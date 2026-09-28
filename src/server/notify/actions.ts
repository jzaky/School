"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";

export async function recentNotificationsAction() {
  const ctx = await getCtx();
  const rows = await ctx.db.notification.findMany({
    where: { orgId: ctx.orgId, recipientId: ctx.membershipId },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  return rows.map((n) => ({
    id: n.id,
    title: pick(ctx.locale, n.titleEn, n.titleAr),
    body: pick(ctx.locale, n.bodyEn, n.bodyAr),
    href: n.href,
    urgent: n.urgent,
    read: Boolean(n.readAt),
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function markNotificationReadAction(id: string) {
  const ctx = await getCtx();
  await ctx.db.notification.updateMany({ where: { id, recipientId: ctx.membershipId }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}

export async function markAllNotificationsReadAction() {
  const ctx = await getCtx();
  await ctx.db.notification.updateMany({ where: { recipientId: ctx.membershipId, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}
