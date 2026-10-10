import { ownerPrisma, rawPrisma, withTenant, type Prisma, type TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import { makeContext, type OrgContext } from "../lib/context.js";
import { conflict, forbidden, notFound, validation } from "../lib/errors.js";
import { hasPermission, SYSTEM_ROLES, type Permission } from "../identity/permissions.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";

export const slugSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "lowercase letters, digits and hyphens");

/**
 * Creates an organization with its system roles and makes `ownerUserId` the Owner.
 * Uses the owner connection for the organization row (no tenant exists yet), then a tenant
 * transaction for everything else.
 */
export async function createOrganization(input: { name: string; slug: string; ownerUserId: string; demoMode?: boolean }) {
  const slug = slugSchema.parse(input.slug);
  const existing = await rawPrisma().organization.findUnique({ where: { slug } });
  if (existing) throw conflict("Slug already taken");
  // organizations has no org_id column; it is readable by the app role and created here.
  const org = await rawPrisma().organization.create({ data: { name: input.name.trim(), slug, demoMode: input.demoMode ?? false } });
  await withTenant(org.id, async (db) => {
    const ctx = makeContext(org.id, { type: "user", id: input.ownerUserId });
    const roles = await Promise.all(
      SYSTEM_ROLES.map((r) => db.role.create({ data: { orgId: org.id, key: r.key, name: r.name, description: r.description, permissions: r.permissions, isSystem: true } })),
    );
    const ownerRole = roles.find((r) => r.key === "owner")!;
    await db.membership.create({ data: { orgId: org.id, userId: input.ownerUserId, roleId: ownerRole.id, status: "active" } });
    await appendEvidence(db, ctx, { type: "org.created", subjectType: "organization", subjectId: org.id, payload: { name: org.name, slug: org.slug } });
  });
  return org;
}

export function assertPermission(ctx: OrgContext, needed: Permission) {
  if (ctx.actor.type === "system") return;
  if (!hasPermission(ctx.actor.permissions, needed)) throw forbidden(`Missing permission ${needed}`);
}

export async function getOrganization(orgId: string) {
  const org = await rawPrisma().organization.findUnique({ where: { id: orgId } });
  if (!org) throw notFound("Organization");
  return org;
}

export async function updateOrganization(ctx: OrgContext, patch: { name?: string; settings?: Record<string, unknown> }) {
  assertPermission(ctx, "org:admin");
  const org = await rawPrisma().organization.update({ where: { id: ctx.orgId }, data: { ...(patch.name ? { name: patch.name.trim() } : {}), ...(patch.settings ? { settings: patch.settings as Prisma.InputJsonValue } : {}) } });
  await withTenant(ctx.orgId, (db) => appendEvidence(db, ctx, { type: "org.updated", subjectType: "organization", subjectId: ctx.orgId, payload: { fields: Object.keys(patch) } }));
  return org;
}

// ---------- Members ----------

export async function listMembers(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "users:read");
  const rows = await db.membership.findMany({ where: { orgId: ctx.orgId }, include: { role: true }, orderBy: { createdAt: "asc" } });
  // users is a global table; fetch display fields for the ids we have.
  const users = await rawPrisma().user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, email: true, name: true, mfaEnabled: true, lastLoginAt: true, status: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((m) => ({ ...m, user: byId.get(m.userId) ?? null }));
}

export async function changeMemberRole(db: TenantDb, ctx: OrgContext, membershipId: string, roleId: string) {
  assertPermission(ctx, "users:write");
  const m = await db.membership.findUnique({ where: { id: membershipId }, include: { role: true } });
  if (!m) throw notFound("Membership");
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!role) throw notFound("Role");
  if (m.role.key === "owner") {
    const owners = await db.membership.count({ where: { orgId: ctx.orgId, role: { key: "owner" }, status: "active" } });
    if (owners <= 1 && role.key !== "owner") throw validation("The organization must keep at least one Owner");
  }
  const updated = await db.membership.update({ where: { id: membershipId }, data: { roleId } });
  await appendEvidence(db, ctx, { type: "member.role_changed", subjectType: "membership", subjectId: membershipId, payload: { from: m.role.key, to: role.key } });
  return updated;
}

