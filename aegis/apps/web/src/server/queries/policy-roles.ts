import "server-only";
import type { TenantDb } from "@aegis/db";
import { hasPermission } from "@aegis/core";

export interface ApproverRoleOption {
  key: string;
  name: string;
  description: string;
  memberCount: number;
}

/** Roles of the tenant that may decide approvals, for the guided refund policy's approver picker. */
export async function approverRoleOptions(db: TenantDb, orgId: string): Promise<ApproverRoleOption[]> {
  const roles = await db.role.findMany({ where: { orgId }, orderBy: [{ isSystem: "desc" }, { name: "asc" }], select: { id: true, key: true, name: true, description: true, permissions: true } });
  const eligible = roles.filter((r) => hasPermission(r.permissions, "approvals:decide"));
  if (eligible.length === 0) return [];
  const counts = await db.membership.groupBy({ by: ["roleId"], where: { orgId, status: "active", roleId: { in: eligible.map((r) => r.id) } }, _count: { _all: true } });
  const countBy = new Map(counts.map((c) => [c.roleId, c._count._all]));
  return eligible.map((r) => ({ key: r.key, name: r.name, description: r.description, memberCount: countBy.get(r.id) ?? 0 }));
}
