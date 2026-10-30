import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { disconnectAll, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { addUserWithRole } from "./helpers.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../src/policy/service.js";
import { createAgent, grantResourcePermission, setAgentTool, transitionAgent } from "../src/agents/registry.js";
import { createDelegation, revokeDelegation } from "../src/agents/delegation.js";
import { authorizeAndExecute, expireHeldRequest, getActionRequest, listActionRequests, releaseQuarantine, requestHashOf } from "../src/gateway/gateway.js";
import { consumeGrant, parseGrantToken, signGrant } from "../src/gateway/grants.js";
import { applyRestrictions } from "../src/gateway/restrictions.js";
import { baselineChecks } from "../src/gateway/baseline.js";
import { decideApprovalAndExecute, provideApprovalInfo } from "../src/approvals/service.js";
import { makeContext, type OrgContext } from "../src/lib/context.js";
import type { PolicyDocument } from "../src/policy/schema.js";

let f: GatewayFixture;
const run = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(f.orgId, fn);

/** Creates, reviews, activates and assigns a policy to one agent. */
async function policyFor(agentId: string, key: string, document: PolicyDocument) {
  await run(async (db) => {
    const { policy, version } = await createPolicy(db, f.ownerCtx, { key, name: key, description: "", category: "authorization", document, changeNote: "test" });
    await submitForReview(db, f.ownerCtx, version.id);
    await activateVersion(db, f.ownerCtx, version.id, { fourEyes: false });
    await assignPolicy(db, f.ownerCtx, policy.id, { targetType: "agent", targetId: agentId, priority: 100 });
  });
}

beforeAll(async () => {
  f = await makeGatewayFixture();
  // Guards that stack on the refund authority policy (allow below AED 500).
  await policyFor(f.agentId, "refund-guards", {
    version: 1,
    appliesTo: { tools: ["issue-refund"], actions: [], environments: [] },
    rules: [
      { id: "narrow-large", description: "", effect: "restrict", when: { all: [{ attr: "params.amount", op: "gt", value: 400 }, { attr: "params.amount", op: "lt", value: 500 }] }, restrict: { capNumeric: { amount: 400 }, setParams: {}, removeParams: [], note: "Refunds near the limit are reduced to AED 400" }, reason: "Narrowed to AED 400", riskIndicators: [] },
      { id: "ask-ticket", description: "", effect: "request_more_information", when: { all: [{ attr: "context.supplied.mode", op: "eq", value: "needs-info" }, { attr: "context.supplied.ticketRef", op: "missing" }] }, moreInformation: { fields: ["ticketRef"], message: "Give the support ticket this refund answers", expiresInMinutes: 60 }, reason: "Ticket reference missing", riskIndicators: [] },
      { id: "hold-suspicious", description: "", effect: "quarantine", when: { attr: "context.supplied.mode", op: "eq", value: "suspicious" }, quarantine: { severity: "critical", reviewRoles: [], expiresInMinutes: 60, note: "Suspicious refund pattern" }, reason: "Held for security review", riskIndicators: ["suspicious"] },
    ],
    tests: [],
  } as unknown as PolicyDocument);
}, 120_000);

afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});

