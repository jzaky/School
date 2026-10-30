import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { withTenant, rawPrisma, ownerPrisma, disconnectAll } from "@aegis/db";
import { createAgent, createOrganization, issueApiKey, listUserMemberships, makeContext, registerUser, transitionAgent } from "@aegis/core";
import { buildApp } from "../src/app.js";


/** The system of record registers payment documents; an agent key cannot register or void them. */
let app: FastifyInstance;
let orgId = "";
let userId = "";
let agentKey = "";
const stamp = `docs-api-${Date.now().toString(36)}`;
const email = `${stamp}@test.aegis.local`;
const password = "CorrectHorse1Battery";

beforeAll(async () => {
  app = await buildApp();
  const user = await registerUser({ email, name: "Finance Lead", password });
  userId = user.id;
  orgId = (await createOrganization({ name: "Docs Org", slug: stamp, ownerUserId: user.id })).id;
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

describe("payment document routes", () => {
  it("a person registers documents and sees them; an agent key is refused", async () => {
    const cookie = await loginCookie();
    const doc = { ref: "INV-SYN-1", kind: "invoice", vendorRef: "VEN-1", amount: 1200, currency: "aed" };
    const reg = await app.inject({ method: "POST", url: "/v1/payment-documents/register", headers: { cookie }, payload: { documents: [doc] } });
    expect(reg.statusCode).toBe(200);
    expect(reg.json().results).toEqual([{ ref: "INV-SYN-1", outcome: "registered" }]);
    const list = await app.inject({ method: "GET", url: "/v1/payment-documents", headers: { cookie } });
    expect(list.json().documents[0]).toMatchObject({ ref: "INV-SYN-1", currency: "AED", amount: 1200, state: "open" });
    const agent = await app.inject({ method: "POST", url: "/v1/payment-documents/register", headers: { authorization: `Bearer ${agentKey}` }, payload: { documents: [{ ...doc, ref: "INV-FAKE" }] } });
    expect(agent.statusCode).toBe(403);
    const voidByAgent = await app.inject({ method: "POST", url: `/v1/payment-documents/${list.json().documents[0].id}/void`, headers: { authorization: `Bearer ${agentKey}` }, payload: { reason: "hide it" } });
    expect(voidByAgent.statusCode).toBe(403);
  });
});
