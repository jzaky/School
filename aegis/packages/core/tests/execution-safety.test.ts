/**
 * Regression tests for the execution safety findings:
 *  - several grants for one approved request allowed repeated downstream execution
 *  - the emergency pause blocked new requests but not previously approved actions
 *  - an ambiguous downstream outcome (call sent, response lost) was recorded as a plain failure
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ownerPrisma, rawPrisma, withTenant, type TenantDb } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { decideApproval, decideApprovalAndExecute } from "../src/approvals/service.js";
import { consumeGrant, issueGrant } from "../src/gateway/grants.js";
import { executeApprovedRequest, executeRequest, issueGrantForRequest, pauseGateway, reconcileExecution, resolveExecutionManually, resumeGateway, sweepStuckExecutions } from "../src/gateway/gateway.js";
import { getDownstreamSystem, registerDownstreamSystem, supportPlatformSimulator, type DownstreamSystem } from "../src/gateway/simulators.js";
import { transitionAgent } from "../src/agents/registry.js";
import { verifyChain } from "../src/evidence/ledger.js";

let f: GatewayFixture;
const run = <T>(fn: (db: TenantDb) => Promise<T>) => withTenant(f.orgId, fn);

beforeAll(async () => {
  f = await makeGatewayFixture();
});
afterAll(async () => {
  registerDownstreamSystem(supportPlatformSimulator);
  await f.cleanup();
});
afterEach(async () => {
  registerDownstreamSystem(supportPlatformSimulator);
  // Never leave the gateway paused for the next test.
  await run((db) => resumeGateway(db, f.ownerCtx, "test cleanup")).catch(() => undefined);
});

async function approvalFor(requestId: string) {
  return run((db) => db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: requestId } }));
}
async function request(id: string) {
  return run((db) => db.actionRequest.findUniqueOrThrow({ where: { id }, include: { receipts: { orderBy: { createdAt: "asc" } }, grants: true } }));
}
/** Agent-mode request above the autonomous limit: pending until an approver decides, then the agent fetches its grant. */
async function pendingAgentModeRequest(amount = 1500) {
  const r = await f.call({ amount, executionMode: "agent" });
  expect(r.status).toBe("pending_approval");
  return r;
}

