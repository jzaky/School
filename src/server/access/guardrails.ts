// Guardrails for role and access changes. Pure functions over a snapshot of who holds which role,
// so they can be checked before and after a change without touching the database.
//
// Rules:
// - The school keeps at least one active person who can manage roles, and the person making a change
//   cannot take that ability away from themselves (now or by giving it an end date).
// - Nobody can increase their own access to sensitive permissions (permission-catalog.ts): not by adding a
//   permission to a role they hold, adding a role to themselves, restoring a role default, moving
//   themselves into another role, or keeping a time-limited sensitive role for longer. Another person who
//   manages roles has to make that change. Lowering your own access is always allowed (subject to the rules above).
// - A staff member always keeps at least one role that does not expire.
import { isSensitivePermission } from "./permission-catalog";

/** `expires` maps a role id to the end of a time-limited assignment. A role id missing from it does not expire. */
export type GuardMember = { id: string; status: string; roleIds: string[]; expires?: Record<string, Date | null | undefined> };
export type GuardRole = { id: string; permissions: string[] };
export type AccessSnapshot = { members: GuardMember[]; roles: GuardRole[] };

export type GuardError = "LAST_ROLES_MANAGER" | "SELF_LOCKOUT" | "SELF_ESCALATION" | "NEEDS_PERMANENT_ROLE";

const MANAGE = "roles.manage";
const FOREVER = Number.POSITIVE_INFINITY;

/** When a member's assignment of a role ends, in ms since epoch (Infinity when it does not expire). */
export function assignmentEnd(m: GuardMember, roleId: string): number {
  const e = m.expires?.[roleId];
  return e ? e.getTime() : FOREVER;
}

/** Role ids that still grant permissions at `now` (time-limited assignments that have ended are ignored). */
export function activeRoleIds(m: GuardMember, now: Date = new Date()): string[] {
  return m.roleIds.filter((id) => assignmentEnd(m, id) > now.getTime());
}

/**
 * What a member can do: permission to the time their access to it ends (Infinity when it does not).
 * Inactive members (suspended, invited, waiting for approval) can do nothing.
 */
export function accessOf(s: AccessSnapshot, membershipId: string, now: Date = new Date()): Map<string, number> {
  const out = new Map<string, number>();
  const m = s.members.find((x) => x.id === membershipId);
  if (!m || m.status !== "ACTIVE") return out;
  for (const roleId of activeRoleIds(m, now)) {
    const role = s.roles.find((r) => r.id === roleId);
    if (!role) continue;
    const end = assignmentEnd(m, roleId);
    for (const p of role.permissions) out.set(p, Math.max(out.get(p) ?? 0, end));
  }
  return out;
}

/** Active members who, in this snapshot, can manage roles right now. */
export function rolesManagers(s: AccessSnapshot, now: Date = new Date()): string[] {
  return s.members.filter((m) => accessOf(s, m.id, now).has(MANAGE)).map((m) => m.id);
}

/** Active members who can manage roles through an assignment that does not expire. */
export function permanentRolesManagers(s: AccessSnapshot, now: Date = new Date()): string[] {
  return s.members.filter((m) => accessOf(s, m.id, now).get(MANAGE) === FOREVER).map((m) => m.id);
}

/**
 * Sensitive permissions the actor would gain, or keep for longer, if `after` replaced `before`.
 * Empty when the change does not increase the actor's own sensitive access.
 */
export function selfEscalation(before: AccessSnapshot, after: AccessSnapshot, actorMembershipId: string, now: Date = new Date(), sensitive: (p: string) => boolean = isSensitivePermission): string[] {
  const had = accessOf(before, actorMembershipId, now);
  const has = accessOf(after, actorMembershipId, now);
  const out: string[] = [];
  for (const [p, until] of has) {
    if (!sensitive(p)) continue;
    if (until > (had.get(p) ?? 0)) out.push(p);
  }
  return out.sort();
}

/** Members in `after` who would be left without a role that does not expire (only those listed in `memberIds`). */
export function withoutPermanentRole(after: AccessSnapshot, memberIds: string[]): string[] {
  return after.members.filter((m) => memberIds.includes(m.id) && m.roleIds.length > 0 && !m.roleIds.some((id) => assignmentEnd(m, id) === FOREVER)).map((m) => m.id);
}

/**
 * Checks a proposed change. The actor cannot raise their own sensitive access, the school must keep at least
 * one active person who can manage roles, and the actor cannot take that ability away from themselves.
 * `changedMembers` are the people whose role assignments change: each must keep a role that does not expire.
 */
export function checkAccessChange(before: AccessSnapshot, after: AccessSnapshot, actorMembershipId: string, now: Date = new Date(), changedMembers: string[] = []): GuardError | null {
  if (selfEscalation(before, after, actorMembershipId, now).length > 0) return "SELF_ESCALATION";
  const had = rolesManagers(before, now);
  const has = rolesManagers(after, now);
  const hadKeep = permanentRolesManagers(before, now);
  const hasKeep = permanentRolesManagers(after, now);
  if ((had.length > 0 && has.length === 0) || (hadKeep.length > 0 && hasKeep.length === 0)) return "LAST_ROLES_MANAGER";
  if ((had.includes(actorMembershipId) && !has.includes(actorMembershipId)) || (hadKeep.includes(actorMembershipId) && !hasKeep.includes(actorMembershipId))) return "SELF_LOCKOUT";
  if (withoutPermanentRole(after, changedMembers).length > 0) return "NEEDS_PERMANENT_ROLE";
  return null;
}

// ---------------------------------------------------------------------------
// Snapshot helpers for the common changes
// ---------------------------------------------------------------------------

