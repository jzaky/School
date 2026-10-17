/**
 * The Stripe test-mode refund connector exercised through the real gateway against a fake Stripe
 * HTTP server (tests/fixtures/fake-stripe.ts). Every assertion about "what Stripe holds" reads the
 * fake's own records, and receipts are reconciled against them: reference equals the refund id and
 * the minor-unit amounts match.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type TenantDb } from "@aegis/db";
import { addUserWithRole, makeTestTenant, type TestTenant } from "./helpers.js";
import { startFakeStripe, type FakeStripe } from "./fixtures/fake-stripe.js";
import { createAgent, grantResourcePermission, setAgentTool, transitionAgent, upsertResource, upsertTool } from "../src/agents/registry.js";
import { createIntegration, setIntegrationStatus, storeCredential, testIntegrationConnection } from "../src/integrations/service.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../src/policy/service.js";
import { makeContext, type OrgContext } from "../src/lib/context.js";
import { encryptSecret, hashObject } from "../src/lib/crypto.js";
import { authorizeAndExecute, pauseGateway, reconcileExecution, resumeGateway, type ActionRequestInput, type GatewayResponse } from "../src/gateway/gateway.js";
import { decideApprovalAndExecute, expireApproval } from "../src/approvals/service.js";
import { installConnectors } from "../src/gateway/connectors/index.js";
import { STRIPE_CREDENTIAL_NAME, STRIPE_TEST_KEY_MESSAGE, stripeTestConnector, toMinorUnits } from "../src/gateway/connectors/stripe.js";
import { getDownstreamSystem } from "../src/gateway/simulators.js";
import { verifyChain } from "../src/evidence/ledger.js";

/** Fixture keys are assembled at runtime so no key-shaped literal exists in source (push protection, secret scanners). */
const fakeKey = (prefix: "sk" | "rk", mode: "test" | "live", body: string) => [prefix, mode, body].join("_");
const TEST_KEY = fakeKey("sk", "test", "51FakeKeyForTheLocalStripeEmulator0000");

let fake: FakeStripe;
let t: TestTenant;
let agentId: string;
let agentCtx: OrgContext;
let integrationId: string;
let approver: { userId: string; ctx: OrgContext };
let engineer: { userId: string; ctx: OrgContext };
const run = <T>(fn: (db: TenantDb) => Promise<T>) => withTenant(t.orgId, fn);
let n = 0;

const REFUND_POLICY = {
  version: 1,
  appliesTo: { tools: ["refund-payment"] },
  rules: [
    { id: "no-duplicate", description: "One refund request per payment", effect: "deny", when: { attr: "context.priorRequestsSameReference", op: "gt", value: 0 }, reason: "A refund for this payment was already requested", riskIndicators: ["duplicate_reference"] },
    { id: "autonomous-under-50", effect: "allow", when: { all: [{ attr: "params.amount", op: "gt", value: 0 }, { attr: "params.amount", op: "lt", value: 50 }] }, reason: "Within autonomous refund limit (below 50)" },
    { id: "approval-50-500", effect: "require_approval", when: { attr: "params.amount", op: "between", value: [50, 500] }, approval: { roles: ["approver"], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, instructions: "Confirm the customer is entitled to the refund." }, reason: "Approval required between 50 and 500" },
    { id: "deny-over-500", effect: "deny", when: { attr: "params.amount", op: "gt", value: 500 }, reason: "Refund exceeds the agent's authority (above 500)", securityEventSeverity: "medium" },
  ],
};

function refund(input: Partial<ActionRequestInput> & { pi: string; amount: number; currency?: string; orderId?: string }): Promise<GatewayResponse> {
  n += 1;
  const { pi, amount, currency, orderId, ...rest } = input;
  return authorizeAndExecute(withTenant, agentCtx, {
    tool: "refund-payment",
    action: "execute",
    params: { paymentIntentId: pi, amount, currency: currency ?? "AED", orderId: orderId ?? `ORD-${n}`, reason: "requested_by_customer" },
    resource: "support-tickets",
    idempotencyKey: `stripe-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 8)}`,
    justification: "test",
    principal: { type: "none" },
    context: {},
    executionMode: "gateway",
    ...rest,
  });
}
const posts = () => fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/refunds");
const approvalFor = (requestId: string) => run((db) => db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: requestId } }));
const request = (id: string) => run((db) => db.actionRequest.findUniqueOrThrow({ where: { id }, include: { receipts: { orderBy: { createdAt: "asc" } }, grants: true } }));