describe("one live grant per request", () => {
  it("an approved agent-mode request yields exactly one grant; a second issuance is refused until the first is used or expires", async () => {
    const r = await pendingAgentModeRequest();
    const a = await approvalFor(r.requestId);
    const decided = await decideApprovalAndExecute(run, f.approver.ctx, a.id, { decision: "approve", comment: "ok", requestHash: a.requestHash });
    expect(decided.status).toBe("approved");
    expect(decided.executed).toBe(false);
    expect((await request(r.requestId)).grants.length).toBe(0); // approval itself issues nothing in agent mode

    const first = await run((db) => issueGrantForRequest(db, f.agentCtx, r.requestId));
    await expect(run((db) => issueGrantForRequest(db, f.agentCtx, r.requestId))).rejects.toThrow(/already outstanding/);
    expect((await request(r.requestId)).grants.filter((g) => !g.consumedAt && !g.voidedAt).length).toBe(1);

    // The downstream system verifies the one grant: the request moves to executing and no further grant can exist.
    const check = await run((db) => consumeGrant(db, first.grant, first.requestHash));
    expect(check.ok).toBe(true);
    expect((await request(r.requestId)).status).toBe("executing");
    await expect(run((db) => issueGrantForRequest(db, f.agentCtx, r.requestId))).rejects.toThrow(/executing/);
    const again = await run((db) => consumeGrant(db, first.grant, first.requestHash));
    expect(again).toEqual({ ok: false, reason: "consumed" });
  });

  it("the partial unique index refuses a second live grant even when the application check is bypassed", async () => {
    const r = await pendingAgentModeRequest();
    const a = await approvalFor(r.requestId);
    await decideApprovalAndExecute(run, f.approver.ctx, a.id, { decision: "approve", comment: "ok", requestHash: a.requestHash });
    await run((db) => issueGrantForRequest(db, f.agentCtx, r.requestId));
    await expect(
      ownerPrisma().$executeRawUnsafe(`INSERT INTO execution_grants (id, org_id, action_request_id, token_hash, request_hash, expires_at) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'x', 'y', now() + interval '5 minutes')`, f.orgId, r.requestId),
    ).rejects.toThrow(/execution_grants_one_live_per_request|unique constraint|duplicate key|23505/i);
  });

  it("an executed request can never receive another grant", async () => {
    const done = await f.call({ amount: 10 });
    expect(done.status).toBe("executed");
    await expect(run((db) => issueGrant(db, f.orgId, done.requestId, "any"))).rejects.toThrow(/executed/);
  });

  it("decideApproval alone no longer executes anything; execution is a separate phase after commit", async () => {
    const r = await f.call({ amount: 1500 });
    const a = await approvalFor(r.requestId);
    const before = (await f.ledger()).length;
    const decided = await run((db) => decideApproval(db, f.approver.ctx, a.id, { decision: "approve", comment: "ok", requestHash: a.requestHash }));
    expect(decided.status).toBe("approved");
    expect(decided.executed).toBe(false);
    expect((await f.ledger()).length).toBe(before);
    expect((await request(r.requestId)).status).toBe("approved");
    // The gateway phase executes exactly once; a repeat returns the recorded receipt.
    const exec = decided.status === "approved" && decided.executeNow ? decided.executeNow : null;
    expect(exec).not.toBeNull();
    const out1 = await executeRequest(run, f.approver.ctx, r.requestId, exec!.grantToken, exec!.params);
    expect(out1.status).toBe("succeeded");
    const out2 = await executeRequest(run, f.approver.ctx, r.requestId, exec!.grantToken, exec!.params);
    expect(out2.reference).toBe(out1.reference);
    expect((await f.ledger()).length).toBe(before + 1);
  });
});

