import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { disconnectAll, rawPrisma, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { addUserWithRole, makeTestTenant } from "./helpers.js";
import { activateVersion, assignPolicy, createPolicy, deactivatePolicy, submitForReview } from "../src/policy/service.js";
import { createAgent, grantResourcePermission, setAgentTool, transitionAgent, upsertTool } from "../src/agents/registry.js";
import { createDelegation } from "../src/agents/delegation.js";
import { authorizeAndExecute, listActionRequests, pauseGateway, requestGrant, requestListFilter } from "../src/gateway/gateway.js";
import { updateOrganization } from "../src/orgs/orgs.js";
import { scimCreateUser } from "../src/identity/scim.js";
import { registerUser } from "../src/identity/auth.js";
import { makeContext, type OrgContext } from "../src/lib/context.js";
import type { PolicyDocument } from "../src/policy/schema.js";

/**
 * Regression tests for the P1 findings of the October 2026 audit (docs/DEFECT_REGISTER.md). Each test
 * reproduces the finding; it failed before the fix.
 */
let f: GatewayFixture;
const run = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(f.orgId, fn);
const allowAll = (tool: string): PolicyDocument => ({ version: 1, appliesTo: { tools: [tool], actions: [], environments: [] }, rules: [{ id: "allow", description: "", effect: "allow", when: { attr: "action.tool", op: "eq", value: tool }, reason: "allowed", riskIndicators: [] }], tests: [] }) as unknown as PolicyDocument;

async function policyFor(agentId: string, key: string, document: PolicyDocument) {
  return run(async (db) => {
    const { policy, version } = await createPolicy(db, f.ownerCtx, { key, name: key, description: "", category: "authorization", document, changeNote: "test" });
    await submitForReview(db, f.ownerCtx, version.id);
    await activateVersion(db, f.ownerCtx, version.id, { fourEyes: false });
    await assignPolicy(db, f.ownerCtx, policy.id, { targetType: "agent", targetId: agentId, priority: 100 });
    return policy.id;
  });
}

async function makeAgent(slug: string, attrs: { riskTier?: "low" | "medium" | "high" | "critical"; limit?: "public" | "internal" | "confidential" | "restricted" } = {}) {
  return run(async (db) => {
    const a = await createAgent(db, f.engineer.ctx, { slug: `${slug}-${randomUUID().slice(0, 6)}`, name: slug, description: "", environment: "production", modelProvider: "x", modelId: "y", dataClassificationLimit: attrs.limit ?? "confidential", riskTier: attrs.riskTier ?? "medium", metadata: {}, technicalOwnerId: f.engineer.userId });
    await transitionAgent(db, f.engineer.ctx, a.id, "registered", "ok");
    await transitionAgent(db, f.engineer.ctx, a.id, "active", "ok");
    return a.id;
  });
}

beforeAll(async () => {
  f = await makeGatewayFixture();
}, 120_000);
afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});

describe("P1-1: an agent lists only its own action requests", () => {
  it("passing another agent's id does not widen the agent's view", async () => {
    const other = await makeAgent("other");
    const r = await f.call({ amount: 40 });
    expect(r.decision).toBe("allow");
    const asOther = makeContext(f.orgId, { type: "agent", id: other, permissions: ["gateway:read"] });
    const page = await run((db) => listActionRequests(db, asOther, requestListFilter.parse({ agentId: f.agentId })));
    expect(page.items.map((x) => x.agentId).filter((id) => id !== other)).toEqual([]);
  });
});

