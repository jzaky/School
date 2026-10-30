import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { withTenant, rawPrisma, ownerPrisma, disconnectAll } from "@aegis/db";
import { createAgent, createOrganization, issueApiKey, listUserMemberships, makeContext, registerUser, setAgentTool, transitionAgent, upsertTool } from "@aegis/core";
import { buildApp } from "../src/app.js";


/** The MCP gateway reports tool definitions with the agent key; only a signed-in person reviews a change. */
let app: FastifyInstance;
let orgId = "";
let userId = "";
let agentKey = "";
let toolId = "";
const stamp = `pins-api-${Date.now().toString(36)}`;
const email = `${stamp}@test.aegis.local`;
const password = "CorrectHorse1Battery";

beforeAll(async () => {
  app = await buildApp();
  const user = await registerUser({ email, name: "Security Lead", password });
  userId = user.id;
  orgId = (await createOrganization({ name: "Pins Org", slug: stamp, ownerUserId: user.id })).id;
  const m = (await listUserMemberships(user.id)).find((x) => x.orgId === orgId)!;
  const ctx = makeContext(orgId, { type: "user", id: user.id, permissions: m.permissions, membershipId: m.membershipId });
  await withTenant(orgId, async (db) => {
    const agent = await createAgent(db, ctx, { slug: "some-agent", name: "Some agent", description: "", environment: "development", modelProvider: "", modelId: "", dataClassificationLimit: "internal", riskTier: "low", metadata: {} });
    await transitionAgent(db, ctx, agent.id, "registered", "ok");
    await transitionAgent(db, ctx, agent.id, "active", "ok");
    const tool = await upsertTool(db, ctx, { key: "mail.send", name: "Send mail", description: "", parameterSchema: {}, destinationRules: { allowedDomains: [], allowedResourceKeys: [] }, riskLevel: "medium" });
    toolId = tool.id;
    await setAgentTool(db, ctx, agent.id, tool.id, true);
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

const def = (description: string) => ({ key: "mail.send", name: "send_email", description, inputSchema: { type: "object" } });

describe("tool definition routes", () => {
  it("the agent key pins, then raises a change; a person sees it and approves it", async () => {
    const auth = { authorization: `Bearer ${agentKey}` };
    const first = await app.inject({ method: "POST", url: "/v1/tool-definitions/report", headers: auth, payload: { server: { name: "mail-mcp", version: "1.0.15" }, tools: [def("Sends an email")] } });
    expect(first.statusCode).toBe(200);
    expect(first.json().results).toEqual([{ key: "mail.send", outcome: "pinned" }]);
    const changed = await app.inject({ method: "POST", url: "/v1/tool-definitions/report", headers: auth, payload: { server: { name: "mail-mcp", version: "1.0.16" }, tools: [def("Sends an email")] } });
    expect(changed.json().results[0].outcome).toBe("changed");
    const agentApprove = await app.inject({ method: "POST", url: `/v1/tool-definitions/${toolId}/approve`, headers: auth, payload: { reason: "approve myself" } });
    expect(agentApprove.statusCode).toBe(403);
    const cookie = await loginCookie();
    const list = await app.inject({ method: "GET", url: "/v1/tool-definitions", headers: { cookie } });
    expect(list.json().tools[0].pin.pending.version).toBe("1.0.16");
    const ok = await app.inject({ method: "POST", url: `/v1/tool-definitions/${toolId}/approve`, headers: { cookie }, payload: { reason: "Reviewed the release notes" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().pinned.version).toBe("1.0.16");
  });
});