describe("emergency pause stops outstanding actions", () => {
  it("blocks approval of pending requests while paused, voids live grants, and lets work resume afterwards", async () => {
    const pending = await pendingAgentModeRequest();
    const a = await approvalFor(pending.requestId);
    const approved = await pendingAgentModeRequest();
    const a2 = await approvalFor(approved.requestId);
    await decideApprovalAndExecute(run, f.approver.ctx, a2.id, { decision: "approve", comment: "ok", requestHash: a2.requestHash });
    const grant = await run((db) => issueGrantForRequest(db, f.agentCtx, approved.requestId));

    const paused = await run((db) => pauseGateway(db, f.ownerCtx, "incident drill"));
    expect(paused.voidedGrants).toBeGreaterThanOrEqual(1);
    expect((await request(approved.requestId)).grants.every((g) => g.voidedAt || g.consumedAt)).toBe(true);

    // 1. New requests are denied at the baseline (already covered elsewhere), 2. pending approvals cannot proceed,
    await expect(decideApprovalAndExecute(run, f.approver.ctx, a.id, { decision: "approve", comment: "ok", requestHash: a.requestHash })).rejects.toThrow(/paused/);
    expect((await request(pending.requestId)).status).toBe("pending_approval");
    // 3. an already approved request cannot obtain a grant, 4. a previously issued grant no longer verifies.
    await expect(run((db) => issueGrantForRequest(db, f.agentCtx, approved.requestId))).rejects.toThrow(/paused/);
    expect(await run((db) => consumeGrant(db, grant.grant, grant.requestHash))).toEqual({ ok: false, reason: "voided" });

    await run((db) => resumeGateway(db, f.ownerCtx, "drill complete"));
    const decided = await decideApprovalAndExecute(run, f.approver.ctx, a.id, { decision: "approve", comment: "ok", requestHash: a.requestHash });
    expect(decided.status).toBe("approved");
    const fresh = await run((db) => issueGrantForRequest(db, f.agentCtx, approved.requestId));
    expect((await run((db) => consumeGrant(db, fresh.grant, fresh.requestHash))).ok).toBe(true);
  });

  it("gateway-mode execution between decision and call is refused while paused and the request stays approved", async () => {
    const r = await f.call({ amount: 1500 });
    const a = await approvalFor(r.requestId);
    const decided = await run((db) => decideApproval(db, f.approver.ctx, a.id, { decision: "approve", comment: "ok", requestHash: a.requestHash }));
    const exec = decided.status === "approved" ? decided.executeNow! : null!;
    await run((db) => pauseGateway(db, f.ownerCtx, "drill"));
    await expect(executeRequest(run, f.approver.ctx, r.requestId, exec.grantToken, exec.params)).rejects.toThrow(/paused/);
    expect((await request(r.requestId)).status).toBe("approved");
    expect((await request(r.requestId)).receipts.length).toBe(0);
    await run((db) => resumeGateway(db, f.ownerCtx, "ok"));
    // The grant was voided by the pause; the approver re-runs execution, which issues a fresh grant and executes once.
    const out = await executeApprovedRequest(run, f.approver.ctx, r.requestId);
    expect(out.status).toBe("succeeded");
    expect((await request(r.requestId)).status).toBe("executed");
    await expect(executeApprovedRequest(run, f.approver.ctx, r.requestId)).rejects.toThrow(/nothing to execute/);
  });

  it("suspending an agent voids its live grants", async () => {
    const approved = await pendingAgentModeRequest();
    const a = await approvalFor(approved.requestId);
    await decideApprovalAndExecute(run, f.approver.ctx, a.id, { decision: "approve", comment: "ok", requestHash: a.requestHash });
    const grant = await run((db) => issueGrantForRequest(db, f.agentCtx, approved.requestId));
    await run((db) => transitionAgent(db, f.ownerCtx, f.agentId, "suspended", "drill"));
    expect(await run((db) => consumeGrant(db, grant.grant, grant.requestHash))).toEqual({ ok: false, reason: "voided" });
    await run((db) => transitionAgent(db, f.ownerCtx, f.agentId, "active", "resume after drill"));
  });
});

