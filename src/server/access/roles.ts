// Roles and access: edit role permissions, create, rename and delete roles, and assign roles to people
// (optionally until a date). Every function takes the acting member and runs inside one tenant transaction
// with an audit event. Guardrails (guardrails.ts): audience restrictions, typed confirmation for sensitive
// permissions, nobody raises their own sensitive access, the school always keeps at least one active person
// who can manage roles, and every staff member keeps a role that does not expire.
// Changes to safeguarding or wellbeing access alert the people who manage safeguarding (access-alerts.ts);
// those alerts are returned as post-commit effects for the caller to flush.
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { tenantTx, type TenantTx } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { execCtx, type Effect } from "@/server/db";
import { SYSTEM_ROLES } from "@/server/identity/permissions";
import {
  audienceOfRole,
  disallowedPermissions,
  isKnownPermission,
  isSensitivePermission,
  opensSensitiveRecords,
  permissionAllowedFor,
} from "./permission-catalog";
import {
  checkAccessChange,
  selfEscalation,
  withAssignmentEnd,
  withMemberRoles,
  withRole,
  withRolePermissions,
  withoutRole,
  type AccessSnapshot,
} from "./guardrails";
import { loadSnapshot } from "./snapshot";
import { alertSafeguardingAccess, memberName, type RoleChange } from "./access-alerts";
import { assignmentActive } from "./until";

export type Actor = { orgId: string; membershipId: string; userId: string };

export type AccessErrorCode =
  | "NOT_FOUND"
  | "INVALID"
  | "AUDIENCE"
  | "CONFIRM_REQUIRED"
  | "LAST_ROLES_MANAGER"
  | "SELF_LOCKOUT"
  | "SELF_ESCALATION"
  | "NEEDS_PERMANENT_ROLE"
  | "PAST_DATE"
  | "BUILT_IN"
  | "HAS_MEMBERS"
  | "NOT_STAFF"
  | "FAMILY_ROLE"
  | "NAME_TAKEN";

export class AccessError extends Error {
  constructor(
    public code: AccessErrorCode,
    /** For SELF_ESCALATION: the sensitive permissions the change would have given the actor. */
    public permissions: string[] = [],
  ) {
    super(`access:${code}`);
  }
}

const who = (a: Actor) => ({ actorId: a.membershipId, actorUserId: a.userId });

/** Typed confirmation: the person types the role's name (either language), ignoring case and spaces. */
export function confirmMatches(typed: string | null | undefined, role: { nameEn: string; nameAr: string }) {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const t = norm(typed ?? "");
  return t.length > 0 && (t === norm(role.nameEn) || t === norm(role.nameAr));
}

function guard(before: AccessSnapshot, after: AccessSnapshot, actor: Actor, now: Date, changedMembers: string[] = []) {
  const err = checkAccessChange(before, after, actor.membershipId, now, changedMembers);
  if (err === "SELF_ESCALATION") throw new AccessError(err, selfEscalation(before, after, actor.membershipId, now));
  if (err) throw new AccessError(err);
}

/**
 * Runs a change in its own transaction. A refused attempt to raise one's own sensitive access is
 * recorded in the audit log (in a separate transaction, because the change itself rolls back).
 */
async function change<T>(actor: Actor, path: string, target: Record<string, unknown>, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  try {
    return await tenantTx(actor.orgId, fn);
  } catch (e) {
    if (e instanceof AccessError && e.code === "SELF_ESCALATION") {
      await tenantTx(actor.orgId, (tx) =>
        audit(tx, actor.orgId, {
          ...who(actor),
          action: "access.self_grant_blocked",
          entityType: "Membership",
          entityId: actor.membershipId,
          sensitivity: "CONFIDENTIAL",
          meta: { path, permissions: e.permissions, ...target },
        }),
      ).catch(() => undefined);
    }
    throw e;
  }
}

async function loadRole(tx: TenantTx, roleId: string) {
  const role = await tx.role.findUnique({ where: { id: roleId } });
  if (!role) throw new AccessError("NOT_FOUND");
  return role;
}

