import type { TenantDb } from "@aegis/db";
import type { OrgContext } from "../lib/context.js";

/**
 * In-app notifications. Idempotency key per (org, key) makes delivery exactly-once from the
 * reader's point of view even when a job retries. Email delivery is a separate job.
 */
export async function notifyUsers(db: TenantDb, ctx: OrgContext, input: { userIds: string[]; type: string; title: string; body?: string; link?: string; idempotencyKey: string }) {
  const unique = [...new Set(input.userIds)];
  if (unique.length === 0) return 0;
  const result = await db.notification.createMany({
    data: unique.map((userId) => ({ orgId: ctx.orgId, userId, type: input.type, title: input.title, body: input.body ?? "", link: input.link, idempotencyKey: `${input.idempotencyKey}:${userId}` })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function listNotifications(db: TenantDb, ctx: OrgContext, userId: string, limit = 30) {
  return db.notification.findMany({ where: { orgId: ctx.orgId, userId }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function unreadCount(db: TenantDb, ctx: OrgContext, userId: string) {
  return db.notification.count({ where: { orgId: ctx.orgId, userId, readAt: null } });
}

export async function markRead(db: TenantDb, ctx: OrgContext, userId: string, ids?: string[]) {
  return db.notification.updateMany({ where: { orgId: ctx.orgId, userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
}

/** Users holding a permission in this org (used to fan out approval requests and alerts). */
export async function userIdsWithPermission(db: TenantDb, ctx: OrgContext, permission: string): Promise<string[]> {
  const rows = await db.membership.findMany({ where: { orgId: ctx.orgId, status: "active", role: { OR: [{ permissions: { has: "*" } }, { permissions: { has: permission } }] } }, select: { userId: true } });
  return rows.map((r) => r.userId);
}