beforeAll(async () => {
  installConnectors();
  fake = await startFakeStripe();
  t = await makeTestTenant("stripe");
  approver = await addUserWithRole(t, "approver", "appr");
  engineer = await addUserWithRole(t, "engineer", "eng");
  const built = await run(async (db) => {
    const { integration } = await createIntegration(db, engineer.ctx, { key: "stripe-test", name: "Stripe (test mode)", type: "payments", description: "", baseUrl: fake.url });
    await db.integration.update({ where: { id: integration.id }, data: { settings: { kind: "sandbox", simulated: false, baseUrl: fake.url } } });
    await storeCredential(db, engineer.ctx, integration.id, STRIPE_CREDENTIAL_NAME, TEST_KEY);
    const tool = await upsertTool(db, engineer.ctx, {
      key: "refund-payment",
      name: "Refund payment (Stripe)",
      description: "",
      integrationId: integration.id,
      riskLevel: "high",
      parameterSchema: { type: "object", required: ["paymentIntentId", "amount", "currency"], properties: { paymentIntentId: { type: "string", pattern: "^pi_" }, amount: { type: "number", minimum: 0.01 }, currency: { type: "string", enum: ["AED", "USD", "EUR", "GBP", "JPY"] }, orderId: { type: "string" }, customerId: { type: "string" }, reason: { type: "string", enum: ["duplicate", "fraudulent", "requested_by_customer"] } }, additionalProperties: false },
      destinationRules: { allowedDomains: [], allowedResourceKeys: ["support-tickets"] },
    });
    const resource = await upsertResource(db, engineer.ctx, { key: "support-tickets", name: "Tickets", type: "application", classification: "internal", attributes: {} });
    const agent = await createAgent(db, engineer.ctx, { slug: "support-refund-agent", name: "Support Refund Agent", description: "", environment: "production", modelProvider: "x", modelId: "y", dataClassificationLimit: "confidential", riskTier: "high", metadata: {}, technicalOwnerId: engineer.userId });
    await setAgentTool(db, engineer.ctx, agent.id, tool.id, true);
    await grantResourcePermission(db, engineer.ctx, agent.id, resource.id, ["read", "write", "execute"]);
    await transitionAgent(db, engineer.ctx, agent.id, "registered", "ok");
    await transitionAgent(db, engineer.ctx, agent.id, "active", "ok");
    const { policy, version } = await createPolicy(db, t.ownerCtx, { key: "stripe-refund-tiers", name: "Stripe refund tiers", description: "", category: "authorization", document: REFUND_POLICY, changeNote: "init" });
    await submitForReview(db, t.ownerCtx, version.id);
    await activateVersion(db, t.ownerCtx, version.id, { fourEyes: false });
    await assignPolicy(db, t.ownerCtx, policy.id, { targetType: "agent", targetId: agent.id, priority: 100 });
    return { agentId: agent.id, integrationId: integration.id };
  });
  agentId = built.agentId;
  integrationId = built.integrationId;
  agentCtx = makeContext(t.orgId, { type: "agent", id: agentId });
});

afterEach(async () => {
  fake.mode = "normal";
  await run((db) => resumeGateway(db, t.ownerCtx, "test cleanup")).catch(() => undefined);
});

afterAll(async () => {
  await fake.close().catch(() => undefined);
  await t.cleanup();
});

