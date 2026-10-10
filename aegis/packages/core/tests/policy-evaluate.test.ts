import { describe, expect, it } from "vitest";
import { evaluatePolicies, getAttr, runPolicyTests } from "../src/policy/evaluate.js";
import { parsePolicyDocument, referencedAttributes } from "../src/policy/schema.js";

const refundPolicy = parsePolicyDocument({
  version: 1,
  appliesTo: { tools: ["issue-refund"] },
  rules: [
    { id: "small-auto", description: "Refunds under 500 are automatic", effect: "allow", when: { all: [{ attr: "params.currency", op: "eq", value: "AED" }, { attr: "params.amount", op: "lt", value: 500 }] }, reason: "Within autonomous refund limit" },
    { id: "mid-approval", description: "500 to 2500 need a supervisor", effect: "require_approval", when: { attr: "params.amount", op: "between", value: [500, 2500] }, approval: { roles: ["approver"], expiresInMinutes: 60 }, reason: "Supervisor approval required between 500 and 2,500" },
    { id: "large-deny", description: "Above 2500 is denied", effect: "deny", when: { attr: "params.amount", op: "gt", value: 2500 }, reason: "Exceeds refund authority", securityEventSeverity: "medium" },
    { id: "no-foreign", effect: "deny", when: { attr: "params.currency", op: "neq", value: "AED" }, reason: "Only AED refunds" },
  ],
  tests: [
    { name: "100 AED allowed", input: { action: { tool: "issue-refund" }, params: { amount: 100, currency: "AED" } }, expect: "allow" },
    { name: "1000 AED approval", input: { action: { tool: "issue-refund" }, params: { amount: 1000, currency: "AED" } }, expect: "require_approval" },
    { name: "5000 AED denied", input: { action: { tool: "issue-refund" }, params: { amount: 5000, currency: "AED" } }, expect: "deny" },
  ],
});
const P = [{ policyKey: "refunds", policyVersionId: "v1", policyVersion: 1, document: refundPolicy }];

describe("policy evaluator", () => {
  it("reads nested attributes", () => {
    expect(getAttr({ a: { b: [1, { c: 2 }] } }, "a.b[1].c")).toBe(2);
    expect(getAttr({ a: 1 }, "a.b.c")).toBeUndefined();
  });
  it("allows below threshold with a full trace", () => {
    const r = evaluatePolicies(P, { action: { tool: "issue-refund" }, params: { amount: 120, currency: "AED" } });
    expect(r.result).toBe("allow");
    expect(r.decidingRule?.ruleId).toBe("small-auto");
    expect(r.trace).toHaveLength(4);
    expect(r.trace.find((t) => t.ruleId === "small-auto")?.comparisons.map((c) => c.result)).toEqual([true, true]);
  });
  it("requires approval in the middle band and carries approval settings", () => {
    const r = evaluatePolicies(P, { action: { tool: "issue-refund" }, params: { amount: 1500, currency: "AED" } });
    expect(r.result).toBe("require_approval");
    expect(r.approval?.roles).toEqual(["approver"]);
    expect(r.approval?.expiresInMinutes).toBe(60);
  });
  it("deny overrides everything else", () => {
    const r = evaluatePolicies(P, { action: { tool: "issue-refund" }, params: { amount: 3000, currency: "AED" } });
    expect(r.result).toBe("deny");
    expect(r.securityEventSeverity).toBe("medium");
    expect(r.reasons).toContain("Exceeds refund authority");
    // Boundary: exactly 2500 is approval, 2500.01 is deny
    expect(evaluatePolicies(P, { action: { tool: "issue-refund" }, params: { amount: 2500, currency: "AED" } }).result).toBe("require_approval");
    expect(evaluatePolicies(P, { action: { tool: "issue-refund" }, params: { amount: 2500.01, currency: "AED" } }).result).toBe("deny");
  });
  it("default denies when nothing matches and when the policy is out of scope", () => {
    const r = evaluatePolicies(P, { action: { tool: "issue-refund" }, params: { currency: "AED" } });
    expect(r.result).toBe("deny");
    expect(r.defaultDeny).toBe(true);
    const skipped = evaluatePolicies(P, { action: { tool: "send-email" }, params: { amount: 1 } });
    expect(skipped.result).toBe("deny");
    expect(skipped.skippedPolicies[0]?.policyKey).toBe("refunds");
  });
  it("never throws on bad input types", () => {
    expect(evaluatePolicies(P, { action: { tool: "issue-refund" }, params: { amount: { nested: true }, currency: 42 } }).result).toBe("deny");
    expect(evaluatePolicies(P, null).result).toBe("deny");
  });
  it("is deterministic", () => {
    const input = { action: { tool: "issue-refund" }, params: { amount: 700, currency: "AED" } };
    const a = JSON.stringify(evaluatePolicies(P, input));
    const b = JSON.stringify(evaluatePolicies(P, input));
    expect(a).toBe(b);
  });
  it("evaluates domain and set operators", () => {
    const doc = parsePolicyDocument({
      version: 1,
      rules: [
        { id: "egress", effect: "deny", when: { attr: "params.destination", op: "domain_not_in", value: ["meridian-demo.example", "*.trusted.example"] } },
        { id: "ok", effect: "allow", when: { attr: "shield.dataClasses", op: "subset_of", value: ["email", "name"] } },
      ],
    });
    const PP = [{ policyKey: "x", policyVersionId: "v", policyVersion: 1, document: doc }];
    expect(evaluatePolicies(PP, { params: { destination: "https://files.evil.example/upload" }, shield: { dataClasses: [] } }).result).toBe("deny");
    expect(evaluatePolicies(PP, { params: { destination: "https://api.trusted.example/x" }, shield: { dataClasses: ["email"] } }).result).toBe("allow");
    expect(evaluatePolicies(PP, { params: { destination: "someone@meridian-demo.example" }, shield: { dataClasses: ["card_number"] } }).result).toBe("deny");
  });
  it("runs embedded tests", () => {
    const results = runPolicyTests(refundPolicy);
    expect(results.every((r) => r.passed)).toBe(true);
    expect(referencedAttributes(refundPolicy)).toEqual(["params.amount", "params.currency"]);
  });
  it("rejects malformed documents", () => {
    expect(() => parsePolicyDocument({ version: 1, rules: [] })).toThrow();
    expect(() => parsePolicyDocument({ version: 1, rules: [{ id: "a", effect: "require_approval", when: { always: true } }] })).toThrow(/approval/);
    expect(() => parsePolicyDocument({ version: 1, rules: [{ id: "a", effect: "allow", when: { always: true } }, { id: "a", effect: "deny", when: { always: true } }] })).toThrow(/Duplicate/);
  });
});
