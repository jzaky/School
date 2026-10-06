// Group invite codes, the group's side of the agreement. Group admins create and revoke them through
// userScope: RLS (prisma/rls.sql, section 4) only lets a group ADMIN insert or update its group's invites.
import { userScope } from "@/lib/tenant-db";
import { requireGroupRole } from "./access";
import { GROUP_INVITE_TTL_DAYS, generateGroupCode, hashGroupCode, normalizeGroupCode } from "./codes";

const DAY = 86_400_000;

export async function createGroupInvite(userId: string, groupId: string, now = new Date()): Promise<{ id: string; code: string; expiresAt: Date }> {
  await requireGroupRole(userId, groupId, { admin: true });
  const code = generateGroupCode();
  const normalized = normalizeGroupCode(code)!;
  const expiresAt = new Date(now.getTime() + GROUP_INVITE_TTL_DAYS * DAY);
  const row = await userScope(userId, (tx) =>
    tx.groupInvite.create({ data: { groupId, codeHash: hashGroupCode(normalized), codeHint: normalized.slice(-4), createdById: userId, expiresAt } }),
  );
  return { id: row.id, code, expiresAt };
}

export async function revokeGroupInvite(userId: string, groupId: string, inviteId: string, now = new Date()) {
  await requireGroupRole(userId, groupId, { admin: true });
  const res = await userScope(userId, (tx) => tx.groupInvite.updateMany({ where: { id: inviteId, groupId, usedAt: null, revokedAt: null }, data: { revokedAt: now } }));
  return res.count === 1;
}

export async function listGroupInvites(userId: string, groupId: string) {
  await requireGroupRole(userId, groupId);
  return userScope(userId, (tx) => tx.groupInvite.findMany({ where: { groupId }, orderBy: { createdAt: "desc" }, take: 50 }));
}
