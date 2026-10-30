/**
 * Deferred evidence (docs/PERFORMANCE.md): the gateway's request path holds the organization lock only for
 * the ledger writes and the commit. These tests try to break what the organization lock used to guarantee,
 * with real concurrency against the database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { authorizeAndExecute, type GatewayResponse } from "../src/gateway/gateway.js";
import { createAgent, grantResourcePermission, setAgentTool, transitionAgent } from "../src/agents/registry.js";
import { verifyChain } from "../src/evidence/ledger.js";
import { makeContext, type OrgContext } from "../src/lib/context.js";

let f: GatewayFixture;
const agents: OrgContext[] = [];
const deferred = <T>(orgId: string, fn: Parameters<typeof withTenant<T>>[1]) => withTenant(orgId, fn, { lock: "deferred" });
const stamp = Date.now().toString(36);

beforeAll(async () => {
  f = await makeGatewayFixture();
  agents.push(f.agentCtx);
  // Two more agents with the same tool and permissions, assigned the same policy through the organization.
  await withTenant(f.orgId, async (db) => {
    const tool = await db.tool.findFirstOrThrow({ where: { key: "issue-refund" } });
    const resource = await db.resource.findFirstOrThrow({ where: { key: "support-tickets" } });
    const policy = await db.policy.findUniqueOrThrow({ where: { id: f.refundPolicyId } });
    await db.policyAssignment.create({ data: { orgId: f.orgId, policyId: policy.id, targetType: "org", priority: 100 } });
    for (let i = 0; i < 2; i++) {
      const a = await createAgent(db, f.engineer.ctx, { slug: `parallel-agent-${i}`, name: `Parallel ${i}`, description: "", environment: "production", modelProvider: "x", modelId: "y", dataClassificationLimit: "confidential", riskTier: "high", metadata: {} });
      await setAgentTool(db, f.engineer.ctx, a.id, tool.id, true);
      await grantResourcePermission(db, f.engineer.ctx, a.id, resource.id, ["read", "write", "execute"]);
      await transitionAgent(db, f.engineer.ctx, a.id, "registered", "ok");
      await transitionAgent(db, f.engineer.ctx, a.id, "active", "ok");
      agents.push(makeContext(f.orgId, { type: "agent", id: a.id }));
    }
  });
}, 120_000);
afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});

const refund = (ctx: OrgContext, orderId: string, idem: string, amount = 100): Promise<GatewayResponse> =>
  authorizeAndExecute(deferred, { ...ctx, requestId: crypto.randomUUID() }, { tool: "issue-refund", action: "execute", params: { orderId, customerId: "CUST-1", amount, currency: "AED" }, resource: "support-tickets", idempotencyKey: idem, justification: "test", principal: {}, context: {}, executionMode: "gateway" } as never);

describe("deferred evidence under concurrency", () => {
  it("two agents refunding the same order at the same moment: only one goes through, in five races", async () => {
    for (let round = 0; round < 5; round++) {
      const order = `ORD-${stamp}-race-${round}`;
      const results = await Promise.all([refund(agents[1]!, order, `idem-${stamp}-race-${round}-a`), refund(agents[2]!, order, `idem-${stamp}-race-${round}-b`)]);
      expect(results.filter((r) => r.decision === "allow")).toHaveLength(1);
      expect(results.filter((r) => r.decision !== "allow")[0]!.reasons.join(" ")).toMatch(/already exists|duplicate/i);
    }
  });

  it("many decisions at once from several agents leave one unbroken, contiguous evidence chain", async () => {
    const before = await withTenant(f.orgId, (db) => db.evidenceEvent.count());
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => refund(agents[i % 3]!, `ORD-${stamp}-par-${i}`, `idem-${stamp}-par-${i}`, [100, 1200, 9000][i % 3])));
    expect(results.every((r) => ["allow", "require_approval", "deny"].includes(r.decision))).toBe(true);
    const chain = await withTenant(f.orgId, (db) => verifyChain(db, f.orgId), { readOnly: true });
    expect(chain.reason ?? "valid").toBe("valid");
    expect(chain.valid).toBe(true);
    const seqs = await withTenant(f.orgId, (db) => db.evidenceEvent.findMany({ orderBy: { seq: "asc" }, select: { seq: true } }));
    seqs.forEach((s, i) => expect(s.seq).toBe(BigInt(i + 1)));
    expect(seqs.length).toBeGreaterThan(before + 30);
  });

  it("the same idempotency key sent five times at once creates one request and executes once", async () => {
    const key = `idem-${stamp}-same`;
    const results = await Promise.all(Array.from({ length: 5 }, () => refund(agents[0]!, `ORD-${stamp}-same`, key)));
    const requests = await withTenant(f.orgId, (db) => db.actionRequest.findMany({ where: { idempotencyKey: key }, include: { receipts: true } }));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.receipts.filter((r) => r.status === "succeeded")).toHaveLength(1);
    expect(results.filter((r) => r.duplicate).length).toBe(4);
  });

  it("evidence written at commit is identical in shape to evidence written immediately", async () => {
    const r = await refund(agents[0]!, `ORD-${stamp}-shape`, `idem-${stamp}-shape`);
    const events = await withTenant(f.orgId, (db) => db.evidenceEvent.findMany({ where: { subjectId: r.requestId }, orderBy: { seq: "asc" } }));
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["gateway.request_received", `gateway.decision.${r.decision}`]));
    expect(events.every((e) => /^[0-9a-f]{64}$/.test(e.hash) && e.seq > 0n)).toBe(true);
    const chain = await withTenant(f.orgId, (db) => verifyChain(db, f.orgId), { readOnly: true });
    expect(chain.valid).toBe(true);
  });

  it("a decision that fails rolls back its evidence with it", async () => {
    const before = await withTenant(f.orgId, (db) => db.evidenceEvent.count());
    await expect(deferred(f.orgId, async (db) => {
      const { appendEvidence } = await import("../src/evidence/ledger.js");
      await appendEvidence(db, f.ownerCtx, { type: "test.should_not_persist", subjectType: "test" });
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await withTenant(f.orgId, (db) => db.evidenceEvent.count())).toBe(before);
  });
});
