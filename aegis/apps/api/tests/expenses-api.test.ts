import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { withTenant, rawPrisma, ownerPrisma, disconnectAll } from "@aegis/db";
import { createAgent, createOrganization, issueApiKey, listUserMemberships, makeContext, registerUser, transitionAgent } from "@aegis/core";
import { buildApp } from "../src/app.js";


/** The card feed and expense system register records; an agent key cannot. BigInt amounts serialize. */
let app: FastifyInstance;
let orgId = "";
let userId = "";
let agentKey = "";
const stamp = `expenses-api-${Date.now().toString(36)}`;
const email = `${stamp}@test.aegis.local`;
const password = "CorrectHorse1Battery";

beforeAll(async () => {
  app = await buildApp();
  const user = await registerUser({ email, name: "Finance Lead", password });
  userId = user.id;
  orgId = (await createOrganization({ name: "Expenses Org", slug: stamp, ownerUserId: user.id })).id;
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

describe("expense routes", () => {
  it("registers a card charge, assesses a claim against it and lists it; agents are refused", async () => {
    const cookie = await loginCookie();
    const tx = await app.inject({ method: "POST", url: "/v1/expenses/transactions", headers: { cookie }, payload: { transactions: [{ ref: "TX-API-1", merchantName: "Comfort Transport", cardRef: "C1", amount: "27.34", currency: "AED", postedAt: "2026-10-21T10:00:00Z" }] } });
    expect(tx.statusCode).toBe(200);
    expect(tx.json()).toEqual({ received: 1, created: 1 });
    const claim = await app.inject({ method: "POST", url: "/v1/expenses/claims", headers: { cookie }, payload: { ref: "CL-API-1", claimantRef: "E1", cardRef: "C1", merchantName: "Comfort Transport", receiptDate: "2026-10-21", currency: "AED", total: "2734.00" } });
    expect(claim.statusCode).toBe(201);
    expect(claim.json().verdict).toBe("confirmed_mismatch");
    const list = await app.inject({ method: "GET", url: "/v1/expenses/claims", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().claims[0]).toMatchObject({ ref: "CL-API-1", total: "2734.00", verdict: "confirmed_mismatch" });
    const agent = await app.inject({ method: "POST", url: "/v1/expenses/claims", headers: { authorization: `Bearer ${agentKey}` }, payload: { ref: "CL-AGENT" } });
    expect(agent.statusCode).toBe(403);
  });
});
