import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { disconnectAll, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { assessReasoning, escalateForReasoning, reasoningPolicySchema, type ReasoningOutcome } from "../src/reasoning/assess.js";
import { counterfactuals, decisionRecord, inspectDecision, recheckWithCurrentPolicies, updateToolReasoningPolicy } from "../src/reasoning/service.js";
import { canonicalJson, sha256Hex } from "../src/lib/crypto.js";
import { randomUUID } from "node:crypto";

const off = reasoningPolicySchema.parse({});
const base = { tool: "issue-refund", action: "execute", params: { amount: 120, orderId: "O-1" } };
const evidence = [{ field: "amount", value: 120, source: "orders-db", ref: "ord-1" }];

describe("reasoning assessment (pure)", () => {
  it("with no rationale and no requirements nothing is checked or changed", () => {
    const a = assessReasoning({ ...base, supplied: {}, policy: off });
    expect(a).toMatchObject({ provided: false, level: "low", integrityFailures: [] });
    expect(escalateForReasoning("allow", a, off).outcome).toBe("allow");
  });

  it("a rationale that matches the request, cites supplied evidence and assumes what the evidence says passes", () => {
    const a = assessReasoning({ ...base, supplied: { evidence, rationale: { summary: "Refund for a damaged item", action: { tool: "issue-refund", action: "execute" }, steps: [{ statement: "Order total confirmed", cites: ["ord-1"] }], assumptions: [{ field: "amount", value: 120 }], policyBasis: ["refund-authority"] } }, policy: off, evaluated: [{ policyKey: "refund-authority", matched: true }] });
    expect(a.provided).toBe(true);
    expect(a.integrityFailures).toEqual([]);
    expect(a.level).toBe("low");
  });

  it("saying one thing and doing another always goes to a person", () => {
    const a = assessReasoning({ ...base, supplied: { rationale: { summary: "Sending a courtesy email", action: { tool: "send-email" } } }, policy: off });
    expect(a.integrityFailures).toEqual(["stated_action"]);
    expect(escalateForReasoning("allow", a, off)).toMatchObject({ outcome: "require_approval" });
  });

  it("citing evidence that was not supplied, or assuming what the request contradicts, is an integrity failure", () => {
    const fabricated = assessReasoning({ ...base, supplied: { evidence, rationale: { summary: "x", steps: [{ statement: "Customer is gold tier", cites: ["crm-77"] }] } }, policy: off });
    expect(fabricated.integrityFailures).toEqual(["citations"]);
    expect(fabricated.indicators.find((i) => i.key === "citations")?.detail).toMatch(/crm-77/);
    const assumed = assessReasoning({ ...base, supplied: { evidence, rationale: { summary: "x", assumptions: [{ field: "amount", value: 12 }] } }, policy: off });
    expect(assumed.integrityFailures).toEqual(["assumption:amount"]);
    const malformed = assessReasoning({ ...base, supplied: { rationale: "because" }, policy: off });
    expect(malformed.integrityFailures).toEqual(["rationale_format"]);
  });

  it("checks the policies the agent relies on against those that applied", () => {
    const a = assessReasoning({ ...base, supplied: { rationale: { summary: "x", policyBasis: ["refund-authority", "made-up-policy", "unused"] } }, policy: off, evaluated: [{ policyKey: "refund-authority", matched: true }, { policyKey: "unused", matched: false }] });
    expect(a.indicators.find((i) => i.key === "policy_basis:made-up-policy")?.status).toBe("fail");
    expect(a.indicators.find((i) => i.key === "policy_basis:unused")?.status).toBe("warning");
    expect(a.integrityFailures).toEqual([]);
  });

  it("tool requirements: a missing rationale is unknown, and uncited steps fail when citations are required", () => {
    const req = reasoningPolicySchema.parse({ enabled: true, requireRationale: true, requireCitations: true, onFailure: "request_more_information" });
    const none = assessReasoning({ ...base, supplied: {}, policy: req });
    expect(none.level).toBe("unknown");
    expect(escalateForReasoning("allow", none, req)).toMatchObject({ outcome: "request_more_information", fields: ["context.rationale"] });
    const uncited = assessReasoning({ ...base, supplied: { rationale: { summary: "x", steps: [{ statement: "Looks fine" }] } }, policy: req });
    expect(uncited.level).toBe("high");
    expect(escalateForReasoning("allow", uncited, { ...req, onFailure: "deny" }).outcome).toBe("deny");
  });

  it("never loosens a decision", () => {
    const strict: Record<ReasoningOutcome, number> = { allow: 0, restrict: 1, require_approval: 2, request_more_information: 3, quarantine: 4, deny: 5, error: 5 };
    fc.assert(
      fc.property(fc.constantFrom<ReasoningOutcome>("allow", "restrict", "require_approval", "deny", "quarantine", "request_more_information", "error"), fc.boolean(), fc.boolean(), fc.constantFrom("low", "elevated", "high", "unknown"), fc.constantFrom("require_approval", "request_more_information", "deny"), (outcome, integrity, enabled, level, onFailure) => {
        const a = { provided: true, level, indicators: [], integrityFailures: integrity ? ["stated_action"] : [], rationale: null, requirementsApplied: enabled } as Parameters<typeof escalateForReasoning>[1];
        const r = escalateForReasoning(outcome, a, { enabled, requireRationale: true, requireCitations: false, onFailure: onFailure as "deny" });
        expect(strict[r.outcome]).toBeGreaterThanOrEqual(strict[outcome]);
      }),
      { numRuns: 1000 },
    );
  });

  it("counterfactuals come only from recorded numeric comparisons", () => {
    const out = counterfactuals([
      { policyKey: "refund-authority", ruleId: "auto-below-500", effect: "allow", matched: true, comparisons: [{ attr: "params.amount", op: "lt", expected: 500, actual: 120, result: true }] },
      { policyKey: "refund-authority", ruleId: "deny-above-2500", effect: "deny", matched: false, comparisons: [{ attr: "params.amount", op: "gt", expected: 2500, actual: 120, result: false }, { attr: "action", op: "eq", expected: "execute", actual: "execute", result: true }] },
    ]);
    expect(out).toEqual(["If params.amount were 500 or more (it was 120), rule refund-authority/auto-below-500 (allow) would no longer match.", "If params.amount were above 2500 (it was 120), rule refund-authority/deny-above-2500 (deny) would match."]);
  });
});

let f: GatewayFixture;
const run = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(f.orgId, fn);
let toolId = "";

beforeAll(async () => {
  f = await makeGatewayFixture();
  toolId = (await run((db) => db.tool.findFirstOrThrow({ where: { key: "issue-refund" } }))).id;
}, 120_000);

afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});

