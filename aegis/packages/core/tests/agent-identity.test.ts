import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { addUserWithRole } from "./helpers.js";
import { requestAccess, decideAccessRequest, expireTemporaryAccess, revokeAccess } from "../src/agents/access.js";
import { emergencyRevokeAgent } from "../src/agents/revocation.js";
import { leastPrivilegeRecommendations } from "../src/agents/least-privilege.js";
import { listDiscoveredAgents, recordAgentObservation, resolveDiscoveredAgent } from "../src/agents/discovery.js";
import { setAgentTool, updateAgent, createAgent, upsertTool } from "../src/agents/registry.js";
import { createDelegation } from "../src/agents/delegation.js";
import { makeContext } from "../src/lib/context.js";

let f: GatewayFixture;
const run = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(f.orgId, fn);
let exportToolId: string;

beforeAll(async () => {
  f = await makeGatewayFixture();
  exportToolId = (await run((db) => db.tool.findFirstOrThrow({ where: { key: "export-customer-records" } }))).id;
}, 120_000);
afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});

describe("registry fields enforced at the gateway", () => {
  it("an agent whose credential has lapsed is refused until re-certified", async () => {
    await run((db) => updateAgent(db, f.engineer.ctx, f.agentId, { credentialExpiresAt: new Date(Date.now() - 60_000) }));
    const r = await f.call({ amount: 20 });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/re-certified/);
    await run((db) => updateAgent(db, f.engineer.ctx, f.agentId, { credentialExpiresAt: new Date(Date.now() + 86400_000) }));
    expect((await f.call({ amount: 20 })).decision).toBe("allow");
  });
  it("the agent's own destination list applies on top of the tool's", async () => {
    await run((db) => setAgentTool(db, f.engineer.ctx, f.agentId, exportToolId, true));
    await run((db) => updateAgent(db, f.engineer.ctx, f.agentId, { allowedDestinations: ["reports.meridian-demo.example"] }));
    const r = await f.call({ tool: "export-customer-records", resource: undefined, params: { destination: "https://warehouse.meridian-demo.example/in" } });
    expect(r.reasons.join(" ")).toMatch(/outside this agent's allowed destinations/);
    await run((db) => updateAgent(db, f.engineer.ctx, f.agentId, { allowedDestinations: [] }));
    await run((db) => setAgentTool(db, f.engineer.ctx, f.agentId, exportToolId, false));
  });
  it("rejects a malformed destination", async () => {
    await expect(run((db) => updateAgent(db, f.engineer.ctx, f.agentId, { allowedDestinations: ["https://x.example/path"] }))).rejects.toThrow();
  });
});

describe("agents cannot raise their own permissions", () => {
  it("an agent cannot grant itself a tool, ask for access, or create a delegation", async () => {
    const self = makeContext(f.orgId, { type: "agent", id: f.agentId });
    await expect(run((db) => setAgentTool(db, self, f.agentId, exportToolId, true))).rejects.toThrow(/agents:write/);
    await expect(run((db) => requestAccess(db, self, { agentId: f.agentId, toolId: exportToolId, actions: [], reason: "I need to export the data now", durationHours: 1 }))).rejects.toThrow(/Only a person/);
    await expect(run((db) => createDelegation(db, self, { delegatorAgentId: f.agentId, delegateAgentId: f.agentId, toolKeys: [], constraints: {}, reason: "self", expiresInHours: 1 }))).rejects.toThrow(/Only a person/);
  });
});

