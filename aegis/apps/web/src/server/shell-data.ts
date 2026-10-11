import "server-only";
import { withTenant } from "@aegis/db";
import { listUserMemberships, unreadCount, type SessionInfo } from "@aegis/core";
import type { ShellData } from "@/components/shell/types";
import { getConsoleContext, type ConsoleContext } from "./session";

export async function shellDataFromContext(c: ConsoleContext): Promise<ShellData> {
  let unread = 0;
  try {
    unread = await withTenant(c.ctx.orgId, (db) => unreadCount(db, c.ctx, c.session.user.id));
  } catch {
    unread = 0;
  }
  return {
    user: { id: c.session.user.id, name: c.session.user.name, email: c.session.user.email, isPlatformAdmin: c.session.user.isPlatformAdmin },
    org: { id: c.org.id, slug: c.org.slug, name: c.org.name, demoMode: c.org.demoMode },
    roleName: c.membership.roleName,
    memberships: c.memberships.filter((m) => m.status === "active").map((m) => ({ orgId: m.orgId, orgName: m.orgName, orgSlug: m.orgSlug, orgDemo: m.orgDemo, roleName: m.roleName })),
    permissions: c.membership.permissions,
    unread,
  };
}

/** Shell data for a signed-in user who may have no organization (platform admins). */
export async function shellDataForPlatform(session: SessionInfo): Promise<ShellData> {
  const memberships = await listUserMemberships(session.user.id);
  const active = memberships.filter((m) => m.status === "active");
  if (active.length > 0) {
    const c = await getConsoleContext();
    return shellDataFromContext(c);
  }
  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email, isPlatformAdmin: session.user.isPlatformAdmin },
    org: null,
    roleName: null,
    memberships: [],
    permissions: [],
    unread: 0,
  };
}
