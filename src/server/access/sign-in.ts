// Sign-in rules used by src/auth.ts: rate limits on password sign-in, and which OAuth sign-ins are allowed
// (the school must have that provider switched on, or the person is finishing a join link).
import { cookies, headers } from "next/headers";
import { identityDb, tenantDb } from "@/lib/tenant-db";
import { resolveActiveMembership } from "@/server/identity/session-org";
import { clientIp, hit } from "./rate-limit";
import { audit } from "@/server/audit/audit";

export const JOIN_INTENT_COOKIE = "join_intent";

async function ip(): Promise<string> {
  try {
    return clientIp(await headers());
  } catch {
    return "local";
  }
}

/** At most 10 password attempts per email and 50 per IP address in 15 minutes. */
export async function passwordSignInAllowed(email: string): Promise<boolean> {
  const [byEmail, byIp] = await Promise.all([hit(`signin:${email.toLowerCase()}`, 10, 15 * 60), hit(`signin-ip:${await ip()}`, 50, 15 * 60)]);
  // The first refused attempt for an address is written to the person's school audit log (no address or password).
  if (!byEmail.ok && byEmail.count === 11) await auditSignInLimited(email).catch(() => undefined);
  return byEmail.ok && byIp.ok;
}

async function auditSignInLimited(email: string) {
  const user = await identityDb.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true, lastActiveOrgId: true } });
  const m = user ? await resolveActiveMembership(user.id, user.lastActiveOrgId, { includePending: true }) : null;
  if (!user || !m) return;
  await audit(tenantDb(m.orgId), m.orgId, { actorId: m.id, actorUserId: user.id, action: "auth.sign_in_refused", entityType: "Membership", entityId: m.id, meta: { method: "password", code: "RATE_LIMITED" } });
}

/** A join page path the person was on before leaving for Google or Microsoft. */
export function isJoinPath(p: string | undefined | null): p is string {
  return !!p && /^\/(en|ar)\/join(\/[A-Za-z0-9_-]{32,64})?(\?code=[A-Za-z0-9-]{1,20})?$/.test(p);
}

/**
 * true to allow, or a redirect path. People who already belong to a school sign in when the school has the
 * provider switched on. Someone with no account yet may continue only while finishing a join link: the
 * account is created here and the join page then attaches it to the school.
 */
export async function oauthSignInDecision(email: string, name: string | null, provider: string): Promise<true | string> {
  const existing = await identityDb.user.findUnique({ where: { email } });
  const membership = existing ? await resolveActiveMembership(existing.id, existing.lastActiveOrgId, { includePending: true }) : null;
  if (membership) {
    const org = await tenantDb(membership.orgId).organization.findUnique({ where: { id: membership.orgId }, select: { googleSignIn: true, microsoftSignIn: true } });
    const allowed = provider === "google" ? org?.googleSignIn : provider === "microsoft-entra-id" ? org?.microsoftSignIn : false;
    return allowed ? true : "/login?error=ProviderDisabled";
  }
  let intent: string | undefined;
  try {
    intent = (await cookies()).get(JOIN_INTENT_COOKIE)?.value;
  } catch {
    intent = undefined;
  }
  if (!isJoinPath(intent)) return existing ? "/login?error=NoMembership" : "/login?error=NotProvisioned";
  if (!existing) await identityDb.user.create({ data: { email, nameEn: name?.trim() || email.split("@")[0], emailVerified: new Date() } });
  return true;
}