export async function setMemberStatus(db: TenantDb, ctx: OrgContext, membershipId: string, status: "active" | "suspended") {
  assertPermission(ctx, "users:write");
  const m = await db.membership.findUnique({ where: { id: membershipId }, include: { role: true } });
  if (!m) throw notFound("Membership");
  if (m.userId === ctx.actor.id) throw validation("You cannot change your own status");
  const updated = await db.membership.update({ where: { id: membershipId }, data: { status } });
  await appendEvidence(db, ctx, { type: `member.${status}`, subjectType: "membership", subjectId: membershipId, payload: {} });
  return updated;
}

// ---------- Roles ----------

export async function listRoles(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "users:read");
  const roles = await db.role.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ isSystem: "desc" }, { name: "asc" }] });
  const counts = await db.membership.groupBy({ by: ["roleId"], where: { orgId: ctx.orgId }, _count: { _all: true } });
  const countBy = new Map(counts.map((c) => [c.roleId, c._count._all]));
  return roles.map((r) => ({ ...r, memberCount: countBy.get(r.id) ?? 0 }));
}

export const roleInputSchema = z.object({ key: slugSchema, name: z.string().min(2).max(80), description: z.string().max(300).default(""), permissions: z.array(z.string()).max(50) });

export async function createRole(db: TenantDb, ctx: OrgContext, input: z.infer<typeof roleInputSchema>) {
  assertPermission(ctx, "users:write");
  if (input.permissions.includes("*")) throw validation("Custom roles cannot hold the wildcard permission");
  const role = await db.role.create({ data: { orgId: ctx.orgId, ...input, isSystem: false } });
  await appendEvidence(db, ctx, { type: "role.created", subjectType: "role", subjectId: role.id, payload: { key: role.key, permissions: role.permissions } });
  return role;
}

export async function updateRole(db: TenantDb, ctx: OrgContext, roleId: string, patch: Partial<Pick<z.infer<typeof roleInputSchema>, "name" | "description" | "permissions">>) {
  assertPermission(ctx, "users:write");
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!role) throw notFound("Role");
  if (role.isSystem) throw validation("System roles cannot be edited. Create a custom role instead.");
  if (patch.permissions?.includes("*")) throw validation("Custom roles cannot hold the wildcard permission");
  const updated = await db.role.update({ where: { id: roleId }, data: patch });
  await appendEvidence(db, ctx, { type: "role.updated", subjectType: "role", subjectId: roleId, payload: { fields: Object.keys(patch), permissions: updated.permissions } });
  return updated;
}

export async function deleteRole(db: TenantDb, ctx: OrgContext, roleId: string) {
  assertPermission(ctx, "users:write");
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!role) throw notFound("Role");
  if (role.isSystem) throw validation("System roles cannot be deleted");
  const inUse = await db.membership.count({ where: { roleId } });
  if (inUse > 0) throw validation(`Role is assigned to ${inUse} member(s). Reassign them first.`);
  await db.role.delete({ where: { id: roleId } });
  await appendEvidence(db, ctx, { type: "role.deleted", subjectType: "role", subjectId: roleId, payload: { key: role.key } });
}

// ---------- Teams ----------

export async function listTeams(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "users:read");
  return db.team.findMany({ where: { orgId: ctx.orgId }, include: { members: true }, orderBy: { name: "asc" } });
}

export async function createTeam(db: TenantDb, ctx: OrgContext, input: { key: string; name: string; description?: string }) {
  assertPermission(ctx, "users:write");
  const team = await db.team.create({ data: { orgId: ctx.orgId, key: slugSchema.parse(input.key), name: input.name.trim(), description: input.description ?? "" } });
  await appendEvidence(db, ctx, { type: "team.created", subjectType: "team", subjectId: team.id, payload: { key: team.key } });
  return team;
}