const roleName = (r: { nameEn: string; nameAr: string }) => ({ en: r.nameEn, ar: r.nameAr || r.nameEn });
const holdersOf = (s: AccessSnapshot, roleId: string) => s.members.filter((m) => m.roleIds.includes(roleId)).map((m) => m.id);
const activeHolders = (s: AccessSnapshot, roleId: string, now: Date) =>
  s.members.filter((m) => m.status === "ACTIVE" && m.roleIds.includes(roleId) && assignmentActive(m.expires?.[roleId], now)).length;

/** Sends the safeguarding access alert for a change, if it touched safeguarding or wellbeing access. */
async function alert(
  tx: TenantTx,
  actor: Actor,
  now: Date,
  effects: Effect[],
  input: { before: AccessSnapshot; after: AccessSnapshot; memberIds: string[]; roles?: RoleChange[]; changeId: string },
) {
  return alertSafeguardingAccess(execCtx(tx, actor.orgId, { now, effects, actorId: actor.membershipId }), {
    actorId: actor.membershipId,
    who: await memberName(tx, actor.orgId, actor.membershipId),
    ...input,
  });
}

/**
 * For other modules that change a member's roles (the staff edit dialog): throws AccessError when the
 * change would raise the actor's own sensitive access, leave nobody able to manage roles, take that
 * ability from the person making it, or leave the member without a role that does not expire.
 * Returns the before and after snapshots so the caller can send the safeguarding alert after writing.
 */
export async function assertMemberRolesChangeAllowed(tx: TenantTx, actor: Actor, membershipId: string, nextRoleIds: string[], now: Date = new Date()) {
  const before = await loadSnapshot(tx, [actor.membershipId, membershipId], nextRoleIds);
  const after = withMemberRoles(before, membershipId, nextRoleIds);
  guard(before, after, actor, now, [membershipId]);
  return { before, after };
}

/** Alert for a member change made by another module after assertMemberRolesChangeAllowed. Returns post-commit effects. */
export async function alertMemberAccessChange(tx: TenantTx, actor: Actor, input: { before: AccessSnapshot; after: AccessSnapshot; memberIds: string[]; changeId?: string }, now: Date = new Date()) {
  const effects: Effect[] = [];
  await alert(tx, actor, now, effects, { ...input, changeId: input.changeId ?? randomUUID() });
  return effects;
}

// ---------------------------------------------------------------------------
// Role permissions
// ---------------------------------------------------------------------------

export async function setRolePermission(
  actor: Actor,
  input: { roleId: string; permission: string; granted: boolean; confirmText?: string | null },
  opts: { now?: Date } = {},
) {
  if (!isKnownPermission(input.permission)) throw new AccessError("INVALID");
  const now = opts.now ?? new Date();
  return change(actor, "role_permission", { roleId: input.roleId, permission: input.permission }, async (tx) => {
    const role = await loadRole(tx, input.roleId);
    const audience = audienceOfRole(role.key);
    const has = role.permissions.includes(input.permission);
    if (has === input.granted) return { changed: false, effects: [] as Effect[] };
    if (input.granted) {
      if (!permissionAllowedFor(audience, input.permission)) throw new AccessError("AUDIENCE");
      if (isSensitivePermission(input.permission) && !confirmMatches(input.confirmText, role)) throw new AccessError("CONFIRM_REQUIRED");
    }
    const next = input.granted ? [...role.permissions, input.permission] : role.permissions.filter((p) => p !== input.permission);
    const before = await loadSnapshot(tx, [actor.membershipId], [role.id]);
    const after = withRolePermissions(before, role.id, next);
    guard(before, after, actor, now);
    await tx.role.update({ where: { id: role.id }, data: { permissions: next, customized: role.isSystem ? true : role.customized } });
    const changeId = randomUUID();
    await audit(tx, actor.orgId, {
      ...who(actor),
      action: input.granted ? "roles.permission_grant" : "roles.permission_revoke",
      entityType: "Role",
      entityId: role.id,
      sensitivity: isSensitivePermission(input.permission) ? "CONFIDENTIAL" : "STANDARD",
      meta: { role: role.key, permission: input.permission, before: [...role.permissions].sort(), after: [...next].sort(), changeId },
    });
    const effects: Effect[] = [];
    await alert(tx, actor, now, effects, {
      before,
      after,
      memberIds: holdersOf(before, role.id),
      roles: [{ name: roleName(role), before: role.permissions, after: next, holders: activeHolders(before, role.id, now) }],
      changeId,
    });
    return { changed: true, effects };
  });
}

