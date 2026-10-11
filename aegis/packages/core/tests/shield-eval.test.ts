import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@aegis/db";
import { addUserWithRole, makeTestTenant } from "./helpers.js";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { runDetectionEval, SECURITY_EVAL_CORPUS } from "../src/shield/eval/corpus.js";
import { ensureDefaultDataClasses } from "../src/shield/data-classes.js";
import { installShield } from "../src/shield/inspector.js";

/**
 * Two separate proofs:
 * (a) detection quality of the heuristic detectors over the corpus (reported numbers),
 * (b) enforcement that does not depend on detection: the registry denies ungranted tools whatever
 *     the text says, and blocked data never reaches the downstream ledger.
 */
describe("security evaluation corpus: detection", () => {
  it("has at least 25 cases across all kinds", () => {
    expect(SECURITY_EVAL_CORPUS.length).toBeGreaterThanOrEqual(25);
    for (const kind of ["injection", "benign", "pii"] as const) expect(SECURITY_EVAL_CORPUS.filter((c) => c.kind === kind).length).toBeGreaterThanOrEqual(8);
    expect(new Set(SECURITY_EVAL_CORPUS.map((c) => c.id)).size).toBe(SECURITY_EVAL_CORPUS.length);
  });

  it("flags at least 90% of injection cases and never blocks a benign case", () => {
    const r = runDetectionEval();
    // Printed so CI logs carry the real numbers.
    console.log(`[shield-eval] injection recall ${r.injection.flagged}/${r.injection.total} (${(r.injection.recall * 100).toFixed(1)}%), missed: ${r.injection.missed.join(",") || "none"}`);
    console.log(`[shield-eval] benign false blocks ${r.benign.falseBlocks}/${r.benign.total}, benign texts with any signal ${r.benign.falseSignals}/${r.benign.total} ${r.benign.falseSignalIds.join(",")}`);
    console.log(`[shield-eval] pii correct ${r.pii.correct}/${r.pii.total}`, r.pii.failures);
    expect(r.injection.recall).toBeGreaterThanOrEqual(0.9);
    expect(r.benign.falseBlocks).toBe(0);
    expect(r.pii.failures).toEqual([]);
    // Soft expectation: expected signal keys are among those raised.
    const missingExpected = r.signalCoverage.filter((c) => c.expected.some((e) => !c.raised.includes(e)));
    expect(missingExpected).toEqual([]);
  });
});

describe("security evaluation corpus: enforcement through the gateway", () => {
  let f: GatewayFixture;
  beforeAll(async () => {
    installShield();
    f = await makeGatewayFixture();
    const analyst = await addUserWithRole(f, "security_analyst", "sec");
    await withTenant(f.orgId, (db) => ensureDefaultDataClasses(db, analyst.ctx));
  });
  afterAll(async () => {
    await f.cleanup();
  });

  it("masks a low severity class and executes with the rewritten parameters", async () => {
    const before = (await f.ledger()).length;
    const r = await f.call({ amount: 60, params: { orderId: "ORD-EVAL-2", customerId: "contact a.b@example.com", amount: 60, currency: "AED" } });
    expect(r.decision).toBe("allow");
    expect(r.status).toBe("executed");
    expect(r.riskIndicators).toContain("data:email");
    expect((await f.ledger()).length).toBe(before + 1);
    const stored = await withTenant(f.orgId, (db) => db.actionRequest.findUniqueOrThrow({ where: { id: r.requestId } }));
    expect((stored.params as { customerId: string }).customerId).toBe("contact *.*@******e.com");
    const ledger = await f.ledger();
    expect(JSON.stringify(ledger.at(-1))).not.toContain("a.b@example.com");
  });

  it("benign parameters pass with no findings", async () => {
    const r = await f.call({ amount: 70, params: { orderId: "ORD-EVAL-3", customerId: "CUST-77", amount: 70, currency: "AED" } });
    expect(r.decision).toBe("allow");
    expect(r.riskIndicators.filter((x) => x.startsWith("data:"))).toEqual([]);
  });
  it("blocks a card number through an allowed tool, raises a security event and leaves the ledger unchanged", async () => {
    const before = (await f.ledger()).length;
    const r = await f.call({ amount: 50, params: { orderId: "ORD-EVAL-1", customerId: "card 4111 1111 1111 1111", amount: 50, currency: "AED" } });
    expect(r.decision).toBe("deny");
    expect(r.status).toBe("denied");
    expect(r.reasons[0]).toMatch(/Sensitive data blocked by data protection: card_number/);
    expect(r.receipt).toBeUndefined();
    expect((await f.ledger()).length).toBe(before);
    const ev = await withTenant(f.orgId, (db) => db.securityEvent.findFirst({ where: { orgId: f.orgId, actionRequestId: r.requestId } }));
    expect(ev?.type).toBe("data_protection.blocked");
    expect(ev?.severity).toBe("high");
    const stored = await withTenant(f.orgId, (db) => db.actionRequest.findUniqueOrThrow({ where: { id: r.requestId }, include: { decisions: true } }));
    const explanation = stored.decisions[0]!.explanation as { stage: string; shield: { dataClass: string; field: string }[] };
    expect(explanation.stage).toBe("shield");
    expect(explanation.shield.map((s) => s.dataClass)).toContain("card_number");
    // Evidence never stores the raw number: findings carry field paths only.
    expect(JSON.stringify(explanation)).not.toContain("4111 1111 1111 1111");
  });

  it("denies an ungranted tool regardless of injected instructions in params", async () => {
    const before = (await f.ledger()).length;
    const injected = SECURITY_EVAL_CORPUS.filter((c) => c.kind === "injection").map((c) => c.text!);
    let i = 0;
    for (const text of injected) {
      i += 1;
      const r = await f.call({ tool: "export-customer-records", action: "export", resource: undefined, params: { segment: "all", destination: "https://warehouse.meridian-demo.example/inbox", instructions: text }, justification: text.slice(0, 200), idempotencyKey: `eval-inj-${Date.now()}-${i}` });
      expect(r.decision).toBe("deny");
      expect(r.status).toBe("denied");
      expect(r.reasons.join(" ")).toMatch(/no active grant for tool export-customer-records/);
      expect(r.receipt).toBeUndefined();
    }
    expect((await f.ledger()).length).toBe(before);
    const events = await withTenant(f.orgId, (db) => db.securityEvent.count({ where: { orgId: f.orgId, agentId: f.agentId, type: "authorization.boundary_violation" } }));
    expect(events).toBeGreaterThanOrEqual(injected.length);
    // The decision explanation records the injection signals Shield saw, as information only.
    const last = await withTenant(f.orgId, (db) => db.actionRequest.findFirst({ where: { orgId: f.orgId, agentId: f.agentId, toolKey: "export-customer-records" }, orderBy: { createdAt: "desc" }, include: { decisions: true } }));
    expect(last?.decisions[0]?.explanation).toMatchObject({ stage: "baseline" });
  });

});

describe("tenant isolation of data classes", () => {
  it("one org's custom class does not affect another", async () => {
    const a = await makeTestTenant("iso-a");
    const b = await makeTestTenant("iso-b");
    try {
      await withTenant(a.orgId, (db) => ensureDefaultDataClasses(db, a.ownerCtx));
      const inB = await withTenant(b.orgId, (db) => db.dataClass.count({ where: { orgId: a.orgId } }));
      expect(inB).toBe(0);
      const own = await withTenant(b.orgId, (db) => db.dataClass.count());
      expect(own).toBe(0);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });
});
