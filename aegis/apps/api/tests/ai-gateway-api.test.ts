import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { withTenant, rawPrisma, ownerPrisma, disconnectAll } from "@aegis/db";
import { createAgent, createOrganization, env, issueApiKey, listUserMemberships, makeContext, registerUser, transitionAgent } from "@aegis/core";
import { createAiProvider, issuePersonalAiKey } from "@aegis/core/secure/ai-gateway";
import { buildApp } from "../src/app.js";

/** The AI gateway over HTTP, in the standalone process shape, against a local fake provider. Synthetic data only. */
let app: FastifyInstance;
let provider: Server;
let hits = 0;
let orgId = "";
let userId = "";
let personalKey = "";
let agentKey = "";
let plainUserKey = "";

beforeAll(async () => {
  env().AEGIS_ALLOW_PRIVATE_DESTINATIONS = true;
  provider = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      hits += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }));
    });
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
  app = await buildApp({ modules: "ai-gateway" });
  const stamp = `aigw-api-${Date.now().toString(36)}`;
  const user = await registerUser({ email: `${stamp}@test.aegis.local`, name: "AI Gateway Tester", password: "CorrectHorse1Battery" });
  userId = user.id;
  const org = await createOrganization({ name: "AI Gateway Org", slug: stamp, ownerUserId: user.id });
  orgId = org.id;
  const m = (await listUserMemberships(user.id)).find((x) => x.orgId === orgId)!;
  const ctx = makeContext(orgId, { type: "user", id: user.id, permissions: m.permissions, membershipId: m.membershipId });
  await withTenant(orgId, async (db) => {
    await createAiProvider(db, ctx, { key: "fake", name: "Fake", baseUrl: base, models: ["gpt-test"] });
    personalKey = (await issuePersonalAiKey(db, ctx, "Laptop")).key;
    plainUserKey = (await issueApiKey(db, ctx, { name: "no scope", subjectType: "user", subjectId: user.id, scopes: ["gateway:read"] })).key;
    const agent = await createAgent(db, ctx, { slug: "chat-agent", name: "Chat agent", description: "", environment: "development", modelProvider: "", modelId: "", dataClassificationLimit: "internal", riskTier: "low", metadata: {} });
    await transitionAgent(db, ctx, agent.id, "registered", "ok");
    await transitionAgent(db, ctx, agent.id, "active", "ok");
    agentKey = (await issueApiKey(db, ctx, { name: "k", subjectType: "agent", subjectId: agent.id })).key;
    await expect(issueApiKey(db, ctx, { name: "k2", subjectType: "agent", subjectId: agent.id, scopes: ["ai:chat"] })).rejects.toThrow(/cannot use the AI gateway/);
  });
});

afterAll(async () => {
  env().AEGIS_ALLOW_PRIVATE_DESTINATIONS = false;
  await app.close();
  await new Promise<void>((r) => provider.close(() => r()));
  await ownerPrisma().organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await rawPrisma().user.delete({ where: { id: userId } }).catch(() => undefined);
  await disconnectAll();
});

const post = (key: string | null, content: string) => app.inject({ method: "POST", url: "/v1/ai/chat/completions", headers: key ? { authorization: `Bearer ${key}` } : {}, payload: { model: "gpt-test", messages: [{ role: "user", content }] } });

describe("AI gateway over HTTP", () => {
  it("a personal key gets an OpenAI-shaped answer with the decision in headers", async () => {
    const res = await post(personalKey, "Write a haiku about autumn.");
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-aegis-decision"]).toBe("allow");
    expect(res.headers["x-aegis-forwarded"]).toBe("true");
    expect(res.json().choices[0].message.content).toBe("ok");
  });

  it("a blocked prompt gets 403 in the OpenAI error shape and the provider is not contacted", async () => {
    const before = hits;
    const res = await post(personalKey, "Refund card 4111 1111 1111 1111 please.");
    expect(res.statusCode).toBe(403);
    expect(res.headers["x-aegis-forwarded"]).toBe("false");
    expect(res.json().error.type).toBe("aegis_policy_block");
    expect(res.body).not.toContain("4111");
    expect(hits).toBe(before);
  });

  it("no key, a key without ai:chat, and an agent key are all refused before anything is sent", async () => {
    const before = hits;
    expect((await post(null, "hi")).statusCode).toBe(401);
    expect((await post(plainUserKey, "hi")).statusCode).toBe(403);
    expect((await post(agentKey, "hi")).statusCode).toBe(403);
    expect(hits).toBe(before);
  });

  it("the standalone process serves only health and the AI gateway", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/policies" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/v1/gateway/actions", payload: {} })).statusCode).toBe(404);
  });
});
