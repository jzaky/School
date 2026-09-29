// Invitations and join settings, admin side: invite staff (one or many), parents and students,
// staff join links, the family join code and the "how people sign in" settings.
// Tokens are shown to the inviter once and stored only as a hash.
import type { InviteKind, Prisma } from "@prisma/client";
import { identityDb, tenantTx, type TenantTx } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { execCtx, type Effect, type ExecCtx } from "@/server/db";
import { queueDirectEmail } from "@/server/notify/direct";
import { isEmail } from "@/lib/people-csv";
import { bilingualEmail } from "./email-text";
import { audienceOfRole } from "./permission-catalog";
import { generateJoinCode, generateToken, hashToken, inviteExpiry, inviteState, type InviteState } from "./tokens";
import { ensureStaffProfile, grantRoles } from "./membership-setup";
import type { Actor } from "./roles";

export class InviteError extends Error {
  constructor(public code: string) {
    super(`invite:${code}`);
  }
}

export const MAX_BULK = 500;

type Org = { id: string; nameEn: string; nameAr: string; defaultLocale: "en" | "ar" };

async function orgOf(tx: TenantTx, orgId: string): Promise<Org> {
  const o = await tx.organization.findUnique({ where: { id: orgId }, select: { id: true, nameEn: true, nameAr: true, defaultLocale: true } });
  if (!o) throw new InviteError("NOT_FOUND");
  return o;
}

async function inviterName(tx: TenantTx, actor: Actor) {
  const u = await tx.membership.findUnique({ where: { id: actor.membershipId }, select: { user: { select: { nameEn: true, nameAr: true } } } });
  return { en: u?.user.nameEn ?? "", ar: u?.user.nameAr || u?.user.nameEn || "" };
}

async function sendInviteEmail(ec: ExecCtx, org: Org, inv: { id: string; kind: InviteKind; email: string | null; nameEn: string | null }, token: string, from: { en: string; ar: string }, sendNo: number) {
  if (!inv.email) return false;
  const kind = inv.kind.toLowerCase();
  const mail = bilingualEmail("inviteSubject", `inviteBody_${kind}`, { school: { en: org.nameEn, ar: org.nameAr }, inviter: from, days: 14 }, org.defaultLocale);
  return queueDirectEmail(ec, {
    to: inv.email,
    templateKey: `invite_${kind}`,
    subject: mail.subject,
    body: mail.body,
    href: `/join/${token}`,
    locale: org.defaultLocale,
    idempotencyKey: `invite:${inv.id}:${sendNo}`,
  });
}

export type CreatedInvite = { email: string | null; invitationId: string; token: string; emailed: boolean };