describe("ambiguous downstream outcomes", () => {
  function flaky(behaviour: "lost-response" | "fails-before-send" | "lost-and-unreconcilable"): DownstreamSystem {
    const real = supportPlatformSimulator;
    return {
      key: real.key,
      kind: "simulated",
      label: "flaky",
      async execute(ctx, req) {
        if (behaviour === "fails-before-send") return { outcome: "failed", reference: null, summary: {}, error: "connection refused before sending" };
        await real.execute(ctx, req); // the side effect happens downstream
        throw new Error("socket hang up: response lost"); // but we never learn about it
      },
      reconcile: behaviour === "lost-and-unreconcilable" ? undefined : real.reconcile,
      testConnection: real.testConnection,
    };
  }

  it("a lost response is recorded as unknown, kept executing, and reconciled from the downstream record without a second side effect", async () => {
    registerDownstreamSystem(flaky("lost-response"));
    const before = (await f.ledger()).length;
    const r = await f.call({ amount: 10 });
    expect(r.status).toBe("executing");
    expect(r.receipt?.status).toBe("unknown");
    expect((await f.ledger()).length).toBe(before + 1);
    registerDownstreamSystem(supportPlatformSimulator);

    const out = await reconcileExecution(run, f.ownerCtx, r.requestId);
    expect(out.status).toBe("succeeded");
    expect(out.requestStatus).toBe("executed");
    expect(out.reference).toMatch(/^RFD-/);
    const row = await request(r.requestId);
    expect(row.status).toBe("executed");
    expect(row.receipts.map((x) => x.status)).toEqual(["unknown", "succeeded"]);
    expect((await f.ledger()).length).toBe(before + 1);
    // A reconcile job was queued for the worker as well; it is idempotent.
    expect(await rawPrisma().job.count({ where: { type: "execution.reconcile", payload: { path: ["actionRequestId"], equals: r.requestId } } })).toBe(1);
  });

  it("a definitive failure before anything was sent is recorded as failed, not unknown", async () => {
    registerDownstreamSystem(flaky("fails-before-send"));
    const r = await f.call({ amount: 10 });
    expect(r.status).toBe("failed");
    expect(r.receipt?.status).toBe("failed");
  });

  it("the sweep reconciles requests left executing by a crash between phases", async () => {
    registerDownstreamSystem(flaky("lost-response"));
    const r = await f.call({ amount: 10 });
    expect(r.status).toBe("executing");
    registerDownstreamSystem(supportPlatformSimulator);
    await ownerPrisma().$executeRawUnsafe(`UPDATE action_requests SET updated_at = now() - interval '10 minutes' WHERE id = $1::uuid`, r.requestId);
    expect(await sweepStuckExecutions(run, f.ownerCtx)).toBeGreaterThanOrEqual(1);
    expect((await request(r.requestId)).status).toBe("executed");
  });

  it("when the downstream system cannot tell, the request becomes unknown with a security event and a human settles it", async () => {
    registerDownstreamSystem(flaky("lost-and-unreconcilable"));
    const r = await f.call({ amount: 10 });
    expect(r.status).toBe("executing");
    const out = await reconcileExecution(run, f.ownerCtx, r.requestId, { force: true });
    expect(out.requestStatus).toBe("unknown");
    expect(await run((db) => db.securityEvent.count({ where: { actionRequestId: r.requestId, type: "execution.outcome_unknown" } }))).toBe(1);
    await expect(run((db) => resolveExecutionManually(db, f.viewer.ctx, r.requestId, { outcome: "succeeded", reference: "RFD-MANUAL", reason: "checked the platform" }))).rejects.toThrow(/agents:control/);
    const settled = await run((db) => resolveExecutionManually(db, f.ownerCtx, r.requestId, { outcome: "succeeded", reference: "RFD-MANUAL", reason: "Refund visible in the support platform under this idempotency key" }));
    expect(settled.requestStatus).toBe("executed");
    expect((await request(r.requestId)).receipts.map((x) => x.status)).toEqual(["unknown", "unknown", "succeeded"]);
  });

  it("downstream idempotency: replaying the same request to the simulator returns the first result instead of acting twice", async () => {
    const sim = getDownstreamSystem("support-platform-sim")!;
    const r = await f.call({ amount: 10 });
    const row = await request(r.requestId);
    const grant = row.grants[0]!;
    const before = (await f.ledger()).length;
    const ctx = { orgId: f.orgId, integrationId: f.integrationId, run, credential: () => Promise.resolve("sim-secret") };
    const req = { actionRequestId: r.requestId, idempotencyKey: `aegis:${r.requestId}`, attempt: 2, toolKey: row.toolKey, action: row.action, params: row.params as Record<string, unknown>, correlationId: row.correlationId, agentSlug: "support-refund-agent", grant: { requestHash: grant.requestHash, consumedAt: grant.consumedAt! } };
    const replay = await sim.execute(ctx, req);
    expect(replay.outcome).toBe("succeeded");
    expect(replay.summary.idempotentReplay).toBe(true);
    expect(replay.reference).toBe(r.receipt?.reference);
    expect((await f.ledger()).length).toBe(before);
    // and a parameter swap is still caught by the grant binding
    const swapped = await sim.execute(ctx, { ...req, params: { ...req.params, amount: 9999 } });
    expect(swapped.outcome).toBe("failed");
    expect(swapped.error).toMatch(/do not match/);
  });

  it("the evidence chain still verifies after every scenario above", async () => {
    const v = await run((db) => verifyChain(db, f.orgId));
    expect(v.valid).toBe(true);
  });
});
