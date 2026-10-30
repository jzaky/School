import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { disconnectAll, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { addUserWithRole } from "./helpers.js";
import { applyAutonomyLevel, compareAutonomy, stricterAutonomy, type AutonomyLevel, type PolicyOutcome } from "../src/autonomy/levels.js";
import { autonomyAnalytics, decideAutonomyRaise, downgradeTarget, getAgentAutonomy, lowerAutonomy, raiseEligibility, requestAutonomyRaise, simulateAutonomy, updateAutonomySettings, DEFAULT_AUTONOMY_SETTINGS } from "../src/autonomy/service.js";
import { decideApprovalAndExecute } from "../src/approvals/service.js";
import { verifyChain } from "../src/evidence/ledger.js";

const OUTCOMES: PolicyOutcome[] = ["allow", "restrict", "require_approval", "deny", "quarantine", "request_more_information", "error"];
/** Higher is stricter: what the agent may do without a person. */
const STRICTNESS: Record<PolicyOutcome, number> = { allow: 0, restrict: 1, require_approval: 2, request_more_information: 3, quarantine: 4, deny: 5, error: 5 };

describe("autonomy levels (pure)", () => {
  it("a level never makes a decision looser than policy, for any input", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0, 1, 2, 3, 4),
        fc.constantFrom(...OUTCOMES),
        fc.constantFrom("low", "medium", "high", "critical", "unexpected"),
        fc.option(fc.double({ min: 0, max: 1e9, noNaN: true }), { nil: null }),
        fc.option(fc.double({ min: 0, max: 1e9, noNaN: true }), { nil: null }),
        fc.boolean(),
        (level, policyOutcome, toolRisk, amount, ceiling, currencyMismatch) => {
          const r = applyAutonomyLevel({ level: level as AutonomyLevel, policyOutcome, toolRisk, amount, ceiling, currencyMismatch });
          expect(STRICTNESS[r.outcome]).toBeGreaterThanOrEqual(STRICTNESS[policyOutcome]);
          if (r.effect === "unchanged") expect(r.outcome).toBe(policyOutcome);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("enforces each level as documented", () => {
    const base = { toolRisk: "low", amount: 100, ceiling: 500 } as const;
    expect(applyAutonomyLevel({ ...base, level: 4, policyOutcome: "allow" }).outcome).toBe("allow");
    expect(applyAutonomyLevel({ ...base, level: 3, policyOutcome: "allow" }).outcome).toBe("allow");
    expect(applyAutonomyLevel({ ...base, level: 3, toolRisk: "high", policyOutcome: "allow" }).code).toBe("autonomy_tool_risk");
    expect(applyAutonomyLevel({ ...base, level: 3, amount: 900, policyOutcome: "allow" }).code).toBe("autonomy_above_ceiling");
    expect(applyAutonomyLevel({ ...base, level: 3, amount: 900, ceiling: null, policyOutcome: "allow" }).outcome).toBe("allow");
    expect(applyAutonomyLevel({ ...base, level: 2, policyOutcome: "allow" }).outcome).toBe("allow");
    expect(applyAutonomyLevel({ ...base, level: 2, toolRisk: "medium", policyOutcome: "allow" }).code).toBe("autonomy_tool_risk");
    expect(applyAutonomyLevel({ ...base, level: 2, ceiling: null, policyOutcome: "allow" }).code).toBe("autonomy_no_ceiling");
    expect(applyAutonomyLevel({ ...base, level: 2, amount: null, ceiling: null, policyOutcome: "allow" }).outcome).toBe("allow");
    expect(applyAutonomyLevel({ ...base, level: 2, currencyMismatch: true, policyOutcome: "allow" }).code).toBe("autonomy_currency");
    expect(applyAutonomyLevel({ ...base, level: 1, policyOutcome: "restrict" }).outcome).toBe("require_approval");
    expect(applyAutonomyLevel({ ...base, level: 0, policyOutcome: "require_approval" })).toMatchObject({ outcome: "deny", effect: "observe_only" });
    expect(applyAutonomyLevel({ ...base, level: 0, policyOutcome: "quarantine" }).outcome).toBe("quarantine");
  });

  it("orders level and ceiling changes and combines two agents strictly", () => {
    expect(compareAutonomy({ level: 1, ceiling: null }, { level: 3, ceiling: null })).toBe("stricter");
    expect(compareAutonomy({ level: 3, ceiling: 100 }, { level: 3, ceiling: null })).toBe("stricter");
    expect(compareAutonomy({ level: 2, ceiling: null }, { level: 2, ceiling: 100 })).toBe("stricter");
    expect(compareAutonomy({ level: 2, ceiling: 200 }, { level: 2, ceiling: 100 })).toBe("looser");
    expect(compareAutonomy({ level: 4, ceiling: 1 }, { level: 4, ceiling: 2 })).toBe("same");
    expect(stricterAutonomy({ level: 3, ceiling: 500 }, { level: 2, ceiling: null })).toEqual({ level: 2, ceiling: null });
    expect(stricterAutonomy({ level: 3, ceiling: null }, { level: 3, ceiling: 250 })).toEqual({ level: 3, ceiling: 250 });
  });

  it("downgrade rules only ever lower", () => {
    expect(downgradeTarget(4, { rule: "security_event", severity: "critical", securityEventType: "x", actionRequestId: null })).toBe(0);
    expect(downgradeTarget(4, { rule: "security_event", severity: "high", securityEventType: "x", actionRequestId: null })).toBe(1);
    expect(downgradeTarget(0, { rule: "security_event", severity: "high", securityEventType: "x", actionRequestId: null })).toBeNull();
    expect(downgradeTarget(3, { rule: "security_event", severity: "medium", securityEventType: "x", actionRequestId: null })).toBeNull();
    expect(downgradeTarget(3, { rule: "denial_burst", denials: 5, windowMinutes: 60, actionRequestId: null })).toBe(2);
    expect(downgradeTarget(1, { rule: "denial_burst", denials: 5, windowMinutes: 60, actionRequestId: null })).toBeNull();
    expect(downgradeTarget(4, { rule: "unknown_outcome", actionRequestId: "r" })).toBe(2);
    expect(downgradeTarget(2, { rule: "unknown_outcome", actionRequestId: "r" })).toBeNull();
  });
});

let f: GatewayFixture;
let controller: Awaited<ReturnType<typeof addUserWithRole>>;
const run = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(f.orgId, fn);
const level = async () => (await run((db) => db.agent.findUniqueOrThrow({ where: { id: f.agentId } }))).autonomyLevel;

beforeAll(async () => {
  f = await makeGatewayFixture();
  controller = await addUserWithRole(f, "security_analyst", "ctl");
}, 120_000);

afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});

