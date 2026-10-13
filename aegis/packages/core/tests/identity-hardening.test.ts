import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { disconnectAll, rawPrisma, withTenant } from "@aegis/db";
import { addUserWithRole, makeTestTenant, type TestTenant } from "./helpers.js";
import { beginSsoLogin, completeSsoLogin, issuerIsSafe, upsertSsoConnection } from "../src/identity/oidc.js";
import { beginMfaEnrolment, confirmMfaEnrolment, registerUser, verifyMfaCode, verifySessionMfa, MFA_MAX_FAILURES } from "../src/identity/auth.js";
import { createSession, setSessionOrg } from "../src/identity/sessions.js";
import { totpCode } from "../src/identity/totp.js";
import { changeMemberRole, createOrganization, createRole } from "../src/orgs/orgs.js";
import { activateVersion, createPolicy, rollbackToVersion } from "../src/policy/service.js";

/** A local OpenID Connect provider: discovery, keys and a token endpoint returning an ID token with the claims a test sets. */
let idp: Server;
let issuer = "";
let key: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let nextClaims: Record<string, unknown> = {};
let nextNonce = "";

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  key = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  idp = createServer(async (req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/.well-known/openid-configuration") return send(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    if (req.url === "/jwks") return send(200, { keys: [jwk] });
    if (req.url === "/token") {
      const idToken = await new SignJWT({ nonce: nextNonce, ...nextClaims }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(issuer).setAudience("aegis-client").setSubject("sub-1").setIssuedAt().setExpirationTime("5m").sign(key);
      return send(200, { id_token: idToken, token_type: "Bearer" });
    }
    send(404, {});
  });
  await new Promise<void>((r) => idp.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
});
afterAll(async () => {
  idp.close();
  await disconnectAll();
});

let t: TestTenant;
let slug: string;
beforeAll(async () => {
  t = await makeTestTenant("idh");
  slug = (await rawPrisma().organization.findUniqueOrThrow({ where: { id: t.orgId } })).slug;
  await withTenant(t.orgId, (db) => upsertSsoConnection(db, t.ownerCtx, { issuer, clientId: "aegis-client", clientSecret: "s3cret", emailDomains: ["sso-test.example"], enabled: true }));
}, 60_000);
afterAll(() => t.cleanup());

async function ssoAs(claims: Record<string, unknown>) {
  const { url, verifier } = await beginSsoLogin(slug, "https://console.example/sso/callback");
  const u = new URL(url);
  nextNonce = u.searchParams.get("nonce")!;
  nextClaims = claims;
  return completeSsoLogin({ code: "c", state: u.searchParams.get("state")!, verifier });
}

