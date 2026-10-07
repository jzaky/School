// Platform-level school group administration.
//
// This is the documented "platform admin" exception to CLAUDE.md hard rule 2: groups sit above schools, and
// app_user may not create groups, assign schools or redeem another party's invite code (prisma/rls.sql,
// section 4). These narrow functions use the owner client (catalogDb). Rules:
// - Callers check the actor first: platform admin for group and member management, school.manage in the
//   school for redeeming a code (see actions.ts). Inputs are validated here as well.
// - Nothing here reads school (tenant) data. Organization rows are read for names only.
// - Every change that concerns a school writes an AuditEvent in that school through tenantDb.
import type { GroupRole } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { slugCandidates } from "@/lib/signup";
import { audit } from "@/server/audit/audit";
import { catalogDb, type CatalogDb } from "@/server/platform/catalog-db";
import { groupInviteState, hashGroupCode, normalizeGroupCode } from "./codes";

export class GroupPlatformError extends Error {
  constructor(public code: "unavailable" | "invalid" | "not_found" | "in_group" | "no_user" | "code_invalid" | "code_used" | "code_expired") {
    super(`group-platform:${code}`);
  }
}

function owner(): CatalogDb {
  const db = catalogDb();
  if (!db) throw new GroupPlatformError("unavailable");
  return db;
}

const clean = (s: unknown, max = 120) => String(s ?? "").trim().slice(0, max);

/** Every group with its schools and people (platform admin page). */
export async function listAllGroups(db: CatalogDb = owner()) {
  const groups = await db.schoolGroup.findMany({
    orderBy: { createdAt: "asc" },
    include: { schools: { orderBy: { joinedAt: "asc" }, include: { org: { select: { id: true, nameEn: true, nameAr: true, slug: true } } } }, members: { orderBy: { createdAt: "asc" } } },
  });
  const userIds = [...new Set(groups.flatMap((g) => g.members.map((m) => m.userId)))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, nameEn: true, nameAr: true } }) : [];
  return groups.map((g) => ({
    ...g,
    members: g.members.map((m) => ({ ...m, user: users.find((u) => u.id === m.userId) ?? null })),
  }));
}

/** Schools that are not in any group yet. Demo-only test schools are included; names only. */
export async function listUngroupedSchools(db: CatalogDb = owner()) {
  return db.organization.findMany({ where: { groupLink: null }, orderBy: { nameEn: "asc" }, select: { id: true, nameEn: true, nameAr: true, slug: true } });
}

export async function createGroup(input: { nameEn: string; nameAr: string; actorUserId: string }, db: CatalogDb = owner()) {
  const nameEn = clean(input.nameEn);
  const nameAr = clean(input.nameAr);
  if (nameEn.length < 2 || nameAr.length < 2) throw new GroupPlatformError("invalid");
  const candidates = slugCandidates(nameEn, 20);
  const taken = new Set((await db.schoolGroup.findMany({ where: { slug: { in: candidates } }, select: { slug: true } })).map((g) => g.slug));
  const slug = candidates.find((c) => !taken.has(c)) ?? `${candidates[0]}-${Date.now().toString(36)}`;
  return db.schoolGroup.create({ data: { slug, nameEn, nameAr, createdById: input.actorUserId } });
}

export async function updateGroup(input: { groupId: string; nameEn: string; nameAr: string }, db: CatalogDb = owner()) {
  const nameEn = clean(input.nameEn);
  const nameAr = clean(input.nameAr);
  if (nameEn.length < 2 || nameAr.length < 2) throw new GroupPlatformError("invalid");
  return db.schoolGroup.update({ where: { id: input.groupId }, data: { nameEn, nameAr } });
}

export async function setGroupLogo(groupId: string, key: string | null, db: CatalogDb = owner()) {
  return db.schoolGroup.update({ where: { id: groupId }, data: { logoUrl: key } });
}

/** Platform admin puts a school in a group. Audited in the school. */
export async function assignSchool(input: { groupId: string; orgId: string; actorUserId: string }, db: CatalogDb = owner()) {
  const [group, org, existing] = await Promise.all([
    db.schoolGroup.findUnique({ where: { id: input.groupId } }),
    db.organization.findUnique({ where: { id: input.orgId }, select: { id: true } }),
    db.schoolGroupSchool.findUnique({ where: { orgId: input.orgId } }),
  ]);
  if (!group || !org) throw new GroupPlatformError("not_found");
  if (existing) throw new GroupPlatformError("in_group");
  const link = await db.schoolGroupSchool.create({ data: { groupId: group.id, orgId: org.id, via: "platform", addedById: input.actorUserId } });
  await audit(tenantDb(org.id), org.id, { actorUserId: input.actorUserId, action: "group.school_added", entityType: "SchoolGroup", entityId: group.id, meta: { via: "platform", groupNameEn: group.nameEn } });
  return link;
}

