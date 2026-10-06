// Platform admin access: people whose sign-in email is listed in PLATFORM_ADMIN_EMAILS.
// Platform pages (/platform/...) show marketing leads, referrals and platform settings. They are not school
// data, so they read and write through the owner client (platformDb), the documented platform admin
// exception to CLAUDE.md hard rule 2. Every write and export records an AuditEvent in the admin's own school.
import "server-only";
import { notFound } from "next/navigation";
import { getCtx, type Ctx } from "@/server/context";
import { catalogDb, isPlatformAdminEmail, type CatalogDb } from "./catalog-db";

export { isPlatformAdminEmail };

/** For pages: 404 unless the signed-in person is a platform admin. */
export async function platformAdminPage(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!isPlatformAdminEmail(ctx.user.email)) notFound();
  return ctx;
}

/** For actions and route handlers: throws unless the signed-in person is a platform admin. */
export async function requirePlatformAdmin(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!isPlatformAdminEmail(ctx.user.email)) throw new Error("FORBIDDEN");
  return ctx;
}

/** The owner client for platform tables (MarketingLead, PlatformSetting, cross-school referral counts). */
export function platformDb(): CatalogDb {
  const db = catalogDb();
  if (!db) throw new Error("PLATFORM_DB_UNAVAILABLE");
  return db;
}
