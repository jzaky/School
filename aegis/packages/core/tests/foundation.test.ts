import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUserWithRole, makeTestTenant, rawPrisma, withTenant, type TestTenant } from "./helpers.js";
import { createAgent, transitionAgent, upsertTool, setAgentTool, revokeAgentTool } from "../src/agents/registry.js";
import { issueApiKey, resolveApiKey } from "../src/identity/api-keys.js";
import { loginWithPassword } from "../src/identity/auth.js";
import { resolveSession, revokeSession } from "../src/identity/sessions.js";
import { verifyChain } from "../src/evidence/ledger.js";
import { createRole, listRoles } from "../src/orgs/orgs.js";

let t: TestTenant;
beforeAll(async () => {
  t = await makeTestTenant("found");
});
afterAll(async () => {
  await t.cleanup();
});

describe("organization bootstrap", () => {
  it("creates system roles and an owner membership", async () => {
    const roles = await withTenant(t.orgId, (db) => listRoles(db, t.ownerCtx));
    expect(roles.map((r) => r.key).sort()).toEqual(["admin", "approver", "auditor", "engineer", "governance_manager", "owner", "security_analyst", "viewer"]);
    expect(roles.find((r) => r.key === "owner")?.memberCount).toBe(1);
  });
  it("custom roles cannot hold the wildcard", async () => {
    await expect(withTenant(t.orgId, (db) => createRole(db, t.ownerCtx, { key: "superrole", name: "Super", description: "", permissions: ["*"] }))).rejects.toThrow(/wildcard/);
  });
});

describe("login and sessions", () => {
  it("logs in, resolves a session and revokes it", async () => {
    const email = (await rawPrisma().user.findUniqueOrThrow({ where: { id: t.ownerUserId } })).email;
    const r = await loginWithPassword({ email, password: "CorrectHorse1Battery" }, {});
    expect(r.activeOrgId).toBe(t.orgId);
    const s = await resolveSession(r.token);
    expect(s?.user.id).toBe(t.ownerUserId);
    await revokeSession(r.sessionId);
    expect(await resolveSession(r.token)).toBeNull();
  });
  it("rejects a wrong password with a generic message", async () => {
    const email = (await rawPrisma().user.findUniqueOrThrow({ where: { id: t.ownerUserId } })).email;
    await expect(loginWithPassword({ email, password: "nope-nope-nope" }, {})).rejects.toThrow(/Invalid email or password/);
    await expect(loginWithPassword({ email: "ghost@test.aegis.local", password: "nope-nope-nope" }, {})).rejects.toThrow(/Invalid email or password/);
  });
});

describe("agent lifecycle", () => {
  it("enforces transitions, permissions and revocation side effects", async () => {
    const engineer = await addUserWithRole(t, "engineer");
    const viewer = await addUserWithRole(t, "viewer");
    const agent = await withTenant(t.orgId, (db) => createAgent(db, engineer.ctx, { slug: "support-bot", name: "Support Bot", description: "", environment: "production", modelProvider: "anthropic", modelId: "claude", dataClassificationLimit: "confidential", riskTier: "high", metadata: {} }));
    await expect(withTenant(t.orgId, (db) => createAgent(db, viewer.ctx, { slug: "x", name: "X", description: "", environment: "development", modelProvider: "", modelId: "", dataClassificationLimit: "internal", riskTier: "low", metadata: {} }))).rejects.toThrow(/Missing permission/);

    // draft -> active is not allowed; draft -> registered -> active is.
    await expect(withTenant(t.orgId, (db) => transitionAgent(db, engineer.ctx, agent.id, "active", ""))).rejects.toThrow(/Cannot move/);
    await withTenant(t.orgId, (db) => transitionAgent(db, engineer.ctx, agent.id, "registered", "ready"));
    await withTenant(t.orgId, (db) => transitionAgent(db, engineer.ctx, agent.id, "active", "go live"));

    // Engineers cannot suspend (emergency control); owners can.
    await expect(withTenant(t.orgId, (db) => transitionAgent(db, engineer.ctx, agent.id, "suspended", "incident"))).rejects.toThrow(/Missing permission/);

    const tool = await withTenant(t.orgId, (db) => upsertTool(db, engineer.ctx, { key: "issue-refund", name: "Issue refund", description: "", parameterSchema: {}, destinationRules: { allowedDomains: [], allowedResourceKeys: [] }, riskLevel: "high" }));
    await withTenant(t.orgId, (db) => setAgentTool(db, engineer.ctx, agent.id, tool.id, true));
    const issued = await withTenant(t.orgId, (db) => issueApiKey(db, engineer.ctx, { name: "prod key", subjectType: "agent", subjectId: agent.id }));
    expect((await resolveApiKey(issued.key))?.subjectId).toBe(agent.id);

    await withTenant(t.orgId, (db) => revokeAgentTool(db, t.ownerCtx, agent.id, tool.id, "incident"));
    const link = await withTenant(t.orgId, (db) => db.agentTool.findUniqueOrThrow({ where: { agentId_toolId: { agentId: agent.id, toolId: tool.id } } }));
    expect(link.enabled).toBe(false);

    await withTenant(t.orgId, (db) => transitionAgent(db, t.ownerCtx, agent.id, "revoked", "compromised"));
    expect(await resolveApiKey(issued.key)).toBeNull();
    await expect(withTenant(t.orgId, (db) => transitionAgent(db, t.ownerCtx, agent.id, "active", "resume"))).rejects.toThrow(/Cannot move/);
  });

  it("every change left a verifiable evidence trail", async () => {
    const result = await withTenant(t.orgId, (db) => verifyChain(db, t.orgId));
    expect(result.valid).toBe(true);
    expect(result.checked).toBeGreaterThan(8);
    const types = await withTenant(t.orgId, (db) => db.evidenceEvent.findMany({ where: { orgId: t.orgId }, select: { type: true }, orderBy: { seq: "asc" } }));
    expect(types.map((x) => x.type)).toContain("agent.revoked");
    expect(types.map((x) => x.type)).toContain("api_key.issued");
  });
});
