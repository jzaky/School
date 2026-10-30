import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { rawPrisma, withTenant, type TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import { makeContext, type OrgContext } from "../lib/context.js";
import { decryptSecret, encryptSecret, constantTimeEqual, hmacHex, randomToken } from "../lib/crypto.js";
import { env } from "../env.js";
import { forbidden, notFound, unauthorized, validation } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { createSession } from "./sessions.js";

/**
 * Enterprise SSO: OpenID Connect authorization code flow with PKCE, one connection per
 * organization. Users are provisioned on first login when their email domain is allowed by the
 * connection and receive the organization's default role ("viewer") until an admin changes it.
 * Tokens are verified against the issuer's JWKS with `jose`. SAML is not implemented.
 */
/**
 * Issuers are fetched by the server (discovery, keys, token exchange), so they must be public https
 * endpoints: no plain http, no IP literals, no localhost or internal names.
 */
export function issuerIsSafe(issuer: string): boolean {
  let u: URL;
  try {
    u = new URL(issuer);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return false;
  if (host === "localhost" || !host.includes(".") || /\.(local|localhost|internal|lan|home|corp)$/.test(host)) return false;
  return true;
}

export const ssoConnectionSchema = z.object({
  protocol: z.enum(["oidc", "saml"]).default("oidc"),
  /** SAML: the identity provider's single sign-on URL and its signing certificate. */
  samlEntryPoint: z.string().url().refine((v) => issuerIsSafe(v) || process.env.AEGIS_ALLOW_INSECURE_SSO_ISSUER === "true", "The SAML sign-on URL must be a public https address").optional(),
  samlIdpCert: z.string().min(100).max(20_000).optional(),
  issuer: z.string().url().refine((v) => issuerIsSafe(v) || process.env.AEGIS_ALLOW_INSECURE_SSO_ISSUER === "true", "The issuer must be a public https address"),
  clientId: z.string().min(1).max(200),
  clientSecret: z.string().min(1).max(500).optional(),
  emailDomains: z.array(z.string().min(3).max(100)).min(1),
  enabled: z.boolean().default(false),
});

export async function upsertSsoConnection(db: TenantDb, ctx: OrgContext, input: z.input<typeof ssoConnectionSchema>) {
  assertPermission(ctx, "org:admin");
  const existing = await db.ssoConnection.findUnique({ where: { orgId: ctx.orgId } });
  if (!existing && !input.clientSecret && (input.protocol ?? "oidc") === "oidc") throw validation("Client secret is required for a new OIDC connection");
  const protocol = input.protocol ?? "oidc";
  if (protocol === "saml" && (!input.samlEntryPoint || !input.samlIdpCert)) throw validation("SAML needs the identity provider's sign-on URL and signing certificate");
  const data = { protocol, issuer: input.issuer.replace(/\/$/, ""), clientId: input.clientId, emailDomains: input.emailDomains.map((d) => d.toLowerCase()), enabled: input.enabled, samlEntryPoint: protocol === "saml" ? input.samlEntryPoint! : null, samlIdpCert: protocol === "saml" ? input.samlIdpCert! : null, ...(input.clientSecret ? { clientSecretEnc: encryptSecret(input.clientSecret, `sso:${ctx.orgId}`) } : {}) };
  const row = existing ? await db.ssoConnection.update({ where: { id: existing.id }, data }) : await db.ssoConnection.create({ data: { orgId: ctx.orgId, ...data, clientSecretEnc: data.clientSecretEnc ?? encryptSecret("", `sso:${ctx.orgId}`) } });
  await appendEvidence(db, ctx, { type: "sso.connection_updated", subjectType: "sso_connection", subjectId: row.id, payload: { protocol: row.protocol, issuer: row.issuer, enabled: row.enabled, domains: row.emailDomains, secretRotated: !!input.clientSecret } });
  return { ...row, clientSecretEnc: undefined };
}

export async function getSsoConnection(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "org:read");
  const row = await db.ssoConnection.findUnique({ where: { orgId: ctx.orgId } });
  return row ? { ...row, clientSecretEnc: undefined, hasSecret: !!row.clientSecretEnc } : null;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}
const discoveryCache = new Map<string, { at: number; doc: Discovery }>();
async function discover(issuer: string): Promise<Discovery> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.at < 3600_000) return cached.doc;
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw unauthorized("Identity provider discovery failed");
  const doc = (await res.json()) as Discovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) throw unauthorized("Identity provider discovery document is incomplete");
  discoveryCache.set(issuer, { at: Date.now(), doc });
  return doc;
}

/** Signed, short-lived state carried through the round trip (stateless: no server storage needed). */
function signState(payload: Record<string, string>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60_000 })).toString("base64url");
  return `${body}.${hmacHex(env().AEGIS_SESSION_SECRET, `sso-state:${body}`)}`;
}
function readState(state: string): Record<string, string> {
  const [body, sig] = state.split(".");
  if (!body || !sig || !constantTimeEqual(hmacHex(env().AEGIS_SESSION_SECRET, `sso-state:${body}`), sig)) throw unauthorized("Invalid SSO state");
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, string> & { exp: number };
  if (parsed.exp < Date.now()) throw unauthorized("SSO state expired");
  return parsed;
}

