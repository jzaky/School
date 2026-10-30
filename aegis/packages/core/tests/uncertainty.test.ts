import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { randomUUID } from "node:crypto";
import { disconnectAll, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { assessUncertainty, escalateForUncertainty, levelOf, readUncertaintyPolicy, uncertaintyPolicySchema, type EscalationOutcome, type UncertaintyPolicy } from "../src/uncertainty/assess.js";
import { computeCalibration, lookupFromReport } from "../src/uncertainty/calibration.js";
import { labelOutcome, recomputeCalibration, uncertaintyOverview, updateToolUncertaintyPolicy } from "../src/uncertainty/service.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../src/policy/service.js";
import { decideApprovalAndExecute } from "../src/approvals/service.js";
import { issueApiKey } from "../src/identity/api-keys.js";
import type { PolicyDocument } from "../src/policy/schema.js";

const now = new Date("2026-10-14T10:00:00Z");
const off: UncertaintyPolicy = uncertaintyPolicySchema.parse({});
const on = (p: Partial<UncertaintyPolicy>): UncertaintyPolicy => uncertaintyPolicySchema.parse({ enabled: true, ...p });
const ev = (field: string, value: string | number, source = "orders-db", minutesAgo = 5) => ({ field, value, source, observedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString() });

describe("uncertainty assessment (pure)", () => {
  it("with nothing supplied and no requirements, uncertainty is low and nothing escalates", () => {
    const a = assessUncertainty({ params: { amount: 100 }, supplied: {}, policy: off, now });
    expect(a.level).toBe("low");
    expect(escalateForUncertainty("allow", a, off).outcome).toBe("allow");
  });

  it("evidence that contradicts the request always goes to a person, even without requirements", () => {
    const a = assessUncertainty({ params: { amount: 900 }, supplied: { evidence: [ev("amount", 90)] }, policy: off, now });
    expect(a.level).toBe("high");
    expect(a.contradictions).toEqual(["amount"]);
    expect(a.indicators.find((i) => i.key === "contradiction:amount")?.basis).toBe("measured");
    expect(escalateForUncertainty("allow", a, off)).toMatchObject({ outcome: "require_approval" });
    const twoSources = assessUncertainty({ params: {}, supplied: { evidence: [ev("customerId", "C-1", "crm"), ev("customerId", "C-2", "billing")] }, policy: off, now });
    expect(twoSources.contradictions).toEqual(["customerId"]);
  });

  it("missing required fields are high and can ask the agent for exactly those fields", () => {
    const policy = on({ requiredContext: ["context.ticketRef", "params.orderId"], onHigh: "request_more_information" });
    const a = assessUncertainty({ params: { amount: 50 }, supplied: {}, policy, now });
    expect(a.level).toBe("high");
    expect(a.missing).toEqual(["context.ticketRef", "params.orderId"]);
    expect(escalateForUncertainty("allow", a, policy)).toMatchObject({ outcome: "request_more_information", fields: ["context.ticketRef", "params.orderId"] });
    const ok = assessUncertainty({ params: { amount: 50, orderId: "O-1" }, supplied: { ticketRef: "T-9" }, policy, now });
    expect(ok.level).toBe("low");
  });

  it("an unbacked value is unknown, and unknown is never treated as safe", () => {
    const policy = on({ requireEvidenceFor: ["amount"] });
    const a = assessUncertainty({ params: { amount: 50 }, supplied: {}, policy, now });
    expect(a.level).toBe("unknown");
    expect(escalateForUncertainty("allow", a, policy).outcome).toBe("require_approval");
    expect(escalateForUncertainty("allow", a, { ...policy, onHigh: "deny" }).outcome).toBe("deny");
  });

  it("checks freshness and sources, and labels what each check rests on", () => {
    const policy = on({ maxEvidenceAgeMinutes: 60, trustedSources: ["orders-db"] });
    const stale = assessUncertainty({ params: {}, supplied: { evidence: [ev("amount", 5, "orders-db", 120)] }, policy, now });
    expect(stale.level).toBe("elevated");
    const future = assessUncertainty({ params: {}, supplied: { evidence: [ev("amount", 5, "orders-db", -60)] }, policy, now });
    expect(future.level).toBe("high");
    const untrusted = assessUncertainty({ params: {}, supplied: { evidence: [ev("amount", 5, "spreadsheet")] }, policy, now });
    expect(untrusted.indicators.find((i) => i.key.startsWith("source:"))?.status).toBe("warning");
    const undated = assessUncertainty({ params: {}, supplied: { evidence: [{ field: "amount", value: 5, source: "orders-db" }] }, policy, now });
    expect(undated.level).toBe("unknown");
    const malformed = assessUncertainty({ params: {}, supplied: { evidence: [{ field: "amount" }] }, policy: off, now });
    expect(malformed.level).toBe("high");
  });

  it("an agent's own confidence is never treated as calibrated without enough labelled outcomes", () => {
    const policy = on({ minConfidence: 0.8 });
    const self = assessUncertainty({ params: {}, supplied: { confidence: 0.6 }, policy, now });
    expect(self.confidence).toMatchObject({ value: 0.6, basis: "self_reported", calibratedAccuracy: null });
    // Audit P2-8: a self-reported figure below the minimum is at least as strict as no figure (which is unknown).
    expect(self.level).toBe("high");
    const absent = assessUncertainty({ params: {}, supplied: {}, policy, now });
    expect(absent.level).toBe("unknown");
    const few = lookupFromReport(computeCalibration(Array.from({ length: 20 }, () => ({ confidence: 0.95, correct: true }))));
    expect(assessUncertainty({ params: {}, supplied: { confidence: 0.95 }, policy, now, calibration: few }).confidence?.basis).toBe("self_reported");
    // 60 outcomes at 0.95 of which only 30 were right: calibrated accuracy 0.5 is below the 0.8 minimum.
    const many = lookupFromReport(computeCalibration(Array.from({ length: 60 }, (_, i) => ({ confidence: 0.95, correct: i % 2 === 0 }))));
    const cal = assessUncertainty({ params: {}, supplied: { confidence: 0.95 }, policy, now, calibration: many });
    expect(cal.confidence).toMatchObject({ basis: "calibrated", calibratedAccuracy: 0.5, sampleSize: 60 });
    expect(cal.level).toBe("high");
  });

  it("the agent reporting what it could not determine asks it for that, even without requirements", () => {
    const a = assessUncertainty({ params: {}, supplied: { missing: ["customerTenure"] }, policy: off, now });
    expect(escalateForUncertainty("allow", a, off)).toMatchObject({ outcome: "request_more_information", fields: ["context.customerTenure"] });
  });

  it("never loosens a decision, for any outcome and assessment", () => {
    const strict: Record<EscalationOutcome, number> = { allow: 0, restrict: 1, require_approval: 2, request_more_information: 3, quarantine: 4, deny: 5, error: 5 };
    fc.assert(
      fc.property(fc.constantFrom<EscalationOutcome>("allow", "restrict", "require_approval", "deny", "quarantine", "request_more_information", "error"), fc.constantFrom("low", "elevated", "high", "unknown"), fc.boolean(), fc.boolean(), fc.constantFrom("require_approval", "request_more_information", "deny"), (outcome, level, enabled, contradiction, onHigh) => {
        const a = { level, indicators: [], missing: ["context.x"], contradictions: contradiction ? ["amount"] : [], confidence: null, requirementsApplied: enabled } as Parameters<typeof escalateForUncertainty>[1];
        const r = escalateForUncertainty(outcome, a, { ...off, enabled, onHigh: onHigh as UncertaintyPolicy["onHigh"] });
        expect(strict[r.outcome]).toBeGreaterThanOrEqual(strict[outcome]);
      }),
      { numRuns: 1000 },
    );
  });

  it("orders levels: any failure is high, any unknown is unknown, any warning is elevated", () => {
    const i = (status: "ok" | "warning" | "fail" | "unknown") => ({ key: status, label: status, basis: "measured" as const, status, detail: "" });
    expect(levelOf([i("ok"), i("warning"), i("unknown"), i("fail")])).toBe("high");
    expect(levelOf([i("warning"), i("unknown")])).toBe("unknown");
    expect(levelOf([i("ok"), i("warning")])).toBe("elevated");
    expect(levelOf([])).toBe("low");
  });

  it("an unreadable stored tool policy is applied strictly, not ignored", () => {
    expect(readUncertaintyPolicy({ enabled: "yes" }).enabled).toBe(true);
    expect(readUncertaintyPolicy({}).enabled).toBe(false);
  });
});

describe("calibration (pure)", () => {
  it("computes bins, expected calibration error and the Brier score exactly", () => {
    const pairs = [...Array.from({ length: 10 }, (_, i) => ({ confidence: 0.9, correct: i < 9 })), ...Array.from({ length: 10 }, (_, i) => ({ confidence: 0.6, correct: i < 3 }))];
    const r = computeCalibration(pairs);
    expect(r.sampleSize).toBe(20);
    expect(r.ece).toBeCloseTo(0.15, 4);
    expect(r.brier).toBeCloseTo(0.195, 4);
    expect(r.accuracy).toBeCloseTo(0.6, 4);
    expect(r.bins[9]).toMatchObject({ count: 10, accuracy: 0.9 });
    expect(r.bins[6]).toMatchObject({ count: 10, accuracy: 0.3 });
    expect(r.status).toBe("insufficient");
    expect(computeCalibration([]).status).toBe("no_outcomes");
  });
});

let f: GatewayFixture;
const run = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(f.orgId, fn);
let refundToolId = "";

beforeAll(async () => {
  f = await makeGatewayFixture();
  refundToolId = (await run((db) => db.tool.findFirstOrThrow({ where: { key: "issue-refund" } }))).id;
}, 120_000);

afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});

