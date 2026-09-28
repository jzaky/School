import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { auth } from "@/auth";
import { tenantDb, identityDb } from "@/lib/tenant-db";
import { can, permissionsOf, roleKeysOf } from "@/server/identity/can";
import type { Permission } from "@/server/identity/permissions";
import { isLocale, type AppLocale } from "@/i18n/routing";

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

/** Request context. Cached per request. Redirects to the sign-in page when there is no valid session. */
export const getCtx = cache(async (): Promise<Ctx> => {
  const ctx = await loadContext();
  if (!ctx) redirect("/login");
  return ctx;
});

export const getOptionalCtx = cache(loadContext);

/** Throw when the current member lacks a permission. Use at the top of server actions. */
export async function requirePermission(p: Permission): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx.can(p)) throw new Error("FORBIDDEN");
  return ctx;
}
