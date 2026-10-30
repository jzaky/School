import { describe, expect, it } from "vitest";
import { evaluatePolicies, runPolicyTests } from "../src/policy/evaluate.js";
import { parsePolicyDocument, policyDocumentSchema } from "../src/policy/schema.js";
import { buildRefundPolicyDocument, defaultRefundSettings, explainRefundPolicy, extractRefundSettings, refundDocumentMatchesSettings, refundSampleRequests, refundSampleToEvaluationInput, refundTemplateSchema, type RefundTemplateInput } from "../src/policy/templates.js";

function evaluate(doc: ReturnType<typeof buildRefundPolicyDocument>, input: Record<string, unknown>) {
  return evaluatePolicies([{ policyKey: "refunds", policyVersionId: "v1", policyVersion: 1, document: doc }], input);
}

function request(amount: number, extra: { currency?: string; reason?: string | null; hour?: number; prior?: number; denied?: number; tool?: string } = {}) {
  const params: Record<string, unknown> = { orderId: "ORD-1", customerId: "CUST-1", amount, currency: extra.currency ?? "AED" };
  if (extra.reason !== null) params.reason = extra.reason ?? "Customer request";
  return { action: { tool: extra.tool ?? "issue-refund", name: "execute" }, params, context: { hour: extra.hour ?? 10, priorRequestsSameReference: extra.prior ?? 0, deniedCount24h: extra.denied ?? 0 } };
}

const EVERYTHING_ON: RefundTemplateInput = {
  tools: ["issue-refund", "refund-payment"],
  currency: "AED",
  allowedCurrencies: ["USD"],
  autoApproveBelow: 500,
  approvalUpTo: 2500,
  approverRoles: ["approver", "governance_manager"],
  minApprovers: 2,
  approvalExpiresMinutes: 120,
  separationOfDuties: true,
  blockDuplicates: true,
  duplicateHandling: "deny",
  requireReason: true,
  businessHoursOnly: { enabled: true, startHourUtc: 4, endHourUtc: 14 },
  maxDailyDeniedAttempts: 5,
};

