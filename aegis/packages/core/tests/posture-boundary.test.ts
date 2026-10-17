import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { agentPosture, postureFromFacts } from "../src/agents/posture.js";
import { createAgent, transitionAgent } from "../src/agents/registry.js";
import { boundaryFromTrace, boundarySentence } from "../src/policy/boundary.js";
import { buildRefundPolicyDocument } from "../src/policy/templates.js";
import { buildScoreBandPolicyDocument } from "../src/policy/score-band.js";
import { parsePolicyDocument } from "../src/policy/schema.js";

let f: GatewayFixture;
beforeAll(async () => {
  f = await makeGatewayFixture();
});
afterAll(async () => {
  await f.cleanup();
});

describe("autonomy posture", () => {
  it("an active agent under the refund policy is supervised, with the template's own sentence", async () => {
    const agent = await withTenant(f.orgId, (db) => db.agent.findUniqueOrThrow({ where: { id: f.agentId }, include: { tools: { include: { tool: true } } } }));
    const p = await withTenant(f.orgId, (db) => agentPosture(db, f.ownerCtx, agent));
    expect(p.posture).toBe("supervised");
    expect(p.sentence).toMatch(/Refunds below AED 500 run automatically/);
    expect(p.sentence).toMatch(/need/);
    expect(p.grantedTools).toContain("issue-refund");
    expect(p.policies.map((x) => x.key)).toContain("refund-authority");
  });

  it("a suspended agent is suspended and an agent without tools is restricted", async () => {
    await withTenant(f.orgId, (db) => transitionAgent(db, f.ownerCtx, f.agentId, "suspended", "posture test"));
    const agent = await withTenant(f.orgId, (db) => db.agent.findUniqueOrThrow({ where: { id: f.agentId }, include: { tools: { include: { tool: true } } } }));
    const p = await withTenant(f.orgId, (db) => agentPosture(db, f.ownerCtx, agent));
    expect(p.posture).toBe("suspended");
    await withTenant(f.orgId, (db) => transitionAgent(db, f.ownerCtx, f.agentId, "active", "resume after posture test"));
    const bare = await withTenant(f.orgId, async (db) => {
      const a = await createAgent(db, f.engineer.ctx, { slug: "bare-agent", name: "Bare Agent", description: "", environment: "production", modelProvider: "x", modelId: "y", dataClassificationLimit: "internal", riskTier: "low", metadata: {}, technicalOwnerId: f.engineer.userId });
      await transitionAgent(db, f.engineer.ctx, a.id, "registered", "ok");
      await transitionAgent(db, f.engineer.ctx, a.id, "active", "ok");
      return db.agent.findUniqueOrThrow({ where: { id: a.id }, include: { tools: { include: { tool: true } } } });
    });
    const q = await withTenant(f.orgId, (db) => agentPosture(db, f.ownerCtx, bare));
    expect(q.posture).toBe("restricted");
    expect(q.sentence).toMatch(/No tool is granted/);
  });

  it("derives autonomous and restricted from the shape of the applicable rules", () => {
    const agent = { id: "a", status: "active", teamId: null, tools: [{ enabled: true, revokedAt: null, tool: { key: "send-email" } }] };
    const allowOnly = parsePolicyDocument({ version: 1, appliesTo: { tools: ["send-email"], actions: [], environments: [] }, rules: [{ id: "ok", effect: "allow", when: { always: true }, reason: "ok" }, { id: "cap", effect: "deny", when: { attr: "params.recipients", op: "gt", value: 50 }, reason: "too many" }] });
    const denyOnly = parsePolicyDocument({ version: 1, appliesTo: { tools: ["send-email"], actions: [], environments: [] }, rules: [{ id: "no", effect: "deny", when: { always: true }, reason: "never" }] });
    const other = parsePolicyDocument({ version: 1, appliesTo: { tools: ["issue-refund"], actions: [], environments: [] }, rules: [{ id: "x", effect: "require_approval", when: { always: true }, reason: "x", approval: {} }] });
    expect(postureFromFacts(agent, [{ policyKey: "mail", policyVersionId: "v", policyVersion: 1, document: allowOnly }]).posture).toBe("autonomous");
    expect(postureFromFacts(agent, [{ policyKey: "mail", policyVersionId: "v", policyVersion: 1, document: denyOnly }]).posture).toBe("restricted");
    expect(postureFromFacts(agent, [{ policyKey: "refunds", policyVersionId: "v", policyVersion: 1, document: other }]).posture).toBe("restricted");
    expect(postureFromFacts(agent, []).sentence).toMatch(/No active policy covers its tools/);
  });
});

describe("boundary sentence", () => {
  it("explains refund template decisions in amounts", () => {
    const doc = buildRefundPolicyDocument({ autoApproveBelow: 500, approvalUpTo: 2500, requireReason: false });
    expect(boundarySentence({ document: doc, ruleId: "refund-authority/approval-band", params: { amount: 1450, currency: "AED" } })).toBe("AED 1,450 is AED 950 above the automatic limit of AED 500 and AED 1,050 below the ceiling of AED 2,500.");
    expect(boundarySentence({ document: doc, ruleId: "above-limit", params: { amount: 6200, currency: "AED" } })).toMatch(/AED 3,700 above the ceiling/);
    expect(boundarySentence({ document: doc, ruleId: "duplicate-refund", params: { amount: 100 }, context: { priorRequestsSameReference: 1, duplicateReferenceKey: "orderId" } })).toMatch(/1 earlier refund request for the same orderId/);
    expect(boundarySentence({ document: doc, ruleId: "approval-band", params: {} })).toBeNull();
  });

  it("explains score-band decisions in score distances", () => {
    const doc = buildScoreBandPolicyDocument({ scoreAttribute: "fraudScore" });
    expect(boundarySentence({ document: doc, ruleId: "hold-band", params: {}, context: { supplied: { fraudScore: 0.62 } } })).toBe("Score 0.62 is 0.07 above the hold boundary of 0.55 and 0.08 below the block boundary of 0.70.");
    expect(boundarySentence({ document: doc, ruleId: "score-missing", params: {} })).toBe("No fraudScore was sent with the request.");
    const trace = [{ ruleId: "review-band", matched: true, comparisons: [{ attr: "context.supplied.fraudScore", op: "gte", expected: 0.4, actual: 0.41, result: true }, { attr: "context.supplied.fraudScore", op: "lt", expected: 0.55, actual: 0.41, result: true }] }];
    expect(boundarySentence({ document: doc, ruleId: "review-band", params: {}, trace })).toBe("Score 0.41 is 0.01 above the review boundary of 0.40 and 0.14 below the hold boundary of 0.55.");
  });

  it("falls back to the deciding rule's matched comparisons for any other policy", () => {
    const trace = [{ policyKey: "treasury-transfer-limits", ruleId: "large-transfer", matched: true, comparisons: [{ attr: "params.amount", op: "gte", expected: 100000, actual: 250000, result: true }, { attr: "context.hour", op: "between", expected: [4, 14], actual: 9, result: true }] }];
    const generic = { version: 1, rules: [{ id: "large-transfer", effect: "require_approval", when: { attr: "params.amount", op: "gte", value: 100000 }, reason: "big" }] };
    expect(boundarySentence({ document: generic, ruleId: "treasury-transfer-limits/large-transfer", params: { amount: 250000 }, trace })).toBe("Matched because amount (250,000) is at or above 100,000 and hour (9) is between 4 and 14.");
    expect(boundaryFromTrace(trace, "other-rule")).toBeNull();
    expect(boundarySentence({ document: generic, ruleId: null, params: {} })).toBeNull();
  });
});