/** Put a built-in role back to the shipped definition and let deploys keep it in step again. */
export async function restoreRoleDefault(actor: Actor, roleId: string, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  return change(actor, "restore_default", { roleId }, async (tx) => {
    const role = await loadRole(tx, roleId);
    const def = SYSTEM_ROLES.find((r) => r.key === role.key);
    if (!role.isSystem || !def) throw new AccessError("NOT_FOUND");
    const before = await loadSnapshot(tx, [actor.membershipId], [role.id]);
    const after = withRolePermissions(before, role.id, def.permissions);
    guard(before, after, actor, now);
    await tx.role.update({
      where: { id: role.id },
      data: { permissions: def.permissions, nameEn: def.nameEn, nameAr: def.nameAr, descEn: def.descEn, descAr: def.descAr, customized: false },
    });
    const changeId = randomUUID();
    await audit(tx, actor.orgId, {
      ...who(actor),
      action: "roles.restore_default",
      entityType: "Role",
      entityId: role.id,
      meta: {
        role: role.key,
        before: { permissions: [...role.permissions].sort(), nameEn: role.nameEn, nameAr: role.nameAr },
        after: { permissions: [...def.permissions].sort(), nameEn: def.nameEn, nameAr: def.nameAr },
        changeId,
      },
    });
    const effects: Effect[] = [];
    await alert(tx, actor, now, effects, {
      before,
      after,
      memberIds: holdersOf(before, role.id),
      roles: [{ name: roleName(def), before: role.permissions, after: def.permissions, holders: activeHolders(before, role.id, now) }],
      changeId,
    });
    return { effects };
  });
}

// ---------------------------------------------------------------------------
// Create, rename, delete
// ---------------------------------------------------------------------------

