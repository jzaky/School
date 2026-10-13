import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { withTenant, rawPrisma, ownerPrisma, disconnectAll } from "@aegis/db";
import { createOrganization, registerUser, listUserMemberships, makeContext, issueApiKey, createAgent, transitionAgent } from "@aegis/core";
import { buildApp } from "../src/app.js";

// An agent's own key can never change what governs it: its autonomy, policies, its or another agent's
// state, approvals, temporary access, delegations or keys. Every such route needs a person's permission.
let app: FastifyInstance;
let orgId = "";
let agentId = "";
let agentKey = "";
const stamp = `selfgov-${Date.now().toString(36)}`;
const domain = `${stamp}.example`;

beforeAll(async () => {
  app = await buildApp();
  const owner = await registerUser({ email: `owner@${domain}`, name: "Owner", password: "CorrectHorse1Battery" });
  orgId = (await createOrganization({ name: "Self Governance Org", slug: stamp, ownerUserId: owner.id })).id;
  const m = (await listUserMemberships(owner.id)).find((x) => x.orgId === orgId)!;
  const ctx = makeContext(orgId, { type: "user", id: owner.id, permissions: m.permissions, membershipId: m.membershipId });
  await withTenant(orgId, async (db) => {
    const agent = await createAgent(db, ctx, { slug: "self-agent", name: "Self Agent", environment: "development" });
    await transitionAgent(db, ctx, agent.id, "registered", "ok");
    await transitionAgent(db, ctx, agent.id, "active", "ok");
    agentId = agent.id;
    agentKey = (await issueApiKey(db, ctx, { name: "default", subjectType: "agent", subjectId: agent.id })).key;
  });
});

afterAll(async () => {
  await app.close();
  await ownerPrisma().organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await rawPrisma().user.deleteMany({ where: { email: { endsWith: `@${domain}` } } }).catch(() => undefined);
  await disconnectAll();
});

const policyDocument = { version: 1, appliesTo: { tools: [], actions: [], environments: [] }, rules: [{ id: "allow-all", description: "", effect: "allow", when: { attr: "action", op: "exists" }, reason: "allow", riskIndicators: [] }], tests: [] };

describe("an agent key cannot change its own governance", () => {
  const attempts: [string, string, () => Record<string, unknown>][] = [
    ["raise its own autonomy", "/v1/autonomy/agents/:agent/raise-requests", () => ({ level: 4, reason: "I would like more autonomy" })],
    ["lower or reset its autonomy", "/v1/autonomy/agents/:agent/lower", () => ({ level: 3, reason: "resetting my own level" })],
    ["decide an autonomy raise", "/v1/autonomy/raise-requests/:random/decision", () => ({ approve: true, note: "" })],
    ["create a policy", "/v1/policies", () => ({ key: "agent-made", name: "Agent made", description: "", category: "authorization", document: policyDocument, changeNote: "by the agent" })],
    ["activate a policy version", "/v1/policies/versions/:random/activate", () => ({ fourEyes: false })],
    ["assign a policy", "/v1/policies/:random/assignments", () => ({ targetType: "agent", targetId: agentId, priority: 1 })],
    ["decide an approval", "/v1/approvals/:random/decide", () => ({ decision: "approve", comment: "self approved", requestHash: "x" })],
    ["grant itself temporary access", "/v1/identity/access-requests", () => ({ agentId, actions: ["read"], reason: "need it", durationHours: 1 })],
    ["decide an access request", "/v1/identity/access-requests/:random/decide", () => ({ approve: true, note: "" })],
    ["create a delegation", "/v1/identity/delegations", () => ({ delegatorAgentId: agentId, delegateAgentId: randomUUID(), toolKeys: [], reason: "x", expiresAt: new Date(Date.now() + 3_600_000).toISOString() })],
    ["emergency-revoke an agent", "/v1/identity/agents/:agent/emergency-revoke", () => ({ reason: "agent revoking" })],
    ["change organization autonomy settings", "/v1/autonomy/settings", () => ({ automaticDowngrades: false, onSecurityEvents: false, denialBurst: null, onUnknownOutcome: false })],
  ];
  for (const [what, path, body] of attempts) {
    it(`cannot ${what}`, async () => {
      const url = path.replace(":agent", agentId).replace(":random", randomUUID());
      const method = path === "/v1/autonomy/settings" ? "PUT" : "POST";
      const res = await app.inject({ method, url, headers: { authorization: `Bearer ${agentKey}` }, payload: body() });
      expect([401, 403]).toContain(res.statusCode);
    });
  }

  it("left the agent's level and the organization's policies untouched", async () => {
    const agent = await withTenant(orgId, (db) => db.agent.findUniqueOrThrow({ where: { id: agentId } }));
    expect(agent.autonomyLevel).toBe(4);
    expect(agent.status).toBe("active");
    const policies = await withTenant(orgId, (db) => db.policy.count({ where: { key: "agent-made" } }));
    expect(policies).toBe(0);
    const transitions = await withTenant(orgId, (db) => db.autonomyTransition.count({ where: { agentId } }));
    expect(transitions).toBe(0);
  });
});