async function revokeOpenFor(tx: TenantTx, kind: InviteKind, email: string, now: Date) {
  await tx.invitation.updateMany({ where: { kind, email, revokedAt: null, uses: 0, expiresAt: { gt: now } }, data: { revokedAt: now } });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export type StaffInviteRow = { nameEn: string; email: string; roleKeys: string[]; department?: string | null };
export type RowProblem = { row: number; code: string };

/**
 * Invite staff by email. Each person gets an "Invited" membership with their roles and department right
 * away (so they appear in the staff list) and a personal link that activates it.
 */
export async function inviteStaff(actor: Actor, rows: StaffInviteRow[], opts: { now?: Date; send?: boolean } = {}) {
  const now = opts.now ?? new Date();
  if (rows.length === 0 || rows.length > MAX_BULK) throw new InviteError("TOO_MANY");
  const created: CreatedInvite[] = [];
  const problems: RowProblem[] = [];
  const effects: Effect[] = [];
  const seen = new Set<string>();

  // Pre-validate and create global users outside the tenant transaction (identity tables are global).
  const prepared: Array<{ row: number; nameEn: string; email: string; roleKeys: string[]; department: string | null; userId: string }> = [];
  const tenant = await tenantTx(actor.orgId, async (tx) => ({
    roles: await tx.role.findMany({ select: { id: true, key: true, nameEn: true, nameAr: true } }),
    departments: await tx.department.findMany({ select: { id: true, nameEn: true, nameAr: true } }),
  }));
  for (const [i, r] of rows.entries()) {
    const row = i + 1;
    const email = r.email?.trim().toLowerCase() ?? "";
    const nameEn = r.nameEn?.trim() ?? "";
    if (!isEmail(email)) { problems.push({ row, code: "EMAIL" }); continue; }
    if (nameEn.length < 2) { problems.push({ row, code: "NAME" }); continue; }
    if (seen.has(email)) { problems.push({ row, code: "DUPLICATE" }); continue; }
    seen.add(email);
    // Roles can be given by key or by name in either language (CSV friendly).
    const keys: string[] = [];
    let badRole = false;
    for (const raw of r.roleKeys.map((k) => k.trim()).filter(Boolean)) {
      const low = raw.toLowerCase();
      const role = tenant.roles.find((x) => x.key === raw || x.nameEn.toLowerCase() === low || x.nameAr === raw);
      if (!role || audienceOfRole(role.key) !== "staff") badRole = true;
      else if (!keys.includes(role.key)) keys.push(role.key);
    }
    if (badRole || keys.length === 0) { problems.push({ row, code: "ROLE" }); continue; }
    let department: string | null = null;
    if (r.department?.trim()) {
      const d = r.department.trim();
      const dep = tenant.departments.find((x) => x.id === d || x.nameEn.toLowerCase() === d.toLowerCase() || x.nameAr === d);
      if (!dep) { problems.push({ row, code: "DEPARTMENT" }); continue; }
      department = dep.id;
    }
    let user = await identityDb.user.findUnique({ where: { email } });
    if (!user) user = await identityDb.user.create({ data: { email, nameEn } });
    prepared.push({ row, nameEn, email, roleKeys: keys, department, userId: user.id });
  }

  await tenantTx(
    actor.orgId,
    async (tx) => {
      const org = await orgOf(tx, actor.orgId);
      const from = await inviterName(tx, actor);
      const ec = execCtx(tx, actor.orgId, { now, actorId: actor.membershipId });
      for (const p of prepared) {
        const existing = await tx.membership.findUnique({ where: { orgId_userId: { orgId: actor.orgId, userId: p.userId } }, select: { id: true, status: true } });
        if (existing && existing.status !== "INVITED") { problems.push({ row: p.row, code: "ALREADY_MEMBER" }); continue; }
        const membershipId = existing?.id ?? (await tx.membership.create({ data: { orgId: actor.orgId, userId: p.userId, status: "INVITED" } })).id;
        await ensureStaffProfile(tx, actor.orgId, membershipId, p.department);
        const roleIds = tenant.roles.filter((r) => p.roleKeys.includes(r.key)).map((r) => r.id);
        await grantRoles(tx, actor.orgId, membershipId, roleIds);
        await revokeOpenFor(tx, "STAFF", p.email, now);
        const token = generateToken();
        const inv = await tx.invitation.create({
          data: { orgId: actor.orgId, kind: "STAFF", email: p.email, nameEn: p.nameEn, roleKeys: p.roleKeys, tokenHash: hashToken(token), expiresAt: inviteExpiry(now), createdById: actor.membershipId, lastSentAt: opts.send === false ? null : now },
        });
        const emailed = opts.send === false ? false : await sendInviteEmail(ec, org, inv, token, from, 1);
        await audit(tx, actor.orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "invite.create", entityType: "Invitation", entityId: inv.id, meta: { kind: "STAFF", roles: p.roleKeys, membershipId, bulk: rows.length > 1 } });
        created.push({ email: p.email, invitationId: inv.id, token, emailed });
      }
      effects.push(...ec.effects);
    },
    { timeout: 60_000 },
  );
  return { created, problems, effects };
}

// ---------------------------------------------------------------------------
// Parents and students
// ---------------------------------------------------------------------------

