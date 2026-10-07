import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { auth } from "@/auth";
import { tenantDb, identityDb } from "@/lib/tenant-db";
import { can, permissionsOf, roleKeysOf } from "@/server/identity/can";
import type { Permission } from "@/server/identity/permissions";
import { lastActiveIsStale, touchLastActive } from "@/server/identity/last-active";
import { isLocale, type AppLocale } from "@/i18n/routing";
import { groupRolesForUser } from "@/server/groups/access";

async function loadContext() {
  const session = await auth();
  const orgId = session?.user?.activeOrgId;
  const membershipId = session?.user?.membershipId;
  if (!session?.user?.id || !orgId || !membershipId) return null;
  const db = tenantDb(orgId);
  const [org, membership, user] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId } }),
    db.membership.findUnique({
      where: { id: membershipId },
      include: {
        roles: { include: { role: true } },
        staffProfile: true,
        student: true,
        guardian: { include: { links: { include: { student: true } } } },
      },
    }),
    identityDb.user.findUnique({ where: { id: session.user.id } }),
  ]);
  if (!org || !membership || !user || membership.status !== "ACTIVE") return null;
  // Last active: no query when the loaded timestamp is fresh; never blocks or fails the request.
  if (lastActiveIsStale(membership.lastSeenAt, new Date())) void touchLastActive(db, membership.id, membership.lastSeenAt).catch(() => undefined);
  const perms = permissionsOf(membership);
  const roles = roleKeysOf(membership);
  const requestLocale = await getLocale();
  const locale: AppLocale = isLocale(requestLocale) ? requestLocale : org.defaultLocale;
  const isStudent = roles.includes("student");
  const isParent = roles.includes("parent");
  return {
    session,
    orgId,
    db,
    org,
    user,
    membership,
    membershipId,
    roles,
    perms,
    locale,
    persona: session.user.persona ?? null,
    isStudent,
    isParent,
    isStaff: !isStudent && !isParent,
    can: (p: Permission) => can(membership, p),
  };
}

export type Ctx = NonNullable<Awaited<ReturnType<typeof loadContext>>>;

/** Where to send a signed-in person whose membership cannot be used yet (waiting for approval). */
async function waitingRedirect(): Promise<string | null> {
  const session = await auth();
  const { orgId, membershipId } = { orgId: session?.user?.activeOrgId, membershipId: session?.user?.membershipId };
  if (!session?.user?.id || !orgId || !membershipId) return null;
  const m = await tenantDb(orgId).membership.findUnique({ where: { id: membershipId }, select: { status: true, userId: true } });
  if (!m || m.userId !== session.user.id || m.status !== "PENDING_APPROVAL") return null;
  const locale = await getLocale();
  return `/${isLocale(locale) ? locale : "en"}/join/waiting`;
}

/** A signed-in school group person with no school session goes to the group area instead of the sign-in page. */
async function groupOnlyRedirect(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id || session.user.membershipId) return null;
  if (!(await groupRolesForUser(session.user.id)).length) return null;
  const locale = await getLocale();
  return `/${isLocale(locale) ? locale : "en"}/group`;
}

/** Request context. Cached per request. Redirects to the sign-in page when there is no valid session. */
export const getCtx = cache(async (): Promise<Ctx> => {
  const ctx = await loadContext();
  if (!ctx) redirect((await waitingRedirect()) ?? (await groupOnlyRedirect()) ?? "/login");
  return ctx;
});

export const getOptionalCtx = cache(loadContext);

/** Throw when the current member lacks a permission. Use at the top of server actions. */
export async function requirePermission(p: Permission): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx.can(p)) throw new Error("FORBIDDEN");
  return ctx;
}