describe("uncertainty in the gateway", () => {
  it("records the assessment on every policy decision without changing behaviour by default", async () => {
    const r = await f.call({ amount: 100 });
    expect(r.decision).toBe("allow");
    const d = await run((db) => db.authorizationDecision.findFirstOrThrow({ where: { actionRequestId: r.requestId } }));
    // The fixture activated its policy moments ago: a heuristic warning raises the level to elevated, and an
    // elevated level never changes the decision.
    expect(d.uncertaintyLevel).toBe("elevated");
    const u = (d.explanation as { uncertainty: { indicators: { key: string; basis: string; status: string }[] } }).uncertainty;
    expect(u.indicators.filter((i) => i.status !== "ok")).toEqual([expect.objectContaining({ key: "recent_policy_change", basis: "heuristic", status: "warning" })]);
    expect((d.explanation as { policyResult: string }).policyResult).toBe("allow");
  });

  it("sends a request whose own evidence contradicts it to a person", async () => {
    const r = await f.call({ amount: 120, context: { evidence: [{ field: "amount", value: 12, source: "orders-db" }] } });
    expect(r.decision).toBe("require_approval");
    expect(r.reasons.join(" ")).toMatch(/Conflicting evidence on amount/);
    const d = await run((db) => db.authorizationDecision.findFirstOrThrow({ where: { actionRequestId: r.requestId } }));
    expect(d.uncertaintyLevel).toBe("high");
    expect((d.explanation as { uncertainty: { contradictions: string[]; escalated: boolean } }).uncertainty).toMatchObject({ contradictions: ["amount"], escalated: true });
  });

  it("with requirements on, asks for missing fields and decides again when they arrive", async () => {
    await expect(run((db) => updateToolUncertaintyPolicy(db, f.viewer.ctx, refundToolId, { enabled: true }))).rejects.toThrow(/Missing permission/);
    await run((db) => updateToolUncertaintyPolicy(db, f.ownerCtx, refundToolId, { enabled: true, requiredContext: ["context.ticketRef"], onHigh: "request_more_information" }));
    const key = `unc-${randomUUID()}`;
    const first = await f.call({ amount: 80, idempotencyKey: key });
    expect(first.decision).toBe("request_more_information");
    expect(first.moreInformation?.fields).toEqual(["context.ticketRef"]);
    const second = await f.call({ amount: 80, idempotencyKey: key, context: { ticketRef: "T-100" } });
    expect(second.decision).toBe("allow");
    expect(second.status).toBe("executed");
    await run((db) => updateToolUncertaintyPolicy(db, f.ownerCtx, refundToolId, {}));
  });

  it("policies can refer to the uncertainty level", async () => {
    await run(async (db) => {
      const doc = { version: 1, appliesTo: { tools: ["issue-refund"], actions: [], environments: [] }, rules: [{ id: "hold-unknown", description: "", effect: "deny", when: { attr: "uncertainty.level", op: "in", value: ["high", "unknown"] }, reason: "Uncertain refunds are refused", riskIndicators: [] }], tests: [] } as unknown as PolicyDocument;
      const { policy, version } = await createPolicy(db, f.ownerCtx, { key: "unc-guard", name: "unc-guard", description: "", category: "authorization", document: doc, changeNote: "test" });
      await submitForReview(db, f.ownerCtx, version.id);
      await activateVersion(db, f.ownerCtx, version.id, { fourEyes: false });
      await assignPolicy(db, f.ownerCtx, policy.id, { targetType: "agent", targetId: f.agentId, priority: 100 });
    });
    const r = await f.call({ amount: 60, context: { evidence: [{ field: "amount", value: 6, source: "orders-db" }] } });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/Uncertain refunds are refused/);
  });

  it("labels outcomes from approvers, people and customer systems, and calibrates only with enough of them", async () => {
    // An approval of a request that carried a confidence becomes an approver label.
    const held = await f.call({ amount: 1200, context: { confidence: 0.9 } });
    expect(held.decision).toBe("require_approval");
    const a = await run((db) => db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: held.requestId } }));
    await decideApprovalAndExecute(run, f.approver.ctx, a.id, { decision: "approve", comment: "ok", requestHash: a.requestHash });
    const approverLabel = await run((db) => db.outcomeLabel.findFirstOrThrow({ where: { actionRequestId: held.requestId } }));
    expect(approverLabel).toMatchObject({ source: "approver", correct: true, confidence: 0.9 });
    // People need monitoring:write.
    await expect(run((db) => labelOutcome(db, f.viewer.ctx, { actionRequestId: held.requestId, correct: false }))).rejects.toThrow(/Missing permission/);
    // Agents can never be given the scope to report outcomes.
    await expect(run((db) => issueApiKey(db, f.ownerCtx, { name: "self-grader", subjectType: "agent", subjectId: f.agentId, scopes: ["outcomes:report"] }))).rejects.toThrow(/cannot report outcomes/);
    // 60 confident requests, half right: enough for calibration, which then shows the gap.
    for (let i = 0; i < 60; i++) {
      const r = await f.call({ amount: 40 + i, context: { confidence: 0.95 } });
      await run((db) => labelOutcome(db, f.ownerCtx, { actionRequestId: r.requestId, correct: i % 2 === 0 }));
    }
    const written = await run((db) => recomputeCalibration(db, f.ownerCtx));
    const overall = written.find((w) => w.agentId === f.agentId && w.toolKey === "*")!;
    expect(overall.report.status).toBe("calibrated");
    expect(overall.report.sampleSize).toBe(61);
    expect(overall.report.ece).toBeGreaterThan(0.3);
    // With requirements on, the calibrated accuracy (about 0.5) is what is compared with the minimum.
    await run((db) => updateToolUncertaintyPolicy(db, f.ownerCtx, refundToolId, { enabled: true, minConfidence: 0.8 }));
    await run((db) => db.policyAssignment.deleteMany({ where: { policy: { key: "unc-guard" } } }));
    const r = await f.call({ amount: 30, context: { confidence: 0.95 } });
    expect(r.decision).toBe("require_approval");
    const d = await run((db) => db.authorizationDecision.findFirstOrThrow({ where: { actionRequestId: r.requestId } }));
    expect((d.explanation as { uncertainty: { confidence: { basis: string } } }).uncertainty.confidence.basis).toBe("calibrated");
    const overview = await run((db) => uncertaintyOverview(db, f.ownerCtx));
    expect(overview.assessed).toBeGreaterThan(60);
    expect(overview.profiles.some((p) => p.toolKey === "*" && p.sampleSize === 61)).toBe(true);
  }, 120_000);
});
