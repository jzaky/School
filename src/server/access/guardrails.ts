// Guardrails for role and access changes. Pure functions over a snapshot of who holds which role,
// so they can be checked before and after a change without touching the database.

export type GuardMember = { id: string; status: string; roleIds: string[] };
export type GuardRole = { id: string; permissions: string[] };
export type AccessSnapshot = { members: GuardMember[]; roles: GuardRole[] };

export type GuardError = "LAST_ROLES_MANAGER" | "SELF_LOCKOUT";

const MANAGE = "roles.manage";

/** Active members who, in this snapshot, hold a role that grants roles.manage. */
export function rolesManagers(s: AccessSnapshot): string[] {
  const granting = new Set(s.roles.filter((r) => r.permissions.includes(MANAGE)).map((r) => r.id));
  return s.members.filter((m) => m.status === "ACTIVE" && m.roleIds.some((id) => granting.has(id))).map((m) => m.id);
}

/**
 * Checks a proposed change. The school must keep at least one active person who can manage roles,
 * and the person making the change cannot take that ability away from themselves.
 */
export function checkAccessChange(before: AccessSnapshot, after: AccessSnapshot, actorMembershipId: string): GuardError | null {
  const had = rolesManagers(before);
  const has = rolesManagers(after);
  if (had.length > 0 && has.length === 0) return "LAST_ROLES_MANAGER";
  if (had.includes(actorMembershipId) && !has.includes(actorMembershipId)) return "SELF_LOCKOUT";
  return null;
}

/** Snapshot helpers for the common changes. */
export function withRolePermissions(s: AccessSnapshot, roleId: string, permissions: string[]): AccessSnapshot {
  return { members: s.members, roles: s.roles.map((r) => (r.id === roleId ? { ...r, permissions } : r)) };
}

export function withMemberRoles(s: AccessSnapshot, membershipId: string, roleIds: string[]): AccessSnapshot {
  return { roles: s.roles, members: s.members.map((m) => (m.id === membershipId ? { ...m, roleIds } : m)) };
}

export function withoutRole(s: AccessSnapshot, roleId: string): AccessSnapshot {
  return { roles: s.roles.filter((r) => r.id !== roleId), members: s.members.map((m) => ({ ...m, roleIds: m.roleIds.filter((id) => id !== roleId) })) };
}