describe("managed autonomy in the gateway", () => {
  it("level 4 is the default and leaves policy exactly as it was", async () => {
    expect(await level()).toBe(4);
    const r = await f.call({ amount: 120 });
    expect(r.decision).toBe("allow");
    expect(r.status).toBe("executed");
    const d = await run((db) => db.authorizationDecision.findFirstOrThrow({ where: { actionRequestId: r.requestId } }));
    expect((d.explanation as { autonomy: unknown }).autonomy).toMatchObject({ level: 4, policyOutcome: "allow", effect: "unchanged" });
  });

  it("lowering is immediate, recorded, and turns allowed actions into approvals at level 1", async () => {
    await expect(run((db) => lowerAutonomy(db, f.viewer.ctx, f.agentId, { level: 1, reason: "viewer tries" }))).rejects.toThrow(/Missing permission agents:control/);
    await expect(run((db) => lowerAutonomy(db, f.ownerCtx, f.agentId, { level: 4, reason: "same level" }))).rejects.toThrow(/already at that level/);
    await run((db) => lowerAutonomy(db, f.ownerCtx, f.agentId, { level: 1, reason: "new refund flow under review" }));
    expect(await level()).toBe(1);
    const r = await f.call({ amount: 120 });
    expect(r.decision).toBe("require_approval");
    expect(r.status).toBe("pending_approval");
    expect(r.reasons.join(" ")).toMatch(/Autonomy level 1/);
    const d = await run((db) => db.authorizationDecision.findFirstOrThrow({ where: { actionRequestId: r.requestId } }));
    expect((d.explanation as { autonomy: unknown }).autonomy).toMatchObject({ level: 1, policyOutcome: "allow", effect: "approval_required", code: "autonomy_every_action" });
    // The approval works like any other and executes the bound parameters.
    const a = await run((db) => db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: r.requestId } }));
    const decided = await decideApprovalAndExecute(run, f.approver.ctx, a.id, { decision: "approve", comment: "fine", requestHash: a.requestHash });
    expect(decided.status).toBe("approved");
    const after = await run((db) => db.actionRequest.findUniqueOrThrow({ where: { id: r.requestId } }));
    expect(after.status).toBe("executed");
  });

  it("never loosens a refusal or a quarantine", async () => {
    const big = await f.call({ amount: 6200 });
    expect(big.decision).toBe("deny");
  });

  it("level 0 executes nothing and records what policy would have done", async () => {
    await run((db) => lowerAutonomy(db, f.ownerCtx, f.agentId, { level: 0, reason: "observe before go-live" }));
    const r = await f.call({ amount: 120 });
    expect(r.decision).toBe("deny");
    expect(r.status).toBe("denied");
    expect(r.reasons.join(" ")).toMatch(/observe only/);
    const receipts = await run((db) => db.executionReceipt.count({ where: { actionRequestId: r.requestId } }));
    expect(receipts).toBe(0);
  });

  it("raising needs a second person; the requester cannot approve their own raise", async () => {
    await expect(run((db) => requestAutonomyRaise(db, f.ownerCtx, f.agentId, { level: 0, reason: "not a raise" }))).rejects.toThrow(/not more autonomy/);
    const req = await run((db) => requestAutonomyRaise(db, f.ownerCtx, f.agentId, { level: 3, ceilingAmount: 300, reason: "observed for a week without issues" }));
    await expect(run((db) => requestAutonomyRaise(db, f.ownerCtx, f.agentId, { level: 4, reason: "another one" }))).rejects.toThrow(/already waiting/);
    await expect(run((db) => decideAutonomyRaise(db, f.ownerCtx, req.id, { approve: true }))).rejects.toThrow(/different person/);
    expect(await level()).toBe(0);
    const out = await run((db) => decideAutonomyRaise(db, controller.ctx, req.id, { approve: true, note: "agreed" }));
    expect(out.transition?.toLevel).toBe(3);
    expect(await level()).toBe(3);
    // The refund tool is high risk, so level 3 still sends it to a person.
    const r = await f.call({ amount: 120 });
    expect(r.decision).toBe("require_approval");
    expect(r.reasons.join(" ")).toMatch(/high risk tools/);
  });

  it("level 2 lets low-risk tools act within the ceiling only", async () => {
    await run((db) => db.tool.updateMany({ where: { key: "issue-refund" }, data: { riskLevel: "low" } }));
    try {
      await run((db) => lowerAutonomy(db, f.ownerCtx, f.agentId, { level: 2, ceilingAmount: 300, reason: "tighten for the month end" }));
      expect((await f.call({ amount: 200 })).decision).toBe("allow");
      const above = await f.call({ amount: 350 });
      expect(above.decision).toBe("require_approval");
      expect(above.reasons.join(" ")).toMatch(/above the agent's ceiling/);
    } finally {
      await run((db) => db.tool.updateMany({ where: { key: "issue-refund" }, data: { riskLevel: "high" } }));
    }
  });

  it("history, simulation, eligibility and analytics come from recorded facts", async () => {
    const view = await run((db) => getAgentAutonomy(db, f.ownerCtx, f.agentId));
    expect(view.level).toBe(2);
    expect(view.history.map((h) => h.kind)).toEqual(["lowered", "raised", "lowered", "lowered"]);
    expect(view.requests[0]?.status).toBe("approved");
    const sim = await run((db) => simulateAutonomy(db, f.ownerCtx, f.agentId, { level: 1 }));
    expect(sim.total).toBeGreaterThan(0);
    expect(sim.simulated.autonomous).toBe(0);
    const sim4 = await run((db) => simulateAutonomy(db, f.ownerCtx, f.agentId, { level: 4 }));
    expect(sim4.simulated.autonomous).toBeGreaterThan(sim.simulated.autonomous);
    const elig = await run((db) => raiseEligibility(db, f.ownerCtx, f.agentId));
    expect(elig.checks.map((c) => c.key)).toEqual(["volume", "denials", "approvals", "security", "quiet"]);
    const stats = await run((db) => autonomyAnalytics(db, f.ownerCtx));
    expect(stats.transitionCounts.lowered).toBe(3);
    expect(stats.decisions.changedByLevel).toBeGreaterThanOrEqual(4);
    const chain = await withTenant(f.orgId, (db) => verifyChain(db, f.orgId), { readOnly: true });
    expect(chain.valid).toBe(true);
    const evidence = await run((db) => db.evidenceEvent.findMany({ where: { type: { startsWith: "autonomy." } }, select: { type: true } }));
    expect(new Set(evidence.map((e) => e.type))).toEqual(new Set(["autonomy.lowered", "autonomy.raise_requested", "autonomy.raised"]));
  });

  it("automatic downgrades are off by default and, when on, lower the level on a severe security event", async () => {
    await run((db) => lowerAutonomy(db, f.ownerCtx, f.agentId, { level: 2, ceilingAmount: 100, reason: "baseline for downgrade test" }));
    // Using a tool the agent was never granted is refused and raises a high-severity security event.
    const ungranted = { tool: "export-customer-records", action: "export", params: { destination: "warehouse.meridian-demo.example" } };
    const offRun = await f.call(ungranted);
    expect(offRun.decision).toBe("deny");
    expect(await level()).toBe(2);
    await run((db) => updateAutonomySettings(db, f.ownerCtx, { ...DEFAULT_AUTONOMY_SETTINGS, automaticDowngrades: true }));
    const raise = await run((db) => requestAutonomyRaise(db, controller.ctx, f.agentId, { level: 3, reason: "pending when the event happens" }));
    const onRun = await f.call(ungranted);
    expect(onRun.decision).toBe("deny");
    expect(await level()).toBe(1);
    const t = await run((db) => db.autonomyTransition.findFirstOrThrow({ where: { agentId: f.agentId }, orderBy: { createdAt: "desc" } }));
    expect(t).toMatchObject({ kind: "automatic_downgrade", fromLevel: 2, toLevel: 1, actorType: "system" });
    expect(t.reason).toMatch(/high security event/);
    expect((t.trigger as { actionRequestId: string }).actionRequestId).toBe(onRun.requestId);
    expect((await run((db) => db.autonomyChangeRequest.findUniqueOrThrow({ where: { id: raise.id } }))).status).toBe("cancelled");
    // A second high event cannot lower it further than level 1; the rule only ever lowers.
    await f.call(ungranted);
    expect(await level()).toBe(1);
  });

  it("a burst of refusals lowers the level by one, once per window", async () => {
    await run((db) => updateAutonomySettings(db, f.ownerCtx, { ...DEFAULT_AUTONOMY_SETTINGS, automaticDowngrades: true, onSecurityEvents: false, denialBurst: { count: 3, windowMinutes: 60 } }));
    const req = await run((db) => requestAutonomyRaise(db, f.ownerCtx, f.agentId, { level: 4, reason: "reset for the burst test" }));
    await run((db) => decideAutonomyRaise(db, controller.ctx, req.id, { approve: true }));
    expect(await level()).toBe(4);
    // Refunds above AED 2,500 are refused by policy; the window already holds earlier refusals.
    await f.call({ amount: 6000 });
    expect(await level()).toBe(3);
    await f.call({ amount: 6100 });
    expect(await level()).toBe(3);
  });

  it("transitions are append-only", async () => {
    await expect(run((db) => db.autonomyTransition.updateMany({ where: { agentId: f.agentId }, data: { reason: "rewritten" } }))).rejects.toThrow(/append-only/);
    await expect(run((db) => db.autonomyTransition.deleteMany({ where: { agentId: f.agentId } }))).rejects.toThrow(/append-only/);
  });
});
