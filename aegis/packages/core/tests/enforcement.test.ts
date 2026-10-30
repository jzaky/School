import { setAgentTool } from "../src/agents/registry.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { disconnectAll, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { auditEnforcementPath, enforcementCoverage } from "../src/gateway/enforcement.js";
import { createIntegration } from "../src/integrations/service.js";
import { requestIdFromIdempotencyKey } from "../src/gateway/simulators.js";

let f: GatewayFixture;
const run = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(f.orgId, fn);

/** Writes an entry straight into the simulated system's ledger: what an agent calling the system directly would leave behind. */
async function writeDownstream(entry: Record<string, unknown>) {
  await run(async (db) => {
    const i = await db.integration.findUniqueOrThrow({ where: { id: f.integrationId } });
    const settings = i.settings as Record<string, unknown>;
    const ledger = (settings.ledger as Record<string, unknown>[]) ?? [];
    await db.integration.update({ where: { id: i.id }, data: { settings: { ...settings, ledger: [{ at: new Date().toISOString(), type: "refund", ...entry }, ...ledger] } as object } });
  });
}

beforeAll(async () => {
  f = await makeGatewayFixture();
}, 120_000);
afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});

describe("enforcement-path audit", () => {
  it("matches every operation the gateway authorized and executed", async () => {
    await f.call({ amount: 20 });
    await f.call({ amount: 30 });
    const r = await auditEnforcementPath((fn) => withTenant(f.orgId, fn), f.ownerCtx, f.integrationId);
    expect(r.observable).toBe(true);
    expect(r.matched).toBe(2);
    expect(r.findings).toEqual([]);
  });
  it("finds operations made around the gateway, with forged ids, or for requests AEGIS refused", async () => {
    const denied = await f.call({ amount: 99_000 });
    expect(denied.decision).toBe("deny");
    await writeDownstream({ reference: "RFD-DIRECT", idempotencyKey: "agent-made-this-up" });
    await writeDownstream({ reference: "RFD-FORGED", idempotencyKey: `aegis:${randomUUID()}` });
    await writeDownstream({ reference: "RFD-REFUSED", idempotencyKey: `aegis:${denied.requestId}` });
    const r = await auditEnforcementPath((fn) => withTenant(f.orgId, fn), f.ownerCtx, f.integrationId);
    expect(r.findings.map((x) => [x.reference, x.kind]).sort()).toEqual([["RFD-DIRECT", "bypass"], ["RFD-FORGED", "unknownRequest"], ["RFD-REFUSED", "unauthorized"]]);
    const ev = await run((db) => db.securityEvent.findFirstOrThrow({ where: { type: "enforcement.bypass_detected" }, orderBy: { createdAt: "desc" } }));
    expect(ev.severity).toBe("critical");
    const i = await run((db) => db.integration.findUniqueOrThrow({ where: { id: f.integrationId } }));
    expect(i.enforcementSummary).toMatchObject({ observable: true, bypass: 1, unknownRequest: 1, unauthorized: 1 });
  });
  it("reports a system that cannot list its operations as not observable, never as clean", async () => {
    const { integration } = await run((db) => createIntegration(db, f.engineer.ctx, { key: `crm-${Date.now().toString(36)}`, name: "Unconnected CRM", type: "crm", description: "" }));
    const r = await auditEnforcementPath((fn) => withTenant(f.orgId, fn), f.ownerCtx, integration.id);
    expect(r.observable).toBe(false);
    expect(r.error).toMatch(/no connector/);
  });
  it("needs integrations:write or security:write", async () => {
    await expect(auditEnforcementPath((fn) => withTenant(f.orgId, fn), f.viewer.ctx, f.integrationId)).rejects.toThrow(/integrations:write/);
  });
  it("coverage shows how each granted tool is enforced", async () => {
    await f.call({ amount: 10, executionMode: "agent" });
    // A granted tool the agent never called is reported as not observed, not as enforced.
    await run(async (db) => setAgentTool(db, f.engineer.ctx, f.agentId, (await db.tool.findFirstOrThrow({ where: { orgId: f.orgId, key: "export-customer-records" } })).id, true));
    const cov = await run((db) => enforcementCoverage(db, f.ownerCtx));
    const tool = cov.find((a) => a.agentId === f.agentId)!.tools.find((t) => t.toolKey === "issue-refund")!;
    // Audit P2-11: the agent ran it itself and no downstream system verified a grant, so it is self-reported.
    expect(tool.strength).toBe("self_reported");
    expect(tool.agentExecuted).toBe(1);
    expect(tool.verifiedDownstream).toBe(0);
    const unused = cov.find((a) => a.agentId === f.agentId)!.tools.find((t) => t.toolKey === "export-customer-records")!;
    expect(unused.requests30d).toBe(0);
    expect(unused.strength).toBe("not_observed");
    expect(tool.outsideGateway).toBe(3);
  });
  it("reads the request id only from a well-formed gateway key", () => {
    const id = randomUUID();
    expect(requestIdFromIdempotencyKey(`aegis:${id}`)).toBe(id);
    expect(requestIdFromIdempotencyKey(`aegis:${id}:x`)).toBeNull();
    expect(requestIdFromIdempotencyKey(undefined)).toBeNull();
  });
});
