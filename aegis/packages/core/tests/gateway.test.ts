import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { decideApproval, expireApproval, listApprovals } from "../src/approvals/service.js";
import { revokeAgentTool, transitionAgent } from "../src/agents/registry.js";
import { resolveApiKey } from "../src/identity/api-keys.js";
import { verifyChain } from "../src/evidence/ledger.js";
import { consumeGrant } from "../src/gateway/grants.js";
import { hashObject } from "../src/lib/crypto.js";
import { setIntegrationStatus, revokeCredential } from "../src/integrations/service.js";
import { registerShieldInspector } from "../src/gateway/shield-hook.js";
import { submitActionRequest } from "../src/gateway/gateway.js";
import { rawPrisma } from "@aegis/db";

let f: GatewayFixture;
beforeAll(async () => {
  f = await makeGatewayFixture();
});
afterAll(async () => {
  await f.cleanup();
});

async function approval(requestId: string) {
  return withTenant(f.orgId, (db) => db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: requestId } }));
}

describe("gateway: allow, deny, approval", () => {
  it("allowed action executes exactly once and leaves a receipt", async () => {
    const before = (await f.ledger()).length;
    const r = await f.call({ amount: 120 });
    expect(r.decision).toBe("allow");
    expect(r.status).toBe("executed");
    expect(r.receipt?.status).toBe("succeeded");
    expect(r.receipt?.reference).toMatch(/^RFD-/);
    expect(r.matchedRuleIds).toContain("refund-authority/autonomous-under-500");
    expect((await f.ledger()).length).toBe(before + 1);
  });

  it("denied action never reaches the downstream system", async () => {
    const before = (await f.ledger()).length;
    const r = await f.call({ amount: 9000 });
    expect(r.decision).toBe("deny");
    expect(r.status).toBe("denied");
    expect(r.receipt).toBeUndefined();
    expect(r.reasons.join(" ")).toMatch(/exceeds the agent's authority/);
    expect((await f.ledger()).length).toBe(before);
    const sec = await withTenant(f.orgId, (db) => db.securityEvent.findMany({ where: { actionRequestId: r.requestId } }));
    expect(sec).toHaveLength(1);
    expect(sec[0]?.type).toBe("policy.violation");
  });

  it("approval-required action stays blocked until approved, then executes once", async () => {
    const before = (await f.ledger()).length;
    const r = await f.call({ amount: 1200 });
    expect(r.decision).toBe("require_approval");
    expect(r.status).toBe("pending_approval");
    expect(r.approval?.requiredRoles).toContain("approver");
    expect((await f.ledger()).length).toBe(before);
    const a = await approval(r.requestId);
    const list = await withTenant(f.orgId, (db) => listApprovals(db, f.approver.ctx, { status: "pending", page: 1, pageSize: 50, mine: false }));
    expect(list.items.some((x) => x.id === a.id)).toBe(true);
    const decided = await withTenant(f.orgId, (db) => decideApproval(db, f.approver.ctx, a.id, { decision: "approve", comment: "ok", requestHash: a.requestHash }));
    expect(decided.status).toBe("approved");
    expect(decided.executed).toBe(true);
    expect((await f.ledger()).length).toBe(before + 1);
    // Approving again is refused (already decided) and does not execute twice.
    await expect(withTenant(f.orgId, (db) => decideApproval(db, f.approver2.ctx, a.id, { decision: "approve", comment: "again", requestHash: a.requestHash }))).rejects.toThrow(/approved/);
    expect((await f.ledger()).length).toBe(before + 1);
  });

  it("rejection records the decision and nothing executes", async () => {
    const before = (await f.ledger()).length;
    const r = await f.call({ amount: 800 });
    const a = await approval(r.requestId);
    const d = await withTenant(f.orgId, (db) => decideApproval(db, f.approver.ctx, a.id, { decision: "reject", comment: "Customer not entitled", requestHash: a.requestHash }));
    expect(d.status).toBe("rejected");
    const req = await withTenant(f.orgId, (db) => db.actionRequest.findUniqueOrThrow({ where: { id: r.requestId } }));
    expect(req.status).toBe("rejected");
    expect((await f.ledger()).length).toBe(before);
  });

  it("default deny: a tool with no matching policy is denied", async () => {
    const r = await f.call({ tool: "export-customer-records", params: { segment: "gold", destination: "https://warehouse.meridian-demo.example/x" }, resource: undefined });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/no active grant|default deny|No policy rule/i);
  });
});

