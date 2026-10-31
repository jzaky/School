import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { addUserWithRole, makeTestTenant } from "./helpers.js";
import { archiveLabScenario, createLabScenario, getLabScenarioVersions, judgeCustom, LAB_SCENARIO_TEMPLATES, listLabScenarios, runnableScenarios, updateLabScenario } from "../src/security/lab-scenarios.js";
import { getLabRun, runAttackSimulation } from "../src/security/lab.js";
import { runScheduledLabs, setLabSchedule } from "../src/security/lab-schedule.js";
import type { TenantRunner } from "../src/gateway/gateway.js";
import { makeContext } from "../src/lib/context.js";

let f: GatewayFixture;
let runner: TenantRunner;
const run = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(f.orgId, fn);
let analyst: Awaited<ReturnType<typeof addUserWithRole>>;
const create = (key: string, definition: Record<string, unknown>, ctx = analyst.ctx) => run((db) => createLabScenario(db, ctx, { key, name: `Scenario ${key}`, definition }));

beforeAll(async () => {
  f = await makeGatewayFixture();
  runner = (fn) => withTenant(f.orgId, fn);
  analyst = await addUserWithRole(f, "security_analyst", "analyst");
  const seed = await f.call({ amount: 100 });
  if (seed.decision !== "allow") throw new Error(`fixture refund not allowed: ${seed.decision}`);
}, 120_000);
afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});

