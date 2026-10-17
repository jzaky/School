import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { addUserWithRole } from "./helpers.js";
import { analyzePolicies, toDnf, witnessFor } from "../src/policy/analysis.js";
import { evaluatePolicies, runPolicyTests, type PolicyToEvaluate } from "../src/policy/evaluate.js";
import { parsePolicyDocument } from "../src/policy/schema.js";
import { buildSectorTemplate, SECTOR_TEMPLATES } from "../src/policy/sector-templates.js";
import { activeExceptionRules, decidePolicyException, listPolicyExceptions, requestPolicyException, revokePolicyException } from "../src/policy/exceptions.js";
import { organizationConflicts, policyEnforcement, policyRecommendations } from "../src/policy/insights.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../src/policy/service.js";
import { replayPolicy } from "../src/policy/replay.js";
import type { OrgContext } from "../src/lib/context.js";

const pol = (key: string, rules: unknown[], tools: string[] = []): PolicyToEvaluate => ({ policyKey: key, policyVersionId: key, policyVersion: 1, document: parsePolicyDocument({ version: 1, appliesTo: { tools, actions: [], environments: [] }, rules }) });

describe("conflict analysis (pure)", () => {
  it("confirms an overlap across policies with a witness the evaluator agrees with, and names the winner", () => {
    const refunds = pol("refunds", [{ id: "small", effect: "allow", when: { attr: "params.amount", op: "lt", value: 500 } }, { id: "huge", effect: "deny", when: { attr: "params.amount", op: "gt", value: 2500 } }], ["issue-refund"]);
    const fx = pol("fx-guard", [{ id: "no-usd", effect: "deny", when: { attr: "params.currency", op: "eq", value: "USD" } }]);
    const r = analyzePolicies([refunds, fx]);
    const cross = r.conflicts.filter((c) => c.a.policyKey !== c.b.policyKey);
    expect(cross).toHaveLength(1);
    expect(cross[0]).toMatchObject({ severity: "high", winner: { policyKey: "fx-guard", ruleId: "no-usd" } });
    expect(evaluatePolicies([refunds, fx], cross[0]!.witness).result).toBe("deny");
    // allow below 500 and deny above 2500 never overlap
    expect(r.conflicts.some((c) => [c.a.ruleId, c.b.ruleId].sort().join() === "huge,small")).toBe(false);
  });

  it("reports rules that can never match, and counts what it cannot analyze instead of calling it safe", () => {
    const r = analyzePolicies([pol("p", [{ id: "impossible", effect: "deny", when: { all: [{ attr: "params.amount", op: "gt", value: 500 }, { attr: "params.amount", op: "lt", value: 100 }] } }, { id: "regex", effect: "allow", when: { attr: "params.note", op: "matches", value: "^ref-[0-9]+$" } }, { id: "other", effect: "deny", when: { attr: "params.note", op: "contains", value: "urgent" } }])]);
    expect(r.deadRules.map((d) => d.ruleId)).toEqual(["impossible"]);
    expect(r.notAnalyzed).toBeGreaterThanOrEqual(1);
  });

  it("handles negation through normal form and respects tool scopes", () => {
    const terms = toDnf({ not: { any: [{ attr: "a", op: "eq", value: 1 }, { attr: "b", op: "in", value: ["x"] }] } })!;
    expect(terms).toEqual([[{ attr: "a", op: "neq", value: 1 }, { attr: "b", op: "not_in", value: ["x"] }]]);
    expect(witnessFor([{ attr: "params.amount", op: "gte", value: 10 }, { attr: "params.amount", op: "lte", value: 10 }])).toEqual({ params: { amount: 10 } });
    const a = pol("a", [{ id: "x", effect: "allow", when: { always: true } }], ["tool-a"]);
    const b = pol("b", [{ id: "y", effect: "deny", when: { always: true } }], ["tool-b"]);
    expect(analyzePolicies([a, b]).conflicts).toEqual([]);
  });

  it("every sector template builds a valid policy whose own tests pass", () => {
    for (const t of SECTOR_TEMPLATES) {
      const doc = buildSectorTemplate(t.id, { tools: ["export-records"], approvedDomains: ["partner.example"] });
      const results = runPolicyTests(doc);
      expect({ id: t.id, failed: results.filter((x) => !x.passed) }).toEqual({ id: t.id, failed: [] });
      expect(results.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("excepted rules are skipped and traced as excepted", () => {
    const p = pol("refunds", [{ id: "dup", effect: "deny", when: { attr: "context.priorRequestsSameReference", op: "gt", value: 0 } }, { id: "small", effect: "allow", when: { attr: "params.amount", op: "lt", value: 500 } }]);
    const input = { params: { amount: 100 }, context: { priorRequestsSameReference: 1 } };
    expect(evaluatePolicies([p], input).result).toBe("deny");
    const r = evaluatePolicies([p], input, { skipRules: new Set(["refunds/dup"]) });
    expect(r.result).toBe("allow");
    expect(r.trace.find((t) => t.ruleId === "dup")).toMatchObject({ excepted: true, matched: false });
  });
});

let f: GatewayFixture;
let gm: { userId: string; ctx: OrgContext };
const run = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(f.orgId, fn);

beforeAll(async () => {
  f = await makeGatewayFixture();
  gm = await addUserWithRole(f, "governance_manager", "gm");
}, 120_000);

afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});

describe("policy exceptions in the gateway", () => {
  it("an approved exception skips its rule for that agent until it expires, and is recorded on the decision", async () => {
    const orderId = `EXC-${Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 8)}`;
    const first = await f.call({ params: { orderId, customerId: "CUST-1", amount: 120, currency: "AED" } });
    expect(first.decision).toBe("allow");
    const dup = await f.call({ params: { orderId, customerId: "CUST-1", amount: 120, currency: "AED" } });
    expect(dup.decision).toBe("deny");

    await expect(run((db) => requestPolicyException(db, f.viewer.ctx, { policyId: f.refundPolicyId, ruleId: "duplicate-refund", agentId: f.agentId, reason: "Partial refunds on the same order", days: 7 }))).rejects.toThrow(/policies:write/);
    await expect(run((db) => requestPolicyException(db, f.ownerCtx, { policyId: f.refundPolicyId, ruleId: "no-such-rule", agentId: f.agentId, reason: "Partial refunds on the same order", days: 7 }))).rejects.toThrow(/not in the active version/);
    await expect(run((db) => requestPolicyException(db, f.ownerCtx, { policyId: f.refundPolicyId, ruleId: "duplicate-refund", agentId: f.agentId, reason: "Partial refunds", days: 120 }))).rejects.toThrow();
    const ex = await run((db) => requestPolicyException(db, f.ownerCtx, { policyId: f.refundPolicyId, ruleId: "duplicate-refund", agentId: f.agentId, toolKey: "issue-refund", reason: "Partial refunds on the same order during the migration", days: 7 }));
    // Requested is not yet active.
    expect((await f.call({ params: { orderId, customerId: "CUST-1", amount: 120, currency: "AED" } })).decision).toBe("deny");
    await expect(run((db) => decidePolicyException(db, f.ownerCtx, ex.id, { approve: true, note: "fine" }))).rejects.toThrow(/requested the exception cannot approve/);
    await run((db) => decidePolicyException(db, gm.ctx, ex.id, { approve: true, note: "Approved for the migration week" }));

    const allowed = await f.call({ params: { orderId, customerId: "CUST-1", amount: 120, currency: "AED" } });
    expect(allowed.decision).toBe("allow");
    const d = await run((db) => db.authorizationDecision.findFirstOrThrow({ where: { actionRequestId: allowed.requestId } }));
    expect(d.explanation).toMatchObject({ exceptions: [ex.id], exceptedRules: ["refund-authority/duplicate-refund"] });

    // Expired: nothing is skipped after the end date.
    const later = await run((db) => activeExceptionRules(db, f.agentId, "issue-refund", new Date(Date.now() + 8 * 86_400_000)));
    expect(later.keys.size).toBe(0);
    // Replay treats the exception as part of what was decided, not as a policy change.
    const version = await run((db) => db.policyVersion.findFirstOrThrow({ where: { policyId: f.refundPolicyId, state: "active" } }));
    const replay = await run((db) => replayPolicy(db, f.ownerCtx, { policyId: f.refundPolicyId, document: version.document }));
    expect(replay.changed).toBe(0);

    await run((db) => revokePolicyException(db, gm.ctx, ex.id, "Migration finished early"));
    expect((await f.call({ params: { orderId, customerId: "CUST-1", amount: 120, currency: "AED" } })).decision).toBe("deny");
    const list = await run((db) => listPolicyExceptions(db, f.ownerCtx));
    expect(list[0]).toMatchObject({ state: "revoked" });
  });
});

describe("enforcement status, organization conflicts and recommendations", () => {
  it("reports whether each policy reaches an enforcement point", async () => {
    const draftOnly = await run((db) => createPolicy(db, f.ownerCtx, { key: "draft-only", name: "Draft only", description: "", category: "authorization", document: { version: 1, rules: [{ id: "r", effect: "deny", when: { always: true } }] }, changeNote: "x" }));
    const unassigned = await run((db) => createPolicy(db, f.ownerCtx, { key: "unassigned", name: "Unassigned", description: "", category: "authorization", document: { version: 1, rules: [{ id: "r", effect: "deny", when: { always: true } }] }, changeNote: "x" }));
    await run((db) => submitForReview(db, f.ownerCtx, unassigned.version.id));
    await run((db) => activateVersion(db, f.ownerCtx, unassigned.version.id, { fourEyes: false }));
    const e = await run((db) => policyEnforcement(db, f.ownerCtx));
    expect(e.get(f.refundPolicyId)).toMatchObject({ state: "enforced", tools: ["issue-refund"] });
    expect(e.get(draftOnly.policy.id)?.state).toBe("no_active_version");
    expect(e.get(unassigned.policy.id)?.state).toBe("not_assigned");
    const recs = await run((db) => policyRecommendations(db, f.ownerCtx));
    expect(recs.some((r) => r.kind === "not_enforced" && r.title.includes("unassigned"))).toBe(true);
  });

  it("finds a cross-policy conflict for a real agent, with the agents it affects", async () => {
    const fx = await run((db) => createPolicy(db, f.ownerCtx, { key: "fx-guard", name: "FX guard", description: "", category: "authorization", document: { version: 1, appliesTo: { tools: ["issue-refund"], actions: [], environments: [] }, rules: [{ id: "no-usd", effect: "deny", when: { attr: "params.currency", op: "eq", value: "USD" }, reason: "USD refunds are not allowed" }] }, changeNote: "x" }));
    await run((db) => submitForReview(db, f.ownerCtx, fx.version.id));
    await run((db) => activateVersion(db, f.ownerCtx, fx.version.id, { fourEyes: false }));
    await run((db) => assignPolicy(db, f.ownerCtx, fx.policy.id, { targetType: "agent", targetId: f.agentId, priority: 50 }));
    const r = await run((db) => organizationConflicts(db, f.ownerCtx));
    const hit = r.conflicts.find((c) => [c.a.policyKey, c.b.policyKey].includes("fx-guard") && [c.a.policyKey, c.b.policyKey].includes("refund-authority"));
    expect(hit).toBeDefined();
    expect(hit!.winner).toMatchObject({ policyKey: "fx-guard", effect: "deny" });
    expect(hit!.agents).toContain("support-refund-agent");
  });
});
