/**
 * AEGIS Trading: the guided trading policy template, and the Alpaca paper connector exercised
 * through the real gateway against a fake Alpaca HTTP server (tests/fixtures/fake-alpaca.ts).
 * Every assertion about "what the broker holds" reads the fake's own records.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type TenantDb } from "@aegis/db";
import { addUserWithRole, makeTestTenant, type TestTenant } from "./helpers.js";
import { startFakeAlpaca, type FakeAlpaca } from "./fixtures/fake-alpaca.js";
import { createAgent, grantResourcePermission, setAgentTool, transitionAgent, upsertResource, upsertTool } from "../src/agents/registry.js";
import { createIntegration, setIntegrationStatus, storeCredential, testIntegrationConnection } from "../src/integrations/service.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../src/policy/service.js";
import { makeContext, type OrgContext } from "../src/lib/context.js";
import { authorizeAndExecute, reconcileExecution, type ActionRequestInput, type GatewayResponse } from "../src/gateway/gateway.js";
import { decideApprovalAndExecute } from "../src/approvals/service.js";
import { installConnectors } from "../src/gateway/connectors/index.js";
import { ALPACA_CREDENTIAL_NAME, ALPACA_PAPER_KEY_MESSAGE, buildOrderBody, isAlpacaPaperCredential, isLiveAlpacaHost, orderParamsSchema } from "../src/gateway/connectors/alpaca.js";
import { getDownstreamSystem } from "../src/gateway/simulators.js";
import { evaluatePolicies, runPolicyTests } from "../src/policy/evaluate.js";
import { buildTradingPolicyDocument, explainTradingPolicy, extractTradingSettings, tradingDocumentMatchesSettings, tradingSampleRequests, tradingSampleToEvaluationInput, tradingTemplateSchema } from "../src/policy/trading.js";
import { boundarySentence } from "../src/policy/boundary.js";
import { postureFromFacts } from "../src/agents/posture.js";

/** Fixture keys are assembled at runtime so no key-shaped literal exists in source. */
const paperKey = () => ["PK", "FAKEPAPER0001"].join("") + ":" + "paper-secret-0000000000";
const liveKey = () => ["AK", "FAKELIVE00001"].join("") + ":" + "live-secret-00000000000";

const evalOne = (doc: ReturnType<typeof buildTradingPolicyDocument>, input: Record<string, unknown>) => evaluatePolicies([{ policyKey: "t", policyVersionId: "v", policyVersion: 1, document: doc }], { agent: { environment: "production" }, ...input });