describe("custom lab scenarios: permissions and validation", () => {
  it("a person with security:write creates scenarios; a viewer and an agent cannot; reading needs a console user", async () => {
    const def = { expected: "allow" };
    await expect(create("viewer-try", def, f.viewer.ctx)).rejects.toThrow(/security:write/);
    await expect(create("agent-try", def, { ...f.agentCtx, actor: { ...f.agentCtx.actor, permissions: ["security:write"] } })).rejects.toThrow(/Only a person/);
    const s = await create("perm-ok", def);
    expect(s.currentVersion).toBe(1);
    await expect(run((db) => listLabScenarios(db, f.agentCtx))).rejects.toThrow(/console users/);
    expect((await run((db) => listLabScenarios(db, f.viewer.ctx))).some((x) => x.key === "perm-ok")).toBe(true);
  });

  it("a definition cannot choose identity, execution mode, idempotency, principal or delegation, and is size-limited", async () => {
    for (const extra of [{ executionMode: "gateway" }, { onBehalfOf: { agentId: f.agentId } }, { idempotencyKey: "x" }, { principal: { type: "user" } }, { agentId: f.agentId }]) {
      await expect(create(`bad-${Object.keys(extra)[0]!.toLowerCase()}`, { expected: "deny", ...extra })).rejects.toThrow();
    }
    await expect(create("bad-params-shape", { expected: "deny", params: { mode: "patch", values: {}, executionMode: "gateway" } })).rejects.toThrow();
    await expect(create("too-big", { expected: "deny", params: { mode: "patch", values: { blob: "x".repeat(3900), b: "x".repeat(3900), c: "x".repeat(3900), d: "x".repeat(3900), e: "x".repeat(3900) } } })).rejects.toThrow(/16000/);
    await expect(create("bad-target", { expected: "deny", target: { agentIds: ["00000000-0000-4000-8000-000000000000"] } })).rejects.toThrow(/registered agent/);
  });

  it("every change is a new immutable version, and archived scenarios no longer run", async () => {
    const s = await create("versioned", { expected: "deny" });
    await run((db) => updateLabScenario(db, analyst.ctx, s.id, { definition: { expected: "not_allowed" }, note: "Any refusal or hold counts" }));
    const v = await run((db) => getLabScenarioVersions(db, analyst.ctx, s.id));
    expect(v.currentVersion).toBe(2);
    expect(v.versions.map((x) => x.version)).toEqual([2, 1]);
    await expect(run((db) => db.labScenarioVersion.update({ where: { id: v.versions[1]!.id }, data: { note: "rewritten" } }))).rejects.toThrow(/append-only/);
    await run((db) => archiveLabScenario(db, analyst.ctx, s.id, "No longer relevant"));
    await expect(run((db) => runnableScenarios(db, f.orgId, f.agentId, [s.id]))).rejects.toThrow(/active scenario/);
  });

  it("templates are valid starting points", () => {
    expect(LAB_SCENARIO_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    expect(LAB_SCENARIO_TEMPLATES.map((t) => t.key)).toContain("routine-request");
  });
});

describe("custom lab scenarios: execution", () => {
  it("runs through the decision-only clone, judges expected against actual, and records version and evidence", async () => {
    const over = await create("big-refund", { params: { mode: "patch", values: { amount: 9_999_999 } }, expected: "not_allowed", context: { lab: false, note: "tries to unset the lab marker" } });
    const routine = await create("routine", { expected: "allow" });
    const wrong = await create("expects-deny-gets-allow", { expected: "deny" });
    const ledgerBefore = (await f.ledger()).length;
    const out = await runAttackSimulation(runner, f.ownerCtx, { targetAgentId: f.agentId, includeBuiltIn: false, customScenarioIds: [over.id, routine.id, wrong.id] });
    expect(out.status).toBe("completed");
    const r = await run((db) => getLabRun(db, f.ownerCtx, out.runId));
    const by = Object.fromEntries(r.results.map((x) => [x.scenarioKey, x]));
    expect(by["custom:big-refund"]).toMatchObject({ outcome: "defended", category: "custom" });
    expect(by["custom:routine"]?.outcome).toBe("defended");
    expect(by["custom:expects-deny-gets-allow"]?.outcome).toBe("gap");
    expect(by["custom:big-refund"]!.detail).toMatchObject({ scenarioId: over.id, version: 1, expected: "not_allowed" });
    expect(r.scenarioKeys).toEqual(expect.arrayContaining(["custom:big-refund@v1", "custom:routine@v1"]));

    // Safety: the request came from the temporary lab clone, in agent mode, with the lab marker intact, and
    // nothing reached the downstream system.
    const reqId = by["custom:big-refund"]!.actionRequestIds[0]!;
    const req = await run((db) => db.actionRequest.findUniqueOrThrow({ where: { id: reqId }, include: { agent: true } }));
    expect(req.agent.isLab).toBe(true);
    expect(req.agentId).not.toBe(f.agentId);
    expect(req.context).toMatchObject({ lab: true, executionMode: "agent" });
    expect(await run((db) => db.executionReceipt.count({ where: { actionRequestId: { in: r.results.flatMap((x) => x.actionRequestIds) } } }))).toBe(0);
    expect((await f.ledger()).length).toBe(ledgerBefore);
    const lab = await run((db) => db.agent.findUniqueOrThrow({ where: { id: req.agentId } }));
    expect(lab.status).toBe("archived");
    const ev = await run((db) => db.evidenceEvent.findFirst({ where: { type: "lab.run_completed", subjectId: out.runId } }));
    expect(ev).not.toBeNull();
  }, 180_000);

  it("a scheduled run includes the active custom scenarios that apply to the agent", async () => {
    await create("scheduled-check", { expected: "not_allowed", params: { mode: "patch", values: { amount: 8_888_888 } }, target: { agentIds: [f.agentId] } });
    await run((db) => setLabSchedule(db, f.ownerCtx, { enabled: true, agentIds: [f.agentId], everyHours: 24 }));
    const res = await runScheduledLabs(runner, f.orgId, new Date(Date.now() + 30 * 24 * 3_600_000));
    expect(res[0]!.status).toBe("ran");
    const r = await run((db) => getLabRun(db, f.ownerCtx, res[0]!.runId!));
    expect(r.results.map((x) => x.scenarioKey)).toContain("custom:scheduled-check");
    await run((db) => setLabSchedule(db, f.ownerCtx, { enabled: false, agentIds: [f.agentId] }));
  }, 180_000);

  it("judges outcomes: a refusal where any refusal was expected defends, an allow where a refusal was expected is a gap", () => {
    expect(judgeCustom("not_allowed", "require_approval")).toBe("defended");
    expect(judgeCustom("not_allowed", "restrict")).toBe("gap");
    expect(judgeCustom("deny", "require_approval")).toBe("inconclusive");
    expect(judgeCustom("allow", "deny")).toBe("inconclusive");
    expect(judgeCustom("quarantine", "quarantine")).toBe("defended");
  });
});

describe("custom lab scenarios: organization isolation", () => {
  it("another organization cannot see, run or change a scenario", async () => {
    const mine = await create("isolated", { expected: "deny" });
    const other = await makeTestTenant("lab-other");
    try {
      const otherAnalyst = await addUserWithRole(other, "security_analyst", "oa");
      expect(await withTenant(other.orgId, (db) => listLabScenarios(db, otherAnalyst.ctx))).toEqual([]);
      expect(await withTenant(other.orgId, (db) => db.labScenario.count({ where: { id: mine.id } }))).toBe(0);
      await expect(withTenant(other.orgId, (db) => updateLabScenario(db, otherAnalyst.ctx, mine.id, { definition: { expected: "allow" }, note: "take over" }))).rejects.toThrow(/not found/i);
      await expect(withTenant(other.orgId, (db) => runnableScenarios(db, other.orgId, f.agentId, [mine.id]))).rejects.toThrow(/active scenario/);
      // Even a forged context naming the first organization cannot read across: row-level security scopes the query.
      const forged = makeContext(f.orgId, { type: "user", id: otherAnalyst.userId, permissions: ["security:read"] });
      expect(await withTenant(other.orgId, (db) => listLabScenarios(db, forged))).toEqual([]);
    } finally {
      await other.cleanup();
    }
  });
});
