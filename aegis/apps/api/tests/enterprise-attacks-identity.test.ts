import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerPrisma, rawPrisma, withTenant } from "@aegis/db";
import { beginMfaEnrolment, changePassword, confirmMfaEnrolment, createOrganization, createSession, issueApiKey, listUserMemberships, makeContext, MFA_MAX_FAILURES, registerUser, revokeApiKey, totpCode } from "@aegis/core";
import { app, attacker, domain, login, nextIp, PASSWORD, setupWorld, teardownWorld, victim } from "./attack-harness.js";

/**
 * Validation phase 2: identity and session attacks over HTTP. Passing shows resistance to these attacks, not to
 * every attack.
 */
beforeAll(setupWorld, 300_000);
afterAll(teardownWorld);

const get = (url: string, headers: Record<string, string>) => app.inject({ method: "GET", url, headers, remoteAddress: nextIp() });
const post = (url: string, headers: Record<string, string>, payload: unknown) => app.inject({ method: "POST", url, headers, payload: payload as object, remoteAddress: nextIp() });

let n = 0;
async function member(role = "viewer") {
  const email = `idt-${++n}-${Date.now().toString(36)}@${domain}`;
  const u = await registerUser({ email, name: `Identity ${n}`, password: PASSWORD });
  await withTenant(attacker.orgId, async (db) => {
    const r = await db.role.findUniqueOrThrow({ where: { orgId_key: { orgId: attacker.orgId, key: role } } });
    await db.membership.create({ data: { orgId: attacker.orgId, userId: u.id, roleId: r.id } });
  });
  return { id: u.id, email };
}
const sessionToken = (cookie: string) => cookie.split("=")[1]!;

describe("sessions", () => {
  it("a signed-out session is dead", async () => {
    const u = await member();
    const cookie = await login(u.email);
    expect((await get("/v1/agents", { cookie })).statusCode).toBe(200);
    expect((await post("/v1/auth/logout", { cookie }, {})).statusCode).toBe(200);
    expect((await get("/v1/agents", { cookie })).statusCode).toBe(401);
    expect((await get("/v1/auth/me", { cookie })).statusCode).toBe(401);
  });

  it("tampered, forged and empty session cookies are refused", async () => {
    const u = await member();
    const cookie = await login(u.email);
    const token = sessionToken(cookie);
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    for (const c of [`aegis_session=${flipped}`, `aegis_session=${token}x`, `aegis_session=${randomUUID()}`, "aegis_session=", `aegis_session=${token.slice(0, 10)}`]) {
      expect((await get("/v1/agents", { cookie: c })).statusCode, c).toBe(401);
    }
  });

  it("removal from the organization ends access at once, and a disabled account is refused", async () => {
    const u = await member();
    const cookie = await login(u.email);
    expect((await get("/v1/agents", { cookie })).statusCode).toBe(200);
    await ownerPrisma().membership.deleteMany({ where: { userId: u.id, orgId: attacker.orgId } });
    expect((await get("/v1/agents", { cookie })).statusCode).toBe(403);

    const v = await member();
    const c2 = await login(v.email);
    await rawPrisma().user.update({ where: { id: v.id }, data: { status: "disabled" } });
    expect((await get("/v1/agents", { cookie: c2 })).statusCode).toBe(401);
  });

  it("changing the password signs out every other session", async () => {
    const u = await member();
    const keep = await login(u.email);
    const other = await login(u.email);
    const keepId = (await rawPrisma().session.findFirstOrThrow({ where: { userId: u.id }, orderBy: { createdAt: "asc" } })).id;
    await changePassword(u.id, PASSWORD, "AnotherCorrect2Horse!", keepId);
    expect((await get("/v1/agents", { cookie: other })).statusCode).toBe(401);
    expect((await get("/v1/agents", { cookie: keep })).statusCode).toBe(200);
  });

  it("a session cannot switch into an organization its user does not belong to", async () => {
    const u = await member();
    const cookie = await login(u.email);
    expect((await post("/v1/auth/switch-org", { cookie }, { orgId: victim.orgId })).statusCode).toBeGreaterThanOrEqual(400);
    const s = await rawPrisma().session.findFirstOrThrow({ where: { userId: u.id, revokedAt: null } });
    expect(s.activeOrgId).toBe(attacker.orgId);
  });

  it("a single sign-on session stays in the organization whose identity provider issued it", async () => {
    const u = await member("owner");
    // The same person also owns a second organization.
    const second = await createOrganization({ name: "Second Org", slug: `idt-second-${Date.now().toString(36)}`, ownerUserId: u.id });
    const { token } = await createSession(u.id, { activeOrgId: attacker.orgId, mfaPassed: true, ssoOrgId: attacker.orgId });
    const cookie = `aegis_session=${token}`;
    expect((await get("/v1/agents", { cookie })).statusCode).toBe(200);
    expect((await post("/v1/auth/switch-org", { cookie }, { orgId: second.id })).statusCode).toBe(403);
    await ownerPrisma().organization.delete({ where: { id: second.id } }).catch(() => undefined);
  });
});