describe("reasoning governance in the gateway and the Decision Inspector", () => {
  it("records a checked rationale, and holds a request whose rationale contradicts it", async () => {
    const good = await f.call({ amount: 140, context: { evidence: [{ field: "amount", value: 140, source: "orders-db", ref: "o-1" }], rationale: { summary: "Damaged on arrival", action: { tool: "issue-refund" }, steps: [{ statement: "Order total checked", cites: ["o-1"] }] } } });
    expect(good.decision).toBe("allow");
    const d = await run((db) => db.authorizationDecision.findFirstOrThrow({ where: { actionRequestId: good.requestId } }));
    expect((d.explanation as { reasoning: { provided: boolean; integrityFailures: string[] } }).reasoning).toMatchObject({ provided: true, integrityFailures: [] });
    const bad = await f.call({ amount: 150, context: { rationale: { summary: "Just reading the order", action: { tool: "read-order" } } } });
    expect(bad.decision).toBe("require_approval");
    expect(bad.reasons.join(" ")).toMatch(/stated reasons do not match/);
  });

  it("enforces a tool's rationale requirements, asking for the rationale when the tool says so", async () => {
    await expect(run((db) => updateToolReasoningPolicy(db, f.viewer.ctx, toolId, { enabled: true }))).rejects.toThrow(/Missing permission/);
    await run((db) => updateToolReasoningPolicy(db, f.ownerCtx, toolId, { enabled: true, requireRationale: true, onFailure: "request_more_information" }));
    const key = `rsn-${randomUUID()}`;
    const first = await f.call({ amount: 90, idempotencyKey: key });
    expect(first.decision).toBe("request_more_information");
    expect(first.moreInformation?.fields).toEqual(["context.rationale"]);
    const second = await f.call({ amount: 90, idempotencyKey: key, context: { rationale: { summary: "Late delivery, within policy" } } });
    expect(second.decision).toBe("allow");
    await run((db) => updateToolReasoningPolicy(db, f.ownerCtx, toolId, {}));
  });

  it("the inspector reconstructs every stage, rechecks against today's policies and exports a hashed record", async () => {
    const r = await f.call({ amount: 1300, context: { rationale: { summary: "Large but justified", policyBasis: ["refund-authority"] } } });
    expect(r.decision).toBe("require_approval");
    const view = await run((db) => inspectDecision(db, f.ownerCtx, r.requestId));
    expect(view.stages.map((s) => s.key)).toEqual(["received", "baseline", "data_protection", "policy", "uncertainty", "reasoning", "autonomy", "outcome", "approval"]);
    const policy = view.stages.find((s) => s.key === "policy")!;
    expect((policy.detail.counterfactuals as string[]).length).toBeGreaterThan(0);
    expect(view.stages.find((s) => s.key === "outcome")?.status).toBe("pending");
    const recheck = await run((db) => recheckWithCurrentPolicies(db, f.ownerCtx, r.requestId));
    expect(recheck).toMatchObject({ comparable: true, then: "require_approval", now: "require_approval", same: true });
    const { record, sha256 } = await run((db) => decisionRecord(db, f.ownerCtx, r.requestId));
    expect(sha256Hex(canonicalJson(record))).toBe(sha256);
    expect(record.note).toMatch(/No model-internal reasoning/);
    expect(record.entities[0]?.id).toBe(`request:${r.requestId}`);
    const exported = await run((db) => db.evidenceEvent.findFirst({ where: { type: "decision.record_exported", subjectId: r.requestId } }));
    expect(exported).not.toBeNull();
    await expect(run((db) => inspectDecision(db, { ...f.ownerCtx, actor: { ...f.ownerCtx.actor, permissions: ["org:read"] } }, r.requestId))).rejects.toThrow(/Missing permission gateway:read/);
  });

  it("flags when similar requests were decided differently by the same policy versions (heuristic)", async () => {
    // Two refunds of nearly the same amount, one asked twice: the duplicate rule decides the second differently.
    const orderId = `PREC-${randomUUID().slice(0, 8)}`;
    const first = await f.call({ params: { orderId, customerId: "CUST-1", amount: 300, currency: "AED" } });
    expect(first.decision).toBe("allow");
    const second = await f.call({ params: { orderId, customerId: "CUST-1", amount: 310, currency: "AED" } });
    expect(second.decision).not.toBe("allow");
    const d = await run((db) => db.authorizationDecision.findFirstOrThrow({ where: { actionRequestId: second.requestId } }));
    const p = (d.explanation as { reasoning: { indicators: { key: string; basis: string; status: string }[] } }).reasoning.indicators.find((i) => i.key === "precedent");
    expect(p).toMatchObject({ basis: "heuristic", status: "warning" });
    // A heuristic warning never changes a decision by itself.
    expect((d.explanation as { reasoning: { escalated: boolean } }).reasoning.escalated).toBe(false);
  });
});
