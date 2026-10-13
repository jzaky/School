import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SignedXml } from "xml-crypto";
import { disconnectAll, rawPrisma, withTenant } from "@aegis/db";
import { makeTestTenant, type TestTenant } from "./helpers.js";
import { upsertSsoConnection } from "../src/identity/oidc.js";
import { beginSamlLogin, completeSamlLogin, samlAcsUrl, samlEntityId, samlMetadata } from "../src/identity/saml.js";
import { registerUser } from "../src/identity/auth.js";
import { createOrganization } from "../src/orgs/orgs.js";

/** A test identity provider: a self-signed key pair and a function that issues signed SAML responses. */
let dir: string;
let idpKey: string;
let idpCert: string;
let otherKey: string;
let t: TestTenant;
let slug: string;
const IDP = "https://idp.saml-test.example/metadata";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aegis-saml-"));
  for (const name of ["idp", "other"]) execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", `/CN=${name}`, "-keyout", join(dir, `${name}.key`), "-out", join(dir, `${name}.crt`)], { stdio: "ignore" });
  idpKey = readFileSync(join(dir, "idp.key"), "utf8");
  idpCert = readFileSync(join(dir, "idp.crt"), "utf8");
  otherKey = readFileSync(join(dir, "other.key"), "utf8");
  t = await makeTestTenant("saml");
  slug = (await rawPrisma().organization.findUniqueOrThrow({ where: { id: t.orgId } })).slug;
  await withTenant(t.orgId, (db) => upsertSsoConnection(db, t.ownerCtx, { protocol: "saml", issuer: IDP, clientId: "saml", emailDomains: ["saml-test.example"], enabled: true, samlEntryPoint: "https://idp.saml-test.example/sso", samlIdpCert: idpCert }));
}, 60_000);
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await t.cleanup();
  await disconnectAll();
});

function issueResponse(opts: { email: string; audience?: string; key?: string; notOnOrAfter?: Date; assertionId?: string }) {
  const now = new Date();
  const after = opts.notOnOrAfter ?? new Date(now.getTime() + 5 * 60_000);
  const assertionId = opts.assertionId ?? `_a${randomUUID().replace(/-/g, "")}`;
  const iso = (d: Date) => d.toISOString();
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${iso(now)}"><saml:Issuer>${IDP}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${opts.email}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${iso(after)}" Recipient="${samlAcsUrl()}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${iso(new Date(now.getTime() - 60_000))}" NotOnOrAfter="${iso(after)}"><saml:AudienceRestriction><saml:Audience>${opts.audience ?? samlEntityId(slug)}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${iso(now)}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${opts.email}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`;
  const sig = new SignedXml({ privateKey: opts.key ?? idpKey, canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#", signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" });
  sig.addReference({ xpath: "//*[local-name(.)='Assertion']", transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"], digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256" });
  sig.computeSignature(assertion, { location: { reference: "//*[local-name(.)='Issuer']", action: "after" } });
  const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r${randomUUID().replace(/-/g, "")}" Version="2.0" IssueInstant="${iso(now)}" Destination="${samlAcsUrl()}"><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${IDP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${sig.getSignedXml()}</samlp:Response>`;
  return Buffer.from(response).toString("base64");
}

async function relayState() {
  const { url } = await beginSamlLogin(slug);
  return new URL(url).searchParams.get("RelayState")!;
}

describe("SAML single sign-on", () => {
  it("starts at the identity provider with a signed relay state and publishes metadata", async () => {
    const { url } = await beginSamlLogin(slug);
    expect(url.startsWith("https://idp.saml-test.example/sso?")).toBe(true);
    expect(new URL(url).searchParams.get("SAMLRequest")).toBeTruthy();
    expect(await samlMetadata(slug)).toContain(samlAcsUrl());
  });
  it("signs in a new person from a signed assertion, bound to this organization", async () => {
    const r = await completeSamlLogin({ samlResponse: issueResponse({ email: `layla-${Date.now()}@saml-test.example` }), relayState: await relayState() });
    expect(r.orgId).toBe(t.orgId);
    expect((await rawPrisma().session.findUniqueOrThrow({ where: { id: r.sessionId } })).ssoOrgId).toBe(t.orgId);
  });
  it("refuses an assertion signed by another key, for another audience, expired, or replayed", async () => {
    const email = `omar-${Date.now()}@saml-test.example`;
    await expect(completeSamlLogin({ samlResponse: issueResponse({ email, key: otherKey }), relayState: await relayState() })).rejects.toThrow(/rejected/);
    await expect(completeSamlLogin({ samlResponse: issueResponse({ email, audience: "https://someone-else.example/sp" }), relayState: await relayState() })).rejects.toThrow(/rejected/);
    await expect(completeSamlLogin({ samlResponse: issueResponse({ email, notOnOrAfter: new Date(Date.now() - 5 * 60_000) }), relayState: await relayState() })).rejects.toThrow(/rejected/);
    const once = issueResponse({ email });
    await completeSamlLogin({ samlResponse: once, relayState: await relayState() });
    await expect(completeSamlLogin({ samlResponse: once, relayState: await relayState() })).rejects.toThrow(/already used/);
  });
  it("refuses a forged relay state and never takes over an account from another organization", async () => {
    await expect(completeSamlLogin({ samlResponse: issueResponse({ email: `x-${Date.now()}@saml-test.example` }), relayState: "e30.deadbeef" })).rejects.toThrow(/Invalid SSO state/);
    const email = `victim-${Date.now()}@saml-test.example`;
    const victim = await registerUser({ email, name: "Victim", password: "CorrectHorse1Battery" });
    await createOrganization({ name: `V ${Date.now()}`, slug: `v-${Date.now().toString(36)}`, ownerUserId: victim.id });
    await expect(completeSamlLogin({ samlResponse: issueResponse({ email }), relayState: await relayState() })).rejects.toThrow(/already exists/);
  });
});