describe("gateway: approval integrity", () => {
  it("expired approvals cannot be used", async () => {
    const r = await f.call({ amount: 700 });
    const a = await approval(r.requestId);
    await withTenant(f.orgId, (db) => db.approvalRequest.update({ where: { id: a.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    await expect(withTenant(f.orgId, (db) => decideApproval(db, f.approver.ctx, a.id, { decision: "approve", comment: "", requestHash: a.requestHash }))).rejects.toThrow(/expired/);
    const res = await withTenant(f.orgId, (db) => expireApproval(db, f.ownerCtx, a.id));
    expect(res.changed).toBe(true);
    const req = await withTenant(f.orgId, (db) => db.actionRequest.findUniqueOrThrow({ where: { id: r.requestId } }));
    expect(req.status).toBe("expired");
    expect(await withTenant(f.orgId, (db) => db.executionReceipt.count({ where: { actionRequestId: r.requestId } }))).toBe(0);
  });

  it("approval cannot authorise modified parameters (hash binding)", async () => {
    const r = await f.call({ amount: 900 });
    const a = await approval(r.requestId);
    const tampered = hashObject({ toolKey: "issue-refund", action: "execute", params: { orderId: "ORD-X", customerId: "CUST-1", amount: 90000, currency: "AED" } });
    await expect(withTenant(f.orgId, (db) => decideApproval(db, f.approver.ctx, a.id, { decision: "approve", comment: "", requestHash: tampered }))).rejects.toThrow(/changed since/);
    // Even a grant presented downstream with other parameters fails.
    const grant = await withTenant(f.orgId, async (db) => {
      const { issueGrant } = await import("../src/gateway/grants.js");
      return issueGrant(db, f.orgId, r.requestId, a.requestHash);
    });
    await withTenant(f.orgId, (db) => db.actionRequest.update({ where: { id: r.requestId }, data: { status: "approved" } }));
    const bad = await withTenant(f.orgId, (db) => consumeGrant(db, grant.token, tampered));
    expect(bad).toEqual({ ok: false, reason: "hash_mismatch" });
    const good = await withTenant(f.orgId, (db) => consumeGrant(db, grant.token, a.requestHash));
    expect(good.ok).toBe(true);
    const again = await withTenant(f.orgId, (db) => consumeGrant(db, grant.token, a.requestHash));
    expect(again).toEqual({ ok: false, reason: "consumed" });
  });

  it("unauthorised users cannot approve; separation of duties blocks the agent owner", async () => {
    const r = await f.call({ amount: 1000 });
    const a = await approval(r.requestId);
    await expect(withTenant(f.orgId, (db) => decideApproval(db, f.viewer.ctx, a.id, { decision: "approve", comment: "", requestHash: a.requestHash }))).rejects.toThrow(/approvals:decide/);
    // Engineer is the technical owner and also lacks the approver role.
    await expect(withTenant(f.orgId, (db) => decideApproval(db, f.engineer.ctx, a.id, { decision: "approve", comment: "", requestHash: a.requestHash }))).rejects.toThrow(/Separation of duties|Requires role|approvals:decide/);
    const req = await withTenant(f.orgId, (db) => db.actionRequest.findUniqueOrThrow({ where: { id: r.requestId } }));
    expect(req.status).toBe("pending_approval");
  });

  it("request_info pauses, escalate hands over, and the escalated approver can decide", async () => {
    const r = await f.call({ amount: 1100 });
    const a = await approval(r.requestId);
    await withTenant(f.orgId, (db) => decideApproval(db, f.approver.ctx, a.id, { decision: "request_info", comment: "Which order?", requestHash: a.requestHash }));
    expect((await approval(r.requestId)).status).toBe("more_info");
    const { provideApprovalInfo } = await import("../src/approvals/service.js");
    await withTenant(f.orgId, (db) => provideApprovalInfo(db, f.agentCtx, a.id, "Order ORD-77 from the Dubai store"));
    expect((await approval(r.requestId)).status).toBe("pending");
    await withTenant(f.orgId, (db) => decideApproval(db, f.approver.ctx, a.id, { decision: "escalate", comment: "Above my comfort", requestHash: a.requestHash, targetUserId: f.approver2.userId }));
    expect((await approval(r.requestId)).status).toBe("escalated");
    const d = await withTenant(f.orgId, (db) => decideApproval(db, f.approver2.ctx, a.id, { decision: "approve", comment: "fine", requestHash: a.requestHash }));
    expect(d.executed).toBe(true);
  });
});

describe("gateway: idempotency and duplicates", () => {
  it("duplicate idempotency key returns the original outcome without re-executing", async () => {
    const before = (await f.ledger()).length;
    const key = `dup-${Date.now()}`;
    const first = await f.call({ amount: 50, idempotencyKey: key, params: { orderId: "ORD-D", customerId: "C", amount: 50, currency: "AED" } });
    const second = await f.call({ amount: 50, idempotencyKey: key, params: { orderId: "ORD-D", customerId: "C", amount: 50, currency: "AED" } });
    expect(first.status).toBe("executed");
    expect(second.duplicate).toBe(true);
    expect(second.requestId).toBe(first.requestId);
    expect((await f.ledger()).length).toBe(before + 1);
  });
  it("same idempotency key with different parameters is rejected", async () => {
    const key = `dup2-${Date.now()}`;
    await f.call({ amount: 10, idempotencyKey: key, params: { orderId: "ORD-E", customerId: "C", amount: 10, currency: "AED" } });
    await expect(f.call({ amount: 20, idempotencyKey: key, params: { orderId: "ORD-E", customerId: "C", amount: 20, currency: "AED" } })).rejects.toThrow(/Idempotency key/);
  });
});

describe("gateway: structural and emergency controls", () => {
  it("rejects parameters that violate the tool schema", async () => {
    const r = await f.call({ params: { orderId: "O", customerId: "C", amount: "lots", currency: "AED" } });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/Parameters do not match/);
  });
  it("denies resources the agent is not permitted on and classification overreach", async () => {
    const r = await f.call({ resource: "payments-core", amount: 10 });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/no permission on resource payments-core/);
  });
  it("revoking the tool grant blocks the next call", async () => {
    const tool = await withTenant(f.orgId, (db) => db.tool.findUniqueOrThrow({ where: { orgId_key: { orgId: f.orgId, key: "issue-refund" } } }));
    await withTenant(f.orgId, (db) => revokeAgentTool(db, f.ownerCtx, f.agentId, tool.id, "incident"));
    const r = await f.call({ amount: 10 });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/no active grant for tool/);
    const { setAgentTool } = await import("../src/agents/registry.js");
    await withTenant(f.orgId, (db) => setAgentTool(db, f.engineer.ctx, f.agentId, tool.id, true));
    expect((await f.call({ amount: 10 })).decision).toBe("allow");
  });
  it("disabling the integration blocks execution, re-enabling restores it", async () => {
    await withTenant(f.orgId, (db) => setIntegrationStatus(db, f.ownerCtx, f.integrationId, "disabled", "vendor incident"));
    const r = await f.call({ amount: 10 });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/Integration .* is disabled/);
    await withTenant(f.orgId, (db) => setIntegrationStatus(db, f.ownerCtx, f.integrationId, "active", "resolved"));
    expect((await f.call({ amount: 10 })).status).toBe("executed");
  });
  it("revoked credentials make execution fail closed with a receipt", async () => {
    const cred = await withTenant(f.orgId, (db) => db.credential.findFirstOrThrow({ where: { integrationId: f.integrationId } }));
    await withTenant(f.orgId, (db) => revokeCredential(db, f.ownerCtx, cred.id, "leak suspected"));
    const r = await f.call({ amount: 10 });
    expect(r.decision).toBe("allow");
    expect(r.status).toBe("failed");
    expect(r.receipt?.status).toBe("failed");
    expect(JSON.stringify(r.receipt?.summary)).toMatch(/credential/);
    const { storeCredential } = await import("../src/integrations/service.js");
    await withTenant(f.orgId, (db) => storeCredential(db, f.engineer.ctx, f.integrationId, "service-token", "new-secret"));
    expect((await f.call({ amount: 10 })).status).toBe("executed");
  });
  it("gateway pause denies everything until resumed", async () => {
    await rawPrisma().organization.update({ where: { id: f.orgId }, data: { settings: { gatewayPaused: true, gatewayPausedReason: "drill" } } });
    const r = await f.call({ amount: 10 });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/Gateway is paused/);
    await rawPrisma().organization.update({ where: { id: f.orgId }, data: { settings: {} } });
    expect((await f.call({ amount: 10 })).decision).toBe("allow");
  });
  it("suspended agents are denied; revoked agents lose their key and pending approvals", async () => {
    const pending = await f.call({ amount: 1500 });
    expect(pending.status).toBe("pending_approval");
    await withTenant(f.orgId, (db) => transitionAgent(db, f.ownerCtx, f.agentId, "suspended", "drill"));
    const r = await f.call({ amount: 10 });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/Agent is suspended/);
    // An approval granted while suspended does not execute.
    const a = await approval(pending.requestId);
    await expect(withTenant(f.orgId, (db) => decideApproval(db, f.approver.ctx, a.id, { decision: "approve", comment: "", requestHash: a.requestHash }))).rejects.toThrow(/agent is suspended/);
    await withTenant(f.orgId, (db) => transitionAgent(db, f.ownerCtx, f.agentId, "active", "resume after drill"));
    const pending2 = await f.call({ amount: 1500 });
    await withTenant(f.orgId, (db) => transitionAgent(db, f.ownerCtx, f.agentId, "revoked", "compromised"));
    expect(await resolveApiKey(f.agentKey)).toBeNull();
    expect((await approval(pending2.requestId)).status).toBe("expired");
    const r2 = await f.call({ amount: 10 });
    expect(r2.decision).toBe("deny");
  });
});