describe("two-factor sign-in", () => {
  async function mfaUser() {
    const u = await member("owner");
    const { secret } = await beginMfaEnrolment(u.id);
    await confirmMfaEnrolment(u.id, totpCode(secret));
    return { ...u, secret };
  }

  it("a password alone opens nothing until the code is given", async () => {
    const u = await mfaUser();
    const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: u.email, password: PASSWORD }, remoteAddress: nextIp() });
    expect(res.json()).toMatchObject({ mfaRequired: true });
    const c = res.cookies.find((x) => x.name === "aegis_session")!;
    const cookie = `${c.name}=${c.value}`;
    for (const url of ["/v1/agents", "/v1/policies", "/v1/approvals", "/v1/assurance/evidence"]) expect((await get(url, { cookie })).statusCode, url).toBe(401);
    expect((await post("/v1/gateway/freezes", { cookie }, { title: "x" })).statusCode).toBe(401);
  });

  it("parallel wrong codes cannot exceed the failure limit; the session is then closed even for the right code", async () => {
    const u = await mfaUser();
    const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: u.email, password: PASSWORD }, remoteAddress: nextIp() });
    const c = res.cookies.find((x) => x.name === "aegis_session")!;
    const cookie = `${c.name}=${c.value}`;
    const right = totpCode(u.secret);
    const wrong = Array.from({ length: 20 }, (_, i) => String((Number(right) + 1000 + i * 7919) % 1_000_000).padStart(6, "0"));
    const answers = await Promise.all(wrong.map((code) => post("/v1/auth/mfa", { cookie }, { code })));
    expect(answers.every((a) => a.statusCode === 401)).toBe(true);
    const s = await rawPrisma().session.findFirstOrThrow({ where: { userId: u.id }, orderBy: { createdAt: "desc" } });
    expect(s.mfaFailures).toBeLessThanOrEqual(MFA_MAX_FAILURES);
    expect(s.revokedAt).not.toBeNull();
    expect((await post("/v1/auth/mfa", { cookie }, { code: totpCode(u.secret) })).statusCode).toBe(401);
    expect((await get("/v1/agents", { cookie })).statusCode).toBe(401);
  });
});

describe("keys", () => {
  it("a revoked or expired key is refused at once", async () => {
    const ownerUser = await ownerPrisma().user.findFirstOrThrow({ where: { email: `attacker@${domain}` } });
    const m = (await listUserMemberships(ownerUser.id)).find((x) => x.orgId === attacker.orgId)!;
    const ctx = makeContext(attacker.orgId, { type: "user", id: ownerUser.id, permissions: m.permissions, membershipId: m.membershipId });
    const agentId = attacker.byTable.get("agents")![0]!;
    const { key, record } = await withTenant(attacker.orgId, (db) => issueApiKey(db, ctx, { name: "to-revoke", subjectType: "agent", subjectId: agentId }));
    expect((await get("/v1/agents/me", { authorization: `Bearer ${key}` })).statusCode).toBe(200);
    await withTenant(attacker.orgId, (db) => revokeApiKey(db, ctx, record.id, "attack suite"));
    expect((await get("/v1/agents/me", { authorization: `Bearer ${key}` })).statusCode).toBe(401);
    const expired = await withTenant(attacker.orgId, (db) => issueApiKey(db, ctx, { name: "expired", subjectType: "agent", subjectId: agentId, expiresAt: new Date(Date.now() - 60_000) }));
    expect((await get("/v1/agents/me", { authorization: `Bearer ${expired.key}` })).statusCode).toBe(401);
    // A bearer key and a session cookie together: the key decides, and a bad key is not rescued by the cookie.
    const cookie = await login(`attacker@${domain}`);
    expect((await get("/v1/agents", { authorization: `Bearer ${key}`, cookie })).statusCode).toBe(401);
  });
});

describe("SCIM across organizations", () => {
  it("the attacker's provisioning key cannot read, change, remove or adopt the victim's users", async () => {
    const key = attacker.integrationKeys[0]!;
    const h = { authorization: `Bearer ${key}`, "content-type": "application/scim+json" };
    const victimUser = victim.ownerId;
    const before = await ownerPrisma().membership.count({ where: { userId: victimUser } });
    const userBefore = await rawPrisma().user.findUniqueOrThrow({ where: { id: victimUser } });
    expect((await get(`/scim/v2/Users/${victimUser}`, h)).statusCode).toBe(404);
    for (const [method, payload] of [
      ["PUT", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: userBefore.email, name: { formatted: "Taken over" }, active: false }],
      ["PATCH", { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", path: "active", value: false }] }],
      ["DELETE", undefined],
    ] as const) {
      const res = await app.inject({ method, url: `/scim/v2/Users/${victimUser}`, headers: h, payload: payload as object | undefined, remoteAddress: nextIp() });
      expect(res.statusCode, method).toBe(404);
    }
    const list = await get(`/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${userBefore.email}"`)}`, h);
    expect(list.body).not.toContain(victimUser);
    const adopt = await app.inject({ method: "POST", url: "/scim/v2/Users", headers: h, payload: { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: userBefore.email, name: { formatted: "Adopted" }, active: true }, remoteAddress: nextIp() });
    expect(adopt.statusCode).toBeGreaterThanOrEqual(400);
    expect(await ownerPrisma().membership.count({ where: { userId: victimUser } })).toBe(before);
    const userAfter = await rawPrisma().user.findUniqueOrThrow({ where: { id: victimUser } });
    expect({ name: userAfter.name, status: userAfter.status }).toEqual({ name: userBefore.name, status: userBefore.status });
  });
});