/** Invite one parent by email for specific children. */
export async function inviteParent(actor: Actor, input: { email: string; nameEn?: string | null; studentIds: string[] }, opts: { now?: Date; send?: boolean } = {}) {
  const now = opts.now ?? new Date();
  const email = input.email.trim().toLowerCase();
  if (!isEmail(email)) throw new InviteError("EMAIL");
  const ids = [...new Set(input.studentIds)];
  if (ids.length === 0 || ids.length > 12) throw new InviteError("CHILDREN");
  return tenantTx(actor.orgId, async (tx) => {
    const found = await tx.student.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) throw new InviteError("CHILDREN");
    const org = await orgOf(tx, actor.orgId);
    const from = await inviterName(tx, actor);
    const ec = execCtx(tx, actor.orgId, { now, actorId: actor.membershipId });
    await revokeOpenFor(tx, "PARENT", email, now);
    const token = generateToken();
    const inv = await tx.invitation.create({
      data: { orgId: actor.orgId, kind: "PARENT", email, nameEn: input.nameEn?.trim() || null, roleKeys: ["parent"], studentIds: ids, tokenHash: hashToken(token), expiresAt: inviteExpiry(now), createdById: actor.membershipId, lastSentAt: opts.send === false ? null : now },
    });
    const emailed = opts.send === false ? false : await sendInviteEmail(ec, org, inv, token, from, 1);
    await audit(tx, actor.orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "invite.create", entityType: "Invitation", entityId: inv.id, meta: { kind: "PARENT", children: ids.length } });
    return { created: [{ email, invitationId: inv.id, token, emailed }] as CreatedInvite[], effects: ec.effects };
  });
}

/** Invite every guardian with an email who is not on the portal yet (typically after a student CSV import). */
export async function inviteAllFamilies(actor: Actor, opts: { now?: Date; send?: boolean } = {}) {
  const now = opts.now ?? new Date();
  return tenantTx(
    actor.orgId,
    async (tx) => {
      const guardians = await tx.guardian.findMany({ where: { membershipId: null, email: { not: null } }, select: { id: true, email: true, firstNameEn: true, lastNameEn: true, links: { select: { studentId: true } } }, take: MAX_BULK });
      const open = await tx.invitation.findMany({ where: { kind: "PARENT", revokedAt: null, uses: 0, expiresAt: { gt: now } }, select: { email: true } });
      const openEmails = new Set(open.map((o) => o.email?.toLowerCase()));
      const org = await orgOf(tx, actor.orgId);
      const from = await inviterName(tx, actor);
      const ec = execCtx(tx, actor.orgId, { now, actorId: actor.membershipId });
      let count = 0;
      let skipped = 0;
      for (const g of guardians) {
        const email = g.email!.trim().toLowerCase();
        if (!isEmail(email) || g.links.length === 0 || openEmails.has(email)) { skipped++; continue; }
        openEmails.add(email);
        const token = generateToken();
        const inv = await tx.invitation.create({
          data: { orgId: actor.orgId, kind: "PARENT", email, nameEn: `${g.firstNameEn} ${g.lastNameEn}`.trim(), roleKeys: ["parent"], studentIds: g.links.map((l) => l.studentId), tokenHash: hashToken(token), expiresAt: inviteExpiry(now), createdById: actor.membershipId, lastSentAt: opts.send === false ? null : now },
        });
        if (opts.send !== false) await sendInviteEmail(ec, org, inv, token, from, 1);
        count++;
      }
      await audit(tx, actor.orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "invite.bulk_families", entityType: "Invitation", meta: { created: count, skipped } });
      return { count, skipped, effects: ec.effects };
    },
    { timeout: 60_000 },
  );
}

/** Invite a student to activate their own account. */
export async function inviteStudent(actor: Actor, input: { studentId: string; email: string }, opts: { now?: Date; send?: boolean } = {}) {
  const now = opts.now ?? new Date();
  const email = input.email.trim().toLowerCase();
  if (!isEmail(email)) throw new InviteError("EMAIL");
  return tenantTx(actor.orgId, async (tx) => {
    const s = await tx.student.findUnique({ where: { id: input.studentId }, select: { id: true, membershipId: true, firstNameEn: true, lastNameEn: true } });
    if (!s) throw new InviteError("NOT_FOUND");
    if (s.membershipId) throw new InviteError("STUDENT_HAS_ACCOUNT");
    const org = await orgOf(tx, actor.orgId);
    const from = await inviterName(tx, actor);
    const ec = execCtx(tx, actor.orgId, { now, actorId: actor.membershipId });
    await revokeOpenFor(tx, "STUDENT", email, now);
    const token = generateToken();
    const inv = await tx.invitation.create({
      data: { orgId: actor.orgId, kind: "STUDENT", email, nameEn: `${s.firstNameEn} ${s.lastNameEn}`, roleKeys: ["student"], studentIds: [s.id], tokenHash: hashToken(token), expiresAt: inviteExpiry(now), createdById: actor.membershipId, lastSentAt: opts.send === false ? null : now },
    });
    const emailed = opts.send === false ? false : await sendInviteEmail(ec, org, inv, token, from, 1);
    await audit(tx, actor.orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "invite.create", entityType: "Invitation", entityId: inv.id, meta: { kind: "STUDENT" } });
    return { created: [{ email, invitationId: inv.id, token, emailed }] as CreatedInvite[], effects: ec.effects };
  });
}

