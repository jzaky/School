import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { withTenant, rawPrisma, ownerPrisma, disconnectAll } from "@aegis/db";
import { createOrganization, registerUser, listUserMemberships, makeContext, issueApiKey, createAgent, transitionAgent, createIntegration, signWebhook, webhookSecretFor } from "@aegis/core";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let orgId = "";
let email = "";
let userId = "";
let agentKey = "";
let integrationKey = "";
let webhookSecret = "";
const password = "CorrectHorse1Battery";

beforeAll(async () => {
  app = await buildApp();
  const stamp = `api-${Date.now().toString(36)}`;
  email = `${stamp}@test.aegis.local`;
  const user = await registerUser({ email, name: "API Tester", password });
  userId = user.id;
  const org = await createOrganization({ name: "API Test Org", slug: stamp, ownerUserId: user.id });
  orgId = org.id;
  const m = (await listUserMemberships(user.id)).find((x) => x.orgId === orgId)!;
  const ctx = makeContext(orgId, { type: "user", id: user.id, permissions: m.permissions, membershipId: m.membershipId });
  await withTenant(orgId, async (db) => {
    const agent = await createAgent(db, ctx, { slug: "api-agent", name: "API Agent", description: "", environment: "development", modelProvider: "", modelId: "", dataClassificationLimit: "internal", riskTier: "low", metadata: {} });
    await transitionAgent(db, ctx, agent.id, "registered", "ok");
    await transitionAgent(db, ctx, agent.id, "active", "ok");
    agentKey = (await issueApiKey(db, ctx, { name: "k", subjectType: "agent", subjectId: agent.id })).key;
    const { integration } = await createIntegration(db, ctx, { key: "hooked-sim", name: "Hooked", type: "test", description: "" });
    integrationKey = (await issueApiKey(db, ctx, { name: "ik", subjectType: "integration", subjectId: integration.id })).key;
    webhookSecret = await webhookSecretFor(db, ctx, integration.id);
  });
});

afterAll(async () => {
  await app.close();
  await ownerPrisma().organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await rawPrisma().user.delete({ where: { id: userId } }).catch(() => undefined);
  await disconnectAll();
});

async function loginCookie(): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === "aegis_session")!;
  return `${cookie.name}=${cookie.value}`;
}

