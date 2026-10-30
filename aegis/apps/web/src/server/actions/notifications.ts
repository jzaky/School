"use server";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { listNotifications, markRead, unreadCount } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

export async function listNotificationsAction() {
  return act(async () => {
    const c = await getConsoleContext();
    const [items, unread] = await withTenant(c.ctx.orgId, async (db) => Promise.all([listNotifications(db, c.ctx, c.session.user.id, 30), unreadCount(db, c.ctx, c.session.user.id)]));
    return { unread, items: items.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })) };
  });
}

export async function markNotificationsReadAction(ids?: string[]) {
  return act(async () => {
    const c = await getConsoleContext();
    const parsed = ids ? z.array(z.string().uuid()).max(100).parse(ids) : undefined;
    const r = await withTenant(c.ctx.orgId, (db) => markRead(db, c.ctx, c.session.user.id, parsed));
    return { count: r.count };
  });
}