describe("P1-2: authorization is bound to time and to the policy version that decided it", () => {
  const agentMode = () => authorizeAndExecute(withTenant, f.agentCtx, { tool: "issue-refund", action: "execute", params: { orderId: `O-${randomUUID().slice(0, 8)}`, customerId: "C", amount: 40, currency: "AED" }, resource: "support-tickets", idempotencyKey: randomUUID(), justification: "", principal: { type: "none" }, context: {}, executionMode: "agent" });
  it("a grant cannot be issued for an allowed request once its execution window has passed", async () => {
    const r = await agentMode();
    expect(r.decision).toBe("allow");
    await run((db) => db.executionGrant.updateMany({ where: { actionRequestId: r.requestId }, data: { voidedAt: new Date(), voidReason: "test" } }));
    // Three hours later, past the default one-hour execution window.
    await expect(requestGrant(withTenant, { ...f.agentCtx, now: new Date(Date.now() + 3 * 3600_000) }, r.requestId)).rejects.toThrow(/execution window/);
    expect((await run((db) => db.actionRequest.findUniqueOrThrow({ where: { id: r.requestId } }))).status).toBe("expired");
  });
  it("a grant cannot be issued once a policy that decided the request has changed", async () => {
    const extra = await policyFor(f.agentId, `extra-${randomUUID().slice(0, 6)}`, allowAll("issue-refund"));
    const r = await agentMode();
    expect(r.decision).toBe("allow");
    await run((db) => db.executionGrant.updateMany({ where: { actionRequestId: r.requestId }, data: { voidedAt: new Date(), voidReason: "test" } }));
    await run((db) => deactivatePolicy(db, f.ownerCtx, extra, "no longer applies"));
    await expect(requestGrant(withTenant, f.agentCtx, r.requestId)).rejects.toThrow(/policy .*changed/);
    expect((await run((db) => db.actionRequest.findUniqueOrThrow({ where: { id: r.requestId } }))).status).toBe("expired");
  });
});

describe("P1-3: a stale settings save cannot undo an emergency control", () => {
  it("saving settings from a snapshot taken before a pause leaves the gateway paused", async () => {
    const before = (await rawPrisma().organization.findUniqueOrThrow({ where: { id: f.orgId } })).settings as Record<string, unknown>;
    await run((db) => pauseGateway(db, f.ownerCtx, "Suspected compromise"));
    await updateOrganization(f.ownerCtx, { settings: { ...before, currency: "AED", gatewayPaused: false, changeFreezes: [] } });
    const after = (await rawPrisma().organization.findUniqueOrThrow({ where: { id: f.orgId } })).settings as Record<string, unknown>;
    expect(after.gatewayPaused).toBe(true);
    expect(after.currency).toBe("AED");
    // A key set to null is removed; keys the patch does not name are kept.
    await updateOrganization(f.ownerCtx, { settings: { onboardingDismissedAt: "2026-10-01T00:00:00Z" } });
    await updateOrganization(f.ownerCtx, { settings: { onboardingDismissedAt: null } });
    const cleared = (await rawPrisma().organization.findUniqueOrThrow({ where: { id: f.orgId } })).settings as Record<string, unknown>;
    expect("onboardingDismissedAt" in cleared).toBe(false);
    expect(cleared.currency).toBe("AED");
    await run(async (db) => (await import("../src/gateway/gateway.js")).resumeGateway(db, f.ownerCtx, "test over"));
  });
});

describe("P1-4: SCIM cannot attach an existing account from outside the organization", () => {
  it("even when the email domain is claimed by the organization's identity provider", async () => {
    const victim = await registerUser({ email: `alice-${randomUUID().slice(0, 6)}@victimcorp.example`, name: "Alice", password: "CorrectHorse1Battery" });
    const attacker = await makeTestTenant("scim");
    try {
      await withTenant(attacker.orgId, (db) => db.ssoConnection.create({ data: { orgId: attacker.orgId, issuer: "https://idp.attacker.example", clientId: "x", clientSecretEnc: "x", emailDomains: ["victimcorp.example"] } }));
      const scim: OrgContext = makeContext(attacker.orgId, { type: "integration", id: null, permissions: ["scim:provision"], scopes: ["scim:provision"] } as never);
      await expect(withTenant(attacker.orgId, (db) => scimCreateUser(db, scim, { userName: victim.email, active: true }, "https://x"))).rejects.toThrow(/exists/);
      expect(await withTenant(attacker.orgId, (db) => db.membership.count({ where: { orgId: attacker.orgId, userId: victim.id } }))).toBe(0);
    } finally {
      await attacker.cleanup();
      await rawPrisma().user.delete({ where: { id: victim.id } }).catch(() => undefined);
    }
  });
});

