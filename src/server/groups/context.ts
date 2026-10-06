import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { auth } from "@/auth";
import { identityDb } from "@/lib/tenant-db";
import { isLocale, type AppLocale } from "@/i18n/routing";
import { groupRolesForUser, isPlatformAdmin, type GroupRoleRow } from "./access";

export type GroupCtx = {
  userId: string;
  user: { id: string; email: string; nameEn: string; nameAr: string | null };
  roles: GroupRoleRow[];
  platformAdmin: boolean;
  /** The school the session is signed in to, if any (for "Back to school"). */
  activeOrgId: string | null;
  locale: AppLocale;
};

const load = cache(async (): Promise<GroupCtx | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const user = await identityDb.user.findUnique({ where: { id: userId }, select: { id: true, email: true, nameEn: true, nameAr: true, isPlatformAdmin: true } });
  if (!user) return null;
  const roles = await groupRolesForUser(userId);
  const loc = await getLocale();
  return {
    userId,
    user: { id: user.id, email: user.email, nameEn: user.nameEn, nameAr: user.nameAr },
    roles,
    platformAdmin: isPlatformAdmin(user),
    activeOrgId: session.user.activeOrgId || null,
    locale: isLocale(loc) ? loc : "en",
  };
});

/** Group area context. Signed-out visitors go to the sign-in page; people with no group role get a 404-like empty state. */
export async function getGroupCtx(): Promise<GroupCtx> {
  const ctx = await load();
  if (!ctx) redirect("/login");
  return ctx;
}

export const getOptionalGroupCtx = load;

/** The group the page is about: the one asked for when the user has a role in it, else their first group. */
export function pickGroup(ctx: GroupCtx, wanted?: string | null): GroupRoleRow | null {
  return ctx.roles.find((r) => r.groupId === wanted) ?? ctx.roles[0] ?? null;
}
