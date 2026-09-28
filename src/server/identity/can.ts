import type { Permission } from "./permissions";

export type MembershipWithRoles = {
  status?: string;
  roles: Array<{ role: { key: string; permissions: string[] } }>;
};

/** Collect the permission keys granted by a membership's roles. Suspended memberships get none. */
export function permissionsOf(membership: MembershipWithRoles | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!membership || (membership.status && membership.status !== "ACTIVE")) return out;
  for (const r of membership.roles) for (const p of r.role.permissions) out.add(p);
  return out;
}

export function roleKeysOf(membership: MembershipWithRoles | null | undefined): string[] {
  if (!membership) return [];
  return membership.roles.map((r) => r.role.key);
}

/** The single permission check used across the app. */
export function can(membership: MembershipWithRoles | null | undefined, permission: Permission): boolean {
  return permissionsOf(membership).has(permission);
}

export function canAny(membership: MembershipWithRoles | null | undefined, permissions: Permission[]): boolean {
  const set = permissionsOf(membership);
  return permissions.some((p) => set.has(p));
}

export function hasRole(membership: MembershipWithRoles | null | undefined, key: string): boolean {
  return roleKeysOf(membership).includes(key);
}