// ---------------------------------------------------------------------------
// Resend, revoke, links
// ---------------------------------------------------------------------------

/** Send a personal invitation again with a fresh link and a new 14-day window. The old link stops working. */
export async function resendInvitation(actor: Actor, invitationId: string, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  return tenantTx(actor.orgId, async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { id: invitationId } });
    if (!inv || !inv.email) throw new InviteError("NOT_FOUND");
    const state = inviteState(inv, now);
    if (state === "ACCEPTED" || state === "REVOKED") throw new InviteError(state);
    const token = generateToken();
    const sends = await tx.auditEvent.count({ where: { entityType: "Invitation", entityId: inv.id, action: "invite.resend" } });
    const updated = await tx.invitation.update({ where: { id: inv.id }, data: { tokenHash: hashToken(token), expiresAt: inviteExpiry(now), lastSentAt: now } });
    const org = await orgOf(tx, actor.orgId);
    const ec = execCtx(tx, actor.orgId, { now, actorId: actor.membershipId });
    const emailed = await sendInviteEmail(ec, org, updated, token, await inviterName(tx, actor), sends + 2);
    await audit(tx, actor.orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "invite.resend", entityType: "Invitation", entityId: inv.id, meta: { kind: inv.kind, before: { expiresAt: inv.expiresAt.toISOString() }, after: { expiresAt: updated.expiresAt.toISOString() } } });
    return { token, emailed, effects: ec.effects };
  });
}

export async function revokeInvitation(actor: Actor, invitationId: string, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  return tenantTx(actor.orgId, async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { id: invitationId } });
    if (!inv) throw new InviteError("NOT_FOUND");
    if (inv.revokedAt) return;
    await tx.invitation.update({ where: { id: inv.id }, data: { revokedAt: now } });
    await audit(tx, actor.orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "invite.revoke", entityType: "Invitation", entityId: inv.id, meta: { kind: inv.kind, before: { state: inviteState(inv, now) }, after: { state: "REVOKED" } } });
  });
}

/** A shareable staff join link: one role, a number of uses and an expiry. */
export async function createStaffLink(actor: Actor, input: { roleKey: string; maxUses: number; days: number }, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const maxUses = Math.floor(input.maxUses);
  const days = Math.floor(input.days);
  if (!(maxUses >= 1 && maxUses <= 500) || !(days >= 1 && days <= 90)) throw new InviteError("INVALID");
  return tenantTx(actor.orgId, async (tx) => {
    const role = await tx.role.findUnique({ where: { orgId_key: { orgId: actor.orgId, key: input.roleKey } }, select: { key: true } });
    if (!role || audienceOfRole(role.key) !== "staff") throw new InviteError("ROLE");
    const token = generateToken();
    const inv = await tx.invitation.create({
      data: { orgId: actor.orgId, kind: "STAFF", email: null, roleKeys: [role.key], maxUses, tokenHash: hashToken(token), expiresAt: inviteExpiry(now, days), createdById: actor.membershipId },
    });
    await audit(tx, actor.orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "invite.link_create", entityType: "Invitation", entityId: inv.id, meta: { role: role.key, maxUses, days } });
    return { token, invitationId: inv.id };
  });
}

// ---------------------------------------------------------------------------
// Join code and sign-in settings
// ---------------------------------------------------------------------------

async function uniqueCode(tx: TenantTx, shortName: string) {
  for (let i = 0; i < 8; i++) {
    const code = generateJoinCode(shortName);
    // Unique index on Organization.joinCode; RLS hides other schools, so collisions surface on update.
    const mine = await tx.organization.findFirst({ where: { joinCode: code }, select: { id: true } });
    if (!mine) return code;
  }
  throw new InviteError("CODE");
}