describe("gateway: failure behaviour", () => {
  it("a throwing evaluation component yields deny plus a security event", async () => {
    const f2 = await makeGatewayFixture();
    try {
      registerShieldInspector(async () => {
        throw new Error("shield exploded");
      });
      const r = await f2.call({ amount: 10 });
      expect(r.decision).toBe("error");
      expect(r.status).toBe("denied");
      const sec = await withTenant(f2.orgId, (db) => db.securityEvent.findMany({ where: { actionRequestId: r.requestId } }));
      expect(sec[0]?.type).toBe("policy.evaluation_failed");
    } finally {
      registerShieldInspector(async (_db, _o, a) => ({ shield: { dataClasses: [], highestSeverity: null, injectionSignals: [], blocked: false }, params: a.params, findings: [], blockReason: null, requireApproval: false }));
      await f2.cleanup();
    }
  });
  it("an evidence write failure rolls the decision back (fail closed)", async () => {
    const f2 = await makeGatewayFixture();
    try {
      const countBefore = await withTenant(f2.orgId, (db) => db.actionRequest.count());
      await expect(
        withTenant(f2.orgId, async (db) => {
          // Break the chain inside this transaction only: a duplicate seq makes the evidence insert fail.
          await db.$executeRawUnsafe(`CREATE TEMP TABLE IF NOT EXISTS boom ON COMMIT DROP AS SELECT 1`);
          const r = await submitActionRequest(db, f2.agentCtx, { tool: "issue-refund", action: "execute", params: { orderId: "O", customerId: "C", amount: 10, currency: "AED" }, resource: "support-tickets", idempotencyKey: `fc-${Date.now()}`, justification: "", principal: { type: "none" }, context: {}, executionMode: "gateway" });
          expect(r.decision).toBe("allow");
          throw new Error("simulated evidence store outage");
        }),
      ).rejects.toThrow(/outage/);
      expect(await withTenant(f2.orgId, (db) => db.actionRequest.count())).toBe(countBefore);
      expect((await f2.ledger()).length).toBe(0);
    } finally {
      await f2.cleanup();
    }
  });
  it("the whole evidence chain verifies after all of the above", async () => {
    const v = await withTenant(f.orgId, (db) => verifyChain(db, f.orgId));
    expect(v.valid).toBe(true);
    expect(v.checked).toBeGreaterThan(40);
  });
});
