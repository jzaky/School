import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { ensureDefaultMonitoringRules, listAlerts, runMonitoring, updateMonitoringRule } from "../src/monitoring/service.js";
import { DEFAULT_AUTO_RESPONSES, readContinuousGovernance, responseOptionsForRule, setContinuousGovernance } from "../src/governance/continuous.js";
import { getOrganization } from "../src/orgs/orgs.js";
import { gatewayPausedState, resumeGateway } from "../src/gateway/gateway.js";
import { transitionAgent } from "../src/agents/registry.js";

let f: GatewayFixture;
beforeAll(async () => {
  f = await makeGatewayFixture();
  await withTenant(f.orgId, async (db) => {
    await ensureDefaultMonitoringRules(db, f.ownerCtx);
    // Make RM-001 fire on the first denial so each test can trigger it with one call.
    const rule = await db.monitoringRule.findUniqueOrThrow({ where: { orgId_key: { orgId: f.orgId, key: "RM-001" } } });
    await updateMonitoringRule(db, f.ownerCtx, rule.id, { definition: { type: "repeated_denials", threshold: 1, windowMinutes: 1440 } });
  });
});
afterAll(async () => {
  await f.cleanup();
});

describe("continuous governance", () => {
  it("defaults to assisted mode and validates responses per rule", async () => {
    const org = await getOrganization(f.orgId);
    expect(readContinuousGovernance(org.settings).mode).toBe("assisted");
    expect(responseOptionsForRule("RM-001")).toContain("suspend_agent");
    expect(responseOptionsForRule("RM-010")).not.toContain("suspend_agent");
    await expect(setContinuousGovernance(f.ownerCtx, { mode: "continuous", responses: { "RM-010": "suspend_agent" } })).rejects.toThrow(/not available/);
    await expect(setContinuousGovernance(f.viewer.ctx, { mode: "continuous", responses: {} })).rejects.toThrow(/org:admin/);
  });

  it("assisted mode raises the alert but takes no action", async () => {
    await f.call({ amount: 9000 }); // above the policy limit: denied
    const r = await withTenant(f.orgId, (db) => runMonitoring(db, f.ownerCtx));
    expect(r.newAlerts).toBeGreaterThanOrEqual(1);
    expect(r.autoResponses).toBe(0);
    const agent = await withTenant(f.orgId, (db) => db.agent.findUniqueOrThrow({ where: { id: f.agentId } }));
    expect(agent.status).toBe("active");
  });

  it("continuous mode suspends the agent the alert names, once, with evidence and a notification", async () => {
    await setContinuousGovernance(f.ownerCtx, { mode: "continuous", responses: DEFAULT_AUTO_RESPONSES });
    // The dedupe key of the assisted-mode alert would otherwise suppress a new RM-001 alert in this window.
    await withTenant(f.orgId, (db) => db.alert.deleteMany({ where: { orgId: f.orgId } }));
    await f.call({ amount: 9100 });
    const r = await withTenant(f.orgId, (db) => runMonitoring(db, f.ownerCtx));
    expect(r.newAlerts).toBeGreaterThanOrEqual(1);
    expect(r.autoResponses).toBe(1);
    const agent = await withTenant(f.orgId, (db) => db.agent.findUniqueOrThrow({ where: { id: f.agentId } }));
    expect(agent.status).toBe("suspended");
    expect(agent.statusReason).toMatch(/Automatic response to RM-001/);
    const alerts = await withTenant(f.orgId, (db) => listAlerts(db, f.ownerCtx, { status: "open", page: 1, pageSize: 50 }));
    const alert = alerts.items.find((a) => a.title.startsWith("RM-001") && (a.detail as Record<string, unknown>).autoResponse);
    expect(alert).toBeDefined();
    const record = (alert!.detail as { autoResponse: { action: string; outcome: string } }).autoResponse;
    expect(record.action).toBe("suspend_agent");
    expect(record.outcome).toBe("applied");
    const evidence = await withTenant(f.orgId, (db) => db.evidenceEvent.findMany({ where: { orgId: f.orgId, type: "governance.auto_response" } }));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.actorType).toBe("system");
    const notes = await withTenant(f.orgId, (db) => db.notification.findMany({ where: { orgId: f.orgId, type: "governance.auto_response" } }));
    expect(notes.length).toBeGreaterThanOrEqual(1);
    // Running again raises nothing new and acts again on nothing.
    const again = await withTenant(f.orgId, (db) => runMonitoring(db, f.ownerCtx));
    expect(again.newAlerts).toBe(0);
    expect(again.autoResponses).toBe(0);
    // A person resumes the agent; the suspension is reversible.
    await withTenant(f.orgId, (db) => transitionAgent(db, f.ownerCtx, f.agentId, "active", "resume after review"));
  });

  it("pause gateway response pauses once and skips when already paused", async () => {
    await setContinuousGovernance(f.ownerCtx, { mode: "continuous", responses: { "RM-001": "pause_gateway" } });
    await withTenant(f.orgId, (db) => db.alert.deleteMany({ where: { orgId: f.orgId } }));
    await f.call({ amount: 9200 });
    const r = await withTenant(f.orgId, (db) => runMonitoring(db, f.ownerCtx));
    expect(r.autoResponses).toBe(1);
    expect((await withTenant(f.orgId, (db) => gatewayPausedState(db, f.orgId))).paused).toBe(true);
    // Every new request is now denied at the baseline stage.
    const denied = await f.call({ amount: 10 });
    expect(denied.decision).toBe("deny");
    await withTenant(f.orgId, (db) => resumeGateway(db, f.ownerCtx, "reviewed"));
    const evidence = await withTenant(f.orgId, (db) => db.evidenceEvent.findMany({ where: { orgId: f.orgId, type: "governance.auto_response" } }));
    expect(evidence.length).toBe(2);
    const paused = evidence.find((e) => (e.payload as { action: string }).action === "pause_gateway");
    expect((paused?.payload as { outcome: string }).outcome).toBe("applied");
  });
});