describe("temporary access", () => {
  it("is requested by one person, approved by another, works until it expires, then ends", async () => {
    const req = await run((db) => requestAccess(db, f.engineer.ctx, { agentId: f.agentId, toolId: exportToolId, actions: [], reason: "Quarterly export for the audit committee", durationHours: 2 }));
    const controller = await addUserWithRole(f, "security_analyst", "ctl");
    await expect(run((db) => decideAccessRequest(db, f.engineer.ctx, req.id, { decision: "approve", note: "" }))).rejects.toThrow(/agents:control|own request/);
    await run((db) => decideAccessRequest(db, controller.ctx, req.id, { decision: "approve", note: "ok for this quarter" }));
    const granted = await f.call({ tool: "export-customer-records", resource: undefined, params: { destination: "https://warehouse.meridian-demo.example/in" } });
    expect(granted.reasons.join(" ")).not.toMatch(/no active grant|Temporary access/);
    // The gateway refuses the grant the moment its end time passes, before any sweep runs.
    await run((db) => db.agentTool.updateMany({ where: { agentId: f.agentId, toolId: exportToolId }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    const after = await f.call({ tool: "export-customer-records", resource: undefined, params: { destination: "https://warehouse.meridian-demo.example/in" } });
    expect(after.reasons.join(" ")).toMatch(/Temporary access to export-customer-records ended/);
    await run((db) => db.accessRequest.update({ where: { id: req.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    expect(await run((db) => expireTemporaryAccess(db, makeContext(f.orgId, { type: "system", id: null })))).toBe(1);
    expect((await run((db) => db.accessRequest.findUniqueOrThrow({ where: { id: req.id } }))).status).toBe("expired");
  });
  it("the requester cannot approve their own request, and approved access can be ended early", async () => {
    const lead = await addUserWithRole(f, "governance_manager", "gm");
    const req = await run((db) => requestAccess(db, lead.ctx, { agentId: f.agentId, toolId: exportToolId, actions: [], reason: "One-off export for an incident", durationHours: 1 }));
    await expect(run((db) => decideAccessRequest(db, lead.ctx, req.id, { decision: "approve", note: "" }))).rejects.toThrow(/own request/);
    await run((db) => decideAccessRequest(db, f.ownerCtx, req.id, { decision: "approve", note: "" }));
    await run((db) => revokeAccess(db, f.ownerCtx, req.id, "incident closed"));
    const link = await run((db) => db.agentTool.findFirstOrThrow({ where: { agentId: f.agentId, toolId: exportToolId } }));
    expect(link.revokedAt).not.toBeNull();
  });
});

describe("least privilege", () => {
  it("suggests removing unused tools and narrowing unused actions, and changes nothing itself", async () => {
    const idle = await run((db) => upsertTool(db, f.engineer.ctx, { key: `idle-lookup-${Date.now().toString(36)}`, name: "Idle lookup", description: "", riskLevel: "low", parameterSchema: {}, destinationRules: { allowedDomains: [], allowedResourceKeys: [] } }));
    await run((db) => setAgentTool(db, f.engineer.ctx, f.agentId, idle.id, true));
    const recs = await run((db) => leastPrivilegeRecommendations(db, f.ownerCtx, { agentId: f.agentId }));
    expect(recs.some((r) => r.kind === "unused_tool" && r.toolId === idle.id)).toBe(true);
    expect(recs.some((r) => r.kind === "unused_resource_action" && /read, write/.test(r.detail))).toBe(true);
    const link = await run((db) => db.agentTool.findFirstOrThrow({ where: { agentId: f.agentId, toolId: idle.id } }));
    expect(link.enabled).toBe(true);
  });
});

describe("discovery", () => {
  it("flags an agent nobody registered, links a known one, and a person resolves the rest", async () => {
    const integ = makeContext(f.orgId, { type: "integration", id: f.integrationId });
    const unknown = await run((db) => recordAgentObservation(db, integ, { source: "support-platform", externalId: "bot-7731", name: "Ticket summariser bot", platform: "custom", metadata: {} }));
    expect(unknown.status).toBe("unregistered");
    const again = await run((db) => recordAgentObservation(db, integ, { source: "support-platform", externalId: "bot-7731", name: "Ticket summariser bot", platform: "custom", metadata: { region: "uae" } }));
    expect(again.observations).toBe(2);
    const known = await run((db) => recordAgentObservation(db, integ, { source: "support-platform", externalId: "support-refund-agent", name: "Support Refund Agent", platform: "", metadata: {} }));
    expect(known.status).toBe("linked");
    const ev = await run((db) => db.securityEvent.findFirst({ where: { type: "discovery.unregistered_agent" } }));
    expect(ev).not.toBeNull();
    await expect(run((db) => recordAgentObservation(db, makeContext(f.orgId, { type: "agent", id: f.agentId }), { source: "x", externalId: "y", name: "z", platform: "", metadata: {} }))).rejects.toThrow(/Only integrations/);
    const registered = await run((db) => createAgent(db, f.engineer.ctx, { slug: `ticket-bot-${Date.now().toString(36)}`, name: "Ticket summariser", environment: "production" }));
    await run((db) => resolveDiscoveredAgent(db, f.engineer.ctx, unknown.id, { action: "link", agentId: registered.id }));
    expect((await run((db) => listDiscoveredAgents(db, f.ownerCtx, { status: "unregistered" }))).length).toBe(0);
  });
});

describe("emergency revocation", () => {
  it("ends every route to future action in one step and lists what was already running", async () => {
    const pending = await f.call({ amount: 900 });
    expect(pending.status).toBe("pending_approval");
    const report = await run((db) => emergencyRevokeAgent(db, f.ownerCtx, f.agentId, { mode: "revoke", reason: "compromised credentials" }));
    expect(report.apiKeysRevoked).toBe(1);
    expect(report.approvalsClosed).toBeGreaterThanOrEqual(1);
    expect((await run((db) => db.actionRequest.findUniqueOrThrow({ where: { id: pending.requestId } }))).status).toBe("expired");
    expect((await run((db) => db.agent.findUniqueOrThrow({ where: { id: f.agentId } }))).status).toBe("revoked");
    expect((await f.call({ amount: 10 })).decision).toBe("deny");
    await expect(run((db) => emergencyRevokeAgent(db, f.viewer.ctx, f.agentId, { mode: "revoke", reason: "viewer tries" }))).rejects.toThrow(/agents:control/);
  });
});
