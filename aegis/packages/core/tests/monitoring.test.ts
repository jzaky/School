import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { acknowledgeAlert, ensureDefaultMonitoringRules, listAlerts, resolveAlert, runMonitoring, updateMonitoringRule } from "../src/monitoring/service.js";
import { evaluateRule } from "../src/monitoring/rules.js";
import { governanceMetrics, governanceTimeSeries } from "../src/assurance/dashboard.js";
import { exportEvidence, verifyAndRecord } from "../src/assurance/evidence-service.js";
import { observedTechnicalControls } from "../src/assurance/compliance.js";

let f: GatewayFixture;
beforeAll(async () => {
  f = await makeGatewayFixture();
  await withTenant(f.orgId, (db) => ensureDefaultMonitoringRules(db, f.ownerCtx));
});
afterAll(async () => {
  await f.cleanup();
});

describe("monitoring rules", () => {
  it("repeated denials raise exactly one deduplicated alert", async () => {
    for (let i = 0; i < 6; i++) await f.call({ amount: 9000 + i });
    const findings = await withTenant(f.orgId, (db) => evaluateRule(db, f.orgId, { type: "repeated_denials", threshold: 5, windowMinutes: 1440 }));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail.count).toBeGreaterThanOrEqual(6);
    const first = await withTenant(f.orgId, (db) => runMonitoring(db, f.ownerCtx));
    expect(first.newAlerts).toBeGreaterThanOrEqual(1);
    const second = await withTenant(f.orgId, (db) => runMonitoring(db, f.ownerCtx));
    expect(second.newAlerts).toBe(0);
    const alerts = await withTenant(f.orgId, (db) => listAlerts(db, f.ownerCtx, { status: "open", page: 1, pageSize: 50 }));
    expect(alerts.items.some((a) => a.title.startsWith("RM-001"))).toBe(true);
    expect(alerts.items.find((a) => a.title.startsWith("RM-001"))?.agentId).toBe(f.agentId);
  });
  it("permission escalation attempts are counted from structural denials", async () => {
    for (let i = 0; i < 3; i++) await f.call({ resource: "payments-core", amount: 10 });
    const findings = await withTenant(f.orgId, (db) => evaluateRule(db, f.orgId, { type: "permission_escalation", threshold: 3, windowMinutes: 1440 }));
    expect(findings).toHaveLength(1);
    expect((findings[0]?.detail.codes as string[]).includes("resource_not_permitted")).toBe(true);
  });
  it("chain integrity rule is quiet on a valid chain and alerts are workable", async () => {
    const chain = await withTenant(f.orgId, (db) => evaluateRule(db, f.orgId, { type: "chain_integrity" }));
    expect(chain).toHaveLength(0);
    const alerts = await withTenant(f.orgId, (db) => listAlerts(db, f.ownerCtx, { status: "open", page: 1, pageSize: 50 }));
    const a = alerts.items[0]!;
    await withTenant(f.orgId, (db) => acknowledgeAlert(db, f.ownerCtx, a.id));
    await withTenant(f.orgId, (db) => resolveAlert(db, f.ownerCtx, a.id, "Investigated; test traffic"));
    const after = await withTenant(f.orgId, (db) => db.alert.findUniqueOrThrow({ where: { id: a.id } }));
    expect(after.status).toBe("resolved");
    await expect(withTenant(f.orgId, (db) => resolveAlert(db, f.viewer.ctx, a.id, "x"))).rejects.toThrow(/monitoring:write/);
  });
  it("rule definitions can be tuned but not retyped", async () => {
    const rule = await withTenant(f.orgId, (db) => db.monitoringRule.findUniqueOrThrow({ where: { orgId_key: { orgId: f.orgId, key: "RM-001" } } }));
    await withTenant(f.orgId, (db) => updateMonitoringRule(db, f.ownerCtx, rule.id, { definition: { type: "repeated_denials", threshold: 50, windowMinutes: 60 } }));
    await expect(withTenant(f.orgId, (db) => updateMonitoringRule(db, f.ownerCtx, rule.id, { definition: { type: "chain_integrity" } }))).rejects.toThrow(/type cannot change/);
  });
});

describe("assurance", () => {
  it("dashboard metrics equal direct counts", async () => {
    const m = await withTenant(f.orgId, (db) => governanceMetrics(db, f.ownerCtx, 30));
    const denied = await withTenant(f.orgId, (db) => db.authorizationDecision.count({ where: { orgId: f.orgId, result: { in: ["deny", "error"] } } }));
    const evaluated = await withTenant(f.orgId, (db) => db.authorizationDecision.count({ where: { orgId: f.orgId } }));
    expect(m.actions.denied).toBe(denied);
    expect(m.actions.evaluated).toBe(evaluated);
    expect(m.agents.active).toBe(1);
    const series = await withTenant(f.orgId, (db) => governanceTimeSeries(db, f.ownerCtx, 7));
    expect(series.reduce((a, d) => a + d.allow + d.deny + d.require_approval + d.error, 0)).toBe(evaluated);
  });
  it("verification is recorded and exports carry the chain status", async () => {
    const v = await withTenant(f.orgId, (db) => verifyAndRecord(db, f.ownerCtx));
    expect(v.valid).toBe(true);
    const out = await withTenant(f.orgId, (db) => exportEvidence(db, f.ownerCtx, { format: "jsonl", page: 1, pageSize: 50 }));
    const lines = out.body.trim().split("\n");
    const header = JSON.parse(lines[0]!);
    expect(header.verification.valid).toBe(true);
    expect(out.count).toBe(lines.length - 1);
    expect(JSON.parse(lines[1]!).type).toBeTruthy();
    const csv = await withTenant(f.orgId, (db) => exportEvidence(db, f.ownerCtx, { format: "csv", page: 1, pageSize: 50 }));
    expect(csv.body.startsWith("seq,occurredAt,type")).toBe(true);
    await expect(withTenant(f.orgId, (db) => exportEvidence(db, f.viewer.ctx, { format: "csv", page: 1, pageSize: 50 }))).resolves.toBeTruthy(); // viewers may read evidence
  });
  it("observed technical controls describe measurements, not compliance", async () => {
    const controls = await withTenant(f.orgId, (db) => observedTechnicalControls(db, f.ownerCtx));
    expect(controls.find((c) => c.key === "evidence_integrity")?.status).toBe("observed");
    expect(controls.find((c) => c.key === "mfa_adoption")?.status).toBe("gap");
    expect(controls.every((c) => typeof c.measure === "string")).toBe(true);
  });
});
