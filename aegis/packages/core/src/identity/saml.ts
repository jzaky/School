import { SAML, ValidateInResponseTo, generateServiceProviderMetadata } from "@node-saml/node-saml";
import { randomBytes } from "node:crypto";
import { rawPrisma, withTenant } from "@aegis/db";
import { env } from "../env.js";
import { forbidden, notFound, unauthorized } from "../lib/errors.js";
import { finishSsoLogin, readSsoState, signSsoState } from "./oidc.js";

/**
 * SAML 2.0 single sign-on (service-provider initiated, HTTP-Redirect request, HTTP-POST response),
 * built on node-saml (MIT). Requirements enforced on every response:
 * - the assertion is signed with the identity provider's configured certificate;
 * - it is addressed to this service provider (audience) and inside its validity window;
 * - the RelayState is AEGIS's own signed, ten-minute state naming the organization, and its nonce must
 *   match the cookie set on the browser that started the login (no login CSRF);
 * - the signed assertion answers the request AEGIS sent: SubjectConfirmationData InResponseTo equals the
 *   request id derived from that nonce (unsolicited, identity-provider-initiated responses are refused);
 * - an assertion id is accepted once, across every process (shared `saml_assertions` table).
 * The account rules after that are the same as OIDC: see finishSsoLogin.
 */
/** Cookie holding the nonce of the SAML login this browser started. */
export const SAML_NONCE_COOKIE = "aegis_saml_login";

export function samlEntityId(orgSlug: string): string {
  return `${env().WEB_PUBLIC_URL}/sso/saml/${orgSlug}/metadata`;
}
export function samlAcsUrl(): string {
  return `${env().WEB_PUBLIC_URL}/sso/saml/acs`;
}

function normaliseCert(cert: string): string {
  return cert.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
}

async function connectionFor(orgId: string) {
  const conn = await withTenant(orgId, (db) => db.ssoConnection.findUnique({ where: { orgId } }));
  if (!conn || !conn.enabled) throw forbidden("Single sign-on is not enabled for this organization");
  if (conn.protocol !== "saml" || !conn.samlEntryPoint || !conn.samlIdpCert) throw forbidden("This organization does not sign in with SAML");
  return conn;
}

/** The AuthnRequest id for a login, derived from the relay-state nonce so the response can be matched to it. */
export function samlRequestId(nonce: string): string {
  return `_aegis${nonce}`;
}

function client(conn: { samlEntryPoint: string | null; samlIdpCert: string | null }, slug: string, nonce?: string) {
  return new SAML({
    ...(nonce ? { generateUniqueId: () => samlRequestId(nonce) } : {}),
    entryPoint: conn.samlEntryPoint!,
    issuer: samlEntityId(slug),
    callbackUrl: samlAcsUrl(),
    idpCert: normaliseCert(conn.samlIdpCert!),
    audience: samlEntityId(slug),
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: 60_000,
    validateInResponseTo: ValidateInResponseTo.never,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    disableRequestedAuthnContext: true,
  });
}

export async function beginSamlLogin(orgSlug: string): Promise<{ url: string; nonce: string; requestId: string }> {
  const org = await rawPrisma().organization.findUnique({ where: { slug: orgSlug } });
  if (!org) throw notFound("Organization");
  const conn = await connectionFor(org.id);
  const nonce = randomBytes(12).toString("hex");
  const relayState = signSsoState({ orgId: org.id, slug: orgSlug, nonce, protocol: "saml" });
  const url = await client(conn, orgSlug, nonce).getAuthorizeUrlAsync(relayState, undefined, {});
  // The caller sets `nonce` as a short-lived cookie on the browser; completeSamlLogin requires it back.
  return { url, nonce, requestId: samlRequestId(nonce) };
}

/**
 * Records an assertion id in the shared `saml_assertions` table and returns false if it was already
 * there, so a captured response is refused on every process and replica, not only the one that saw it.
 * Expired ids for the organization are removed first; the primary key makes the insert the check.
 */
export async function acceptAssertionOnce(orgId: string, assertionId: string, ttlMs: number): Promise<boolean> {
  return withTenant(orgId, async (db) => {
    await db.samlAssertion.deleteMany({ where: { orgId, expiresAt: { lt: new Date() } } });
    const inserted = await db.samlAssertion.createMany({ data: [{ orgId, assertionId, expiresAt: new Date(Date.now() + ttlMs) }], skipDuplicates: true });
    return inserted.count === 1;
  });
}

export async function completeSamlLogin(params: { samlResponse: string; relayState: string; browserNonce: string | null | undefined; ip?: string; userAgent?: string }) {
  const st = readSsoState(params.relayState);
  if (st.protocol !== "saml" || !st.orgId || !st.slug || typeof st.nonce !== "string") throw unauthorized("Invalid SAML relay state");
  if (!params.browserNonce || params.browserNonce !== st.nonce) throw unauthorized("This sign-in was not started from this browser; start again from the sign-in page");
  const conn = await connectionFor(st.orgId);
  let profile;
  try {
    ({ profile } = await client(conn, st.slug).validatePostResponseAsync({ SAMLResponse: params.samlResponse }));
  } catch (e) {
    throw unauthorized(`SAML response rejected: ${e instanceof Error ? e.message : "invalid"}`);
  }
  if (!profile) throw unauthorized("SAML response carried no assertion");
  // Inside the signed assertion: the response must answer the request this browser started.
  const answered = profile.getAssertionXml?.().match(/<(?:\w+:)?SubjectConfirmationData\b[^>]*\bInResponseTo="([^"]+)"/)?.[1] ?? null;
  if (answered !== samlRequestId(st.nonce)) throw unauthorized("The SAML response does not answer the sign-in request AEGIS sent");
  const assertionId = (profile as { ID?: string }).ID ?? (profile.getAssertionXml?.().match(/\bID="([^"]+)"/)?.[1] ?? null);
  if (!assertionId || !(await acceptAssertionOnce(st.orgId, assertionId, 10 * 60_000))) throw unauthorized("This SAML assertion was already used");
  const p = profile as Record<string, unknown>;
  const email = String(p.email ?? p.mail ?? p["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] ?? profile.nameID ?? "").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw unauthorized("The identity provider did not send an email address");
  const name = String(p.displayName ?? p["http://schemas.microsoft.com/identity/claims/displayname"] ?? p.name ?? email);
  return finishSsoLogin({ issuer: conn.issuer, emailDomains: conn.emailDomains, protocol: "saml" }, st.orgId, { email, name, ip: params.ip, userAgent: params.userAgent });
}

/** Service-provider metadata an administrator gives their identity provider. */
export async function samlMetadata(orgSlug: string): Promise<string> {
  const org = await rawPrisma().organization.findUnique({ where: { slug: orgSlug } });
  if (!org) throw notFound("Organization");
  return generateServiceProviderMetadata({ issuer: samlEntityId(orgSlug), callbackUrl: samlAcsUrl(), identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress", wantAssertionsSigned: true });
}