describe("trading policy template", () => {
  it("defaults, validation and explanation", () => {
    const s = tradingTemplateSchema.parse({});
    expect(s.instruments).toContain("SPY");
    expect(s.autoApproveNotionalBelow).toBe(5000);
    expect(s.approvalNotionalUpTo).toBe(50_000);
    expect(s.approvalExpiresMinutes).toBe(30);
    expect(tradingTemplateSchema.safeParse({ autoApproveNotionalBelow: 100, approvalNotionalUpTo: 50 }).success).toBe(false);
    expect(tradingTemplateSchema.safeParse({ instruments: [] }).success).toBe(false);
    expect(tradingTemplateSchema.parse({ instruments: [" aapl "] }).instruments).toEqual(["AAPL"]);
    const lines = explainTradingPolicy(s);
    expect(lines.join("\n")).toMatch(/Orders below USD 5,000 run automatically/);
    expect(lines.join("\n")).toMatch(/Orders from USD 5,000 to USD 50,000 need one Approver within 30 minutes/);
    expect(lines.join("\n")).toMatch(/Outside 14:00 to 20:00 UTC every order needs a person/);
  });

  it("every sample decides as the generated document promises, and the embedded tests pass", () => {
    for (const settings of [{}, { autoApproveNotionalBelow: 0 }, { marketHoursOnly: { enabled: true, startHourUtc: 22, endHourUtc: 3, handling: "deny" as const }, maxDailyLoss: 2000, maxDailyOrders: 50, allowedSides: ["buy" as const] }, { blockDuplicates: false, requireReason: false, marketHoursOnly: { enabled: false } }]) {
      const s = tradingTemplateSchema.parse(settings);
      const doc = buildTradingPolicyDocument(s);
      for (const sample of tradingSampleRequests(s)) {
        const r = evalOne(doc, tradingSampleToEvaluationInput(sample));
        expect(r.result, `${JSON.stringify(settings)} / ${sample.id}`).toBe(sample.expected);
      }
      const results = runPolicyTests(doc);
      expect(results.every((t) => t.passed), JSON.stringify(results.filter((t) => !t.passed))).toBe(true);
      expect(extractTradingSettings(doc)).toEqual(s);
      expect(tradingDocumentMatchesSettings(doc)).toBe(true);
    }
  });

  it("bands, caps and guards decide in the expected order", () => {
    const doc = buildTradingPolicyDocument({ maxDailyLoss: 1500, maxDailyOrders: 20 });
    const base = { symbol: "AAPL", side: "buy", type: "limit", qty: 10, limitPrice: 180, notional: 1800, reference: "SIG-1", reason: "signal" };
    const ctx = { hour: 15, priorRequestsSameReference: 0, requestCount24h: 2, deniedCount24h: 0, supplied: {} };
    const at = (params: Record<string, unknown>, context: Record<string, unknown> = {}) => evalOne(doc, { action: { tool: "submit-order", name: "execute" }, params: { ...base, ...params }, context: { ...ctx, ...context } });
    expect(at({}).result).toBe("allow");
    expect(at({ notional: 12_000, limitPrice: 1200 }).result).toBe("require_approval");
    expect(at({ notional: 12_000, limitPrice: 1200 }).decidingRule?.ruleId).toBe("approval-band");
    expect(at({ notional: 60_000, limitPrice: 6000 }).result).toBe("deny");
    expect(at({ notional: 60_000, limitPrice: 6000 }).decidingRule?.ruleId).toBe("above-ceiling");
    expect(at({ symbol: "GME" }).decidingRule?.ruleId).toBe("instrument-not-allowed");
    expect(at({ qty: 501, limitPrice: 3.59, notional: 1799 }).decidingRule?.ruleId).toBe("oversize-order");
    expect(at({ type: "stop" }).decidingRule?.ruleId).toBe("order-type-not-allowed");
    expect(at({}, { priorRequestsSameReference: 1 }).decidingRule?.ruleId).toBe("duplicate-order");
    expect(at({}, { hour: 3 }).result).toBe("require_approval");
    expect(at({}, { hour: 3 }).decidingRule?.ruleId).toBe("outside-market-hours");
    expect(at({}, { supplied: { dayPnl: -1500 } }).decidingRule?.ruleId).toBe("daily-loss-cap");
    expect(at({}, { supplied: { dayPnl: -1499 } }).result).toBe("allow");
    expect(at({}, { requestCount24h: 20 }).decidingRule?.ruleId).toBe("too-many-orders");
    expect(at({ reason: "  " }).decidingRule?.ruleId).toBe("missing-reason");
  });

  it("boundary sentences and posture read the template", () => {
    const doc = buildTradingPolicyDocument({});
    expect(boundarySentence({ document: doc, ruleId: "trading-mandate/approval-band", params: { notional: 12_000 } })).toBe("USD 12,000 is USD 7,000 above the automatic limit of USD 5,000 and USD 38,000 below the ceiling of USD 50,000.");
    expect(boundarySentence({ document: doc, ruleId: "outside-market-hours", params: {}, context: { hour: 3 } })).toBe("Requested at 03:00 UTC, outside market hours (14:00 to 20:00 UTC).");
    expect(boundarySentence({ document: doc, ruleId: "instrument-not-allowed", params: { symbol: "GME" } })).toMatch(/GME is not on the allowed list/);
    const agent = { id: "a", status: "active", teamId: null, tools: [{ enabled: true, revokedAt: null, tool: { key: "submit-order" } }] };
    const p = postureFromFacts(agent, [{ policyKey: "trading-mandate", policyVersionId: "v", policyVersion: 1, document: doc }]);
    expect(p.posture).toBe("supervised");
    expect(p.sentence).toMatch(/Orders below USD 5,000 run automatically/);
  });
});

