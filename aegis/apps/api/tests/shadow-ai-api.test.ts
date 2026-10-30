import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { withTenant, rawPrisma, ownerPrisma, disconnectAll } from "@aegis/db";
import { createAgent, createIntegration, createOrganization, issueApiKey, listUserMemberships, makeContext, registerUser, transitionAgent } from "@aegis/core";
import { buildApp } from "../src/app.js";

/** A log forwarder posts a synthetic DNS export; other keys are refused. */
let app: FastifyInstance;
let orgId = "";
let userId = "";
let forwarderKey = "";
let noScopeKey = "";
let agentKey = "";

beforeAll(async () => {
  app = await buildApp();
  const stamp = `shadow-api-${Date.now().toString(36)}`;
  const user = await registerUser({ email: `${stamp}@test.aegis.local`, name: "Shadow Tester", password: "CorrectHorse1Battery" });
  userId = user.id;
  const org = await createOrganization({ name: "Shadow Org", slug: stamp, ownerUserId: user.id });
  orgId = org.id;
  const m = (await listUserMemberships(user.id)).find((x) => x.orgId === orgId)!;
  const ctx = makeContext(orgId, { type: "user", id: user.id, permissions: m.permissions, membershipId: m.membershipId });
  await withTenant(orgId, async (db) => {
    const { integration } = await createIntegration(db, ctx, { key: "dns-forwarder", name: "DNS forwarder", type: "log_forwarder", description: "" });
    forwarderKey = (await issueApiKey(db, ctx, { name: "fwd", subjectType: "integration", subjectId: integration.id, scopes: ["discovery:report"] })).key;
    noScopeKey = (await issueApiKey(db, ctx, { name: "ns", subjectType: "integration", subjectId: integration.id, scopes: ["webhooks:send"] })).key;
    const agent = await createAgent(db, ctx, { slug: "shadow-agent", name: "Shadow agent", description: "", environment: "development", modelProvider: "", modelId: "", dataClassificationLimit: "internal", riskTier: "low", metadata: {} });
    await transitionAgent(db, ctx, agent.id, "registered", "ok");
    await transitionAgent(db, ctx, agent.id, "active", "ok");
    agentKey = (await issueApiKey(db, ctx, { name: "ak", subjectType: "agent", subjectId: agent.id, scopes: ["gateway:submit", "discovery:report"] })).key;
  });
});

afterAll(async () => {
  await app.close();
  await ownerPrisma().organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await rawPrisma().user.delete({ where: { id: userId } }).catch(() => undefined);
  await disconnectAll();
});

const text = JSON.stringify({ ts: new Date().toISOString(), client: "10.9.9.9", query: "claude.ai" }) + "\n" + JSON.stringify({ ts: new Date().toISOString(), client: "10.9.9.9", query: "intranet.example" });
const post = (key: string) => app.inject({ method: "POST", url: "/v1/shadow-ai/imports", headers: { authorization: `Bearer ${key}` }, payload: { format: "dns_jsonl", text } });

describe("shadow AI over HTTP", () => {
  it("a forwarder with discovery:report imports a DNS export and only the AI lookup is kept", async () => {
    const res = await post(forwarderKey);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ matched: 1, unmatched: 1, accepted: 1 });
  });
  it("a key without the scope and an agent key are refused", async () => {
    expect((await post(noScopeKey)).statusCode).toBe(403);
    expect((await post(agentKey)).statusCode).toBe(403);
  });
  it("results are not readable with an API key", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/shadow-ai/apps", headers: { authorization: `Bearer ${forwarderKey}` } })).statusCode).toBe(403);
  });
});