/** Platform admin takes a school out of its group. Audited in the school. */
export async function removeSchoolFromGroup(input: { groupId: string; orgId: string; actorUserId: string }, db: CatalogDb = owner()) {
  const link = await db.schoolGroupSchool.findUnique({ where: { orgId: input.orgId } });
  if (!link || link.groupId !== input.groupId) throw new GroupPlatformError("not_found");
  await db.schoolGroupSchool.delete({ where: { id: link.id } });
  await audit(tenantDb(input.orgId), input.orgId, { actorUserId: input.actorUserId, action: "group.school_removed", entityType: "SchoolGroup", entityId: input.groupId, meta: { via: "platform" } });
}

/** Give an existing account a group role. Accounts are not created here. */
export async function setGroupMember(input: { groupId: string; email: string; role: GroupRole; titleEn?: string; titleAr?: string }, db: CatalogDb = owner()) {
  const email = clean(input.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["ADMIN", "VIEWER"].includes(input.role)) throw new GroupPlatformError("invalid");
  const [group, user] = await Promise.all([db.schoolGroup.findUnique({ where: { id: input.groupId } }), db.user.findUnique({ where: { email } })]);
  if (!group) throw new GroupPlatformError("not_found");
  if (!user) throw new GroupPlatformError("no_user");
  const titles = { titleEn: clean(input.titleEn) || null, titleAr: clean(input.titleAr) || null };
  return db.groupMember.upsert({
    where: { groupId_userId: { groupId: group.id, userId: user.id } },
    create: { groupId: group.id, userId: user.id, role: input.role, ...titles },
    update: { role: input.role, ...titles },
  });
}

export async function removeGroupMember(input: { groupId: string; memberId: string }, db: CatalogDb = owner()) {
  const m = await db.groupMember.findUnique({ where: { id: input.memberId } });
  if (!m || m.groupId !== input.groupId) throw new GroupPlatformError("not_found");
  await db.groupMember.delete({ where: { id: m.id } });
}

async function findInvite(code: string, db: CatalogDb, now: Date) {
  const normalized = normalizeGroupCode(code);
  if (!normalized) throw new GroupPlatformError("code_invalid");
  const invite = await db.groupInvite.findUnique({ where: { codeHash: hashGroupCode(normalized) }, include: { group: { select: { id: true, nameEn: true, nameAr: true, logoUrl: true } } } });
  if (!invite) throw new GroupPlatformError("code_invalid");
  const state = groupInviteState(invite, now);
  if (state === "USED") throw new GroupPlatformError("code_used");
  if (state === "REVOKED") throw new GroupPlatformError("code_invalid");
  if (state === "EXPIRED") throw new GroupPlatformError("code_expired");
  return invite;
}

/** What a school admin sees before accepting: the group's name only. */
export async function previewGroupInvite(code: string, db: CatalogDb = owner(), now = new Date()) {
  const invite = await findInvite(code, db, now);
  return { groupId: invite.group.id, nameEn: invite.group.nameEn, nameAr: invite.group.nameAr, expiresAt: invite.expiresAt };
}

/**
 * The school's side of the agreement: a school admin redeems a code a group admin created.
 * Single use: the invite is claimed with a conditional update, so two schools cannot use one code.
 */
export async function redeemGroupInvite(input: { code: string; orgId: string; actorUserId: string; actorMembershipId: string }, db: CatalogDb = owner(), now = new Date()) {
  const invite = await findInvite(input.code, db, now);
  const existing = await db.schoolGroupSchool.findUnique({ where: { orgId: input.orgId } });
  if (existing) throw new GroupPlatformError("in_group");
  await db.$transaction(async (tx) => {
    const claimed = await tx.groupInvite.updateMany({ where: { id: invite.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { usedAt: now, usedByOrgId: input.orgId } });
    if (claimed.count !== 1) throw new GroupPlatformError("code_used");
    await tx.schoolGroupSchool.create({ data: { groupId: invite.groupId, orgId: input.orgId, via: "invite", addedById: input.actorUserId, joinedAt: now } });
  });
  await audit(tenantDb(input.orgId), input.orgId, {
    actorId: input.actorMembershipId,
    actorUserId: input.actorUserId,
    action: "group.joined",
    entityType: "SchoolGroup",
    entityId: invite.groupId,
    meta: { via: "invite", inviteId: invite.id, groupNameEn: invite.group.nameEn },
  });
  return { groupId: invite.groupId, nameEn: invite.group.nameEn, nameAr: invite.group.nameAr };
}