function slug(s: string) {
  return (
    s
      .normalize("NFD")
      .replace(/[^\x20-\x7e]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "role"
  );
}

export type RoleDetails = { nameEn: string; nameAr: string; descEn?: string | null; descAr?: string | null };

function cleanDetails(d: RoleDetails) {
  const nameEn = d.nameEn.trim().slice(0, 80);
  const nameAr = (d.nameAr.trim() || nameEn).slice(0, 80);
  if (nameEn.length < 2) throw new AccessError("INVALID");
  return { nameEn, nameAr, descEn: d.descEn?.trim().slice(0, 300) || null, descAr: d.descAr?.trim().slice(0, 300) || d.descEn?.trim().slice(0, 300) || null };
}

/**
 * A new staff role, empty or copied from another role (keeping only permissions staff may hold).
 * Nobody holds a new role, so copying never changes anyone's access; adding yourself to the copy is
 * checked like any other self-assignment.
 */
export async function createRole(actor: Actor, input: RoleDetails & { copyFromRoleId?: string | null }, opts: { now?: Date } = {}) {
  const details = cleanDetails(input);
  const now = opts.now ?? new Date();
  return change(actor, "create_role", { copyFromRoleId: input.copyFromRoleId ?? null }, async (tx) => {
    const taken = await tx.role.findFirst({ where: { OR: [{ nameEn: { equals: details.nameEn, mode: "insensitive" } }, { nameAr: details.nameAr }] }, select: { id: true } });
    if (taken) throw new AccessError("NAME_TAKEN");
    let permissions: string[] = [];
    let copiedFrom: string | null = null;
    if (input.copyFromRoleId) {
      const src = await loadRole(tx, input.copyFromRoleId);
      const bad = new Set(disallowedPermissions("staff", src.permissions));
      permissions = src.permissions.filter((p) => !bad.has(p));
      copiedFrom = src.key;
    }
    const base = `custom_${slug(details.nameEn)}`;
    let key = base;
    for (let i = 2; await tx.role.findUnique({ where: { orgId_key: { orgId: actor.orgId, key } }, select: { id: true } }); i++) key = `${base}_${i}`;
    const before = await loadSnapshot(tx, [actor.membershipId]);
    const role = await tx.role.create({ data: { orgId: actor.orgId, key, ...details, permissions, isSystem: false, customized: false } });
    const after = withRole(before, { id: role.id, permissions });
    guard(before, after, actor, now);
    const changeId = randomUUID();
    await audit(tx, actor.orgId, {
      ...who(actor),
      action: "roles.create",
      entityType: "Role",
      entityId: role.id,
      meta: { role: key, copiedFrom, before: null, after: { nameEn: details.nameEn, nameAr: details.nameAr, permissions: [...permissions].sort() }, changeId },
    });
    const effects: Effect[] = [];
    await alert(tx, actor, now, effects, { before, after, memberIds: [], roles: [{ name: roleName(details), before: [], after: permissions, holders: 0 }], changeId });
    return { ...role, effects };
  });
}

export async function updateRoleDetails(actor: Actor, input: RoleDetails & { roleId: string }) {
  const details = cleanDetails(input);
  return tenantTx(actor.orgId, async (tx) => {
    const role = await loadRole(tx, input.roleId);
    const taken = await tx.role.findFirst({
      where: { id: { not: role.id }, OR: [{ nameEn: { equals: details.nameEn, mode: "insensitive" } }, { nameAr: details.nameAr }] },
      select: { id: true },
    });
    if (taken) throw new AccessError("NAME_TAKEN");
    await tx.role.update({ where: { id: role.id }, data: { ...details, customized: role.isSystem ? true : role.customized } });
    await audit(tx, actor.orgId, {
      ...who(actor),
      action: "roles.rename",
      entityType: "Role",
      entityId: role.id,
      meta: { role: role.key, before: { nameEn: role.nameEn, nameAr: role.nameAr, descEn: role.descEn, descAr: role.descAr }, after: details },
    });
  });
}

/** Delete a school-made role. Members must be moved to another role first (or in the same step). */
export async function deleteRole(actor: Actor, input: { roleId: string; moveToRoleId?: string | null }, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  return change(actor, "delete_role", { roleId: input.roleId, moveToRoleId: input.moveToRoleId ?? null }, async (tx) => {
    const role = await loadRole(tx, input.roleId);
    if (role.isSystem) throw new AccessError("BUILT_IN");
    const members = await tx.membershipRole.findMany({ where: { roleId: role.id }, select: { membershipId: true, expiresAt: true } });
    let target: { id: string; key: string } | null = null;
    if (members.length > 0) {
      if (!input.moveToRoleId || input.moveToRoleId === role.id) throw new AccessError("HAS_MEMBERS");
      const t = await loadRole(tx, input.moveToRoleId);
      if (audienceOfRole(t.key) !== "staff") throw new AccessError("AUDIENCE");
      target = { id: t.id, key: t.key };
    }
    const memberIds = members.map((m) => m.membershipId);
    const before = await loadSnapshot(tx, [actor.membershipId, ...memberIds], [role.id]);
    let after = withoutRole(before, role.id);
    if (target) {
      // Moved people keep the end date they had on the deleted role.
      const tid = target.id;
      for (const m of members) {
        const cur = after.members.find((x) => x.id === m.membershipId);
        if (!cur || cur.roleIds.includes(tid)) continue;
        after = withMemberRoles(after, m.membershipId, [...cur.roleIds, tid], { [tid]: m.expiresAt });
      }
    }
    guard(before, after, actor, now, memberIds);
    if (target) {
      await tx.membershipRole.createMany({
        data: members.map((m) => ({ orgId: actor.orgId, membershipId: m.membershipId, roleId: target!.id, expiresAt: m.expiresAt })),
        skipDuplicates: true,
      });
    }
    await tx.role.delete({ where: { id: role.id } });
    const changeId = randomUUID();
    await audit(tx, actor.orgId, {
      ...who(actor),
      action: "roles.delete",
      entityType: "Role",
      entityId: role.id,
      meta: { role: role.key, movedTo: target?.key ?? null, membersMoved: members.length, before: { nameEn: role.nameEn, permissions: [...role.permissions].sort() }, after: null, changeId },
    });
    const effects: Effect[] = [];
    await alert(tx, actor, now, effects, {
      before,
      after,
      memberIds,
      roles: members.length ? [] : [{ name: roleName(role), before: role.permissions, after: [], holders: 0, deleted: true }],
      changeId,
    });
    return { effects };
  });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

async function staffMembership(tx: TenantTx, membershipId: string) {
  const m = await tx.membership.findUnique({
    where: { id: membershipId },
    include: { roles: { include: { role: true } }, student: { select: { id: true } }, guardian: { select: { id: true } } },
  });
  if (!m) throw new AccessError("NOT_FOUND");
  if (m.student || m.guardian || m.roles.some((r) => audienceOfRole(r.role.key) !== "staff")) throw new AccessError("NOT_STAFF");
  return m;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Set exactly which staff roles a staff member holds. Roles granting sensitive permissions need the
 * caller to confirm (the UI shows a warning first). `expires` gives newly added roles an end date.
 * Takes effect on the member's next request, because permissions are read from the database on every request.
 */
export async function setMemberRoles(
  actor: Actor,
  input: { membershipId: string; roleIds: string[]; confirmSensitive?: boolean; expires?: Record<string, Date | null> },
  opts: { now?: Date; path?: string } = {},
) {
  const wanted = [...new Set(input.roleIds)];
  if (wanted.length === 0) throw new AccessError("INVALID");
  const now = opts.now ?? new Date();
  return change(actor, opts.path ?? "member_roles", { membershipId: input.membershipId, roleIds: wanted }, async (tx) => {
    const m = await staffMembership(tx, input.membershipId);
    const roles = await tx.role.findMany({ where: { id: { in: wanted } } });
    if (roles.length !== wanted.length) throw new AccessError("NOT_FOUND");
    if (roles.some((r) => audienceOfRole(r.key) !== "staff")) throw new AccessError("FAMILY_ROLE");
    const current = m.roles.map((r) => r.roleId);
    const added = roles.filter((r) => !current.includes(r.id));
    if (added.some((r) => opensSensitiveRecords(r.permissions)) && !input.confirmSensitive) {
      throw new AccessError("CONFIRM_REQUIRED");
    }
    const expires: Record<string, Date | null> = {};
    for (const r of added) {
      const e = input.expires?.[r.id] ?? null;
      if (e && e.getTime() <= now.getTime()) throw new AccessError("PAST_DATE");
      expires[r.id] = e;
    }
    const before = await loadSnapshot(tx, [actor.membershipId, m.id], wanted);
    const after = withMemberRoles(before, m.id, wanted, expires);
    guard(before, after, actor, now, [m.id]);
    await tx.membershipRole.deleteMany({ where: { membershipId: m.id, roleId: { notIn: wanted } } });
    await tx.membershipRole.createMany({
      data: wanted.map((roleId) => ({ orgId: actor.orgId, membershipId: m.id, roleId, expiresAt: expires[roleId] ?? null })),
      skipDuplicates: true,
    });
    const keysBefore = m.roles.map((r) => r.role.key).sort();
    const keysAfter = roles.map((r) => r.key).sort();
    const until = Object.fromEntries(
      roles
        .map((r) => [r.key, iso(r.id in expires ? expires[r.id] : m.roles.find((x) => x.roleId === r.id)?.expiresAt)] as const)
        .filter(([, v]) => v !== null),
    );
    const changeId = randomUUID();
    await audit(tx, actor.orgId, {
      ...who(actor),
      action: "people.roles_change",
      entityType: "Membership",
      entityId: m.id,
      sensitivity: [...added, ...m.roles.filter((r) => !wanted.includes(r.roleId)).map((r) => r.role)].some((r) => opensSensitiveRecords(r.permissions)) ? "CONFIDENTIAL" : "STANDARD",
      meta: { before: keysBefore, after: keysAfter, ...(Object.keys(until).length ? { until } : {}), ...(opts.path === "end_early" ? { endedEarly: true } : {}), changeId },
    });
    const effects: Effect[] = [];
    await alert(tx, actor, now, effects, { before, after, memberIds: [m.id], changeId });
    return { before: keysBefore, after: keysAfter, effects };
  });
}

export async function addRoleMember(actor: Actor, input: { roleId: string; membershipId: string; confirmSensitive?: boolean; expiresAt?: Date | null }, opts: { now?: Date } = {}) {
  const current = await tenantTx(actor.orgId, async (tx) => {
    const role = await loadRole(tx, input.roleId);
    if (audienceOfRole(role.key) !== "staff") throw new AccessError("FAMILY_ROLE");
    const m = await staffMembership(tx, input.membershipId);
    return m.roles.map((r) => r.roleId);
  });
  if (current.includes(input.roleId)) return { before: [], after: [], effects: [] as Effect[] };
  return setMemberRoles(
    actor,
    { membershipId: input.membershipId, roleIds: [...current, input.roleId], confirmSensitive: input.confirmSensitive, expires: { [input.roleId]: input.expiresAt ?? null } },
    { now: opts.now, path: "add_member" },
  );
}

/** End a role assignment now (also "end access early" for time-limited assignments). */
export async function removeRoleMember(actor: Actor, input: { roleId: string; membershipId: string }, opts: { now?: Date } = {}) {
  const current = await tenantTx(actor.orgId, async (tx) => {
    const role = await loadRole(tx, input.roleId);
    if (audienceOfRole(role.key) !== "staff") throw new AccessError("FAMILY_ROLE");
    const m = await staffMembership(tx, input.membershipId);
    return m.roles.map((r) => ({ roleId: r.roleId, expiresAt: r.expiresAt }));
  });
  const next = current.filter((r) => r.roleId !== input.roleId).map((r) => r.roleId);
  if (next.length === current.length) return { before: [], after: [], effects: [] as Effect[] };
  // A staff member always keeps at least one role.
  if (next.length === 0) throw new AccessError("INVALID");
  const ending = current.find((r) => r.roleId === input.roleId);
  return setMemberRoles(actor, { membershipId: input.membershipId, roleIds: next, confirmSensitive: true }, { now: opts.now, path: ending?.expiresAt ? "end_early" : "remove_member" });
}

/**
 * Change when a role assignment ends: extend it, shorten it, give it an end date, or (null) make it
 * permanent. Making your own sensitive access last longer counts as raising it and is refused.
 */
export async function setAssignmentEnd(actor: Actor, input: { roleId: string; membershipId: string; expiresAt: Date | null }, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) throw new AccessError("PAST_DATE");
  return change(actor, "assignment_end", { roleId: input.roleId, membershipId: input.membershipId, expiresAt: iso(input.expiresAt) }, async (tx) => {
    const m = await staffMembership(tx, input.membershipId);
    const row = m.roles.find((r) => r.roleId === input.roleId);
    if (!row) throw new AccessError("NOT_FOUND");
    if (iso(row.expiresAt) === iso(input.expiresAt)) return { changed: false, effects: [] as Effect[] };
    const before = await loadSnapshot(tx, [actor.membershipId, m.id], [input.roleId]);
    const after = withAssignmentEnd(before, m.id, input.roleId, input.expiresAt);
    guard(before, after, actor, now, [m.id]);
    await tx.membershipRole.update({ where: { id: row.id }, data: { expiresAt: input.expiresAt } });
    const changeId = randomUUID();
    await audit(tx, actor.orgId, {
      ...who(actor),
      action: "people.role_end_change",
      entityType: "Membership",
      entityId: m.id,
      sensitivity: opensSensitiveRecords(row.role.permissions) ? "CONFIDENTIAL" : "STANDARD",
      meta: { role: row.role.key, before: iso(row.expiresAt), after: iso(input.expiresAt), changeId },
    });
    const effects: Effect[] = [];
    await alert(tx, actor, now, effects, { before, after, memberIds: [m.id], changeId });
    return { changed: true, effects };
  });
}

// ---------------------------------------------------------------------------
// Access check
// ---------------------------------------------------------------------------

/**
 * For each permission the person has, which of their roles grants it. Suspended or pending members have
 * none, and time-limited assignments that have ended grant nothing.
 */
export function explainAccess(membership: { status: string; roles: Array<{ expiresAt?: Date | null; role: { key: string; permissions: string[] } }> }, now: Date = new Date()) {
  const out = new Map<string, string[]>();
  if (membership.status !== "ACTIVE") return out;
  for (const r of membership.roles) {
    if (!assignmentActive(r.expiresAt, now)) continue;
    for (const p of r.role.permissions) out.set(p, [...(out.get(p) ?? []), r.role.key]);
  }
  return out;
}

export const STAFF_MEMBERSHIP_WHERE: Prisma.MembershipWhereInput = {
  student: { is: null },
  guardian: { is: null },
  roles: { some: {}, none: { role: { key: { in: ["parent", "student"] } } } },
};