describe("single sign-on", () => {
  it("provisions a new user with a verified address and binds the session to this organization", async () => {
    const email = `new-${Date.now()}@sso-test.example`;
    const r = await ssoAs({ email, email_verified: true, name: "New Person" });
    expect(r.orgId).toBe(t.orgId);
    const s = await rawPrisma().session.findUniqueOrThrow({ where: { id: r.sessionId } });
    expect(s.ssoOrgId).toBe(t.orgId);
    const other = await makeTestTenant("idh-other");
    await expect(setSessionOrg(r.sessionId, other.orgId)).rejects.toThrow(/another organization's single sign-on/);
    await setSessionOrg(r.sessionId, t.orgId);
    await other.cleanup();
  });
  it("refuses an address the provider did not assert as verified", async () => {
    await expect(ssoAs({ email: `x-${Date.now()}@sso-test.example` })).rejects.toThrow(/verified email/);
    await expect(ssoAs({ email: `y-${Date.now()}@sso-test.example`, email_verified: false })).rejects.toThrow(/verified email/);
  });
  it("never takes over an existing account that belongs to another organization", async () => {
    const email = `victim-${Date.now()}@sso-test.example`;
    const victim = await registerUser({ email, name: "Victim", password: "CorrectHorse1Battery" });
    await createOrganization({ name: `Victim org ${Date.now()}`, slug: `victim-${Date.now().toString(36)}`, ownerUserId: victim.id });
    await expect(ssoAs({ email, email_verified: true })).rejects.toThrow(/already exists/);
    expect(await rawPrisma().session.count({ where: { userId: victim.id } })).toBe(0);
  });
  it("signs in an existing member of this organization", async () => {
    const member = await addUserWithRole(t, "viewer", "ssomember");
    const user = await rawPrisma().user.findUniqueOrThrow({ where: { id: member.userId } });
    await rawPrisma().user.update({ where: { id: user.id }, data: { email: `m-${Date.now()}@sso-test.example` } });
    const updated = await rawPrisma().user.findUniqueOrThrow({ where: { id: user.id } });
    const r = await ssoAs({ email: updated.email, email_verified: true });
    expect(r.userId).toBe(user.id);
  });
  it("accepts only public https issuers", () => {
    expect(issuerIsSafe("https://login.microsoftonline.com/tenant/v2.0")).toBe(true);
    for (const bad of ["http://idp.example.com", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://idp.internal", "https://intranet", "https://u:p@idp.example.com"]) expect(issuerIsSafe(bad), bad).toBe(false);
  });
});

describe("multi-factor authentication", () => {
  it("accepts each code once", async () => {
    const u = await registerUser({ email: `mfa-${Date.now()}@test.aegis.local`, name: "M", password: "CorrectHorse1Battery" });
    const { secret } = await beginMfaEnrolment(u.id);
    await confirmMfaEnrolment(u.id, totpCode(secret, Date.now() - 30_000));
    const code = totpCode(secret);
    expect(await verifyMfaCode(u.id, code)).toBe(true);
    expect(await verifyMfaCode(u.id, code)).toBe(false);
    await expect(beginMfaEnrolment(u.id)).rejects.toThrow(/already on/);
  });
  it("closes the session after too many wrong codes", async () => {
    const u = await registerUser({ email: `mfa2-${Date.now()}@test.aegis.local`, name: "M", password: "CorrectHorse1Battery" });
    const { secret } = await beginMfaEnrolment(u.id);
    await confirmMfaEnrolment(u.id, totpCode(secret));
    const { session } = await createSession(u.id, { mfaPassed: false });
    for (let i = 1; i < MFA_MAX_FAILURES; i++) expect(await verifySessionMfa(session.id, u.id, "000000")).toEqual({ ok: false, revoked: false, remaining: MFA_MAX_FAILURES - i });
    expect(await verifySessionMfa(session.id, u.id, "000000")).toEqual({ ok: false, revoked: true, remaining: 0 });
    // Even the right code no longer helps: the session is closed.
    expect((await verifySessionMfa(session.id, u.id, totpCode(secret, Date.now() + 30_000))).ok).toBe(false);
    expect((await rawPrisma().session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();
  });
});

describe("no self-escalation through roles", () => {
  it("an administrator cannot make anyone owner, cannot change their own role, and cannot create a role beyond their permissions", async () => {
    const admin = await addUserWithRole(t, "admin", "adm");
    const viewer = await addUserWithRole(t, "viewer", "vw");
    const roles = await withTenant(t.orgId, (db) => db.role.findMany({ where: { orgId: t.orgId } }));
    const owner = roles.find((r) => r.key === "owner")!;
    const approver = roles.find((r) => r.key === "approver")!;
    const memberships = await withTenant(t.orgId, (db) => db.membership.findMany({ where: { orgId: t.orgId } }));
    const vm = memberships.find((m) => m.userId === viewer.userId)!;
    const am = memberships.find((m) => m.userId === admin.userId)!;
    await expect(withTenant(t.orgId, (db) => changeMemberRole(db, admin.ctx, vm.id, owner.id))).rejects.toThrow(/do not hold: \*/);
    await expect(withTenant(t.orgId, (db) => changeMemberRole(db, admin.ctx, am.id, owner.id))).rejects.toThrow(/your own role/);
    await expect(withTenant(t.orgId, (db) => createRole(db, admin.ctx, { key: "sneaky", name: "Sneaky", description: "", permissions: ["org:admin"] }))).rejects.toThrow(/org:admin/);
    await expect(withTenant(t.orgId, (db) => createRole(db, t.ownerCtx, { key: "typo", name: "Typo", description: "", permissions: ["gateway:raed"] }))).rejects.toThrow(/Unknown permissions/);
    await withTenant(t.orgId, (db) => changeMemberRole(db, admin.ctx, vm.id, approver.id));
    await withTenant(t.orgId, (db) => changeMemberRole(db, t.ownerCtx, vm.id, owner.id));
    await expect(withTenant(t.orgId, (db) => changeMemberRole(db, admin.ctx, vm.id, approver.id))).rejects.toThrow(/do not hold/);
  });
});

describe("policy activation needs review", () => {
  it("a draft cannot be activated or rolled back to", async () => {
    const doc = { version: 1, appliesTo: { tools: [], actions: [], environments: [] }, rules: [{ id: "r", effect: "deny", when: { always: true } }], tests: [] };
    const { version } = await withTenant(t.orgId, (db) => createPolicy(db, t.ownerCtx, { key: `p-${Date.now().toString(36)}`, name: "P", description: "", category: "authorization", document: doc as never, changeNote: "x" }));
    await expect(withTenant(t.orgId, (db) => activateVersion(db, t.ownerCtx, version.id, { fourEyes: false }))).rejects.toThrow(/Submit the version for review/);
    await expect(withTenant(t.orgId, (db) => rollbackToVersion(db, t.ownerCtx, version.id, "emergency"))).rejects.toThrow(/active before/);
  });
});
