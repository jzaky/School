/**
 * AEGIS Trading journey against a real Alpaca paper-trading account.
 *
 *   ALPACA_PAPER_KEY=PK...:secret npx tsx scripts/alpaca-paper-check.mts
 *
 * Without ALPACA_PAPER_KEY the script prints what it would do and exits 0. With it, the script:
 *   1. refuses anything that is not a paper key (key id starting with PK), so no real money can trade;
 *   2. stores the key in the demo tenant's vault for the alpaca-paper integration and enables it;
 *   3. runs the connection test (GET /v2/account on the paper host);
 *   4. drives the gateway as the demo portfolio-trading-agent: a small automatic market order, a limit order
 *      that needs the demo approver, an oversize order that must be refused before any broker call, and a
 *      replay of the first request (same idempotency key) that must not place a second order;
 *   5. lists the orders from Alpaca by client_order_id and reconciles them against AEGIS receipts, printing a
 *      table and exiting non-zero on any mismatch.
 *
 * Orders are tiny (USD 5 market, USD 20 limit far below market so it rests) and only on the paper account.
 * Requires DATABASE_URL etc. from the monorepo .env and a seeded demo tenant (pnpm db:seed).
 */
import { disconnectAll, rawPrisma, withTenant, type TenantDb } from "../packages/db/src/index.js";
import { env } from "../packages/core/src/env.js";
import { installShield } from "../packages/core/src/shield/inspector.js";
import { installConnectors } from "../packages/core/src/gateway/connectors/index.js";
import { ALPACA_CREDENTIAL_NAME, ALPACA_PAPER_BASE_URL, ALPACA_PAPER_KEY_MESSAGE, alpacaRequest, getOrderByClientId, parseAlpacaCredential, type AlpacaClient } from "../packages/core/src/gateway/connectors/alpaca.js";
import { DEMO_SLUG } from "../packages/core/src/seed/demo-tenant.js";
import { listUserMemberships } from "../packages/core/src/identity/memberships.js";
import { makeContext } from "../packages/core/src/lib/context.js";
import { setIntegrationStatus, storeCredential, testIntegrationConnection } from "../packages/core/src/integrations/service.js";
import { authorizeAndExecute, type GatewayResponse } from "../packages/core/src/gateway/gateway.js";
import { decideApprovalAndExecute } from "../packages/core/src/approvals/service.js";

const raw = process.env.ALPACA_PAPER_KEY?.trim();
const SYMBOL = process.env.ALPACA_CHECK_SYMBOL ?? "SPY";

function plan() {
  console.log("alpaca-paper-check: no ALPACA_PAPER_KEY set. Plan:");
  console.log("  1. refuse non-paper keys (" + ALPACA_PAPER_KEY_MESSAGE + ")");
  console.log("  2. store the key for the demo tenant's alpaca-paper integration and enable it");
  console.log("  3. connection test against " + ALPACA_PAPER_BASE_URL + "/v2/account");
  console.log(`  4. USD 5 ${SYMBOL} market order (automatic), USD 20 ${SYMBOL} limit order at a price far below market (approval), 600-unit order (refused), replay of the first request (no second order)`);
  console.log("  5. list orders from Alpaca by client_order_id and reconcile against AEGIS receipts");
}

