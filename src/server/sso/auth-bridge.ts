// Glue between Auth.js (src/auth.ts) and the shared sign-in rules: Google and Microsoft profiles in the shared
// identity shape, the remembered school hint from the sign-in page, and password sign-in audit events.
import { cookies } from "next/headers";
import { tenantDb } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { schoolBySlug } from "@/server/platform/sso-lookup";
import type { NormalizedIdentity } from "./flow";
import { SCHOOL_HINT_COOKIE } from "./web";

const MS_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Google or Microsoft (Auth.js) profile in the shared shape, plus Microsoft's tenant facts for link.ts. */
export function oauthIdentity(
  provider: string,
  providerAccountId: string,
  user: { email?: string | null; name?: string | null },
  profile: unknown,
  env: NodeJS.ProcessEnv = process.env,
): { identity: NormalizedIdentity; msTenant: string | null; msVerifiedDomain: boolean } | null {
  const p = (profile ?? {}) as Record<string, unknown>;
  const id = provider === "google" ? "google" : provider === "microsoft-entra-id" ? "microsoft" : null;
  if (!id) return null;
  const tid = id === "microsoft" ? str(p.tid) : null;
  // A single-tenant deployment (issuer names one tenant) only ever receives that tenant's users.
  const issuerTenant = /\/([0-9a-f-]{36})\/v2\.0\/?$/i.exec(env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ?? "")?.[1]?.toLowerCase() ?? null;
  const xmsEdov = p.xms_edov === true || p.xms_edov === "1" || p.xms_edov === 1 || p.xms_edov === "true";
  return {
    identity: {
      provider: id,
      subject: providerAccountId,
      email: user.email?.toLowerCase() ?? null,
      emailVerified: id === "google" ? p.email_verified === true : tid === MS_CONSUMER_TENANT || xmsEdov,
      name: user.name ?? null,
      givenName: str(p.given_name),
      familyName: str(p.family_name),
      tenant: tid,
      externalId: null,
      role: null,
      emiratesId: null,
      assurance: null,
    },
    msTenant: tid,
    msVerifiedDomain: xmsEdov || (!!issuerTenant && tid?.toLowerCase() === issuerTenant),
  };
}

/** Whether the provider itself (not a school directory) vouches for the address. */
export const globallyVerified = (x: { identity: NormalizedIdentity; msVerifiedDomain: boolean }) => x.identity.emailVerified || x.msVerifiedDomain;

/** The school chosen on /login/[school], if any. A hint only: link.ts still requires membership in that school. */
export async function schoolHintOrgId(): Promise<string | null> {
  try {
    const slug = (await cookies()).get(SCHOOL_HINT_COOKIE)?.value;
    if (!slug) return null;
    return (await schoolBySlug(slug))?.id ?? null;
  } catch {
    return null;
  }
}

/** Password sign-in outcomes for a known member, in their school's audit log. No address or password detail. */
export async function auditPasswordSignIn(orgId: string, membershipId: string, userId: string, outcome: "ok" | "wrong_password" | "sso_required") {
  await audit(tenantDb(orgId), orgId, {
    actorId: membershipId,
    actorUserId: userId,
    action: outcome === "ok" ? "auth.sign_in" : "auth.sign_in_refused",
    entityType: "Membership",
    entityId: membershipId,
    meta: { method: "password", ...(outcome === "ok" ? {} : { code: outcome === "sso_required" ? "SSO_REQUIRED" : "WRONG_PASSWORD" }) },
  }).catch(() => undefined);
}