describe("stripe-test connector: money movement through the gateway", () => {
  it("is registered as a sandbox system", () => {
    const s = getDownstreamSystem("stripe-test");
    expect(s?.kind).toBe("sandbox");
    expect(s?.label).toBe("Stripe (test mode)");
  });

  it("converts amounts to minor units per currency", () => {
    expect(toMinorUnits(12.5, "AED")).toBe(1250);
    expect(toMinorUnits(0.01, "USD")).toBe(1);
    expect(toMinorUnits(1500, "JPY")).toBe(1500);
    expect(toMinorUnits(1.23, "KWD")).toBe(1230);
    expect(() => toMinorUnits(12.505, "AED")).toThrow(/precision/);
    expect(() => toMinorUnits(0, "AED")).toThrow(/positive/);
  });

  it("a small refund executes once and Stripe holds exactly one refund with the right minor units and AEGIS metadata", async () => {
    const pi = fake.seedPaymentIntent(100_00);
    const before = posts().length;
    const r = await refund({ pi: pi.id, amount: 12.5, orderId: "ORD-A1" });
    expect(r.decision).toBe("allow");
    expect(r.status).toBe("executed");
    expect(r.receipt?.status).toBe("succeeded");
    const held = fake.refunds().filter((x) => x.payment_intent === pi.id);
    expect(held).toHaveLength(1);
    expect(held[0]!.amount).toBe(1250);
    expect(held[0]!.metadata).toMatchObject({ aegis_request_id: r.requestId, aegis_org_id: t.orgId, aegis_correlation_id: r.correlationId, aegis_order_id: "ORD-A1" });
    // Receipt reconciled with the downstream record.
    expect(r.receipt?.reference).toBe(held[0]!.id);
    expect(r.receipt?.summary.amountMinor).toBe(1250);
    expect(r.receipt?.summary.requestedAmountMinor).toBe(1250);
    expect(posts().length).toBe(before + 1);
    const call = posts().at(-1)!;
    expect(call.headers["idempotency-key"]).toBe(`aegis:${r.requestId}`);
    expect(call.headers["stripe-version"]).toBe("2024-06-20");
    expect(call.headers.authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(call.body.payment_intent).toBe(pi.id);
    expect(call.body.amount).toBe("1250");
    expect(call.body.reason).toBe("requested_by_customer");
  });

  it("zero-decimal currencies are sent as whole units", async () => {
    const pi = fake.seedPaymentIntent(5000, "jpy");
    const r = await refund({ pi: pi.id, amount: 20, currency: "JPY" });
    expect(r.status).toBe("executed");
    expect(fake.refunds().find((x) => x.payment_intent === pi.id)!.amount).toBe(20);
  });

  it("a larger refund waits for a named approver and executes exactly once on approval", async () => {
    const pi = fake.seedPaymentIntent(1000_00);
    const before = posts().length;
    const r = await refund({ pi: pi.id, amount: 120 });
    expect(r.decision).toBe("require_approval");
    expect(r.status).toBe("pending_approval");
    expect(r.approval?.requiredRoles).toEqual(["approver"]);
    expect(posts().length).toBe(before);
    expect(fake.refunds().filter((x) => x.payment_intent === pi.id)).toHaveLength(0);
    const a = await approvalFor(r.requestId);
    const decided = await decideApprovalAndExecute(run, approver.ctx, a.id, { decision: "approve", comment: "entitled", requestHash: a.requestHash });
    expect(decided.status).toBe("approved");
    expect(decided.executed).toBe(true);
    expect(decided.receipt?.status).toBe("succeeded");
    const held = fake.refunds().filter((x) => x.payment_intent === pi.id);
    expect(held).toHaveLength(1);
    expect(held[0]!.amount).toBe(12000);
    expect(decided.receipt?.reference).toBe(held[0]!.id);
    expect(posts().length).toBe(before + 1);
    await expect(decideApprovalAndExecute(run, approver.ctx, a.id, { decision: "approve", comment: "again", requestHash: a.requestHash })).rejects.toThrow(/approved/);
    expect(fake.refunds().filter((x) => x.payment_intent === pi.id)).toHaveLength(1);
  });

  it("a prohibited amount is denied with no HTTP call", async () => {
    const pi = fake.seedPaymentIntent(10000_00);
    const before = fake.requests.length;
    const r = await refund({ pi: pi.id, amount: 750 });
    expect(r.decision).toBe("deny");
    expect(r.status).toBe("denied");
    expect(r.reasons.join(" ")).toMatch(/exceeds the agent's authority/);
    expect(fake.requests.length).toBe(before);
    expect(fake.refunds().filter((x) => x.payment_intent === pi.id)).toHaveLength(0);
  });

  it("a duplicate refund for the same payment intent is denied before reaching Stripe", async () => {
    const pi = fake.seedPaymentIntent(100_00);
    const first = await refund({ pi: pi.id, amount: 10, orderId: "ORD-DUP" });
    expect(first.status).toBe("executed");
    const before = fake.requests.length;
    const second = await refund({ pi: pi.id, amount: 10, orderId: "ORD-DUP" });
    expect(second.decision).toBe("deny");
    expect(second.reasons.join(" ")).toMatch(/already requested/);
    expect(second.matchedRuleIds).toContain("stripe-refund-tiers/no-duplicate");
    expect(fake.requests.length).toBe(before);
    expect(fake.refunds().filter((x) => x.payment_intent === pi.id)).toHaveLength(1);
  });

  it("an expired approval cannot execute", async () => {
    const pi = fake.seedPaymentIntent(1000_00);
    const r = await refund({ pi: pi.id, amount: 200 });
    const a = await approvalFor(r.requestId);
    await run((db) => db.approvalRequest.update({ where: { id: a.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    await expect(decideApprovalAndExecute(run, approver.ctx, a.id, { decision: "approve", comment: "", requestHash: a.requestHash })).rejects.toThrow(/expired/);
    const res = await run((db) => expireApproval(db, t.ownerCtx, a.id));
    expect(res.changed).toBe(true);
    expect((await request(r.requestId)).status).toBe("expired");
    expect(fake.refunds().filter((x) => x.payment_intent === pi.id)).toHaveLength(0);
  });

  it("modified parameters are rejected: at the gateway (same key, different amount) and downstream (grant binding, Stripe idempotency_error)", async () => {
    const pi = fake.seedPaymentIntent(1000_00);
    const key = `stripe-mod-${Date.now()}`;
    const params = { paymentIntentId: pi.id, amount: 15, currency: "AED", orderId: "ORD-M" };
    const first = await refund({ pi: pi.id, amount: 15, idempotencyKey: key, params });
    expect(first.status).toBe("executed");
    await expect(refund({ pi: pi.id, amount: 25, idempotencyKey: key, params: { ...params, amount: 25 } })).rejects.toThrow(/Idempotency key/);
    expect(fake.refunds().filter((x) => x.payment_intent === pi.id)).toHaveLength(1);

    // Downstream: the connector refuses parameters the consumed grant does not bind, before any HTTP call.
    const row = await request(first.requestId);
    const grant = row.grants[0]!;
    const ctx = { orgId: t.orgId, integrationId, run, credential: () => Promise.resolve(TEST_KEY) };
    const before = fake.requests.length;
    const swapped = await stripeTestConnector.execute(ctx, { actionRequestId: first.requestId, idempotencyKey: `aegis:${first.requestId}`, attempt: 2, toolKey: "refund-payment", action: "execute", params: { ...params, amount: 40 }, correlationId: row.correlationId, agentSlug: "support-refund-agent", grant: { requestHash: grant.requestHash, consumedAt: grant.consumedAt! } });
    expect(swapped.outcome).toBe("failed");
    expect(swapped.error).toMatch(/do not match/);
    expect(fake.requests.length).toBe(before);

    // And Stripe itself refuses a reused key with a different body (emulated), which the connector maps to failed.
    const tamperedHash = hashObject({ toolKey: "refund-payment", action: "execute", params: { ...params, amount: 40 } });
    const replayed = await stripeTestConnector.execute(ctx, { actionRequestId: first.requestId, idempotencyKey: `aegis:${first.requestId}`, attempt: 3, toolKey: "refund-payment", action: "execute", params: { ...params, amount: 40 }, correlationId: row.correlationId, agentSlug: "support-refund-agent", grant: { requestHash: tamperedHash, consumedAt: grant.consumedAt! } });
    expect(replayed.outcome).toBe("failed");
    expect(replayed.error).toMatch(/idempotency_error/);
    expect(fake.refunds().filter((x) => x.payment_intent === pi.id)).toHaveLength(1);

    // A true replay (same key, same body) returns the original refund and creates nothing.
    const same = await stripeTestConnector.execute(ctx, { actionRequestId: first.requestId, idempotencyKey: `aegis:${first.requestId}`, attempt: 4, toolKey: "refund-payment", action: "execute", params, correlationId: row.correlationId, agentSlug: "support-refund-agent", grant: { requestHash: grant.requestHash, consumedAt: grant.consumedAt! } });
    expect(same.outcome).toBe("succeeded");
    expect(same.reference).toBe(first.receipt?.reference);
    expect(fake.refunds().filter((x) => x.payment_intent === pi.id)).toHaveLength(1);
  });

  it("emergency pause blocks approval of an outstanding request; resuming lets it proceed exactly once", async () => {
    const pi = fake.seedPaymentIntent(1000_00);
    const r = await refund({ pi: pi.id, amount: 300 });
    expect(r.status).toBe("pending_approval");
    const a = await approvalFor(r.requestId);
    await run((db) => pauseGateway(db, t.ownerCtx, "incident drill"));
    await expect(decideApprovalAndExecute(run, approver.ctx, a.id, { decision: "approve", comment: "ok", requestHash: a.requestHash })).rejects.toThrow(/paused/);
    expect((await request(r.requestId)).status).toBe("pending_approval");
    expect(fake.refunds().filter((x) => x.payment_intent === pi.id)).toHaveLength(0);
    await run((db) => resumeGateway(db, t.ownerCtx, "drill complete"));
    const decided = await decideApprovalAndExecute(run, approver.ctx, a.id, { decision: "approve", comment: "ok", requestHash: a.requestHash });
    expect(decided.executed).toBe(true);
    const held = fake.refunds().filter((x) => x.payment_intent === pi.id);
    expect(held).toHaveLength(1);
    expect(held[0]!.amount).toBe(30000);
    expect(decided.receipt?.reference).toBe(held[0]!.id);
  });
});

describe("stripe-test connector: ambiguous outcomes and reconciliation", () => {
  it("a lost response yields receipt unknown and status executing; reconcile resolves it from Stripe's record without a second refund", async () => {
    const pi = fake.seedPaymentIntent(100_00);
    fake.mode = "lost-response";
    const r = await refund({ pi: pi.id, amount: 20 });
    expect(r.decision).toBe("allow");
    expect(r.status).toBe("executing");
    expect(r.receipt?.status).toBe("unknown");
    expect(r.receipt?.summary.stripe).toMatchObject({ responded: false });
    expect(fake.refunds().filter((x) => x.payment_intent === pi.id)).toHaveLength(1);
    fake.mode = "normal";
    const out = await reconcileExecution(run, t.ownerCtx, r.requestId);
    expect(out.status).toBe("succeeded");
    expect(out.requestStatus).toBe("executed");
    const held = fake.refunds().filter((x) => x.payment_intent === pi.id);
    expect(held).toHaveLength(1);
    expect(out.reference).toBe(held[0]!.id);
    expect(out.summary.amountMinor).toBe(2000);
    expect(out.summary.reconcileStrategy).toBe("list");
    const row = await request(r.requestId);
    expect(row.status).toBe("executed");
    expect(row.receipts.map((x) => x.status)).toEqual(["unknown", "succeeded"]);
  });

  it("a connection dropped before Stripe processed anything reconciles through the idempotent replay and still yields exactly one refund", async () => {
    const pi = fake.seedPaymentIntent(100_00);
    fake.mode = "drop-before-processing";
    const r = await refund({ pi: pi.id, amount: 30 });
    expect(r.status).toBe("executing");
    expect(fake.refunds().filter((x) => x.payment_intent === pi.id)).toHaveLength(0);
    fake.mode = "normal";
    const out = await reconcileExecution(run, t.ownerCtx, r.requestId);
    expect(out.status).toBe("succeeded");
    expect(out.summary.reconcileStrategy).toBe("replay");
    const held = fake.refunds().filter((x) => x.payment_intent === pi.id);
    expect(held).toHaveLength(1);
    expect(held[0]!.amount).toBe(3000);
    expect(out.reference).toBe(held[0]!.id);
    expect(held[0]!.metadata.aegis_request_id).toBe(r.requestId);
    // A second reconcile call returns the recorded receipt and sends nothing.
    const before = fake.requests.length;
    const again = await reconcileExecution(run, t.ownerCtx, r.requestId);
    expect(again.reference).toBe(out.reference);
    expect(fake.requests.length).toBe(before);
  });

  it("a 500 reply yields unknown, then reconciles to failed when Stripe holds no refund", async () => {
    const pi = fake.seedPaymentIntent(100_00);
    fake.mode = "server-error";
    const r = await refund({ pi: pi.id, amount: 20 });
    expect(r.status).toBe("executing");
    expect(r.receipt?.status).toBe("unknown");
    expect(r.receipt?.summary.stripe).toMatchObject({ responded: true, httpStatus: 500 });
    fake.mode = "normal";
    const out = await reconcileExecution(run, t.ownerCtx, r.requestId);
    expect(out.status).toBe("failed");
    expect(out.requestStatus).toBe("failed");
    expect(fake.refunds().filter((x) => x.payment_intent === pi.id)).toHaveLength(0);
    const row = await request(r.requestId);
    expect(row.receipts.map((x) => x.status)).toEqual(["unknown", "failed"]);
  });

  it("a definitive 4xx from Stripe (over-refund) is a failed receipt, not unknown", async () => {
    const pi = fake.seedPaymentIntent(10_00);
    const r = await refund({ pi: pi.id, amount: 25 });
    expect(r.decision).toBe("allow");
    expect(r.status).toBe("failed");
    expect(r.receipt?.status).toBe("failed");
    expect(String(r.receipt?.summary.error)).toMatch(/charge_already_refunded/);
    expect(fake.refunds().filter((x) => x.payment_intent === pi.id)).toHaveLength(0);
  });

  it("an unknown payment intent is a failed receipt (resource_missing)", async () => {
    const r = await refund({ pi: "pi_doesnotexist000", amount: 5 });
    expect(r.status).toBe("failed");
    expect(String(r.receipt?.summary.error)).toMatch(/resource_missing/);
  });
});

describe("stripe-test connector: key safety and connection test", () => {
  it("refuses live and malformed keys at store time, accepts test keys", async () => {
    await expect(run((db) => storeCredential(db, engineer.ctx, integrationId, "other-key", fakeKey("sk", "live", "51ThisWouldMoveRealMoney000000")))).rejects.toThrow(STRIPE_TEST_KEY_MESSAGE);
    await expect(run((db) => storeCredential(db, engineer.ctx, integrationId, "other-key", fakeKey("rk", "live", "51ThisWouldMoveRealMoney000000")))).rejects.toThrow(/Only Stripe test-mode keys/);
    await expect(run((db) => storeCredential(db, engineer.ctx, integrationId, "other-key", "not-a-stripe-key-at-all"))).rejects.toThrow(/Only Stripe test-mode keys/);
    expect(await run((db) => db.credential.count({ where: { integrationId, name: "other-key" } }))).toBe(0);
    const ok = await run((db) => storeCredential(db, engineer.ctx, integrationId, "restricted-key", fakeKey("rk", "test", "51RestrictedTestKey0000000000")));
    expect(ok.name).toBe("restricted-key");
    await run((db) => db.credential.delete({ where: { id: ok.id } }));
  });

  it("refuses a live key at execution time even if it bypassed the vault check, with no HTTP call", async () => {
    const cred = await run((db) => db.credential.findUniqueOrThrow({ where: { integrationId_name: { integrationId, name: STRIPE_CREDENTIAL_NAME } } }));
    await run((db) => db.credential.update({ where: { id: cred.id }, data: { secretEnc: encryptSecret(fakeKey("sk", "live", "51Tampered00000000000000000"), `credential:${cred.id}:${cred.name}`) } }));
    try {
      const pi = fake.seedPaymentIntent(100_00);
      const before = fake.requests.length;
      const r = await refund({ pi: pi.id, amount: 5 });
      expect(r.decision).toBe("allow");
      expect(r.status).toBe("failed");
      expect(String(r.receipt?.summary.error)).toMatch(/Only Stripe test-mode keys/);
      expect(fake.requests.length).toBe(before);
    } finally {
      await run((db) => db.credential.update({ where: { id: cred.id }, data: { secretEnc: encryptSecret(TEST_KEY, `credential:${cred.id}:${cred.name}`) } }));
    }
  });

  it("the connection test passes against the fake, records health and evidence, and fails when the fake is stopped", async () => {
    const ok = await testIntegrationConnection(run, engineer.ctx, integrationId);
    expect(ok.ok).toBe(true);
    expect(ok.detail).toBe("Stripe test mode reachable, livemode=false");
    expect(ok.kind).toBe("sandbox");
    let integ = await run((db) => db.integration.findUniqueOrThrow({ where: { id: integrationId } }));
    expect(integ.lastHealthOk).toBe(true);
    const ev = await run((db) => db.evidenceEvent.findMany({ where: { orgId: t.orgId, type: "integration.connection_tested", subjectId: integrationId } }));
    expect(ev.length).toBeGreaterThanOrEqual(1);
    const stopped = await startFakeStripe();
    await run((db) => db.integration.update({ where: { id: integrationId }, data: { settings: { kind: "sandbox", simulated: false, baseUrl: stopped.url } } }));
    await stopped.close();
    const bad = await testIntegrationConnection(run, engineer.ctx, integrationId);
    expect(bad.ok).toBe(false);
    expect(bad.detail).toMatch(/unreachable/);
    integ = await run((db) => db.integration.findUniqueOrThrow({ where: { id: integrationId } }));
    expect(integ.lastHealthOk).toBe(false);
    await run((db) => db.integration.update({ where: { id: integrationId }, data: { settings: { kind: "sandbox", simulated: false, baseUrl: fake.url } } }));
    // A viewer may not run it.
    const viewer = await addUserWithRole(t, "viewer", "view");
    await expect(testIntegrationConnection(run, viewer.ctx, integrationId)).rejects.toThrow(/integrations:write/);
  });

  it("a disabled integration denies at the gateway before any Stripe call", async () => {
    await run((db) => setIntegrationStatus(db, t.ownerCtx, integrationId, "disabled", "No credential connected"));
    const pi = fake.seedPaymentIntent(100_00);
    const before = fake.requests.length;
    const r = await refund({ pi: pi.id, amount: 5 });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/disabled/);
    expect(fake.requests.length).toBe(before);
    await run((db) => setIntegrationStatus(db, t.ownerCtx, integrationId, "active", "key connected"));
  });

  it("every receipt that succeeded matches a refund Stripe holds, amount for amount", async () => {
    const receipts = await run((db) => db.executionReceipt.findMany({ where: { orgId: t.orgId, downstreamSystem: "stripe-test", status: "succeeded" } }));
    expect(receipts.length).toBeGreaterThanOrEqual(6);
    const held = new Map(fake.refunds().map((x) => [x.id, x]));
    for (const rc of receipts) {
      const refundRow = held.get(rc.downstreamReference ?? "");
      expect(refundRow, `receipt ${rc.id} references ${rc.downstreamReference}`).toBeDefined();
      expect((rc.responseSummary as { amountMinor: number }).amountMinor).toBe(refundRow!.amount);
      expect(refundRow!.metadata.aegis_request_id).toBe(rc.actionRequestId);
    }
    // No refund exists in Stripe without a matching receipt either.
    const referenced = new Set(receipts.map((rc) => rc.downstreamReference));
    for (const x of fake.refunds()) expect(referenced.has(x.id), `refund ${x.id} has a receipt`).toBe(true);
    const v = await run((db) => verifyChain(db, t.orgId));
    expect(v.valid).toBe(true);
  });

  it("the enforcement-path audit matches every Stripe refund to an authorized request, and flags one made directly", async () => {
    const { auditEnforcementPath } = await import("../src/gateway/enforcement.js");
    const clean = await auditEnforcementPath(run, t.ownerCtx, integrationId);
    expect(clean.observable).toBe(true);
    expect(clean.findings).toEqual([]);
    expect(clean.matched).toBe(fake.refunds().length);
    // A refund created with the Stripe key directly, without the gateway, carries no AEGIS request id.
    const direct = await fetch(`${fake.url}/v1/refunds`, { method: "POST", headers: { authorization: `Bearer ${TEST_KEY}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ payment_intent: fake.refunds()[0]!.payment_intent!, amount: "1" }) });
    expect(direct.ok).toBe(true);
    const audited = await auditEnforcementPath(run, t.ownerCtx, integrationId);
    expect(audited.findings.map((x) => x.kind)).toEqual(["bypass"]);
  });
});

