import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { withTenant, rawPrisma, ownerPrisma, disconnectAll } from "@aegis/db";
import { createAgent, createOrganization, issueApiKey, listUserMemberships, makeContext, registerUser, transitionAgent } from "@aegis/core";
import { buildApp } from "../src/app.js";


/** A person runs an agent access review over the API; an agent key cannot. */
let app: FastifyInstance;
let orgId = "";
let userId = "";
let agentKey = "";
const stamp = `reviews-api-${Date.now().toString(36)}`;
const email = `${stamp}@test.aegis.local`;
const password = "CorrectHorse1Battery";

beforeAll(async () => {
  app = await buildApp();
  const user = await registerUser({ email, name: "Access Reviewer", password });
  userId = user.id;
  orgId = (await createOrganization({ name: "Reviews Org", slug: stamp, ownerUserId: user.id })).id;
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

describe("access review routes", () => {
  it("starts a review, decides every item and completes it", async () => {
    const cookie = await loginCookie();
    const started = await app.inject({ method: "POST", url: "/v1/access-reviews", headers: { cookie }, payload: { title: "API review", dueInDays: 7 } });
    expect(started.statusCode).toBe(201);
    const o = (await app.inject({ method: "GET", url: "/v1/access-reviews", headers: { cookie } })).json();
    expect(o.open.title).toBe("API review");
    for (const i of o.items) {
      const r = await app.inject({ method: "POST", url: `/v1/access-reviews/items/${i.id}/decide`, headers: { cookie }, payload: { decision: "keep" } });
      expect(r.statusCode).toBe(200);
    }
    const done = await app.inject({ method: "POST", url: `/v1/access-reviews/${o.open.id}/complete`, headers: { cookie } });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe("completed");
  });

  it("refuses agent keys", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/access-reviews", headers: { authorization: `Bearer ${agentKey}` }, payload: { title: "agent review" } });
    expect([401, 403]).toContain(res.statusCode);
  });
});