async function main() {
  if (!raw) {
    plan();
    return;
  }
  const cred = parseAlpacaCredential(raw);
  if (!cred) {
    console.error(ALPACA_PAPER_KEY_MESSAGE);
    process.exitCode = 2;
    return;
  }
  void env;
  installShield();
  installConnectors();
  const client: AlpacaClient = { baseUrl: process.env.ALPACA_API_BASE ?? ALPACA_PAPER_BASE_URL, keyId: cred.keyId, secretKey: cred.secretKey };
  const account = await alpacaRequest<{ status: string; buying_power: string }>(client, "GET", "/v2/account");
  if (account.kind !== "ok") {
    console.error("Alpaca paper account unreachable:", account.kind === "error" ? account.message : account.error);
    process.exitCode = 2;
    return;
  }
  console.log(`Alpaca paper account ${account.body.status}, buying power ${account.body.buying_power}`);

  const org = await rawPrisma().organization.findUniqueOrThrow({ where: { slug: DEMO_SLUG } });
  const run = <T>(fn: (db: TenantDb) => Promise<T>) => withTenant(org.id, fn);
  const users = await rawPrisma().user.findMany({ where: { email: { in: ["karim.nassar@meridian-demo.example", "lina.mansour@meridian-demo.example"] } } });
  const ctxFor = async (email: string) => {
    const u = users.find((x) => x.email === email)!;
    const m = (await listUserMemberships(u.id)).find((x) => x.orgId === org.id)!;
    return makeContext(org.id, { type: "user", id: u.id, label: email, permissions: m.permissions, membershipId: m.membershipId });
  };
  const engineer = await ctxFor("karim.nassar@meridian-demo.example");
  const approver = await ctxFor("lina.mansour@meridian-demo.example");
  const { integrationId, agentId } = await run(async (db) => {
    const integ = await db.integration.findFirstOrThrow({ where: { orgId: org.id, key: "alpaca-paper" } });
    const agent = await db.agent.findFirstOrThrow({ where: { orgId: org.id, slug: "portfolio-trading-agent" } });
    const existing = await db.credential.findFirst({ where: { integrationId: integ.id, name: ALPACA_CREDENTIAL_NAME, revokedAt: null } });
    if (!existing) await storeCredential(db, engineer, integ.id, ALPACA_CREDENTIAL_NAME, raw);
    if (integ.status !== "active") await setIntegrationStatus(db, engineer, integ.id, "active", "paper key connected by alpaca-paper-check");
    return { integrationId: integ.id, agentId: agent.id };
  });
  const test = await testIntegrationConnection(run, engineer, integrationId);
  console.log(`Connection test: ${test.ok ? "ok" : "FAILED"} (${test.detail})`);
  if (!test.ok) {
    process.exitCode = 1;
    return;
  }

  const agentCtx = makeContext(org.id, { type: "agent", id: agentId, label: "portfolio-trading-agent" });
  const stamp = Date.now().toString(36);
  const base = { tool: "place-order", action: "execute", resource: "trading-book", principal: { type: "system" as const }, context: { dayPnl: 0 }, executionMode: "gateway" as const };
  const results: { step: string; response: GatewayResponse }[] = [];
  const small = await authorizeAndExecute(withTenant, agentCtx, { ...base, params: { symbol: SYMBOL, side: "buy", type: "market", qty: 0.01, notional: 5, reference: `CHK-${stamp}-1`, reason: "alpaca-paper-check automatic order" }, idempotencyKey: `alpaca-check-${stamp}-small`, justification: "paper check" });
  results.push({ step: "USD 5 market order (automatic)", response: small });
  const mid = await authorizeAndExecute(withTenant, agentCtx, { ...base, params: { symbol: SYMBOL, side: "buy", type: "limit", qty: 10, limitPrice: 2, notional: 20, reference: `CHK-${stamp}-2`, reason: "alpaca-paper-check approval order" }, idempotencyKey: `alpaca-check-${stamp}-mid`, justification: "paper check" });
  // The seeded mandate's bands start at USD 5,000, so a USD 20 order is automatic too unless the check is run outside market hours.
  results.push({ step: "USD 20 limit order", response: mid });
  if (mid.status === "pending_approval") {
    const ap = await run((db) => db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: mid.requestId } }));
    const d = await decideApprovalAndExecute(run, approver, ap.id, { decision: "approve", comment: "alpaca-paper-check", requestHash: ap.requestHash });
    console.log(`Approved by demo approver: executed=${d.executed}`);
  }
  const big = await authorizeAndExecute(withTenant, agentCtx, { ...base, params: { symbol: SYMBOL, side: "buy", type: "limit", qty: 600, limitPrice: 2, notional: 1200, reference: `CHK-${stamp}-3`, reason: "alpaca-paper-check oversize order" }, idempotencyKey: `alpaca-check-${stamp}-big`, justification: "paper check" });
  results.push({ step: "600-unit order (must be refused)", response: big });
  const replay = await authorizeAndExecute(withTenant, agentCtx, { ...base, params: { symbol: SYMBOL, side: "buy", type: "market", qty: 0.01, notional: 5, reference: `CHK-${stamp}-1`, reason: "alpaca-paper-check automatic order" }, idempotencyKey: `alpaca-check-${stamp}-small`, justification: "paper check" });
  results.push({ step: "replay of the first request (no second order)", response: replay });

  let failures = 0;
  console.log("\nstep | decision | status | receipt | alpaca order");
  for (const r of results) {
    const receipts = await run((db) => db.executionReceipt.findMany({ where: { actionRequestId: r.response.requestId }, orderBy: { createdAt: "asc" } }));
    const ref = receipts.find((x) => x.status === "succeeded")?.downstreamReference ?? null;
    let alpaca = "none";
    if (r.response.status === "executed") {
      const found = await getOrderByClientId(client, `aegis:${r.response.requestId}`);
      alpaca = "order" in found ? `${found.order.id} ${found.order.status}` : "missing" in found ? "MISSING" : `unknown: ${found.unknown}`;
      if (!("order" in found) || found.order.id !== ref) failures++;
    }
    console.log(`${r.step} | ${r.response.decision} | ${r.response.status}${r.response.duplicate ? " (duplicate)" : ""} | ${ref ?? "-"} | ${alpaca}`);
  }
  if (big.status !== "denied") failures++;
  if (!replay.duplicate) failures++;
  const placed = await run((db) => db.executionReceipt.count({ where: { actionRequestId: small.requestId, status: "succeeded" } }));
  if (placed !== 1) failures++;
  console.log(failures === 0 ? "\nAll checks passed: AEGIS receipts match Alpaca's paper orders." : `\n${failures} check(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => disconnectAll());
