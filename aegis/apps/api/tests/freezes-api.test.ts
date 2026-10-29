import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { withTenant, rawPrisma, ownerPrisma, disconnectAll } from "@aegis/db";
import { createAgent, createOrganization, issueApiKey, listUserMemberships, makeContext, registerUser, transitionAgent } from "@aegis/core";
import { buildApp } from "../src/app.js";

const hour = 3600_000;

/** A person starts and ends a change freeze and turns on two-person recovery; an agent key cannot. */
let app: FastifyInstance;
let orgId = "";
let userId = "";
let agentKey = "";
const stamp = `freezes-api-${Date.now().toString(36)}`;
const email = `${stamp}@test.aegis.local`;
const password = "CorrectHorse1Battery";

beforeAll(async () => {
  app = await buildApp();
  const user = await registerUser({ email, name: "Change Manager", password });
  userId = user.id;
  orgId = (await createOrganization({ name: "Freeze Org", slug: stamp, ownerUserId: user.id })).id;
  const m = (await listUserMemberships(user.id)).find((x) => x.orgId === orgId)!;
  const ctx = makeContext(orgId, { type: "user", id: user.id, permissions: m.permissions, membershipId: m.membershipId });
  await withTenant(orgId, async (db) => {
    const agent = await createAgent(db, ctx, { slug: "some-agent", name: "Some agent", description: "", environment: "development", modelProvider: "", modelId: "", dataClassificationLimit: "internal", riskTier: "low", metadata: {} });
    await transitionAgent(db, ctx, agent.id, "registered", "ok");
    await transitionAgent(db, ctx, agent.id, "active", "ok");
    agentKey = (await issueApiKey(db, ctx, { name: "ak", subjectType: "agent", subjectId: agent.id, scopes: ["gateway:submit"] })).key;
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

describe("change freeze routes", () => {
  it("starts a freeze, lists it, refuses bad input and ends it with a reason", async () => {
    const cookie = await loginCookie();
    const created = await app.inject({ method: "POST", url: "/v1/gateway/freezes", headers: { cookie }, payload: { title: "Quarter close", reason: "Finance systems frozen for the audit", startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + hour).toISOString(), minRiskLevel: "high" } });
    expect(created.statusCode).toBe(201);
    const f = created.json();
    expect(f).toMatchObject({ effect: "deny", minRiskLevel: "high" });
    const list = await app.inject({ method: "GET", url: "/v1/gateway/freezes", headers: { cookie } });
    expect(list.json().freezes.map((x: { id: string }) => x.id)).toContain(f.id);
    const bad = await app.inject({ method: "POST", url: "/v1/gateway/freezes", headers: { cookie }, payload: { title: "x", reason: "short", startsAt: "2026-01-02", endsAt: "2026-01-01" } });
    expect(bad.statusCode).toBe(400);
    const noReason = await app.inject({ method: "POST", url: `/v1/gateway/freezes/${f.id}/end`, headers: { cookie }, payload: { reason: "" } });
    expect(noReason.statusCode).toBe(400);
    const ended = await app.inject({ method: "POST", url: `/v1/gateway/freezes/${f.id}/end`, headers: { cookie }, payload: { reason: "Audit signed off" } });
    expect(ended.statusCode).toBe(200);
    expect(ended.json().endReason).toBe("Audit signed off");
    const tpr = await app.inject({ method: "POST", url: "/v1/gateway/freezes/two-person-recovery", headers: { cookie }, payload: { enabled: true, reason: "Change policy requires it" } });
    expect(tpr.json()).toEqual({ enabled: true });
  });

  it("refuses agent keys: an agent cannot start or end a freeze", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/gateway/freezes", headers: { authorization: `Bearer ${agentKey}` }, payload: {} });
    expect([401, 403]).toContain(res.statusCode);
  });
});
