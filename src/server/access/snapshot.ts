// Loads an access snapshot (guardrails.ts) from the database inside a tenant transaction.
import type { Tx } from "@/server/db";
import type { AccessSnapshot } from "./guardrails";

/**
 * Everyone who could be affected by a change: the given members, everyone who holds the given roles,
 * and everyone who holds a role that can manage roles (for the lockout rules). All roles are included.
 */
export async function loadSnapshot(tx: Tx, memberIds: string[], roleIds: string[] = []): Promise<AccessSnapshot> {
  const roles = await tx.role.findMany({ select: { id: true, permissions: true } });
  const managerRoleIds = roles.filter((r) => r.permissions.includes("roles.manage")).map((r) => r.id);
  const members = await tx.membership.findMany({
    where: {
      OR: [{ id: { in: memberIds } }, { roles: { some: { roleId: { in: [...managerRoleIds, ...roleIds] } } } }],
    },
    select: { id: true, status: true, roles: { select: { roleId: true, expiresAt: true } } },
  });
  return {
    roles,
    members: members.map((m) => ({
      id: m.id,
      status: m.status,
      roleIds: m.roles.map((r) => r.roleId),
      expires: Object.fromEntries(m.roles.map((r) => [r.roleId, r.expiresAt])),
    })),
  };
}