describe("alpaca-paper connector", () => {
  let fake: FakeAlpaca;
  let t: TestTenant;
  let agentId: string;
  let agentCtx: OrgContext;
  let integrationId: string;
  let approver: { userId: string; ctx: OrgContext };
  let engineer: { userId: string; ctx: OrgContext };
  const run = <T>(fn: (db: TenantDb) => Promise<T>) => withTenant(t.orgId, fn);
  let n = 0;

  function order(input: Partial<ActionRequestInput> & { params: Record<string, unknown> }): Promise<GatewayResponse> {
    n += 1;
    const { params, ...rest } = input;
    return authorizeAndExecute(withTenant, agentCtx, {
      tool: "place-order",
      action: "execute",
      params: { symbol: "AAPL", side: "buy", type: "market", qty: 5, notional: 900, reference: `SIG-${n}`, reason: "test signal", ...params },
      resource: "trading-book",
      idempotencyKey: `alpaca-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 8)}`,
      justification: "test",
      principal: { type: "none" },
      context: {},
      executionMode: "gateway",
      ...rest,
    });
  }
  const posts = () => fake.requests.filter((r) => r.method === "POST" && r.path === "/v2/orders");
  const request = (id: string) => run((db) => db.actionRequest.findUniqueOrThrow({ where: { id }, include: { receipts: { orderBy: { createdAt: "asc" } } } }));

  beforeAll(async () => {
    installConnectors();
    fake = await startFakeAlpaca();
    t = await makeTestTenant("alpaca");
    approver = await addUserWithRole(t, "approver", "appr");
    engineer = await addUserWithRole(t, "engineer", "eng");
    const built = await run(async (db) => {
      const { integration } = await createIntegration(db, engineer.ctx, { key: "alpaca-paper", name: "Alpaca (paper trading)", type: "brokerage", description: "", baseUrl: fake.url });
      await db.integration.update({ where: { id: integration.id }, data: { settings: { kind: "sandbox", simulated: false, baseUrl: fake.url } } });
      await storeCredential(db, engineer.ctx, integration.id, ALPACA_CREDENTIAL_NAME, paperKey());
      const tool = await upsertTool(db, engineer.ctx, {
        key: "place-order",
        name: "Place order (Alpaca paper)",
        description: "",
        integrationId: integration.id,
        riskLevel: "critical",
        parameterSchema: { type: "object", required: ["symbol", "side", "type", "qty", "notional", "reference"], properties: { symbol: { type: "string" }, side: { type: "string", enum: ["buy", "sell"] }, type: { type: "string", enum: ["market", "limit"] }, qty: { type: "number", minimum: 0 }, notional: { type: "number", minimum: 0 }, limitPrice: { type: "number", minimum: 0 }, timeInForce: { type: "string" }, reference: { type: "string" }, reason: { type: "string", maxLength: 500 } }, additionalProperties: false },
        destinationRules: { allowedDomains: [], allowedResourceKeys: ["trading-book"] },
      });
      const resource = await upsertResource(db, engineer.ctx, { key: "trading-book", name: "Trading book", type: "portfolio", classification: "confidential", attributes: {} });
      const agent = await createAgent(db, engineer.ctx, { slug: "trading-agent", name: "Trading Agent", description: "", environment: "production", modelProvider: "x", modelId: "y", dataClassificationLimit: "confidential", riskTier: "critical", metadata: {}, technicalOwnerId: engineer.userId });
      await setAgentTool(db, engineer.ctx, agent.id, tool.id, true);
      await grantResourcePermission(db, engineer.ctx, agent.id, resource.id, ["read", "write", "execute"]);
      await transitionAgent(db, engineer.ctx, agent.id, "registered", "ok");
      await transitionAgent(db, engineer.ctx, agent.id, "active", "ok");
      const document = buildTradingPolicyDocument({ tools: ["place-order"], instruments: ["AAPL", "MSFT", "SPY"], autoApproveNotionalBelow: 1000, approvalNotionalUpTo: 10_000, maxOrderQty: 100, marketHoursOnly: { enabled: false }, approverRoles: ["approver"] });
      const { policy, version } = await createPolicy(db, t.ownerCtx, { key: "trading-mandate", name: "Trading mandate", description: "", category: "authorization", document, changeNote: "init" });
      await submitForReview(db, t.ownerCtx, version.id);
      await activateVersion(db, t.ownerCtx, version.id, { fourEyes: false });
      await assignPolicy(db, t.ownerCtx, policy.id, { targetType: "agent", targetId: agent.id, priority: 100 });
      return { agentId: agent.id, integrationId: integration.id };
    });
    agentId = built.agentId;
    integrationId = built.integrationId;
    agentCtx = makeContext(t.orgId, { type: "agent", id: agentId });
  });

  afterEach(() => {
    fake.mode = "normal";
  });

  afterAll(async () => {
    await fake.close().catch(() => undefined);
    await t.cleanup();
  });

  it("is registered as a sandbox system and refuses live keys and the live host", async () => {
    const s = getDownstreamSystem("alpaca-paper");
    expect(s?.kind).toBe("sandbox");
    expect(isAlpacaPaperCredential(paperKey())).toBe(true);
    expect(isAlpacaPaperCredential(liveKey())).toBe(false);
    expect(isAlpacaPaperCredential("no-colon")).toBe(false);
    expect(isLiveAlpacaHost("https://api.alpaca.markets")).toBe(true);
    expect(isLiveAlpacaHost("https://paper-api.alpaca.markets")).toBe(false);
    await expect(run((db) => storeCredential(db, engineer.ctx, integrationId, ALPACA_CREDENTIAL_NAME, liveKey()))).rejects.toThrow(ALPACA_PAPER_KEY_MESSAGE);
  });

  it("validates order parameters: limit orders need a price and a notional that matches qty times price", () => {
    expect(orderParamsSchema.safeParse({ symbol: "AAPL", side: "buy", type: "limit", qty: 10, notional: 1800, reference: "r" }).success).toBe(false);
    expect(orderParamsSchema.safeParse({ symbol: "AAPL", side: "buy", type: "limit", qty: 10, limitPrice: 180, notional: 1800, reference: "r" }).success).toBe(true);
    expect(orderParamsSchema.safeParse({ symbol: "AAPL", side: "buy", type: "limit", qty: 10, limitPrice: 180, notional: 900, reference: "r" }).success).toBe(false);
    expect(buildOrderBody(orderParamsSchema.parse({ symbol: "AAPL", side: "buy", type: "market", qty: 5, notional: 900.456, reference: "r" }), "cid")).toEqual({ symbol: "AAPL", side: "buy", type: "market", time_in_force: "day", client_order_id: "cid", notional: "900.46" });
    expect(buildOrderBody(orderParamsSchema.parse({ symbol: "AAPL", side: "sell", type: "limit", qty: 10, limitPrice: 180, notional: 1800, reference: "r" }), "cid")).toMatchObject({ qty: "10", limit_price: "180" });
  });

  it("a small market order executes once; Alpaca holds exactly one order keyed by the gateway idempotency key", async () => {
    const before = posts().length;
    const r = await order({ params: { notional: 900, qty: 5 } });
    expect(r.decision).toBe("allow");
    expect(r.status).toBe("executed");
    expect(r.receipt?.status).toBe("succeeded");
    const held = fake.orders().filter((o) => o.id === r.receipt?.reference);
    expect(held).toHaveLength(1);
    expect(held[0]!.notional).toBe("900");
    expect(held[0]!.qty).toBeNull();
    expect(posts().length).toBe(before + 1);
    const req = await request(r.requestId);
    expect(held[0]!.client_order_id).toBe(`aegis:${r.requestId}`);
    expect(req.receipts[0]!.responseSummary).toMatchObject({ paper: true, symbol: "AAPL" });
  });

  it("an order in the approval band waits for a person and executes once approved", async () => {
    const r = await order({ params: { notional: 4500, qty: 25 } });
    expect(r.status).toBe("pending_approval");
    expect(posts().filter((p) => (p.body as { notional?: string }).notional === "4500")).toHaveLength(0);
    const ap = await run((db) => db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: r.requestId } }));
    const d = await decideApprovalAndExecute(run, approver.ctx, ap.id, { decision: "approve", comment: "within mandate", requestHash: ap.requestHash });
    expect(d.executed).toBe(true);
    expect(fake.orders().some((o) => o.notional === "4500")).toBe(true);
  });

  it("an order above the ceiling and an order in a disallowed symbol are refused before any broker call", async () => {
    const before = posts().length;
    const big = await order({ params: { notional: 25_000, qty: 100 } });
    expect(big.status).toBe("denied");
    const bad = await order({ params: { symbol: "GME", notional: 500, qty: 10 } });
    expect(bad.status).toBe("denied");
    expect(bad.matchedRuleIds).toContain("trading-mandate/instrument-not-allowed");
    expect(posts().length).toBe(before);
  });

  it("a limit order whose declared notional does not match qty times price fails at the connector with nothing sent", async () => {
    const before = posts().length;
    const r = await order({ params: { type: "limit", qty: 5, limitPrice: 100, notional: 900 } });
    expect(r.decision).toBe("allow");
    expect(r.status).toBe("failed");
    expect(r.receipt?.status).toBe("failed");
    expect(posts().length).toBe(before);
  });

  it("a lost response leaves the request unresolved, and reconciliation finds the order by client_order_id", async () => {
    fake.mode = "lost-response";
    const r = await order({ params: { notional: 700, qty: 3 } });
    expect(r.status).toBe("executing");
    expect(r.receipt?.status).toBe("unknown");
    fake.mode = "normal";
    const rec = await reconcileExecution(run, t.ownerCtx, r.requestId);
    expect(rec.status).toBe("succeeded");
    const held = fake.orders().filter((o) => o.notional === "700");
    expect(held).toHaveLength(1);
    expect(rec.reference).toBe(held[0]!.id);
  });

  it("a server error before the order exists reconciles to failed with nothing placed", async () => {
    fake.mode = "server-error";
    const r = await order({ params: { notional: 650, qty: 3 } });
    expect(r.status).toBe("executing");
    fake.mode = "normal";
    const rec = await reconcileExecution(run, t.ownerCtx, r.requestId);
    expect(rec.status).toBe("failed");
    expect(fake.orders().filter((o) => o.notional === "650")).toHaveLength(0);
  });

  it("the connection test reads the paper account", async () => {
    await run((db) => setIntegrationStatus(db, engineer.ctx, integrationId, "active", "test"));
    const r = await testIntegrationConnection(run, engineer.ctx, integrationId);
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/ACTIVE/);
  });
});