export async function setTeamMembers(db: TenantDb, ctx: OrgContext, teamId: string, membershipIds: string[], leadId?: string) {
  assertPermission(ctx, "users:write");
  const team = await db.team.findUnique({ where: { id: teamId } });
  if (!team) throw notFound("Team");
  await db.teamMember.deleteMany({ where: { teamId } });
  if (membershipIds.length) {
    await db.teamMember.createMany({ data: membershipIds.map((membershipId) => ({ orgId: ctx.orgId, teamId, membershipId, isLead: membershipId === leadId })) });
  }
  await appendEvidence(db, ctx, { type: "team.members_set", subjectType: "team", subjectId: teamId, payload: { count: membershipIds.length } });
}

// ---------- Invitations ----------

export async function inviteUser(db: TenantDb, ctx: OrgContext, input: { email: string; roleId: string }) {
  assertPermission(ctx, "users:write");
  const role = await db.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw notFound("Role");
  const email = input.email.toLowerCase().trim();
  const user = await rawPrisma().user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    const existing = await db.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: user.id } } });
    if (existing) throw conflict("This person is already a member");
  }
  const token = randomToken(24);
  const inv = await db.invitation.create({
    data: { orgId: ctx.orgId, email, roleId: input.roleId, tokenHash: sha256Hex(token), invitedBy: ctx.actor.id!, expiresAt: new Date(Date.now() + 7 * 24 * 3600_000) },
  });
  await appendEvidence(db, ctx, { type: "invitation.created", subjectType: "invitation", subjectId: inv.id, payload: { role: role.key } });
  return { invitation: inv, token };
}

export async function acceptInvitation(token: string, userId: string) {
  const rows = await rawPrisma().$queryRaw<{ id: string; org_id: string; email: string; role_id: string; expires_at: Date; accepted_at: Date | null; org_name: string }[]>`SELECT * FROM aegis_invitation_by_hash(${sha256Hex(token)})`;
  const inv = rows[0];
  if (!inv || inv.accepted_at || inv.expires_at < new Date()) throw notFound("Invitation");
  const user = await rawPrisma().user.findUniqueOrThrow({ where: { id: userId } });
  if (user.email !== inv.email) throw forbidden("This invitation was sent to a different email address");
  await withTenant(inv.org_id, async (db) => {
    const ctx = makeContext(inv.org_id, { type: "user", id: userId });
    await db.membership.upsert({ where: { orgId_userId: { orgId: inv.org_id, userId } }, create: { orgId: inv.org_id, userId, roleId: inv.role_id, status: "active" }, update: { status: "active", roleId: inv.role_id } });
    await db.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    await appendEvidence(db, ctx, { type: "invitation.accepted", subjectType: "invitation", subjectId: inv.id, payload: {} });
  });
  return { orgId: inv.org_id, orgName: inv.org_name };
}

/** Platform admin only: lists every organization (owner connection, logged as a platform event). */
export async function platformListOrganizations(actorUserId: string) {
  const owner = ownerPrisma();
  await owner.platformEvent.create({ data: { type: "platform.tenants_listed", actorId: actorUserId } });
  const orgs = await owner.organization.findMany({ orderBy: { createdAt: "asc" } });
  const agentCounts = await owner.agent.groupBy({ by: ["orgId"], _count: { _all: true } });
  const memberCounts = await owner.membership.groupBy({ by: ["orgId"], _count: { _all: true } });
  const a = new Map(agentCounts.map((c) => [c.orgId, c._count._all]));
  const m = new Map(memberCounts.map((c) => [c.orgId, c._count._all]));
  return orgs.map((o) => ({ ...o, agentCount: a.get(o.id) ?? 0, memberCount: m.get(o.id) ?? 0 }));
}
