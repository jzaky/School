// Roles and access: edit role permissions, create, rename and delete roles, and assign roles to people.
// Every function takes the acting member and runs inside one tenant transaction with an audit event.
// Guardrails: audience restrictions, typed confirmation for sensitive permissions, and the school always
// keeps at least one active person who can manage roles (never the person making the change by accident).
import type { Prisma } from "@prisma/client";
import { tenantTx, type TenantTx } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { SYSTEM_ROLES } from "@/server/identity/permissions";
import {
  audienceOfRole,
  disallowedPermissions,
  isKnownPermission,
  isSensitivePermission,
  permissionAllowedFor,
} from "./permission-catalog";
import { checkAccessChange, withMemberRoles, withRolePermissions, withoutRole, type AccessSnapshot } from "./guardrails";

export type Actor = { orgId: string; membershipId: string; userId: string };

export type AccessErrorCode =
  | "NOT_FOUND"
  | "INVALID"
  | "AUDIENCE"
  | "CONFIRM_REQUIRED"
  | "LAST_ROLES_MANAGER"
  | "SELF_LOCKOUT"
  | "BUILT_IN"
  | "HAS_MEMBERS"
  | "NOT_STAFF"
  | "FAMILY_ROLE"
  | "NAME_TAKEN";

export class AccessError extends Error {
  constructor(public code: AccessErrorCode) {
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

/** Everyone who could be affected by a change: current role managers plus the given members and roles. */
async function snapshot(tx: TenantTx, memberIds: string[], roleIds: string[]): Promise<AccessSnapshot> {
  const roles = await tx.role.findMany({ select: { id: true, permissions: true } });
  const managerRoleIds = roles.filter((r) => r.permissions.includes("roles.manage")).map((r) => r.id);
  const members = await tx.membership.findMany({
    where: {
      OR: [
        { id: { in: memberIds } },
        { roles: { some: { roleId: { in: [...managerRoleIds, ...roleIds] } } } },
      ],
    },
    select: { id: true, status: true, roles: { select: { roleId: true } } },
  });
  return { roles, members: members.map((m) => ({ id: m.id, status: m.status, roleIds: m.roles.map((r) => r.roleId) })) };
}

function guard(before: AccessSnapshot, after: AccessSnapshot, actor: Actor) {
  const err = checkAccessChange(before, after, actor.membershipId);
  if (err) throw new AccessError(err);
}

async function loadRole(tx: TenantTx, roleId: string) {
  const role = await tx.role.findUnique({ where: { id: roleId } });
  if (!role) throw new AccessError("NOT_FOUND");
  return role;
}

/**
 * For other modules that change a member's roles (the staff edit dialog): throws AccessError when the
 * change would leave nobody able to manage roles, or take that ability from the person making it.
 */
export async function assertMemberRolesChangeAllowed(tx: TenantTx, actor: Actor, membershipId: string, nextRoleIds: string[]) {
  const before = await snapshot(tx, [actor.membershipId, membershipId], nextRoleIds);
  guard(before, withMemberRoles(before, membershipId, nextRoleIds), actor);
}

// ---------------------------------------------------------------------------
// Role permissions
// ---------------------------------------------------------------------------

export async function setRolePermission(
  actor: Actor,
  input: { roleId: string; permission: string; granted: boolean; confirmText?: string | null },
) {
  if (!isKnownPermission(input.permission)) throw new AccessError("INVALID");
  return tenantTx(actor.orgId, async (tx) => {
    const role = await loadRole(tx, input.roleId);
    const audience = audienceOfRole(role.key);
    const has = role.permissions.includes(input.permission);
    if (has === input.granted) return { changed: false };
    if (input.granted) {
      if (!permissionAllowedFor(audience, input.permission)) throw new AccessError("AUDIENCE");
      if (isSensitivePermission(input.permission) && !confirmMatches(input.confirmText, role)) throw new AccessError("CONFIRM_REQUIRED");
    }
    const next = input.granted ? [...role.permissions, input.permission] : role.permissions.filter((p) => p !== input.permission);
    const before = await snapshot(tx, [actor.membershipId], [role.id]);
    guard(before, withRolePermissions(before, role.id, next), actor);
    await tx.role.update({ where: { id: role.id }, data: { permissions: next, customized: role.isSystem ? true : role.customized } });
    await audit(tx, actor.orgId, {
      ...who(actor),
      action: input.granted ? "roles.permission_grant" : "roles.permission_revoke",
      entityType: "Role",
      entityId: role.id,
      sensitivity: isSensitivePermission(input.permission) ? "CONFIDENTIAL" : "STANDARD",
      meta: { role: role.key, permission: input.permission, before: [...role.permissions].sort(), after: [...next].sort() },
    });
    return { changed: true };
  });
}

/** Put a built-in role back to the shipped definition and let deploys keep it in step again. */
export async function restoreRoleDefault(actor: Actor, roleId: string) {
  return tenantTx(actor.orgId, async (tx) => {
    const role = await loadRole(tx, roleId);
    const def = SYSTEM_ROLES.find((r) => r.key === role.key);
    if (!role.isSystem || !def) throw new AccessError("NOT_FOUND");
    const before = await snapshot(tx, [actor.membershipId], [role.id]);
    guard(before, withRolePermissions(before, role.id, def.permissions), actor);
    await tx.role.update({
      where: { id: role.id },
      data: { permissions: def.permissions, nameEn: def.nameEn, nameAr: def.nameAr, descEn: def.descEn, descAr: def.descAr, customized: false },
    });
    await audit(tx, actor.orgId, {
      ...who(actor),
      action: "roles.restore_default",
      entityType: "Role",
      entityId: role.id,
      meta: {
        role: role.key,
        before: { permissions: [...role.permissions].sort(), nameEn: role.nameEn, nameAr: role.nameAr },
        after: { permissions: [...def.permissions].sort(), nameEn: def.nameEn, nameAr: def.nameAr },
      },
    });
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

/** A new staff role, empty or copied from another role (keeping only permissions staff may hold). */
export async function createRole(actor: Actor, input: RoleDetails & { copyFromRoleId?: string | null }) {
  const details = cleanDetails(input);
  return tenantTx(actor.orgId, async (tx) => {
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
    const role = await tx.role.create({ data: { orgId: actor.orgId, key, ...details, permissions, isSystem: false, customized: false } });
    await audit(tx, actor.orgId, {
      ...who(actor),
      action: "roles.create",
      entityType: "Role",
      entityId: role.id,
      meta: { role: key, copiedFrom, before: null, after: { nameEn: details.nameEn, nameAr: details.nameAr, permissions: [...permissions].sort() } },
    });
    return role;
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
export async function deleteRole(actor: Actor, input: { roleId: string; moveToRoleId?: string | null }) {
  return tenantTx(actor.orgId, async (tx) => {
    const role = await loadRole(tx, input.roleId);
    if (role.isSystem) throw new AccessError("BUILT_IN");
    const members = await tx.membershipRole.findMany({ where: { roleId: role.id }, select: { membershipId: true } });
    let target: { id: string; key: string } | null = null;
    if (members.length > 0) {
      if (!input.moveToRoleId || input.moveToRoleId === role.id) throw new AccessError("HAS_MEMBERS");
      const t = await loadRole(tx, input.moveToRoleId);
      if (audienceOfRole(t.key) !== "staff") throw new AccessError("AUDIENCE");
      target = { id: t.id, key: t.key };
    }
    const before = await snapshot(tx, [actor.membershipId, ...members.map((m) => m.membershipId)], [role.id]);
    let after = withoutRole(before, role.id);
    if (target) {
      const tid = target.id;
      after = { roles: after.roles, members: after.members.map((m) => (members.some((x) => x.membershipId === m.id) && !m.roleIds.includes(tid) ? { ...m, roleIds: [...m.roleIds, tid] } : m)) };
    }
    guard(before, after, actor);
    if (target) {
      await tx.membershipRole.createMany({
        data: members.map((m) => ({ orgId: actor.orgId, membershipId: m.membershipId, roleId: target!.id })),
        skipDuplicates: true,
      });
    }
    await tx.role.delete({ where: { id: role.id } });
    await audit(tx, actor.orgId, {
      ...who(actor),
      action: "roles.delete",
      entityType: "Role",
      entityId: role.id,
      meta: { role: role.key, movedTo: target?.key ?? null, membersMoved: members.length, before: { nameEn: role.nameEn, permissions: [...role.permissions].sort() }, after: null },
    });
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

/**
 * Set exactly which staff roles a staff member holds. Roles granting sensitive permissions need the
 * caller to confirm (the UI shows a warning first). Takes effect on the member's next request, because
 * permissions are read from the database on every request.
 */
export async function setMemberRoles(actor: Actor, input: { membershipId: string; roleIds: string[]; confirmSensitive?: boolean }) {
  const wanted = [...new Set(input.roleIds)];
  if (wanted.length === 0) throw new AccessError("INVALID");
  return tenantTx(actor.orgId, async (tx) => {
    const m = await staffMembership(tx, input.membershipId);
    const roles = await tx.role.findMany({ where: { id: { in: wanted } } });
    if (roles.length !== wanted.length) throw new AccessError("NOT_FOUND");
    if (roles.some((r) => audienceOfRole(r.key) !== "staff")) throw new AccessError("FAMILY_ROLE");
    const current = m.roles.map((r) => r.roleId);
    const added = roles.filter((r) => !current.includes(r.id));
    if (added.some((r) => r.permissions.some(isSensitivePermission) && !m.roles.some((x) => x.role.permissions.some(isSensitivePermission))) && !input.confirmSensitive) {
      throw new AccessError("CONFIRM_REQUIRED");
    }
    const before = await snapshot(tx, [actor.membershipId, m.id], wanted);
    guard(before, withMemberRoles(before, m.id, wanted), actor);
    await tx.membershipRole.deleteMany({ where: { membershipId: m.id, roleId: { notIn: wanted } } });
    await tx.membershipRole.createMany({ data: wanted.map((roleId) => ({ orgId: actor.orgId, membershipId: m.id, roleId })), skipDuplicates: true });
    const keysBefore = m.roles.map((r) => r.role.key).sort();
    const keysAfter = roles.map((r) => r.key).sort();
    await audit(tx, actor.orgId, {
      ...who(actor),
      action: "people.roles_change",
      entityType: "Membership",
      entityId: m.id,
      meta: { before: keysBefore, after: keysAfter },
    });
    return { before: keysBefore, after: keysAfter };
  });
}

export async function addRoleMember(actor: Actor, input: { roleId: string; membershipId: string; confirmSensitive?: boolean }) {
  const current = await tenantTx(actor.orgId, async (tx) => {
    const role = await loadRole(tx, input.roleId);
    if (audienceOfRole(role.key) !== "staff") throw new AccessError("FAMILY_ROLE");
    const m = await staffMembership(tx, input.membershipId);
    return m.roles.map((r) => r.roleId);
  });
  if (current.includes(input.roleId)) return { before: [], after: [] };
  return setMemberRoles(actor, { membershipId: input.membershipId, roleIds: [...current, input.roleId], confirmSensitive: input.confirmSensitive });
}

export async function removeRoleMember(actor: Actor, input: { roleId: string; membershipId: string }) {
  const current = await tenantTx(actor.orgId, async (tx) => {
    const role = await loadRole(tx, input.roleId);
    if (audienceOfRole(role.key) !== "staff") throw new AccessError("FAMILY_ROLE");
    const m = await staffMembership(tx, input.membershipId);
    return m.roles.map((r) => r.roleId);
  });
  const next = current.filter((id) => id !== input.roleId);
  if (next.length === current.length) return { before: [], after: [] };
  // A staff member always keeps at least one role.
  if (next.length === 0) throw new AccessError("INVALID");
  return setMemberRoles(actor, { membershipId: input.membershipId, roleIds: next, confirmSensitive: true });
}

// ---------------------------------------------------------------------------
// Access check
// ---------------------------------------------------------------------------

/** For each permission the person has, which of their roles grants it. Suspended or pending members have none. */
export function explainAccess(membership: { status: string; roles: Array<{ role: { key: string; permissions: string[] } }> }) {
  const out = new Map<string, string[]>();
  if (membership.status !== "ACTIVE") return out;
  for (const r of membership.roles) {
    for (const p of r.role.permissions) out.set(p, [...(out.get(p) ?? []), r.role.key]);
  }
  return out;
}

export const STAFF_MEMBERSHIP_WHERE: Prisma.MembershipWhereInput = {
  student: { is: null },
  guardian: { is: null },
  roles: { some: {}, none: { role: { key: { in: ["parent", "student"] } } } },
};
