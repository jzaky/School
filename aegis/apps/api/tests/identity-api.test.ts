import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { withTenant, rawPrisma, ownerPrisma, disconnectAll } from "@aegis/db";
import { createOrganization, registerUser, listUserMemberships, makeContext, issueApiKey, createAgent, transitionAgent, createIntegration, upsertSsoConnection } from "@aegis/core";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let orgId = "";
let ownerId = "";
let agentKey = "";
let integrationKey = "";
let scimKey = "";
let narrowAgentKey = "";
const stamp = `idapi-${Date.now().toString(36)}`;
const domain = `${stamp}.example`;
const scim = (key: string) => ({ authorization: `Bearer ${key}`, "content-type": "application/scim+json" });

beforeAll(async () => {
  app = await buildApp();
  const owner = await registerUser({ email: `owner@${domain}`, name: "Owner", password: "CorrectHorse1Battery" });
  ownerId = owner.id;
  orgId = (await createOrganization({ name: "Identity API Org", slug: stamp, ownerUserId: owner.id })).id;
  const m = (await listUserMemberships(owner.id)).find((x) => x.orgId === orgId)!;
  const ctx = makeContext(orgId, { type: "user", id: owner.id, permissions: m.permissions, membershipId: m.membershipId });
  await withTenant(orgId, async (db) => {
    const agent = await createAgent(db, ctx, { slug: "id-agent", name: "Identity Agent", environment: "development" });
    await transitionAgent(db, ctx, agent.id, "registered", "ok");
    await transitionAgent(db, ctx, agent.id, "active", "ok");
    agentKey = (await issueApiKey(db, ctx, { name: "default", subjectType: "agent", subjectId: agent.id })).key;
    narrowAgentKey = (await issueApiKey(db, ctx, { name: "read only", subjectType: "agent", subjectId: agent.id, scopes: ["gateway:read"] })).key;
    const { integration } = await createIntegration(db, ctx, { key: "idp", name: "Identity provider", type: "identity", description: "" });
    integrationKey = (await issueApiKey(db, ctx, { name: "default", subjectType: "integration", subjectId: integration.id })).key;
    scimKey = (await issueApiKey(db, ctx, { name: "scim", subjectType: "integration", subjectId: integration.id, scopes: ["scim:provision"] })).key;
    await upsertSsoConnection(db, ctx, { issuer: "https://login.example.com", clientId: "c", clientSecret: "s", emailDomains: [domain], enabled: false });
  });
});

afterAll(async () => {
  await app.close();
  await ownerPrisma().organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await rawPrisma().user.deleteMany({ where: { email: { endsWith: `@${domain}` } } }).catch(() => undefined);
  void ownerId;
  await disconnectAll();
});

describe("API key scopes", () => {
  it("a key is limited to the routes its scopes cover", async () => {
    const submit = { tool: "nothing", idempotencyKey: "scope-test-001", params: {} };
    expect((await app.inject({ method: "POST", url: "/v1/gateway/actions", headers: { authorization: `Bearer ${narrowAgentKey}` }, payload: submit })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/gateway/actions", headers: { authorization: `Bearer ${narrowAgentKey}` } })).statusCode).toBe(200);
    // A default agent key can submit (the unknown tool is then denied by the gateway itself).
    expect((await app.inject({ method: "POST", url: "/v1/gateway/actions", headers: { authorization: `Bearer ${agentKey}` }, payload: { ...submit, idempotencyKey: "scope-test-002" } })).json().decision).toBe("deny");
    // A provisioning key cannot verify grants; a default integration key cannot provision.
    expect((await app.inject({ method: "POST", url: "/v1/gateway/grants/verify", headers: { authorization: `Bearer ${scimKey}` }, payload: { grant: "aegis_gr2.x.y", toolKey: "t", params: {} } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/scim/v2/Users", headers: scim(integrationKey) })).statusCode).toBe(403);
  });
  it("an agent key cannot report discovered agents; an integration key can", async () => {
    const body = { source: "kubernetes", externalId: "deploy/summariser", name: "Summariser", platform: "langgraph" };
    expect((await app.inject({ method: "POST", url: "/v1/identity/discovery/agents", headers: { authorization: `Bearer ${agentKey}` }, payload: body })).statusCode).toBe(403);
    const r = await app.inject({ method: "POST", url: "/v1/identity/discovery/agents", headers: { authorization: `Bearer ${integrationKey}` }, payload: body });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("unregistered");
  });
});

describe("SCIM 2.0", () => {
  let userId = "";
  it("creates a user as a viewer, finds it by userName, and refuses a duplicate", async () => {
    const created = await app.inject({ method: "POST", url: "/scim/v2/Users", headers: scim(scimKey), payload: { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: `amira@${domain}`, name: { givenName: "Amira", familyName: "Haddad" }, active: true } });
    expect(created.statusCode).toBe(201);
    expect(created.headers["content-type"]).toMatch(/application\/scim\+json/);
    userId = created.json().id;
    expect(created.json().groups[0].value).toBe("viewer");
    const found = await app.inject({ method: "GET", url: `/scim/v2/Users?filter=${encodeURIComponent(`userName eq "amira@${domain}"`)}`, headers: scim(scimKey) });
    expect(found.json().totalResults).toBe(1);
    const dup = await app.inject({ method: "POST", url: "/scim/v2/Users", headers: scim(scimKey), payload: { userName: `amira@${domain}` } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().scimType).toBe("uniqueness");
  });
  it("will not pull in an account from outside the organization's claimed domains", async () => {
    const outsider = await registerUser({ email: `someone-${stamp}@elsewhere.example`, name: "Outsider", password: "CorrectHorse1Battery" });
    const r = await app.inject({ method: "POST", url: "/scim/v2/Users", headers: scim(scimKey), payload: { userName: outsider.email } });
    expect(r.statusCode).toBe(409);
    await rawPrisma().user.delete({ where: { id: outsider.id } });
  });
  it("assigns roles through groups but never owner or admin", async () => {
    const ok = await app.inject({ method: "PATCH", url: "/scim/v2/Groups/approver", headers: scim(scimKey), payload: { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "add", path: "members", value: [{ value: userId }] }] } });
    expect(ok.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/scim/v2/Users/${userId}`, headers: scim(scimKey) })).json().groups[0].value).toBe("approver");
    const owner = await app.inject({ method: "PATCH", url: "/scim/v2/Groups/owner", headers: scim(scimKey), payload: { Operations: [{ op: "add", path: "members", value: [{ value: userId }] }] } });
    expect(owner.statusCode).toBe(403);
  });
  it("deactivation suspends the membership and closes sessions; delete keeps the account", async () => {
    const off = await app.inject({ method: "PATCH", url: `/scim/v2/Users/${userId}`, headers: scim(scimKey), payload: { Operations: [{ op: "replace", path: "active", value: false }] } });
    expect(off.json().active).toBe(false);
    expect((await app.inject({ method: "DELETE", url: `/scim/v2/Users/${userId}`, headers: scim(scimKey) })).statusCode).toBe(204);
    expect(await rawPrisma().user.findUnique({ where: { id: userId } })).not.toBeNull();
  });
  it("answers unsupported filters with a SCIM error body", async () => {
    const r = await app.inject({ method: "GET", url: `/scim/v2/Users?filter=${encodeURIComponent('emails co "x"')}`, headers: scim(scimKey) });
    expect(r.statusCode).toBe(400);
    expect(r.json().scimType).toBe("invalidFilter");
  });
});
