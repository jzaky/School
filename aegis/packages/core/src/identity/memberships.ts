import { rawPrisma, type MembershipStatus } from "@aegis/db";

export interface UserMembership {
  membershipId: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  orgDemo: boolean;
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  status: MembershipStatus;
}

/** All organizations a user belongs to. Runs through a SECURITY DEFINER function because no tenant is selected yet. */
export async function listUserMemberships(userId: string): Promise<UserMembership[]> {
  const rows = await rawPrisma().$queryRaw<
    { membership_id: string; org_id: string; org_slug: string; org_name: string; org_demo: boolean; role_id: string; role_key: string; role_name: string; permissions: string[]; status: MembershipStatus }[]
  >`SELECT * FROM aegis_user_memberships(${userId}::uuid)`;
  return rows.map((r) => ({
    membershipId: r.membership_id,
    orgId: r.org_id,
    orgSlug: r.org_slug,
    orgName: r.org_name,
    orgDemo: r.org_demo,
    roleId: r.role_id,
    roleKey: r.role_key,
    roleName: r.role_name,
    permissions: r.permissions,
    status: r.status,
  }));
}

export async function getUserMembership(userId: string, orgId: string): Promise<UserMembership | null> {
  const all = await listUserMemberships(userId);
  return all.find((m) => m.orgId === orgId && m.status === "active") ?? null;
}
