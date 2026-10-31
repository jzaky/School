import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerPrisma, withTenant } from "@aegis/db";
import { pauseGateway, registerUser, resumeGateway } from "@aegis/core";
import { app, attacker, domain, gateway, login, nextIp, PASSWORD, refundWorld as g, setupRefundAgents, setupWorld, teardownWorld } from "./attack-harness.js";

/**
 * Validation phase 2: race conditions over HTTP. Each test fires the same attack many times at once and checks the
 * invariant afterwards. Passing shows resistance to these races at this concurrency, not to every interleaving.
 */
beforeAll(async () => {
  await setupWorld();
  await setupRefundAgents();
}, 300_000);
afterAll(teardownWorld);

const { refund, submit } = gateway;
const PARALLEL = 12;

async function approver(label: string) {
  const email = `race-${label}-${Date.now().toString(36)}@${domain}`;
  const u = await registerUser({ email, name: `Approver ${label}`, password: PASSWORD });
  await withTenant(attacker.orgId, async (db) => {
    const role = await db.role.findUniqueOrThrow({ where: { orgId_key: { orgId: attacker.orgId, key: "approver" } } });
    await db.membership.create({ data: { orgId: attacker.orgId, userId: u.id, roleId: role.id } });
  });
  return login(email);
}

describe("races", () => {
  it("approvers deciding the same approval at once: one decision stands, and at most one grant exists", async () => {
    const held = await submit(g.refundKey, refund(1000));
    expect(held.status).toBe(202);
    const approval = await ownerPrisma().approvalRequest.findFirstOrThrow({ where: { actionRequestId: held.body.requestId! } });
    const cookies = await Promise.all(["a", "b", "c"].map(approver));
    const decisions = ["approve", "approve", "reject", "approve", "reject", "approve"];
    const answers = await Promise.all(
      decisions.map((decision, i) => app.inject({ method: "POST", url: `/v1/approvals/${approval.id}/decide`, headers: { cookie: cookies[i % cookies.length]! }, payload: { decision, comment: "race", requestHash: approval.requestHash }, remoteAddress: nextIp() })),
    );
    expect(answers.every((a) => a.statusCode < 500)).toBe(true);
    const after = await ownerPrisma().approvalRequest.findUniqueOrThrow({ where: { id: approval.id } });
    expect(["approved", "rejected"]).toContain(after.status);
    const grants = await ownerPrisma().executionGrant.count({ where: { actionRequestId: held.body.requestId! } });
    expect(grants).toBeLessThanOrEqual(1);
    if (after.status === "rejected") expect(grants).toBe(0);
  });

  it("one grant verified by many downstream calls at once is consumed exactly once", async () => {
    const body = refund(150);
    const a = await submit(g.refundKey, body);
    expect(a.status).toBe(200);
    const token = (a.body as { grant?: { token: string } }).grant!.token;
    const answers = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) => app.inject({ method: "POST", url: "/v1/gateway/grants/verify", headers: { authorization: `Bearer ${attacker.integrationKeys[i % attacker.integrationKeys.length]}` }, payload: { grant: token, toolKey: "issue-refund", action: "execute", params: body.params }, remoteAddress: nextIp() })),
    );
    expect(answers.filter((r) => r.statusCode === 200).length).toBe(1);
    expect(answers.every((r) => r.statusCode === 200 || r.statusCode === 403)).toBe(true);
  });

  it("one idempotency key sent at once with small and large amounts never yields an allow for the large amount", async () => {
    const key = `race-${randomUUID()}`;
    const base = refund(100, { idempotencyKey: key });
    const bodies = Array.from({ length: PARALLEL }, (_, i) => ({ ...base, params: { ...base.params, amount: i % 2 ? 9999 : 100 } }));
    const answers = await Promise.all(bodies.map((b) => submit(g.refundKey, b)));
    expect(answers.every((r) => r.status < 500)).toBe(true);
    const rows = await ownerPrisma().actionRequest.findMany({ where: { orgId: attacker.orgId, idempotencyKey: key } });
    expect(rows.length).toBe(1);
    const stored = (rows[0]!.params as { amount: number }).amount;
    for (const r of answers) if (r.body.decision === "allow") expect(stored).toBe(100);
    const live = await ownerPrisma().executionGrant.count({ where: { actionRequestId: rows[0]!.id, consumedAt: null, voidedAt: null } });
    expect(live).toBeLessThanOrEqual(1);
  });

  it("many refunds for the same order at once: at most one is allowed", async () => {
    const orderId = gateway.order();
    const answers = await Promise.all(Array.from({ length: PARALLEL }, () => submit(g.refundKey, { ...refund(100), params: { orderId, customerId: "CUST-1", amount: 100, currency: "AED" } })));
    expect(answers.every((r) => r.status < 500)).toBe(true);
    expect(answers.filter((r) => r.body.decision === "allow").length).toBeLessThanOrEqual(1);
  });

  it("an agent starting the same granted request many times at once starts it once", async () => {
    const a = await submit(g.refundKey, refund(120));
    expect(a.status).toBe(200);
    const token = (a.body as { grant?: { token: string } }).grant!.token;
    const answers = await Promise.all(Array.from({ length: PARALLEL }, () => app.inject({ method: "POST", url: `/v1/gateway/actions/${a.body.requestId}/start`, headers: { authorization: `Bearer ${g.refundKey}` }, payload: { grant: token }, remoteAddress: nextIp() })));
    expect(answers.filter((r) => r.statusCode === 200).length).toBe(1);
    expect(answers.every((r) => r.statusCode < 500)).toBe(true);
  });

  it("a pause racing with in-flight requests leaves no live grant behind", async () => {
    // The pause starts at several delays after the requests, so some decisions land before it and some after.
    // The test requires at least one round where both happened; otherwise it would prove nothing.
    let interleaved = false;
    for (const delayMs of [0, 10, 25, 50, 100, 200]) {
      const inflight = Array.from({ length: PARALLEL }, () => submit(g.refundKey, refund(50)));
      await new Promise((r) => setTimeout(r, delayMs));
      await withTenant(attacker.orgId, (db) => pauseGateway(db, g.ownerCtx, `race test ${delayMs}ms`));
      const answers = await Promise.all(inflight);
      try {
        expect(answers.every((r) => r.status < 500)).toBe(true);
        const live = await ownerPrisma().executionGrant.count({ where: { orgId: attacker.orgId, consumedAt: null, voidedAt: null } });
        expect(live, `live grants after a pause at ${delayMs}ms`).toBe(0);
        expect((await submit(g.refundKey, refund(10))).body.decision).not.toBe("allow");
        const decisions = new Set(answers.map((a) => a.body.decision));
        if (decisions.has("allow") && decisions.has("deny")) interleaved = true;
      } finally {
        await withTenant(attacker.orgId, (db) => resumeGateway(db, g.ownerCtx, "race test done"));
      }
    }
    expect(interleaved).toBe(true);
  }, 120_000);
});