describe("restrict", () => {
  it("narrows the parameters, says so, and executes only the narrowed request", async () => {
    const r = await f.call({ amount: 450 });
    expect(r.decision).toBe("restrict");
    expect(r.status).toBe("executed");
    expect(r.restrictions?.applied).toEqual(["amount capped from 450 to 400"]);
    expect(r.restrictions?.params.amount).toBe(400);
    const receipt = await run((db) => db.executionReceipt.findFirstOrThrow({ where: { actionRequestId: r.requestId } }));
    const ledger = await f.ledger();
    expect(ledger.find((e) => e.reference === receipt.downstreamReference)?.amount).toBe(400);
  });
  it("applies the smallest cap, then forced values, then removals, and refuses prototype paths", () => {
    const out = applyRestrictions({ amount: 900, a: { b: 1 }, keep: true }, [
      { capNumeric: { amount: 500 }, setParams: { channel: "sandbox" }, removeParams: ["a.b"], note: "" },
      { capNumeric: { amount: 300 }, setParams: { "__proto__.polluted": true }, removeParams: [], note: "" },
    ]);
    expect(out.params).toEqual({ amount: 300, a: {}, keep: true, channel: "sandbox" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("request more information", () => {
  it("holds the request, names the fields, and decides again when the agent resubmits under the same key", async () => {
    const key = `info-${randomUUID()}`;
    const first = await f.call({ amount: 120, idempotencyKey: key, context: { mode: "needs-info" } });
    expect(first.decision).toBe("request_more_information");
    expect(first.status).toBe("awaiting_information");
    expect(first.moreInformation?.fields).toEqual(["ticketRef"]);
    const second = await f.call({ amount: 120, idempotencyKey: key, context: { mode: "needs-info", ticketRef: "T-881" } });
    expect(second.requestId).toBe(first.requestId);
    expect(second.decision).toBe("allow");
    expect(second.status).toBe("executed");
  });
  it("expires when the window passes", async () => {
    const r = await f.call({ amount: 90, context: { mode: "needs-info" } });
    const later = makeContext(f.orgId, { type: "system", id: null }, { now: new Date(Date.now() + 2 * 3600_000) });
    expect(await run((db) => expireHeldRequest(db, later, r.requestId))).toBe(true);
    expect((await run((db) => db.actionRequest.findUniqueOrThrow({ where: { id: r.requestId } }))).status).toBe("expired");
  });
});

describe("quarantine", () => {
  it("holds the request, raises a critical security event that opens an incident, and nothing executes", async () => {
    const r = await f.call({ amount: 100, context: { mode: "suspicious" } });
    expect(r.decision).toBe("quarantine");
    expect(r.status).toBe("quarantined");
    expect(r.quarantine?.securityEventId).toBeTruthy();
    const ev = await run((db) => db.securityEvent.findUniqueOrThrow({ where: { id: r.quarantine!.securityEventId! } }));
    expect(ev.severity).toBe("critical");
    expect(ev.incidentId).toBeTruthy();
    expect(await run((db) => db.executionReceipt.count({ where: { actionRequestId: r.requestId } }))).toBe(0);
    expect(await run((db) => db.executionGrant.count({ where: { actionRequestId: r.requestId } }))).toBe(0);
  });
  it("only a security reviewer releases it, release goes to a human approval, and approval executes", async () => {
    const r = await f.call({ amount: 100, context: { mode: "suspicious" } });
    await expect(run((db) => releaseQuarantine(db, f.engineer.ctx, r.requestId, { action: "to_approval", reason: "looks fine to me" }))).rejects.toThrow(/security:write/);
    const analyst = await addUserWithRole(f, "security_analyst", "sec");
    const released = await run((db) => releaseQuarantine(db, analyst.ctx, r.requestId, { action: "to_approval", reason: "pattern explained by a bulk correction" }));
    expect(released.status).toBe("pending_approval");
    const a = await run((db) => db.approvalRequest.findUniqueOrThrow({ where: { id: released.approvalRequestId! } }));
    const out = await decideApprovalAndExecute((fn) => withTenant(f.orgId, fn), f.approver.ctx, a.id, { decision: "approve", comment: "", requestHash: a.requestHash });
    expect(out.executed).toBe(true);
  });
  it("a refused quarantine is denied and cannot be released again", async () => {
    const r = await f.call({ amount: 100, context: { mode: "suspicious" } });
    const analyst = await addUserWithRole(f, "security_analyst", "sec2");
    expect((await run((db) => releaseQuarantine(db, analyst.ctx, r.requestId, { action: "refuse", reason: "matches a known fraud pattern" }))).status).toBe("denied");
    await expect(run((db) => releaseQuarantine(db, analyst.ctx, r.requestId, { action: "to_approval", reason: "second thoughts" }))).rejects.toThrow(/only quarantined/);
  });
});

describe("signed, integration-bound grants", () => {
  it("rejects a forged, altered or old-format token before any lookup", async () => {
    const r = await f.call({ amount: 50, executionMode: "agent" });
    const token = r.grant!.token;
    const claims = parseGrantToken(token)!;
    expect(claims.req).toBe(r.requestId);
    expect(claims.int).toBe(f.integrationId);
    const [prefix, , sig] = token.split(".");
    const altered = `${prefix}.${Buffer.from(JSON.stringify({ ...claims, h: "0".repeat(64) })).toString("base64url")}.${sig}`;
    expect(await run((db) => consumeGrant(db, altered, claims.h))).toEqual({ ok: false, reason: "invalid_token" });
    expect(await run((db) => consumeGrant(db, "aegis_gr_" + "a".repeat(48), claims.h))).toEqual({ ok: false, reason: "invalid_token" });
    // A validly signed token for a grant that does not exist is unknown, not accepted.
    expect(await run((db) => consumeGrant(db, signGrant({ ...claims, gid: randomUUID() }), claims.h))).toEqual({ ok: false, reason: "unknown" });
  });
  it("another integration's key cannot consume the grant; the right integration can, once", async () => {
    const r = await f.call({ amount: 60, executionMode: "agent" });
    const hash = parseGrantToken(r.grant!.token)!.h;
    expect(await run((db) => consumeGrant(db, r.grant!.token, hash, { integrationId: randomUUID() }))).toEqual({ ok: false, reason: "integration_mismatch" });
    expect((await run((db) => consumeGrant(db, r.grant!.token, hash, { integrationId: f.integrationId }))).ok).toBe(true);
    expect(await run((db) => consumeGrant(db, r.grant!.token, hash, { integrationId: f.integrationId }))).toEqual({ ok: false, reason: "consumed" });
  });
});

describe("read access and approval integrity", () => {
  it("an integration sees only requests routed through its own tools; a user needs gateway:read", async () => {
    await f.call({ amount: 30 });
    const own = makeContext(f.orgId, { type: "integration", id: f.integrationId });
    const other = makeContext(f.orgId, { type: "integration", id: randomUUID() });
    expect((await run((db) => listActionRequests(db, own, { page: 1, pageSize: 5 }))).total).toBeGreaterThan(0);
    expect((await run((db) => listActionRequests(db, other, { page: 1, pageSize: 5 }))).total).toBe(0);
    const anyId = (await run((db) => listActionRequests(db, own, { page: 1, pageSize: 1 }))).items[0]!.id;
    await expect(run((db) => getActionRequest(db, other, anyId))).rejects.toThrow(/not found/i);
    const noRead: OrgContext = makeContext(f.orgId, { type: "user", id: f.viewer.userId, permissions: ["org:read"] });
    await expect(run((db) => listActionRequests(db, noRead, { page: 1, pageSize: 5 }))).rejects.toThrow(/gateway:read/);
  });
  it("only the agent, its owners or an approver may answer an information request", async () => {
    const r = await f.call({ amount: 900 });
    const a = await run((db) => db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: r.requestId } }));
    await decideApprovalAndExecute((fn) => withTenant(f.orgId, fn), f.approver.ctx, a.id, { decision: "request_info", comment: "which order?", requestHash: a.requestHash });
    await expect(run((db) => provideApprovalInfo(db, makeContext(f.orgId, { type: "integration", id: f.integrationId }), a.id, "order 5"))).rejects.toThrow(/Integrations/);
    await expect(run((db) => provideApprovalInfo(db, f.viewer.ctx, a.id, "order 5"))).rejects.toThrow(/owners or an approver/);
    await run((db) => provideApprovalInfo(db, f.engineer.ctx, a.id, "order 5, duplicate charge"));
  });
  it("an approval re-hashes the stored parameters: an edit after the request is caught", async () => {
    const r = await f.call({ amount: 1200 });
    const a = await run((db) => db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: r.requestId } }));
    await run((db) => db.actionRequest.update({ where: { id: r.requestId }, data: { params: { orderId: "ORD-X", customerId: "CUST-1", amount: 1, currency: "AED" } } }));
    await expect(decideApprovalAndExecute((fn) => withTenant(f.orgId, fn), f.approver2.ctx, a.id, { decision: "approve", comment: "", requestHash: a.requestHash })).rejects.toThrow(/changed since it was presented/);
  });
  it("an unknown data classification fails closed", () => {
    const out = baselineChecks({
      agent: { status: "active", dataClassificationLimit: "confidential", tools: [{ enabled: true, revokedAt: null, toolId: "t" }], permissions: [{ resourceId: "r", actions: ["execute"], expiresAt: null, revokedAt: null }] } as never,
      tool: { id: "t", key: "x", enabled: true, integration: null, parameterSchema: {}, destinationRules: {} } as never,
      action: "execute",
      resource: { id: "r", key: "res", classification: "top-secret" } as never,
      resourceKeyRequested: "res",
      params: {},
      destinationDomain: null,
      gatewayPaused: { paused: false },
    });
    expect(out.failures.map((x) => x.code)).toContain("classification_exceeded");
  });
});