/** Step 1: build the provider redirect for an organization slug. Returns the URL and the PKCE verifier to keep in a cookie. */
export async function beginSsoLogin(orgSlug: string, redirectUri: string): Promise<{ url: string; verifier: string }> {
  const org = await rawPrisma().organization.findUnique({ where: { slug: orgSlug } });
  if (!org) throw notFound("Organization");
  const conn = await withTenant(org.id, (db) => db.ssoConnection.findUnique({ where: { orgId: org.id } }));
  if (!conn || !conn.enabled) throw forbidden("Single sign-on is not enabled for this organization");
  if (conn.protocol !== "oidc") throw forbidden("This organization signs in with SAML");
  const disc = await discover(conn.issuer);
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const nonce = randomBytes(16).toString("hex");
  const state = signState({ orgId: org.id, nonce, redirectUri });
  const url = new URL(disc.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", conn.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), verifier };
}

/** Step 2: exchange the code, verify the id token, provision or load the user, create a session. */
export async function completeSsoLogin(params: { code: string; state: string; verifier: string; ip?: string; userAgent?: string }) {
  const st = readState(params.state);
  const orgId = st.orgId!;
  const conn = await withTenant(orgId, (db) => db.ssoConnection.findUnique({ where: { orgId } }));
  if (!conn || !conn.enabled) throw forbidden("Single sign-on is not enabled");
  if (conn.protocol !== "oidc") throw forbidden("This organization signs in with SAML");
  const disc = await discover(conn.issuer);
  const body = new URLSearchParams({ grant_type: "authorization_code", code: params.code, redirect_uri: st.redirectUri!, client_id: conn.clientId, client_secret: decryptSecret(conn.clientSecretEnc, `sso:${orgId}`), code_verifier: params.verifier });
  const tokenRes = await fetch(disc.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(8000) });
  if (!tokenRes.ok) throw unauthorized("Token exchange failed");
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) throw unauthorized("No id_token returned");
  const jwks = createRemoteJWKSet(new URL(disc.jwks_uri));
  const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: disc.issuer || conn.issuer, audience: conn.clientId });
  if (payload.nonce !== st.nonce) throw unauthorized("Nonce mismatch");
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  // The provider must assert that it verified the address; a missing claim is not a verification.
  if (!email || payload.email_verified !== true) throw unauthorized("Identity provider did not return a verified email");
  return finishSsoLogin(conn, orgId, { email, name: typeof payload.name === "string" ? payload.name : email, ip: params.ip, userAgent: params.userAgent });
}

/**
 * Shared end of every single sign-on login (OIDC and SAML), after the identity provider's answer has
 * been verified: domain check, no takeover of accounts outside this organization, provisioning as a
 * viewer, evidence, and a session bound to this organization.
 */
export async function finishSsoLogin(conn: { issuer: string; emailDomains: string[]; protocol?: string }, orgId: string, who: { email: string; name: string; ip?: string; userAgent?: string }) {
  const email = who.email.toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (!conn.emailDomains.includes(domain)) throw forbidden(`Email domain ${domain} is not allowed for this organization`);
  let user = await rawPrisma().user.findUnique({ where: { email } });
  if (user) {
    // An organization's identity provider vouches only for its own members. An account that exists for
    // another organization is never taken over by matching its email: it must be invited here first.
    const member = await withTenant(orgId, (db) => db.membership.findUnique({ where: { orgId_userId: { orgId, userId: user!.id } } }));
    if (!member) throw forbidden("An AEGIS account with this email already exists. Ask an administrator of this organization to invite it, then sign in with single sign-on.");
  } else {
    user = await rawPrisma().user.create({ data: { email, name: who.name, passwordHash: null } });
  }
  if (user.status !== "active") throw forbidden("Account disabled");
  await withTenant(orgId, async (db) => {
    const ctx = makeContext(orgId, { type: "user", id: user!.id });
    const m = await db.membership.findUnique({ where: { orgId_userId: { orgId, userId: user!.id } } });
    if (!m) {
      const viewer = await db.role.findUniqueOrThrow({ where: { orgId_key: { orgId, key: "viewer" } } });
      await db.membership.create({ data: { orgId, userId: user!.id, roleId: viewer.id, status: "active" } });
      await appendEvidence(db, ctx, { type: "sso.user_provisioned", subjectType: "membership", subjectId: user!.id, payload: { domain, role: "viewer", protocol: conn.protocol ?? "oidc" } });
    } else if (m.status !== "active") {
      throw forbidden("Your membership in this organization is suspended");
    }
    await appendEvidence(db, ctx, { type: "sso.login", subjectType: "user", subjectId: user!.id, payload: { issuer: conn.issuer, protocol: conn.protocol ?? "oidc" } });
  });
  await rawPrisma().user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  // SSO logins satisfy MFA when the provider enforces it; we still honour a user's own TOTP flag.
  const { token, session } = await createSession(user.id, { ip: who.ip, userAgent: who.userAgent, activeOrgId: orgId, ssoOrgId: orgId, mfaPassed: !user.mfaEnabled });
  return { token, sessionId: session.id, userId: user.id, orgId, mfaRequired: user.mfaEnabled };
}

export { signState as signSsoState, readState as readSsoState };

/** Which sign-in protocol an organization uses, or null when single sign-on is off. */
export async function ssoProtocolForOrg(orgSlug: string): Promise<"oidc" | "saml" | null> {
  const org = await rawPrisma().organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;
  const conn = await withTenant(org.id, (db) => db.ssoConnection.findUnique({ where: { orgId: org.id }, select: { enabled: true, protocol: true } }));
  if (!conn?.enabled) return null;
  return conn.protocol === "saml" ? "saml" : "oidc";
}
