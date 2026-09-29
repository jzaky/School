import "server-only";
// Sign-up steps that run on the server outside a form post: finishing an OAuth sign-up and auditing a verification.
import { cookies } from "next/headers";
import { auth, unstable_update } from "@/auth";
import { identityDb, tenantDb } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { provisionSchool } from "@/server/platform/signup";
import { PENDING_COOKIE, pendingSignup } from "@/server/onboarding/oauth-signup";

/** Called after the provider sign-in: create the school for the signed-in person. */
export async function completeOAuthSignup(): Promise<string> {
  const pending = await pendingSignup();
  const session = await auth();
  const userId = session?.user?.id;
  if (!pending || !userId) return "/signup?error=oauth";
  const jar = await cookies();
  jar.delete(PENDING_COOKIE);
  let provisioned: { orgId: string; membershipId: string };
  try {
    provisioned = await provisionSchool({ userId, schoolNameEn: pending.schoolNameEn, schoolNameAr: pending.schoolNameAr, emirate: pending.emirate, curricula: pending.curricula, locale: pending.locale, isPrincipal: pending.isPrincipal });
  } catch {
    return "/signup?error=failed";
  }
  // The provider confirmed the address.
  await identityDb.user.updateMany({ where: { id: userId, emailVerified: null }, data: { emailVerified: new Date() } });
  await unstable_update({ activeOrgId: provisioned.orgId } as never).catch(() => undefined);
  jar.set("NEXT_LOCALE", pending.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return `/${pending.locale}/setup`;
}

/** Record the verification in the school's audit log (called from the verification page). */
export async function auditEmailVerified(userId: string) {
  const user = await identityDb.user.findUnique({ where: { id: userId }, select: { lastActiveOrgId: true } });
  if (!user?.lastActiveOrgId) return;
  const db = tenantDb(user.lastActiveOrgId);
  const org = await db.organization.findUnique({ where: { id: user.lastActiveOrgId }, select: { createdById: true } });
  if (org?.createdById !== userId) return;
  await audit(db, user.lastActiveOrgId, { actorUserId: userId, action: "org.email_verified", entityType: "Organization", entityId: user.lastActiveOrgId });
}