describe("api", () => {
  it("serves Prometheus metrics to the same host only, and counts requests by route group without ids", async () => {
    await app.inject({ method: "GET", url: "/health" });
    const local = await app.inject({ method: "GET", url: "/metrics", remoteAddress: "127.0.0.1" });
    expect(local.statusCode).toBe(200);
    expect(local.headers["content-type"]).toContain("text/plain");
    expect(local.body).toContain("# TYPE aegis_http_requests_total counter");
    expect(local.body).toMatch(/aegis_http_requests_total\{route="\/health",status="2xx"\} \d+/);
    expect(local.body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
    expect((await app.inject({ method: "GET", url: "/metrics", remoteAddress: "203.0.113.9" })).statusCode).toBe(404);
  });
  it("refuses gateway requests with 503 when the process is at capacity, and nothing is decided", async () => {
    const { m, env } = await import("@aegis/core");
    const before = m.gatewayDecisions.total();
    m.gatewayInFlight.add(env().AEGIS_GATEWAY_MAX_IN_FLIGHT);
    try {
      const res = await app.inject({ method: "POST", url: "/v1/gateway/actions", headers: { authorization: `Bearer ${agentKey}` }, payload: { tool: "none", params: {}, idempotencyKey: `bp-${Date.now()}` } });
      expect(res.statusCode).toBe(503);
      expect(res.headers["retry-after"]).toBe("1");
      expect(res.json().error.code).toBe("overloaded");
    } finally {
      m.gatewayInFlight.add(-env().AEGIS_GATEWAY_MAX_IN_FLIGHT);
    }
    expect(m.gatewayDecisions.total()).toBe(before);
    expect(m.gatewayOverloaded.total()).toBeGreaterThanOrEqual(1);
  });
  it("serves health and readiness", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.json().database).toBe("up");
  });
  it("rejects unauthenticated and badly authenticated requests", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/agents" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/agents", headers: { authorization: "Bearer aegis_ak_nope" } })).statusCode).toBe(401);
    const bad = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: "wrong-password-1" } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.message).toBe("Invalid email or password");
  });
  it("logs in with a cookie session and lists agents with BigInt-safe serialisation", async () => {
    const cookie = await loginCookie();
    const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(me.json().memberships[0].orgId).toBe(orgId);
    const agents = await app.inject({ method: "GET", url: "/v1/agents", headers: { cookie } });
    expect(agents.statusCode).toBe(200);
    expect(agents.json().items).toHaveLength(1);
    const evidence = await app.inject({ method: "GET", url: "/v1/assurance/evidence?pageSize=5", headers: { cookie } });
    expect(evidence.statusCode).toBe(200);
    expect(typeof evidence.json().items[0].seq).toBe("string");
  });
  it("gateway denies unknown tools for an agent key and refuses user cookies", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/gateway/actions", headers: { authorization: `Bearer ${agentKey}` }, payload: { tool: "does-not-exist", params: {}, idempotencyKey: `k-${Date.now()}` } });
    expect(r.statusCode).toBe(403);
    expect(r.json().decision).toBe("deny");
    const cookie = await loginCookie();
    const asUser = await app.inject({ method: "POST", url: "/v1/gateway/actions", headers: { cookie }, payload: { tool: "x", params: {}, idempotencyKey: `k2-${Date.now()}` } });
    expect(asUser.statusCode).toBe(403);
    const invalid = await app.inject({ method: "POST", url: "/v1/gateway/actions", headers: { authorization: `Bearer ${agentKey}` }, payload: { tool: "x" } });
    expect(invalid.statusCode).toBe(400);
  });
  it("accepts correctly signed webhooks and rejects bad signatures, stale timestamps and missing headers", async () => {
    const body = JSON.stringify({ type: "health", payload: { ok: true } });
    const ts = String(Date.now());
    const good = await app.inject({ method: "POST", url: "/v1/webhooks/hooked-sim", headers: { authorization: `Bearer ${integrationKey}`, "content-type": "application/json", "x-aegis-timestamp": ts, "x-aegis-signature": signWebhook(webhookSecret, ts, body) }, payload: body });
    expect(good.statusCode).toBe(200);
    const badSig = await app.inject({ method: "POST", url: "/v1/webhooks/hooked-sim", headers: { authorization: `Bearer ${integrationKey}`, "content-type": "application/json", "x-aegis-timestamp": ts, "x-aegis-signature": "00".repeat(32) }, payload: body });
    expect(badSig.statusCode).toBe(401);
    expect(badSig.json().reason).toBe("bad_signature");
    const stale = String(Date.now() - 10 * 60_000);
    const old = await app.inject({ method: "POST", url: "/v1/webhooks/hooked-sim", headers: { authorization: `Bearer ${integrationKey}`, "content-type": "application/json", "x-aegis-timestamp": stale, "x-aegis-signature": signWebhook(webhookSecret, stale, body) }, payload: body });
    expect(old.json().reason).toBe("stale_timestamp");
    const missing = await app.inject({ method: "POST", url: "/v1/webhooks/hooked-sim", headers: { authorization: `Bearer ${integrationKey}`, "content-type": "application/json" }, payload: body });
    expect(missing.json().reason).toBe("missing_headers");
    const wrongKey = await app.inject({ method: "POST", url: "/v1/webhooks/hooked-sim", headers: { authorization: `Bearer ${agentKey}`, "content-type": "application/json", "x-aegis-timestamp": ts, "x-aegis-signature": signWebhook(webhookSecret, ts, body) }, payload: body });
    expect(wrongKey.statusCode).toBe(403);
  });
  it("never leaks secrets in error bodies", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/nope" });
    expect(r.statusCode).toBe(404);
    expect(JSON.stringify(r.json())).not.toMatch(/aegis_ak_|password|secret/i);
  });
});