describe("agent-to-agent delegation", () => {
  let delegateId: string;
  let delegateCtx: OrgContext;
  let noGrantId: string;
  beforeAll(async () => {
    const ids = await run(async (db) => {
      const tool = await db.tool.findFirstOrThrow({ where: { key: "issue-refund" } });
      const res = await db.resource.findFirstOrThrow({ where: { key: "support-tickets" } });
      const make = async (slug: string, grant: boolean) => {
        const a = await createAgent(db, f.engineer.ctx, { slug, name: slug, description: "", environment: "production", modelProvider: "x", modelId: "y", dataClassificationLimit: "confidential", riskTier: "medium", metadata: {}, technicalOwnerId: f.engineer.userId });
        if (grant) await setAgentTool(db, f.engineer.ctx, a.id, tool.id, true);
        await grantResourcePermission(db, f.engineer.ctx, a.id, res.id, ["execute"]);
        await transitionAgent(db, f.engineer.ctx, a.id, "registered", "ok");
        await transitionAgent(db, f.engineer.ctx, a.id, "active", "ok");
        return a.id;
      };
      return { d: await make(`delegate-${Date.now().toString(36)}`, true), n: await make(`nogrant-${Date.now().toString(36)}`, false) };
    });
    delegateId = ids.d;
    noGrantId = ids.n;
    delegateCtx = makeContext(f.orgId, { type: "agent", id: delegateId });
    const refund = (await run((db) => db.policy.findFirstOrThrow({ where: { key: "refund-authority" } }))).id;
    await run((db) => assignPolicy(db, f.ownerCtx, refund, { targetType: "agent", targetId: delegateId, priority: 100 }));
    await run((db) => assignPolicy(db, f.ownerCtx, refund, { targetType: "agent", targetId: noGrantId, priority: 100 }));
    // Applies to the delegator only: it must still bind delegated requests.
    await policyFor(f.agentId, "delegator-floor", { version: 1, appliesTo: { tools: ["issue-refund"], actions: [], environments: [] }, rules: [{ id: "small-only", description: "", effect: "deny", when: { attr: "params.amount", op: "gt", value: 300 }, reason: "Delegator policy: above AED 300 refused", riskIndicators: [] }], tests: [] } as unknown as PolicyDocument);
  }, 120_000);

  const delegated = (ctx: OrgContext, amount: number, onBehalfOf: string) =>
    authorizeAndExecute(withTenant, ctx, { tool: "issue-refund", action: "execute", params: { orderId: `D-${randomUUID().slice(0, 8)}`, customerId: "C", amount, currency: "AED" }, resource: "support-tickets", idempotencyKey: `del-${randomUUID()}`, justification: "", principal: { type: "none" }, context: {}, executionMode: "gateway", onBehalfOf: { agentId: onBehalfOf } });

  it("only a person creates a delegation, and never for tools the delegator lacks", async () => {
    await expect(run((db) => createDelegation(db, makeContext(f.orgId, { type: "agent", id: f.agentId }), { delegatorAgentId: f.agentId, delegateAgentId: delegateId, toolKeys: [], constraints: {}, reason: "self-service", expiresInHours: 1 }))).rejects.toThrow(/Only a person/);
    await expect(run((db) => createDelegation(db, f.ownerCtx, { delegatorAgentId: f.agentId, delegateAgentId: delegateId, toolKeys: ["export-customer-records"], constraints: {}, reason: "wants export", expiresInHours: 1 }))).rejects.toThrow(/does not hold/);
  });
  it("a delegated request passes both agents' grants and policies and the delegation cap", async () => {
    await run((db) => createDelegation(db, f.ownerCtx, { delegatorAgentId: f.agentId, delegateAgentId: delegateId, toolKeys: ["issue-refund"], constraints: { maxAmount: 250 }, reason: "weekend cover", expiresInHours: 4 }));
    const ok = await delegated(delegateCtx, 120, f.agentId);
    expect(ok.decision).toBe("allow");
    expect(ok.delegation?.onBehalfOf).toBe("support-refund-agent");
    const overCap = await delegated(delegateCtx, 260, f.agentId);
    expect(overCap.decision).toBe("deny");
    expect(overCap.reasons.join(" ")).toMatch(/delegation limit/);
  });
  it("the delegator's own policy still applies to delegated requests", async () => {
    const d = await run((db) => db.agentDelegation.findFirstOrThrow({ where: { delegateAgentId: delegateId, revokedAt: null } }));
    await run((db) => db.agentDelegation.update({ where: { id: d.id }, data: { constraints: {} } }));
    const r = await delegated(delegateCtx, 350, f.agentId);
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/Delegator policy/);
  });
  it("a delegate without its own grant gains nothing from the delegation", async () => {
    await run((db) => createDelegation(db, f.ownerCtx, { delegatorAgentId: f.agentId, delegateAgentId: noGrantId, toolKeys: ["issue-refund"], constraints: {}, reason: "test", expiresInHours: 1 }));
    const r = await delegated(makeContext(f.orgId, { type: "agent", id: noGrantId }), 50, f.agentId);
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/no active grant/);
  });
  it("revocation takes effect on the next request and is recorded as a security event", async () => {
    const d = await run((db) => db.agentDelegation.findFirstOrThrow({ where: { delegateAgentId: delegateId, revokedAt: null } }));
    await run((db) => revokeDelegation(db, f.ownerCtx, d.id, "cover ended"));
    const r = await delegated(delegateCtx, 50, f.agentId);
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/No active delegation/);
    const ev = await run((db) => db.securityEvent.findFirst({ where: { actionRequestId: r.requestId } }));
    expect(ev?.type).toBe("authorization.delegation_refused");
  });
  it("a request hash binds tool, action and parameters", () => {
    expect(requestHashOf("a", "execute", { x: 1 })).not.toBe(requestHashOf("a", "execute", { x: 2 }));
  });
});
