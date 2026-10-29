import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withTenant } from "@aegis/db";
import { addUserWithRole, makeTestTenant, type TestTenant } from "./helpers.js";
import { makeContext } from "../src/lib/context.js";
import { authorizeAndExecute } from "../src/gateway/gateway.js";
import { updateAgent } from "../src/agents/registry.js";
import { SHARED_FRAMEWORKS } from "../src/seed/frameworks/index.js";
import { SECTOR_PACKS } from "../src/validation/sector-lab.js";
import { PILOT_KITS, installPilotKit, pilotReport } from "../src/pilots/kits.js";
import { readWatchOnly, setWatchOnly } from "../src/pilots/watch-only.js";
import { updateInjectionResponse } from "../src/shield/injection-response.js";

const pack = SECTOR_PACKS.find((p) => p.key === "government")!;
const caseParams = (id: string) => pack.cases.find((c) => c.id === id)!.params;

describe("pilot kits and watch-only mode", () => {
  let t: TestTenant;
  let agentId: string;
  const started = new Date(Date.now() - 60_000);
  let n = 0;
  const call = (tool: string, params: Record<string, unknown>) =>
    authorizeAndExecute(withTenant, makeContext(t.orgId, { type: "agent", id: agentId, label: "procurement-payments-agent" }), { tool, action: "execute", params, context: {}, justification: "", idempotencyKey: `pilot-${Date.now()}-${++n}`, principal: { type: "system" }, executionMode: "agent" });

  beforeAll(async () => {
    t = await makeTestTenant("pilot");
  }, 60_000);
  afterAll(async () => {
    await t.cleanup();
    await disconnectAll();
  });

  it("offers one kit per sector, each mapped to seeded framework catalogs", () => {
    expect(PILOT_KITS.map((k) => k.key)).toEqual(SECTOR_PACKS.map((p) => p.key));
    const keys = new Set(SHARED_FRAMEWORKS.map((f) => f.key));
    for (const k of PILOT_KITS) {
      expect(k.scenarios.length, k.key).toBeGreaterThan(2);
      for (const f of k.frameworks) expect(keys.has(f), `${k.key} -> ${f}`).toBe(true);
    }
  });

  it("installs a kit with its agent in watch-only mode, and repeating the install changes nothing", async () => {
    const first = await withTenant(t.orgId, (db) => installPilotKit(db, t.ownerCtx, "government"));
    expect(first.agents).toEqual([expect.objectContaining({ slug: "procurement-payments-agent", created: true, watchOnly: true })]);
    expect(first.policies).toEqual([{ key: "public-payment-authority", created: true }]);
    agentId = first.agents[0]!.id;
    const again = await withTenant(t.orgId, (db) => installPilotKit(db, t.ownerCtx, "government"));
    expect(again.agents[0]).toMatchObject({ id: agentId, created: false, watchOnly: true });
    expect(again.policies[0]!.created).toBe(false);
  });

  it("in watch-only mode the action proceeds, the record keeps what AEGIS would have done, and no approval is opened", async () => {
    const r = await call("release-contractor-payment", caseParams("gov-bank-change"));
    expect(r.status).toBe("allowed");
    expect(r.decision).toBe("require_approval");
    expect(r.watchOnly).toEqual({ wouldHave: "require_approval" });
    expect(r.grant?.token).toBeTruthy();
    expect(r.riskIndicators).toContain("watch_only:require_approval");
    const approvals = await withTenant(t.orgId, (db) => db.approvalRequest.count({ where: { actionRequestId: r.requestId } }));
    expect(approvals).toBe(0);
    await withTenant(t.orgId, (db) => updateInjectionResponse(db, t.ownerCtx, { response: "quarantine", signals: [] }));
    const injected = await call("release-contractor-payment", caseParams("gov-hidden-instruction"));
    expect(injected.status).toBe("allowed");
    expect(injected.watchOnly?.wouldHave).toBe("quarantine");
    const events = await withTenant(t.orgId, (db) => db.securityEvent.count({ where: { orgId: t.orgId, agentId } }));
    expect(events).toBeGreaterThan(0);
  });

  it("never relaxes hard controls: a tool the agent was not granted is still refused", async () => {
    const r = await call("export-patient-data", { cohort: "COH-SYN-1", recordCount: 1, destination: "https://records.health-lab.example/x" });
    expect(r.status).toBe("denied");
    expect(r.watchOnly).toBeUndefined();
  });

  it("only a person with policy activation rights turns it on; ordinary edits cannot; turning it off enforces again", async () => {
    const approver = await addUserWithRole(t, "approver", "appr");
    await expect(withTenant(t.orgId, (db) => setWatchOnly(db, approver.ctx, agentId, { enabled: true, reason: "try it" }))).rejects.toThrow(/policies:activate/);
    await withTenant(t.orgId, (db) => setWatchOnly(db, t.ownerCtx, agentId, { enabled: false, reason: "watch period over" }));
    await withTenant(t.orgId, (db) => updateAgent(db, t.ownerCtx, agentId, { metadata: { watchOnly: { enabled: true, since: new Date().toISOString(), by: null, reason: "sneaky" } } }));
    const meta = await withTenant(t.orgId, (db) => db.agent.findUniqueOrThrow({ where: { id: agentId }, select: { metadata: true } }));
    expect(readWatchOnly(meta.metadata)).toBeNull();
    const r = await call("release-contractor-payment", caseParams("gov-bank-change"));
    expect(r.status).toBe("pending_approval");
    expect(r.watchOnly).toBeUndefined();
    await expect(withTenant(t.orgId, (db) => setWatchOnly(db, t.ownerCtx, agentId, { enabled: true, reason: "" }))).rejects.toThrow(/reason/);
  });

  it("the pilot report comes from the organization's own records", async () => {
    const report = await withTenant(t.orgId, (db) => pilotReport(db, t.ownerCtx, { from: started, to: new Date(Date.now() + 60_000), agentIds: [agentId] }));
    expect(report.actions.total).toBe(4);
    expect(report.watchOnly).toEqual({ passed: 2, wouldHave: { require_approval: 1, quarantine: 1 } });
    expect(report.approvals.total).toBe(1);
    expect(report.executedWithoutPermission).toBe(0);
    expect(report.ledger.valid).toBe(true);
    expect(report.security.total).toBeGreaterThan(0);
    await expect(withTenant(t.orgId, (db) => pilotReport(db, t.ownerCtx, { from: new Date(), to: started }))).rejects.toThrow(/end after/);
  });
});
