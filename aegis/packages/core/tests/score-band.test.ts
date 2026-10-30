import { describe, expect, it } from "vitest";
import { evaluatePolicies, runPolicyTests } from "../src/policy/evaluate.js";
import { parsePolicyDocument } from "../src/policy/schema.js";
import { buildScoreBandPolicyDocument, defaultScoreBandSettings, explainScoreBandPolicy, extractScoreBandSettings, scoreBandDocumentMatchesSettings, scoreBandSampleRequests, scoreBandSampleToEvaluationInput, scoreBandTemplateSchema, type ScoreBandInput } from "../src/policy/score-band.js";

function evaluate(doc: ReturnType<typeof buildScoreBandPolicyDocument>, input: Record<string, unknown>) {
  return evaluatePolicies([{ policyKey: "score", policyVersionId: "v1", policyVersion: 1, document: doc }], input);
}

function request(score: number | null | string, opts: { source?: "context" | "params"; attribute?: string; tool?: string } = {}) {
  const attribute = opts.attribute ?? "riskScore";
  const scored = score === null ? {} : { [attribute]: score };
  const base = { action: { tool: opts.tool ?? "issue-refund", name: "execute" }, params: { orderId: "ORD-1", customerId: "CUST-1", amount: 120, currency: "AED", reason: "test" } };
  return opts.source === "params" ? { ...base, params: { ...base.params, ...scored }, context: { supplied: {} } } : { ...base, context: { supplied: scored } };
}

describe("score-band policy template", () => {
  it("applies defaults and validates boundaries on both scales", () => {
    const s = defaultScoreBandSettings();
    expect(s.scoreAttribute).toBe("riskScore");
    expect([s.reviewFrom, s.holdFrom, s.blockFrom]).toEqual([0.4, 0.55, 0.7]);
    expect(() => scoreBandTemplateSchema.parse({ reviewFrom: 0.6, holdFrom: 0.5 })).toThrow(/hold boundary/);
    expect(() => scoreBandTemplateSchema.parse({ holdFrom: 0.8, blockFrom: 0.7 })).toThrow(/block boundary/);
    expect(() => scoreBandTemplateSchema.parse({ blockFrom: 1.5 })).toThrow(/at most 1/);
    expect(scoreBandTemplateSchema.parse({ scale: "percent", reviewFrom: 40, holdFrom: 55, blockFrom: 70 }).blockFrom).toBe(70);
    expect(() => scoreBandTemplateSchema.parse({ scoreAttribute: "risk score" })).toThrow();
  });

  it("routes every band with the defaults and records the settings in the document", () => {
    const doc = buildScoreBandPolicyDocument({});
    expect(parsePolicyDocument(doc)).toBeTruthy();
    expect(evaluate(doc, request(0.1)).result).toBe("allow");
    const review = evaluate(doc, request(0.45));
    expect(review.result).toBe("require_approval");
    expect(review.matchedRules.some((r) => r.ruleId === "review-band")).toBe(true);
    const hold = evaluate(doc, request(0.6));
    expect(hold.result).toBe("require_approval");
    expect(hold.matchedRules.some((r) => r.ruleId === "hold-band")).toBe(true);
    expect(hold.riskIndicators).toContain("hold");
    expect(hold.approval?.expiresInMinutes).toBe(60);
    expect(evaluate(doc, request(0.7)).result).toBe("deny");
    expect(evaluate(doc, request(0.95)).result).toBe("deny");
    expect(evaluate(doc, request(null)).result).toBe("deny");
    expect(evaluate(doc, request(1.4)).result).toBe("deny");
    expect(evaluate(doc, request(-0.1)).result).toBe("deny");
    expect(extractScoreBandSettings(doc)?.blockFrom).toBe(0.7);
    expect(scoreBandDocumentMatchesSettings(doc)).toBe(true);
  });

  it("boundaries are inclusive at the top of each band and exclusive below", () => {
    const doc = buildScoreBandPolicyDocument({ reviewFrom: 0.4, holdFrom: 0.55, blockFrom: 0.7 });
    expect(evaluate(doc, request(0.3999)).result).toBe("allow");
    expect(evaluate(doc, request(0.4)).matchedRules.some((r) => r.ruleId === "review-band")).toBe(true);
    expect(evaluate(doc, request(0.55)).matchedRules.some((r) => r.ruleId === "hold-band")).toBe(true);
    expect(evaluate(doc, request(0.6999)).matchedRules.some((r) => r.ruleId === "hold-band")).toBe(true);
    expect(evaluate(doc, request(0.7)).matchedRules.some((r) => r.ruleId === "block-band")).toBe(true);
  });

  it("reads the score from params on a percent scale and honours missing-score escalation", () => {
    const input: ScoreBandInput = { scoreSource: "params", scoreAttribute: "fraudProbability", scale: "percent", reviewFrom: 40, holdFrom: 55, blockFrom: 70, missingScore: "require_approval", tools: ["charge-card"] };
    const doc = buildScoreBandPolicyDocument(input);
    const opts = { source: "params" as const, attribute: "fraudProbability", tool: "charge-card" };
    expect(evaluate(doc, request(12, opts)).result).toBe("allow");
    expect(evaluate(doc, request(50, opts)).result).toBe("require_approval");
    expect(evaluate(doc, request(71, opts)).result).toBe("deny");
    expect(evaluate(doc, request(null, opts)).result).toBe("require_approval");
    expect(evaluate(doc, request(150, opts)).result).toBe("deny");
    // A score supplied in the context is ignored when the template reads params.
    expect(evaluate(doc, request(90, { attribute: "fraudProbability", tool: "charge-card" })).result).toBe("require_approval");
  });

  it("a request without a score, or with a non-numeric score, is refused by default", () => {
    const doc = buildScoreBandPolicyDocument({});
    expect(evaluate(doc, request(null)).result).toBe("deny");
    expect(evaluate(doc, request("high")).result).toBe("deny");
    expect(evaluate(doc, request("high")).defaultDeny).toBe(true);
  });

  it("the document's own tests pass for the defaults and for a zero review boundary", () => {
    for (const input of [{}, { reviewFrom: 0, holdFrom: 0, blockFrom: 0.9 }, { scale: "percent" as const, reviewFrom: 20, holdFrom: 20, blockFrom: 20 }, { scoreAttribute: "fraudScore", tools: ["issue-refund", "refund-payment"] }, { scoreSource: "params" as const, scoreAttribute: "p_fraud" }]) {
      const doc = buildScoreBandPolicyDocument(input);
      const results = runPolicyTests(doc);
      expect(results.filter((r) => !r.passed), JSON.stringify(results.filter((r) => !r.passed))).toEqual([]);
      for (const sample of scoreBandSampleRequests(input)) {
        expect(evaluate(doc, scoreBandSampleToEvaluationInput(sample, input)).result, sample.name).toBe(sample.expected);
      }
    }
  });

  it("explains itself in plain language and rejects documents from other templates", () => {
    const lines = explainScoreBandPolicy({});
    expect(lines.join(" ")).toMatch(/Scores below 0.40 run automatically/);
    expect(lines.join(" ")).toMatch(/0.70 and above are refused/);
    expect(extractScoreBandSettings({ version: 1, meta: { template: { id: "refund-v1", settings: {} } } })).toBeNull();
  });
});
