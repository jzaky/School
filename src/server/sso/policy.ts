// A school's sign-in policy: which options its sign-in page shows, whether staff must use single sign-on,
// allowed domains, how first sign-ins find existing members, and provider ids (ClassLink tenant, Clever district,
// Microsoft tenant, the school's own OpenID Connect provider). A school without a SignInPolicy row gets defaults
// that match the original behaviour: password, plus Google and Microsoft when the school has them switched on.
// No "server-only" marker: tests and the worker import it.
import type { SignInPolicy } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { SIGN_IN_METHODS, isSignInMethod, methodConfigured, type SignInMethod } from "./providers";

export type MatchBy = "EMAIL" | "EXTERNAL_ID" | "EMAIL_OR_EXTERNAL_ID";
export const MATCH_BY: MatchBy[] = ["EMAIL_OR_EXTERNAL_ID", "EMAIL", "EXTERNAL_ID"];

export type Policy = Omit<SignInPolicy, "id" | "createdAt" | "updatedAt" | "updatedById" | "methods" | "matchBy"> & {
  methods: SignInMethod[];
  matchBy: MatchBy;
  /** False when the school never saved sign-in settings (defaults in use). */
  saved: boolean;
};

type OrgFlags = { googleSignIn: boolean; microsoftSignIn: boolean };

export function defaultPolicy(orgId: string, org: OrgFlags): Policy {
  return {
    orgId,
    methods: ["password", ...(org.googleSignIn ? (["google"] as const) : []), ...(org.microsoftSignIn ? (["microsoft"] as const) : [])],
    staffSsoRequired: false,
    allowedDomains: [],
    matchBy: "EMAIL_OR_EXTERNAL_ID",
    selfJoinDomains: [],
    selfJoinApproval: true,
    classlinkTenantId: null,
    cleverDistrictId: null,
    microsoftTenantId: null,
    oidcName: null,
    oidcIssuer: null,
    oidcClientId: null,
    oidcSecretEnc: null,
    oidcScopes: "openid email profile",
    oidcEmailClaim: "email",
    oidcIdClaim: "sub",
    oidcNameClaim: "name",
    oidcTrustEmail: false,
    uaePassEidMatch: true,
    saved: false,
  };
}

export function toPolicy(row: SignInPolicy): Policy {
  const { id: _id, createdAt: _c, updatedAt: _u, updatedById: _b, ...rest } = row;
  return {
    ...rest,
    methods: SIGN_IN_METHODS.filter((m) => row.methods.includes(m)),
    matchBy: (MATCH_BY as string[]).includes(row.matchBy) ? (row.matchBy as MatchBy) : "EMAIL_OR_EXTERNAL_ID",
    saved: true,
  };
}

export async function loadPolicy(orgId: string): Promise<Policy> {
  const db = tenantDb(orgId);
  const [row, org] = await Promise.all([
    db.signInPolicy.findUnique({ where: { orgId } }),
    db.organization.findUnique({ where: { id: orgId }, select: { googleSignIn: true, microsoftSignIn: true } }),
  ]);
  if (row) return toPolicy(row);
  return defaultPolicy(orgId, org ?? { googleSignIn: false, microsoftSignIn: false });
}

/** The school OpenID Connect provider has everything it needs. */
export const oidcReady = (p: Pick<Policy, "oidcIssuer" | "oidcClientId" | "oidcSecretEnc">) => Boolean(p.oidcIssuer && p.oidcClientId && p.oidcSecretEnc);

/** Is this option switched on by the school AND configured on the server? */
export function methodAvailable(p: Policy, method: SignInMethod, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!p.methods.includes(method) || !methodConfigured(method, env)) return false;
  if (method === "oidc") return oidcReady(p);
  return true;
}

/** The options the school's sign-in page shows, in display order. Password is always kept for administrators. */
export function visibleMethods(p: Policy, env: NodeJS.ProcessEnv = process.env): SignInMethod[] {
  return SIGN_IN_METHODS.filter((m) => methodAvailable(p, m, env));
}

export function cleanMethods(input: unknown[]): SignInMethod[] {
  return SIGN_IN_METHODS.filter((m) => input.some((x) => isSignInMethod(x) && x === m));
}

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Lower-case, de-duplicated domains; returns the first invalid entry as a problem. */
export function cleanDomainList(input: string[]): { domains: string[]; invalid: string | null } {
  const out: string[] = [];
  for (const raw of input) {
    const d = raw.trim().toLowerCase().replace(/^@/, "");
    if (!d) continue;
    if (!DOMAIN.test(d)) return { domains: out, invalid: d };
    if (!out.includes(d)) out.push(d);
  }
  return { domains: out.slice(0, 20), invalid: null };
}

export const domainOf = (email: string | null | undefined) => (email?.split("@")[1] ?? "").toLowerCase();