export function withRolePermissions(s: AccessSnapshot, roleId: string, permissions: string[]): AccessSnapshot {
  return { members: s.members, roles: s.roles.map((r) => (r.id === roleId ? { ...r, permissions } : r)) };
}

/** A new role (for example a copy of another role). Nobody holds it yet. */
export function withRole(s: AccessSnapshot, role: GuardRole): AccessSnapshot {
  return { members: s.members, roles: [...s.roles.filter((r) => r.id !== role.id), role] };
}

/**
 * The member holds exactly `roleIds`. Roles they keep keep their end dates; `expires` sets end dates for
 * the listed roles (null: does not expire). A member missing from the snapshot is added as active.
 */
export function withMemberRoles(s: AccessSnapshot, membershipId: string, roleIds: string[], expires: Record<string, Date | null> = {}): AccessSnapshot {
  const exists = s.members.some((m) => m.id === membershipId);
  const base = exists ? s.members : [...s.members, { id: membershipId, status: "ACTIVE", roleIds: [] }];
  return {
    roles: s.roles,
    members: base.map((m) => {
      if (m.id !== membershipId) return m;
      const next: Record<string, Date | null> = {};
      for (const id of roleIds) {
        const e = id in expires ? expires[id] : m.roleIds.includes(id) ? (m.expires?.[id] ?? null) : null;
        next[id] = e ?? null;
      }
      return { ...m, roleIds: [...roleIds], expires: next };
    }),
  };
}

/** Change the end date of one assignment (null: does not expire). */
export function withAssignmentEnd(s: AccessSnapshot, membershipId: string, roleId: string, expiresAt: Date | null): AccessSnapshot {
  return {
    roles: s.roles,
    members: s.members.map((m) => (m.id === membershipId && m.roleIds.includes(roleId) ? { ...m, expires: { ...m.expires, [roleId]: expiresAt } } : m)),
  };
}

export function withMemberStatus(s: AccessSnapshot, membershipId: string, status: string): AccessSnapshot {
  return { roles: s.roles, members: s.members.map((m) => (m.id === membershipId ? { ...m, status } : m)) };
}

export function withoutRole(s: AccessSnapshot, roleId: string): AccessSnapshot {
  return {
    roles: s.roles.filter((r) => r.id !== roleId),
    members: s.members.map((m) => ({ ...m, roleIds: m.roleIds.filter((id) => id !== roleId) })),
  };
}

// ---------------------------------------------------------------------------
// What the UI should not offer: changes that would raise the viewer's own sensitive access
// ---------------------------------------------------------------------------

/** Roles (from `candidateRoleIds`) that the actor cannot add to themselves, because that would raise their sensitive access. */
export function rolesBlockedForSelf(s: AccessSnapshot, actorMembershipId: string, candidateRoleIds: string[], now: Date = new Date()): string[] {
  const me = s.members.find((m) => m.id === actorMembershipId);
  if (!me) return [];
  return candidateRoleIds.filter((roleId) => !me.roleIds.includes(roleId) && selfEscalation(s, withMemberRoles(s, actorMembershipId, [...me.roleIds, roleId]), actorMembershipId, now).length > 0);
}

/** Permissions that the actor cannot switch on for this role, because they hold it and would gain access. */
export function permissionsBlockedForSelf(s: AccessSnapshot, actorMembershipId: string, roleId: string, permissions: string[], now: Date = new Date()): string[] {
  const role = s.roles.find((r) => r.id === roleId);
  if (!role) return [];
  return permissions.filter((p) => !role.permissions.includes(p) && selfEscalation(s, withRolePermissions(s, roleId, [...role.permissions, p]), actorMembershipId, now).length > 0);
}

/** Whether replacing a role's permissions (restore default) would raise the actor's sensitive access. */
export function rolePermissionsBlockedForSelf(s: AccessSnapshot, actorMembershipId: string, roleId: string, permissions: string[], now: Date = new Date()): boolean {
  return selfEscalation(s, withRolePermissions(s, roleId, permissions), actorMembershipId, now).length > 0;
}

// ---------------------------------------------------------------------------
// Watched access: who gained or lost a set of permissions (safeguarding alerts)
// ---------------------------------------------------------------------------

export type AccessDelta = { membershipId: string; gained: string[]; lost: string[]; longer: string[]; shorter: string[] };

/**
 * For each member, which watched permissions they gained, lost, or now hold for a longer or shorter time.
 * `beforeAt` lets a caller look at the "before" picture at an earlier moment (an assignment that just expired).
 */
export function watchedDeltas(before: AccessSnapshot, after: AccessSnapshot, memberIds: string[], watched: readonly string[], now: Date = new Date(), beforeAt: Date = now): AccessDelta[] {
  const out: AccessDelta[] = [];
  for (const id of memberIds) {
    const a = accessOf(before, id, beforeAt);
    const b = accessOf(after, id, now);
    const d: AccessDelta = { membershipId: id, gained: [], lost: [], longer: [], shorter: [] };
    for (const p of watched) {
      const x = a.get(p);
      const y = b.get(p);
      if (x === undefined && y !== undefined) d.gained.push(p);
      else if (x !== undefined && y === undefined) d.lost.push(p);
      else if (x !== undefined && y !== undefined && y > x) d.longer.push(p);
      else if (x !== undefined && y !== undefined && y < x) d.shorter.push(p);
    }
    if (d.gained.length || d.lost.length || d.longer.length || d.shorter.length) out.push(d);
  }
  return out;
}

/** Watched permissions a role gained or lost when its permission list changed. */
export function roleWatchedDelta(beforePerms: string[], afterPerms: string[], watched: readonly string[]) {
  return {
    gained: watched.filter((p) => !beforePerms.includes(p) && afterPerms.includes(p)),
    lost: watched.filter((p) => beforePerms.includes(p) && !afterPerms.includes(p)),
  };
}
