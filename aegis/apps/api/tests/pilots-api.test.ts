import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { withTenant, rawPrisma, ownerPrisma, disconnectAll } from "@aegis/db";
import { createAgent, createOrganization, issueApiKey, listUserMemberships, makeContext, registerUser, transitionAgent } from "@aegis/core";
import { buildApp } from "../src/app.js";

/** A person installs a sector kit, toggles watch-only mode and reads the pilot report; an agent key cannot. */
let app: FastifyInstance;
let orgId = "";
let userId = "";
let agentKey = "";
const stamp = `pilots-api-${Date.now().toString(36)}`;
const email = `${stamp}@test.aegis.local`;
const password = "CorrectHorse1Battery";

beforeAll(async () => {
  app = await buildApp();
  const user = await registerUser({ email, name: "Pilot Lead", password });
  userId = user.id;
  orgId = (await createOrganization({ name: "Pilot Org", slug: stamp, ownerUserId: user.id })).id;
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

describe("pilot routes", () => {
  it("lists kits, installs one in watch-only mode, switches it to enforcing and reports", async () => {
    const cookie = await loginCookie();
    const kits = await app.inject({ method: "GET", url: "/v1/pilots/kits", headers: { cookie } });
    expect(kits.statusCode).toBe(200);
    expect(kits.json().kits.map((k: { key: string }) => k.key)).toContain("public-safety");
    const install = await app.inject({ method: "POST", url: "/v1/pilots/kits/healthcare/install", headers: { cookie }, payload: {} });
    expect(install.statusCode).toBe(201);
    const agent = install.json().agents[0];
    expect(agent).toMatchObject({ slug: "clinical-records-agent", watchOnly: true });
    const off = await app.inject({ method: "POST", url: `/v1/pilots/agents/${agent.id}/watch-only`, headers: { cookie }, payload: { enabled: false, reason: "enforce" } });
    expect(off.statusCode).toBe(200);
    expect(off.json().watchOnly).toBeNull();
    const now = Date.now();
    const report = await app.inject({ method: "GET", url: `/v1/pilots/report?from=${new Date(now - 86_400_000).toISOString()}&to=${new Date(now + 60_000).toISOString()}`, headers: { cookie } });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({ executedWithoutPermission: 0, ledger: { valid: true } });
    const unknown = await app.inject({ method: "POST", url: "/v1/pilots/kits/not-a-kit/install", headers: { cookie }, payload: {} });
    expect(unknown.statusCode).toBe(404);
  });

  it("refuses agent keys: an agent cannot install kits or relax its own enforcement", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/pilots/kits", headers: { authorization: `Bearer ${agentKey}` } });
    expect([401, 403]).toContain(res.statusCode);
  });
});