describe("refund policy template", () => {
  it("applies defaults", () => {
    const s = defaultRefundSettings();
    expect(s.tools).toEqual(["issue-refund", "refund-payment"]);
    expect(s.currency).toBe("AED");
    expect(s.autoApproveBelow).toBe(500);
    expect(s.approvalUpTo).toBe(2500);
    expect(s.approverRoles).toEqual(["approver"]);
    expect(s.blockDuplicates).toBe(true);
    expect(s.requireReason).toBe(true);
    expect(s.businessHoursOnly.enabled).toBe(false);
  });

  it("rejects an approval ceiling below the autonomous limit and empty business hours", () => {
    expect(refundTemplateSchema.safeParse({ autoApproveBelow: 1000, approvalUpTo: 500 }).success).toBe(false);
    expect(refundTemplateSchema.safeParse({ businessHoursOnly: { enabled: true, startHourUtc: 9, endHourUtc: 9 } }).success).toBe(false);
    expect(refundTemplateSchema.safeParse({ minApprovers: 4 }).success).toBe(false);
    expect(refundTemplateSchema.safeParse({ currency: "aed" }).data?.currency).toBe("AED");
  });

  it("generates a document that validates and passes its own embedded tests, for defaults and for every guard on", () => {
    for (const settings of [{}, EVERYTHING_ON, { duplicateHandling: "require_approval" as const }, { autoApproveBelow: 0, approvalUpTo: 1000 }, { businessHoursOnly: { enabled: true, startHourUtc: 20, endHourUtc: 4 } }]) {
      const doc = buildRefundPolicyDocument(settings);
      expect(policyDocumentSchema.safeParse(doc).success).toBe(true);
      expect(doc.tests.length).toBeGreaterThanOrEqual(4);
      const results = runPolicyTests(doc);
      expect(results.filter((r) => !r.passed).map((r) => `${r.name}: expected ${r.expected}, got ${r.actual} (${r.decidingRule})`)).toEqual([]);
    }
  });

  it("evaluates every band with the default settings", () => {
    const doc = buildRefundPolicyDocument({});
    expect(evaluate(doc, request(100)).result).toBe("allow");
    expect(evaluate(doc, request(100)).decidingRule?.ruleId).toBe("autonomous-band");
    expect(evaluate(doc, request(499.99)).result).toBe("allow");
    const mid = evaluate(doc, request(500));
    expect(mid.result).toBe("require_approval");
    expect(mid.decidingRule?.ruleId).toBe("approval-band");
    expect(mid.approval?.roles).toEqual(["approver"]);
    expect(mid.approval?.expiresInMinutes).toBe(240);
    expect(mid.riskIndicators).toContain("elevated_amount");
    expect(evaluate(doc, request(2500)).result).toBe("require_approval");
    const large = evaluate(doc, request(2500.01));
    expect(large.result).toBe("deny");
    expect(large.decidingRule?.ruleId).toBe("above-limit");
    expect(large.securityEventSeverity).toBe("medium");
    expect(large.reasons[0]).toContain("AED 2,500");
  });

  it("refuses wrong or missing currency, duplicates and missing reasons", () => {
    const doc = buildRefundPolicyDocument({});
    const usd = evaluate(doc, request(100, { currency: "USD" }));
    expect(usd.result).toBe("deny");
    expect(usd.decidingRule?.ruleId).toBe("wrong-currency");
    expect(evaluate(doc, request(100, { currency: "aed" })).result).toBe("deny");
    expect(evaluate(doc, { ...request(100), params: { orderId: "ORD-1", amount: 100, reason: "x" } }).decidingRule?.ruleId).toBe("wrong-currency");
    const dup = evaluate(doc, request(100, { prior: 1 }));
    expect(dup.result).toBe("deny");
    expect(dup.decidingRule?.ruleId).toBe("duplicate-refund");
    expect(dup.riskIndicators).toContain("duplicate_refund");
    expect(evaluate(doc, request(100, { reason: null })).decidingRule?.ruleId).toBe("missing-reason");
    expect(evaluate(doc, request(100, { reason: "   " })).decidingRule?.ruleId).toBe("missing-reason");
    expect(evaluate(doc, request(0)).decidingRule?.ruleId).toBe("invalid-amount");
    expect(evaluate(doc, request(-5)).decidingRule?.ruleId).toBe("invalid-amount");
  });

  it("honours the guard switches", () => {
    const relaxed = buildRefundPolicyDocument({ blockDuplicates: false, requireReason: false });
    expect(relaxed.rules.map((r) => r.id)).not.toContain("duplicate-refund");
    expect(relaxed.rules.map((r) => r.id)).not.toContain("missing-reason");
    expect(evaluate(relaxed, request(100, { prior: 3, reason: null })).result).toBe("allow");

    const escalate = buildRefundPolicyDocument({ duplicateHandling: "require_approval" });
    const r = evaluate(escalate, request(100, { prior: 1 }));
    expect(r.result).toBe("require_approval");
    expect(r.decidingRule?.ruleId).toBe("duplicate-refund");
    expect(r.approval?.instructions).toContain("earlier refund");

    const strict = buildRefundPolicyDocument(EVERYTHING_ON);
    expect(evaluate(strict, request(100, { hour: 9 })).result).toBe("allow");
    expect(evaluate(strict, request(100, { hour: 3 })).decidingRule?.ruleId).toBe("after-hours");
    expect(evaluate(strict, request(100, { hour: 14 })).decidingRule?.ruleId).toBe("after-hours");
    expect(evaluate(strict, request(100, { hour: 13 })).result).toBe("allow");
    expect(evaluate(strict, request(100, { denied: 5 })).decidingRule?.ruleId).toBe("too-many-denials");
    expect(evaluate(strict, request(100, { denied: 4 })).result).toBe("allow");
    expect(evaluate(strict, request(100, { currency: "USD" })).result).toBe("allow");
    expect(evaluate(strict, request(100, { currency: "EUR" })).result).toBe("deny");
    expect(evaluate(strict, request(1000)).approval?.minApprovers).toBe(2);
    expect(evaluate(strict, request(1000)).approval?.roles).toEqual(["approver", "governance_manager"]);
    expect(evaluate(strict, request(100, { tool: "refund-payment" })).result).toBe("allow");
    expect(evaluate(strict, request(100, { tool: "initiate-transfer" })).skippedPolicies).toHaveLength(1);

    const overnight = buildRefundPolicyDocument({ businessHoursOnly: { enabled: true, startHourUtc: 20, endHourUtc: 4 } });
    expect(evaluate(overnight, request(100, { hour: 22 })).result).toBe("allow");
    expect(evaluate(overnight, request(100, { hour: 2 })).result).toBe("allow");
    expect(evaluate(overnight, request(100, { hour: 12 })).decidingRule?.ruleId).toBe("after-hours");
  });

  it("handles a zero autonomous limit", () => {
    const doc = buildRefundPolicyDocument({ autoApproveBelow: 0, approvalUpTo: 1000 });
    expect(evaluate(doc, request(1)).result).toBe("require_approval");
    expect(evaluate(doc, request(1000)).result).toBe("require_approval");
    expect(evaluate(doc, request(1001)).result).toBe("deny");
    expect(explainRefundPolicy({ autoApproveBelow: 0, approvalUpTo: 1000 })[1]).toContain("No refund runs automatically");
  });

  it("round-trips the settings through meta.template", () => {
    const settings = refundTemplateSchema.parse(EVERYTHING_ON);
    const doc = buildRefundPolicyDocument(settings);
    expect(extractRefundSettings(doc)).toEqual(settings);
    // Through JSON, as the database stores it.
    const stored = JSON.parse(JSON.stringify(doc));
    expect(extractRefundSettings(stored)).toEqual(settings);
    expect(extractRefundSettings(parsePolicyDocument(stored))).toEqual(settings);
    expect(refundDocumentMatchesSettings(stored)).toBe(true);
    // A hand-edited rule is still recognised but flagged as diverged.
    const edited = { ...stored, rules: stored.rules.map((r: { id: string; when: unknown }) => (r.id === "above-limit" ? { ...r, when: { attr: "params.amount", op: "gt", value: 9999 } } : r)) };
    expect(extractRefundSettings(edited)).toEqual(settings);
    expect(refundDocumentMatchesSettings(edited)).toBe(false);
  });

  it("does not recognise other documents or a broken meta block", () => {
    expect(extractRefundSettings({ version: 1, rules: [] })).toBeNull();
    expect(extractRefundSettings({ version: 1, rules: [], meta: { template: { id: "other", settings: {} } } })).toBeNull();
    expect(extractRefundSettings({ version: 1, rules: [], meta: { template: { id: "refund-v1", settings: { autoApproveBelow: 5000, approvalUpTo: 10 } } } })).toBeNull();
    expect(extractRefundSettings(null)).toBeNull();
    // Documents without meta still parse (existing documents stay valid).
    expect(policyDocumentSchema.safeParse({ version: 1, rules: [{ id: "a", effect: "deny", when: { always: true } }] }).success).toBe(true);
  });

  it("explains the thresholds in plain language", () => {
    const lines = explainRefundPolicy({ autoApproveBelow: 500, approvalUpTo: 2500, approvalExpiresMinutes: 240 });
    expect(lines).toContain("Refunds below AED 500 run automatically.");
    expect(lines).toContain("Refunds from AED 500 to AED 2,500 need one Approver within 4 hours.");
    expect(lines).toContain("Refunds above AED 2,500 are refused.");
    expect(lines).toContain("A second refund for the same order or payment is refused.");
    expect(lines).toContain("A refund without a stated reason is refused.");
    expect(lines.join(" ")).not.toContain("business hours");
    const strict = explainRefundPolicy(EVERYTHING_ON).join("\n");
    expect(strict).toContain("AED, USD");
    expect(strict).toContain("2 approvers (Approver or Governance Manager) within 2 hours");
    expect(strict).toContain("04:00 to 14:00 UTC");
    expect(strict).toContain("After 5 refused attempts");
    expect(explainRefundPolicy({ duplicateHandling: "require_approval" })).toContain("A second refund for the same order or payment needs approval, whatever the amount.");
  });

  it("produces sample requests that the generated document decides as labelled", () => {
    for (const settings of [{}, EVERYTHING_ON, { duplicateHandling: "require_approval" as const, autoApproveBelow: 0, approvalUpTo: 300 }]) {
      const doc = buildRefundPolicyDocument(settings);
      const samples = refundSampleRequests(settings);
      const ids = samples.map((s) => s.id);
      expect(ids).toEqual(expect.arrayContaining(["small", "large", "wrong_currency"]));
      for (const sample of samples) {
        const r = evaluate(doc, refundSampleToEvaluationInput(sample));
        expect(`${sample.id}: ${r.result}`).toBe(`${sample.id}: ${sample.expected}`);
      }
    }
    const strictIds = refundSampleRequests(EVERYTHING_ON).map((s) => s.id);
    expect(strictIds).toEqual(["small", "mid", "large", "wrong_currency", "duplicate", "missing_reason", "after_hours", "too_many_denials", "second_tool"]);
    expect(refundSampleRequests({ businessHoursOnly: { enabled: false } }).map((s) => s.id)).not.toContain("after_hours");
  });

  it("writes human-readable rule ids, descriptions, reasons and approval instructions", () => {
    const doc = buildRefundPolicyDocument({});
    for (const rule of doc.rules) {
      expect(rule.id).toMatch(/^[a-z][a-z-]+$/);
      expect(rule.description.length).toBeGreaterThan(10);
      expect(rule.reason.length).toBeGreaterThan(10);
      if (rule.effect === "require_approval") expect(rule.approval?.instructions.length).toBeGreaterThan(20);
    }
    expect(doc.rules.find((r) => r.id === "above-limit")?.securityEventSeverity).toBe("medium");
    expect(doc.appliesTo.tools).toEqual(["issue-refund", "refund-payment"]);
  });
});
