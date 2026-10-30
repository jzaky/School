import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, rawPrisma, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { labRegressions, readLabSchedule, runScheduledLabs, setLabSchedule } from "../src/security/lab-schedule.js";
import type { TenantRunner } from "../src/gateway/gateway.js";

let f: GatewayFixture;
let runner: TenantRunner;

beforeAll(async () => {
  f = await makeGatewayFixture();
  runner = (fn) => withTenant(f.orgId, fn);
  const seed = await f.call({ amount: 100 });
  if (seed.decision !== "allow") throw new Error(`fixture refund not allowed: ${seed.decision}`);
}, 120_000);

afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});

describe("continuous attack simulation", () => {
  it("only a person with security:write can set the schedule, for this organization's own agents", async () => {
    await expect(runner((db) => setLabSchedule(db, f.viewer.ctx, { enabled: true, agentIds: [f.agentId] }))).rejects.toThrow(/security:write/);
    await expect(runner((db) => setLabSchedule(db, { ...f.agentCtx, actor: { ...f.agentCtx.actor, permissions: ["security:write"] } }, { enabled: true, agentIds: [f.agentId] }))).rejects.toThrow(/Only a person/);
    await expect(runner((db) => setLabSchedule(db, f.ownerCtx, { enabled: true, agentIds: [] }))).rejects.toThrow(/at least one agent/);
    await expect(runner((db) => setLabSchedule(db, f.ownerCtx, { enabled: true, agentIds: ["00000000-0000-4000-8000-000000000000"] }))).rejects.toThrow(/registered agent/);
  });

  it("runs a scheduled agent once per interval, and nothing while the schedule is off", async () => {
    expect(await runScheduledLabs(runner, f.orgId)).toEqual([]);
    await runner((db) => setLabSchedule(db, f.ownerCtx, { enabled: true, agentIds: [f.agentId], everyHours: 24 }));
    const settings = (await rawPrisma().organization.findUniqueOrThrow({ where: { id: f.orgId } })).settings;
    expect(readLabSchedule(settings)).toMatchObject({ enabled: true, everyHours: 24, agentIds: [f.agentId] });
    const first = await runScheduledLabs(runner, f.orgId);
    expect(first).toHaveLength(1);
    expect(first[0]!.status).toBe("ran");
    const run = await runner((db) => db.attackSimulationRun.findUniqueOrThrow({ where: { id: first[0]!.runId! } }));
    expect(run.status).toBe("completed");
    expect((run.summary as { scheduled?: boolean }).scheduled).toBe(true);
    // Within the interval the agent is not due again.
    expect((await runScheduledLabs(runner, f.orgId))[0]!.status).toBe("not_due");
    // A day later it runs again; with nothing changed there is no regression.
    const later = await runScheduledLabs(runner, f.orgId, new Date(Date.now() + 25 * 3_600_000));
    expect(later[0]!.status).toBe("ran");
    expect(later[0]!.regressions).toEqual([]);
    // A previous run in which one of today's gaps was still defended, as before a control weakened (lab results
    // are append-only, so it is a separate run): the next scheduled run raises a high-severity security event.
    const gap = await runner((db) => db.attackSimulationResult.findFirst({ where: { runId: later[0]!.runId!, outcome: "gap" } }));
    expect(gap, "the fixture's configuration leaves at least one gap").toBeTruthy();
    await runner(async (db) => {
      const prior = await db.attackSimulationRun.create({ data: { orgId: f.orgId, targetAgentId: f.agentId, status: "completed", scenarioKeys: [gap!.scenarioKey], summary: { scheduled: false }, startedAt: new Date(), completedAt: new Date() } });
      await db.attackSimulationResult.create({ data: { orgId: f.orgId, runId: prior.id, scenarioKey: gap!.scenarioKey, category: gap!.category, outcome: "defended", expected: gap!.expected, observed: "Refused (earlier configuration)" } });
    });
    const next = await runScheduledLabs(runner, f.orgId, new Date(Date.now() + 49 * 3_600_000));
    expect(next[0]!.regressions).toContain(gap!.scenarioKey);
    const ev = await runner((db) => db.securityEvent.findFirst({ where: { type: "lab.regression", agentId: f.agentId }, orderBy: { createdAt: "desc" } }));
    expect(ev?.severity).toBe("high");
    expect((ev?.detail as { scenarios: string[] }).scenarios).toContain(gap!.scenarioKey);
    await runner((db) => setLabSchedule(db, f.ownerCtx, { enabled: false, agentIds: [f.agentId] }));
    expect(await runScheduledLabs(runner, f.orgId, new Date(Date.now() + 80 * 3_600_000))).toEqual([]);
  }, 180_000);

  it("a scenario defended last time and a gap now is a regression", () => {
    expect(labRegressions({ a: "defended", b: "gap", c: "defended", d: "inconclusive" }, { a: "gap", b: "gap", c: "defended", d: "gap" })).toEqual(["a"]);
  });
});
