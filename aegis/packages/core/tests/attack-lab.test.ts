import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { getLabRun, LAB_SCENARIOS, listLabRuns, runAttackSimulation } from "../src/security/lab.js";
import { listAgents } from "../src/agents/registry.js";
import type { TenantRunner } from "../src/gateway/gateway.js";

let f: GatewayFixture;
let runner: TenantRunner;

beforeAll(async () => {
  f = await makeGatewayFixture();
  runner = (fn) => withTenant(f.orgId, fn);
  // The lab starts from the target's own recent request.
  const seed = await f.call({ amount: 100 });
  if (seed.decision !== "allow") throw new Error(`fixture refund not allowed: ${seed.decision}`);
}, 120_000);

afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});

describe("Attack Simulation Lab", () => {
  it("only a person with security:write can start a run", async () => {
    await expect(runAttackSimulation(runner, f.viewer.ctx, { targetAgentId: f.agentId })).rejects.toThrow(/Missing permission security:write/);
    await expect(runAttackSimulation(runner, { ...f.agentCtx, actor: { ...f.agentCtx.actor, permissions: ["security:write"] } }, { targetAgentId: f.agentId })).rejects.toThrow(/Only a person/);
  });

  it("runs every scenario through the gateway as a clone, decision-only, and tears the clone down", async () => {
    const before = await runner((db) => db.incident.count());
    const notesBefore = await runner((db) => db.notification.count());
    const out = await runAttackSimulation(runner, f.ownerCtx, { targetAgentId: f.agentId });
    expect(out.status).toBe("completed");
    expect(out.control).toBe("allow");
    const run = await runner((db) => getLabRun(db, f.ownerCtx, out.runId));
    const by = Object.fromEntries(run.results.map((r) => [r.scenarioKey, r]));
    expect(Object.keys(by).sort()).toEqual(["control", ...LAB_SCENARIOS.map((s) => s.key)].sort());
    expect(run.results.filter((r) => r.outcome === "error")).toEqual([]);

    // Baseline controls that must hold whatever the organization's policies say.
    for (const key of ["ungranted_tool", "self_escalation", "self_approval", "delegation_abuse", "idempotency_reuse", "parameter_tampering", "grant_replay", "contradictory_rationale", "fabricated_citation", "expired_credential", "suspended_agent", "exfiltration_destination", "amount_inflation"]) {
      expect({ key, outcome: by[key]?.outcome }).toEqual({ key, outcome: "defended" });
    }
    expect(by.grant_replay?.observed).toMatch(/consumed/);
    expect(by.parameter_tampering?.observed).toMatch(/hash_mismatch/);
    // The fixture's refund policy has per-request limits only: five small parts of a large refund pass. Reported, not hidden.
    expect(by.split_amounts?.outcome).toBe("gap");
    expect(run.results.find((r) => r.scenarioKey === "split_amounts")?.remedy).toMatch(/daily total or velocity/);

    // Nothing executed downstream and the clone is gone from every agent list.
    const lab = await runner((db) => db.agent.findUniqueOrThrow({ where: { id: run.labAgentId! } }));
    expect(lab).toMatchObject({ isLab: true, status: "archived" });
    const receipts = await runner((db) => db.executionReceipt.findMany({ where: { request: { agentId: lab.id } } }));
    expect(receipts.every((r) => r.status !== "succeeded")).toBe(true);
    const live = await runner((db) => db.executionGrant.count({ where: { request: { agentId: lab.id }, consumedAt: null, voidedAt: null } }));
    expect(live).toBe(0);
    const pending = await runner((db) => db.approvalRequest.count({ where: { status: "pending", request: { agentId: lab.id } } }));
    expect(pending).toBe(0);
    const assignments = await runner((db) => db.policyAssignment.count({ where: { targetId: lab.id } }));
    expect(assignments).toBe(0);
    const agents = await runner((db) => listAgents(db, f.ownerCtx, { page: 1, pageSize: 100 }));
    expect(agents.items.some((a) => a.id === lab.id)).toBe(false);

    // Lab traffic is on the evidence record but opens no incident and notifies nobody.
    expect(await runner((db) => db.incident.count())).toBe(before);
    expect(await runner((db) => db.notification.count())).toBe(notesBefore);
    const events = await runner((db) => db.securityEvent.findMany({ where: { agentId: lab.id } }));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.title.startsWith("[lab]"))).toBe(true);
    const ledger = await runner((db) => db.evidenceEvent.findMany({ where: { subjectType: "attack_simulation_run", subjectId: out.runId } }));
    expect(ledger.map((e) => e.type).sort()).toEqual(["lab.run_completed", "lab.run_started"]);
    // The target agent is untouched.
    const target = await runner((db) => db.agent.findUniqueOrThrow({ where: { id: f.agentId } }));
    expect(target.status).toBe("active");
  }, 120_000);

  it("results are append-only and runs are listed for security readers", async () => {
    const runs = await runner((db) => listLabRuns(db, f.ownerCtx));
    expect(runs[0]?.target?.id).toBe(f.agentId);
    await expect(runner((db) => db.attackSimulationResult.updateMany({ where: { runId: runs[0]!.id }, data: { outcome: "defended" } }))).rejects.toThrow();
    await expect(runner((db) => listLabRuns(db, { ...f.viewer.ctx, actor: { ...f.viewer.ctx.actor, permissions: ["org:read"] } }))).rejects.toThrow(/security:read/);
  });

  it("a lab clone of a suspended or lab agent is refused", async () => {
    const lab = await runner((db) => db.agent.findFirstOrThrow({ where: { isLab: true } }));
    await expect(runAttackSimulation(runner, f.ownerCtx, { targetAgentId: lab.id })).rejects.toThrow(/not found/i);
  });
});
