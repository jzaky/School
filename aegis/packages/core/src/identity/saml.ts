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
 * - the RelayState is AEGIS's own signed, ten-minute state naming the organization;
 * - an assertion id is accepted once (per process; a shared store is listed as a limitation).
 * The account rules after that are the same as OIDC: see finishSsoLogin.
 */
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

function client(conn: { samlEntryPoint: string | null; samlIdpCert: string | null }, slug: string) {
  return new SAML({
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

export async function beginSamlLogin(orgSlug: string): Promise<{ url: string }> {
  const org = await rawPrisma().organization.findUnique({ where: { slug: orgSlug } });
  if (!org) throw notFound("Organization");
  const conn = await connectionFor(org.id);
  const relayState = signSsoState({ orgId: org.id, slug: orgSlug, nonce: randomBytes(12).toString("hex"), protocol: "saml" });
  const url = await client(conn, orgSlug).getAuthorizeUrlAsync(relayState, undefined, {});
  return { url };
}

const seenAssertions = new Map<string, number>();
function acceptOnce(id: string, ttlMs: number): boolean {
  const now = Date.now();
  for (const [k, exp] of seenAssertions) if (exp < now) seenAssertions.delete(k);
  if (seenAssertions.has(id)) return false;
  seenAssertions.set(id, now + ttlMs);
  return true;
}

export async function completeSamlLogin(params: { samlResponse: string; relayState: string; ip?: string; userAgent?: string }) {
  const st = readSsoState(params.relayState);
  if (st.protocol !== "saml" || !st.orgId || !st.slug) throw unauthorized("Invalid SAML relay state");
  const conn = await connectionFor(st.orgId);
  let profile;
  try {
    ({ profile } = await client(conn, st.slug).validatePostResponseAsync({ SAMLResponse: params.samlResponse }));
  } catch (e) {
    throw unauthorized(`SAML response rejected: ${e instanceof Error ? e.message : "invalid"}`);
  }
  if (!profile) throw unauthorized("SAML response carried no assertion");
  const assertionId = (profile as { ID?: string }).ID ?? (profile.getAssertionXml?.().match(/\bID="([^"]+)"/)?.[1] ?? null);
  if (!assertionId || !acceptOnce(assertionId, 10 * 60_000)) throw unauthorized("This SAML assertion was already used");
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