describe("P1-5: a delegate never escapes the delegating agent's limits", () => {
  let delegator: string;
  let delegate: string;
  const callTool = (onBehalfOf: string, params: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    authorizeAndExecute(withTenant, makeContext(f.orgId, { type: "agent", id: delegate }), { tool: "http-call", action: "execute", params, idempotencyKey: randomUUID(), justification: "", principal: { type: "none" }, context: {}, executionMode: "agent", onBehalfOf: { agentId: onBehalfOf }, ...extra });

  beforeAll(async () => {
    const toolId = await run(async (db) => (await upsertTool(db, f.engineer.ctx, { key: "http-call", name: "HTTP call", description: "", integrationId: null, riskLevel: "medium", parameterSchema: {}, destinationRules: { allowedDomains: [], allowedResourceKeys: [] } })).id);
    delegator = await makeAgent("delegator", { riskTier: "critical", limit: "restricted" });
    delegate = await makeAgent("delegate", { riskTier: "low", limit: "restricted" });
    await run(async (db) => {
      await setAgentTool(db, f.engineer.ctx, delegator, toolId, true);
      await setAgentTool(db, f.engineer.ctx, delegate, toolId, true);
      await db.agent.update({ where: { id: delegator }, data: { allowedDestinations: ["safe.example"] } });
      const restricted = await db.resource.findFirstOrThrow({ where: { orgId: f.orgId, key: "payments-core" } });
      await grantResourcePermission(db, f.engineer.ctx, delegator, restricted.id, ["execute"]);
      await grantResourcePermission(db, f.engineer.ctx, delegate, restricted.id, ["execute"]);
      // The delegating agent's limit is lowered after its grant: the permission row stays, the limit must still bind.
      await db.agent.update({ where: { id: delegator }, data: { dataClassificationLimit: "internal" } });
    });
    await policyFor(delegator, `deleg-allow-${randomUUID().slice(0, 6)}`, allowAll("http-call"));
    await policyFor(delegate, `dele-allow-${randomUUID().slice(0, 6)}`, allowAll("http-call"));
    await run((db) => createDelegation(db, f.ownerCtx, { delegatorAgentId: delegator, delegateAgentId: delegate, toolKeys: ["http-call"], constraints: {}, reason: "audit test", expiresInHours: 2 }));
  }, 120_000);

  it("the delegating agent's destination allow-list applies", async () => {
    expect((await callTool(delegator, { url: "https://safe.example/x" })).decision).toBe("allow");
    const r = await callTool(delegator, { url: "https://evil.example/x" });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/delegating agent|allowed destinations/i);
  });

  it("the delegating agent's data classification limit applies", async () => {
    const r = await callTool(delegator, { url: "https://safe.example/x" }, { resource: "payments-core" });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/restricted/);
  });

  it("the delegating agent's policies are judged on the delegating agent's own attributes", async () => {
    const doc = { version: 1, appliesTo: { tools: ["http-call"], actions: [], environments: [] }, rules: [{ id: "no-critical", description: "", effect: "deny", when: { attr: "agent.riskTier", op: "eq", value: "critical" }, reason: "Critical-tier agents may not make HTTP calls", riskIndicators: [] }], tests: [] } as unknown as PolicyDocument;
    const pid = await policyFor(delegator, `deleg-tier-${randomUUID().slice(0, 6)}`, doc);
    const r = await callTool(delegator, { url: "https://safe.example/x" });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/Critical-tier/);
    await run((db) => deactivatePolicy(db, f.ownerCtx, pid, "test over"));
  });

  it("an expired delegating agent's authority cannot be used", async () => {
    await run((db) => db.agent.update({ where: { id: delegator }, data: { credentialExpiresAt: new Date(Date.now() - 60_000) } }));
    const r = await callTool(delegator, { url: "https://safe.example/x" });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/lapsed|expired/i);
  });
});

void addUserWithRole;
