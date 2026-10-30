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
import { acceptAssertionOnce, beginSamlLogin, completeSamlLogin, samlAcsUrl, samlEntityId, samlMetadata } from "../src/identity/saml.js";
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

function issueResponse(opts: { email: string; audience?: string; key?: string; notOnOrAfter?: Date; assertionId?: string; inResponseTo?: string | null }) {
  const now = new Date();
  const after = opts.notOnOrAfter ?? new Date(now.getTime() + 5 * 60_000);
  const assertionId = opts.assertionId ?? `_a${randomUUID().replace(/-/g, "")}`;
  const iso = (d: Date) => d.toISOString();
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${iso(now)}"><saml:Issuer>${IDP}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${opts.email}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData${opts.inResponseTo ? ` InResponseTo="${opts.inResponseTo}"` : ""} NotOnOrAfter="${iso(after)}" Recipient="${samlAcsUrl()}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${iso(new Date(now.getTime() - 60_000))}" NotOnOrAfter="${iso(after)}"><saml:AudienceRestriction><saml:Audience>${opts.audience ?? samlEntityId(slug)}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${iso(now)}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${opts.email}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`;
  const sig = new SignedXml({ privateKey: opts.key ?? idpKey, canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#", signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" });
  sig.addReference({ xpath: "//*[local-name(.)='Assertion']", transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"], digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256" });
  sig.computeSignature(assertion, { location: { reference: "//*[local-name(.)='Issuer']", action: "after" } });
  const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r${randomUUID().replace(/-/g, "")}" Version="2.0" IssueInstant="${iso(now)}" Destination="${samlAcsUrl()}"${opts.inResponseTo ? ` InResponseTo="${opts.inResponseTo}"` : ""}><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${IDP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${sig.getSignedXml()}</samlp:Response>`;
  return Buffer.from(response).toString("base64");
}

/** Starts a login as a browser would: the relay state, the cookie nonce and the request id AEGIS sent. */
async function start() {
  const { url, nonce, requestId } = await beginSamlLogin(slug);
  return { relayState: new URL(url).searchParams.get("RelayState")!, nonce, requestId };
}
type Login = Awaited<ReturnType<typeof start>>;
/** The identity provider answers the login's request; by default the browser that started it posts it back. */
async function complete(resp: Parameters<typeof issueResponse>[0], login?: Login, browserNonce?: string | null) {
  const l = login ?? (await start());
  return completeSamlLogin({ samlResponse: issueResponse({ ...resp, inResponseTo: resp.inResponseTo === undefined ? l.requestId : resp.inResponseTo }), relayState: l.relayState, browserNonce: browserNonce === undefined ? l.nonce : browserNonce });
}

describe("SAML single sign-on", () => {
  it("starts at the identity provider with a signed relay state and publishes metadata", async () => {
    const { url } = await beginSamlLogin(slug);
    expect(url.startsWith("https://idp.saml-test.example/sso?")).toBe(true);
    expect(new URL(url).searchParams.get("SAMLRequest")).toBeTruthy();
    expect(await samlMetadata(slug)).toContain(samlAcsUrl());
  });
  it("signs in a new person from a signed assertion, bound to this organization", async () => {
    const r = await complete({ email: `layla-${Date.now()}@saml-test.example` });
    expect(r.orgId).toBe(t.orgId);
    expect((await rawPrisma().session.findUniqueOrThrow({ where: { id: r.sessionId } })).ssoOrgId).toBe(t.orgId);
  });
  it("refuses an assertion signed by another key, for another audience, expired, or replayed", async () => {
    const email = `omar-${Date.now()}@saml-test.example`;
    await expect(complete({ email, key: otherKey })).rejects.toThrow(/rejected/);
    await expect(complete({ email, audience: "https://someone-else.example/sp" })).rejects.toThrow(/rejected/);
    await expect(complete({ email, notOnOrAfter: new Date(Date.now() - 5 * 60_000) })).rejects.toThrow(/rejected/);
    const login = await start();
    const once = issueResponse({ email, inResponseTo: login.requestId });
    await completeSamlLogin({ samlResponse: once, relayState: login.relayState, browserNonce: login.nonce });
    await expect(completeSamlLogin({ samlResponse: once, relayState: login.relayState, browserNonce: login.nonce })).rejects.toThrow(/already used/);
  });
  it("keeps the replay record in the shared database, per organization, and lets expired ids go", async () => {
    const id = `_assert-${randomUUID()}`;
    const other = await makeTestTenant("saml-other");
    try {
      // Two concurrent attempts (as on two replicas): exactly one is accepted.
      const results = await Promise.all([acceptAssertionOnce(t.orgId, id, 60_000), acceptAssertionOnce(t.orgId, id, 60_000)]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await acceptAssertionOnce(t.orgId, id, 60_000)).toBe(false);
      // The record is a row, visible to any process, and scoped to its organization.
      expect(await withTenant(t.orgId, (db) => db.samlAssertion.count({ where: { assertionId: id } }))).toBe(1);
      expect(await withTenant(other.orgId, (db) => db.samlAssertion.count({ where: { assertionId: id } }))).toBe(0);
      expect(await acceptAssertionOnce(other.orgId, id, 60_000)).toBe(true);
      // Once expired, the id is cleaned up on the next check.
      const old = `_assert-${randomUUID()}`;
      expect(await acceptAssertionOnce(t.orgId, old, -1_000)).toBe(true);
      await acceptAssertionOnce(t.orgId, `_assert-${randomUUID()}`, 60_000);
      expect(await withTenant(t.orgId, (db) => db.samlAssertion.count({ where: { assertionId: old } }))).toBe(0);
    } finally {
      await other.cleanup();
    }
  });
  it("refuses a forged relay state and never takes over an account from another organization", async () => {
    await expect(completeSamlLogin({ samlResponse: issueResponse({ email: `x-${Date.now()}@saml-test.example` }), relayState: "e30.deadbeef", browserNonce: "x" })).rejects.toThrow(/Invalid SSO state/);
    const email = `victim-${Date.now()}@saml-test.example`;
    const victim = await registerUser({ email, name: "Victim", password: "CorrectHorse1Battery" });
    await createOrganization({ name: `V ${Date.now()}`, slug: `v-${Date.now().toString(36)}`, ownerUserId: victim.id });
    await expect(complete({ email })).rejects.toThrow(/already exists/);
  });
  // Audit P2-5: the response must answer this browser's own request.
  it("refuses a login this browser did not start, an unsolicited response, and an answer to another request", async () => {
    const email = `p25-${Date.now()}@saml-test.example`;
    await expect(complete({ email }, undefined, null)).rejects.toThrow(/not started from this browser/);
    await expect(complete({ email }, undefined, "another-browsers-nonce")).rejects.toThrow(/not started from this browser/);
    await expect(complete({ email, inResponseTo: null })).rejects.toThrow(/does not answer/);
    const other = await start();
    await expect(complete({ email, inResponseTo: other.requestId })).rejects.toThrow(/does not answer/);
    const ok = await complete({ email });
    expect(ok.orgId).toBe(t.orgId);
  });
});
