import "server-only";
import { rawPrisma, type TenantDb } from "@aegis/db";

/** Display names for user ids. Users is a global table; only id and name are read. */
export async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const rows = await rawPrisma().user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export interface MemberOption {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleName: string;
}

/** Active members of the current tenant with display fields, for pickers (owners, team members). */
export async function memberOptions(db: TenantDb, orgId: string): Promise<MemberOption[]> {
  const rows = await db.membership.findMany({ where: { orgId, status: "active" }, include: { role: true } });
  const users = await rawPrisma().user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true, email: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows
    .map((r) => ({ membershipId: r.id, userId: r.userId, name: byId.get(r.userId)?.name ?? "Unknown user", email: byId.get(r.userId)?.email ?? "", roleName: r.role.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