/** The school's family join code, created on first use. */
export async function ensureJoinCode(orgId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await tenantTx(orgId, async (tx) => {
        const org = await tx.organization.findUnique({ where: { id: orgId }, select: { joinCode: true, shortNameEn: true, nameEn: true } });
        if (!org) throw new InviteError("NOT_FOUND");
        if (org.joinCode) return org.joinCode;
        const code = await uniqueCode(tx, org.shortNameEn || org.nameEn);
        await tx.organization.update({ where: { id: orgId }, data: { joinCode: code } });
        return code;
      });
    } catch (e) {
      if (e instanceof InviteError) throw e;
      // Unique collision with another school's code: the transaction rolled back, try a new code.
    }
  }
  throw new InviteError("CODE");
}

export async function regenerateJoinCode(actor: Actor) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await tenantTx(actor.orgId, async (tx) => {
        const org = await tx.organization.findUnique({ where: { id: actor.orgId }, select: { joinCode: true, shortNameEn: true, nameEn: true } });
        if (!org) throw new InviteError("NOT_FOUND");
        const code = await uniqueCode(tx, org.shortNameEn || org.nameEn);
        await tx.organization.update({ where: { id: actor.orgId }, data: { joinCode: code } });
        await audit(tx, actor.orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "join.code_regenerate", entityType: "Organization", entityId: actor.orgId, meta: { before: org.joinCode ? "set" : null, after: "set" } });
        return code;
      });
    } catch (e) {
      if (e instanceof InviteError) throw e;
      // Unique collision with another school: retry with a new code.
    }
  }
  throw new InviteError("CODE");
}

const PUBLIC_EMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "msn.com"]);

export function cleanDomains(input: string[]): { domains: string[]; problem: string | null } {
  const out: string[] = [];
  for (const raw of input) {
    const d = raw.trim().toLowerCase().replace(/^@/, "");
    if (!d) continue;
    if (!/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) return { domains: [], problem: "DOMAIN" };
    if (PUBLIC_EMAIL_DOMAINS.has(d)) return { domains: [], problem: "PUBLIC_DOMAIN" };
    if (!out.includes(d)) out.push(d);
  }
  if (out.length > 10) return { domains: [], problem: "DOMAIN" };
  return { domains: out, problem: null };
}

export type JoinSettings = {
  googleSignIn: boolean;
  microsoftSignIn: boolean;
  staffEmailDomains: string[];
  staffDomainAutoApprove: boolean;
  parentSelfJoin: boolean;
  parentJoinApproval: boolean;
  studentSelfJoin: boolean;
};

export async function updateJoinSettings(actor: Actor, input: JoinSettings) {
  const { domains, problem } = cleanDomains(input.staffEmailDomains);
  if (problem) throw new InviteError(problem);
  return tenantTx(actor.orgId, async (tx) => {
    const select = { googleSignIn: true, microsoftSignIn: true, staffEmailDomains: true, staffDomainAutoApprove: true, parentSelfJoin: true, parentJoinApproval: true, studentSelfJoin: true } satisfies Prisma.OrganizationSelect;
    const before = await tx.organization.findUnique({ where: { id: actor.orgId }, select });
    if (!before) throw new InviteError("NOT_FOUND");
    const after: JoinSettings = { ...input, staffEmailDomains: domains };
    await tx.organization.update({ where: { id: actor.orgId }, data: after });
    await audit(tx, actor.orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "join.settings_update", entityType: "Organization", entityId: actor.orgId, meta: { before, after } });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export type InviteRow = {
  id: string;
  kind: InviteKind;
  email: string | null;
  nameEn: string | null;
  roleKeys: string[];
  studentIds: string[];
  state: InviteState;
  uses: number;
  maxUses: number;
  expiresAt: Date;
  createdAt: Date;
  lastSentAt: Date | null;
  createdById: string;
  isLink: boolean;
};

export function toRow(inv: { id: string; kind: InviteKind; email: string | null; nameEn: string | null; roleKeys: string[]; studentIds: string[]; uses: number; maxUses: number; expiresAt: Date; createdAt: Date; lastSentAt: Date | null; revokedAt: Date | null; createdById: string }, now: Date): InviteRow {
  return { ...inv, state: inviteState(inv, now), isLink: !inv.email };
}
