/**
 * Stripe test-mode journey through AEGIS, against the real Stripe API in test mode.
 *
 *   STRIPE_TEST_SECRET_KEY=sk_test_... npx tsx scripts/stripe-sandbox-check.mts
 *
 * Without STRIPE_TEST_SECRET_KEY the script prints what it would do and exits 0. With it, the script:
 *   1. refuses anything that is not a test-mode key (sk_test_ or rk_test_), so no real money can move;
 *   2. creates and confirms a PaymentIntent with the documented test payment method pm_card_visa;
 *   3. stores the key in the demo tenant's vault for the stripe-test integration and enables it;
 *   4. drives the gateway as the demo support-refund-agent: a small autonomous refund, a tier-two refund
 *      approved by the demo approver, a duplicate (same idempotency key) that must not refund twice, and an
 *      over-limit refund that must be denied before any Stripe call;
 *   5. lists the payment intent's refunds from Stripe and reconciles them against AEGIS receipts, printing a
 *      table and exiting non-zero on any mismatch.
 *
 * All HTTP and amount logic is shared with the connector (packages/core/src/gateway/connectors/stripe.ts).
 * Requires DATABASE_URL etc. from the monorepo .env and a seeded demo tenant (pnpm db:seed).
 */
import { disconnectAll, rawPrisma, withTenant, type TenantDb } from "../packages/db/src/index.js";
import { env } from "../packages/core/src/env.js";
import { installShield } from "../packages/core/src/shield/inspector.js";
import { installConnectors } from "../packages/core/src/gateway/connectors/index.js";
import { fromMinorUnits, isStripeTestKey, listRefundsForPaymentIntent, STRIPE_CREDENTIAL_NAME, STRIPE_DEFAULT_BASE_URL, STRIPE_TEST_KEY_MESSAGE, stripeRequest, toMinorUnits, type StripeClient, type StripeRefund } from "../packages/core/src/gateway/connectors/stripe.js";
import { DEMO_SLUG } from "../packages/core/src/seed/demo-tenant.js";
import { listUserMemberships } from "../packages/core/src/identity/memberships.js";
import { makeContext } from "../packages/core/src/lib/context.js";
import { setIntegrationStatus, storeCredential, testIntegrationConnection } from "../packages/core/src/integrations/service.js";
import { authorizeAndExecute, type GatewayResponse } from "../packages/core/src/gateway/gateway.js";
import { decideApprovalAndExecute } from "../packages/core/src/approvals/service.js";

const CURRENCY = (process.env.STRIPE_CHECK_CURRENCY ?? "AED").toUpperCase();
// The demo refund-authority policy: below 500 autonomous, 500 to 2,500 approval, above 2,500 denied, AED only.
const SMALL = 25;
const TIER_TWO = 1200;
const OVER_LIMIT = 2600;
const PAYMENT_TOTAL = 1500;

const key = process.env.STRIPE_TEST_SECRET_KEY?.trim();

function plan() {
  console.log("stripe-sandbox-check: STRIPE_TEST_SECRET_KEY is not set, so nothing runs. With a test-mode key this script would:");
  console.log(`  1. refuse any key that is not sk_test_ or rk_test_`);
  console.log(`  2. POST /v1/payment_intents (amount ${toMinorUnits(PAYMENT_TOTAL, CURRENCY)} minor units ${CURRENCY}, payment_method=pm_card_visa, confirm=true, automatic_payment_methods[enabled]=true, allow_redirects=never)`);
  console.log(`  3. store the key as credential "${STRIPE_CREDENTIAL_NAME}" of the demo tenant's stripe-test integration and enable it`);
  console.log(`  4. submit through the gateway as support-refund-agent: ${CURRENCY} ${SMALL} (autonomous), ${CURRENCY} ${TIER_TWO} (approved by the demo approver), the same ${SMALL} request again (duplicate idempotency key), ${CURRENCY} ${OVER_LIMIT} (denied)`);
  console.log(`  5. GET /v1/refunds?payment_intent=... and reconcile every refund against AEGIS receipts (reference, minor-unit amount, metadata.aegis_request_id)`);
  console.log("Exit code is 0 only when every receipt matches a Stripe refund and vice versa.");
}

interface Row {
  step: string;
  decision: string;
  status: string;
  requestId: string;
  receiptRef: string | null;
  receiptAmountMinor: number | null;
  stripeAmountMinor: number | null;
  match: string;
}

function printTable(rows: Row[]) {
  const cols: (keyof Row)[] = ["step", "decision", "status", "requestId", "receiptRef", "receiptAmountMinor", "stripeAmountMinor", "match"];
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i]!)).join("  ");
  console.log(line(cols));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const r of rows) console.log(line(cols.map((c) => String(r[c] ?? ""))));
}

async function main(): Promise<number> {
  if (!key) {
    plan();
    return 0;
  }
  if (!isStripeTestKey(key)) {
    console.error(`Refusing to run: ${STRIPE_TEST_KEY_MESSAGE}`);
    return 2;
  }
  env();
  installShield();
  installConnectors();
  const client: StripeClient = { baseUrl: process.env.STRIPE_API_BASE ?? STRIPE_DEFAULT_BASE_URL, key };

  // 1. A confirmed test payment to refund against.
  const totalMinor = toMinorUnits(PAYMENT_TOTAL, CURRENCY);
  const pi = await stripeRequest<{ id: string; status: string; amount: number; currency: string; livemode: boolean }>(client, "POST", "/v1/payment_intents", {
    form: { amount: totalMinor, currency: CURRENCY.toLowerCase(), payment_method: "pm_card_visa", confirm: "true", automatic_payment_methods: { enabled: "true", allow_redirects: "never" }, metadata: { aegis_check: "stripe-sandbox-check" } },
    idempotencyKey: `aegis-check-pi-${Date.now()}`,
  });
  if (pi.kind !== "ok") {
    console.error("Could not create the test PaymentIntent:", pi.kind === "error" ? `${pi.status} ${pi.error.code ?? pi.error.type}: ${pi.error.message}` : pi.error);
    return 2;
  }
  if (pi.body.livemode) {
    console.error("Stripe answered with livemode=true. Refusing to continue.");
    return 2;
  }
  if (pi.body.status !== "succeeded") {
    console.error(`PaymentIntent ${pi.body.id} is ${pi.body.status}, not succeeded; cannot refund it.`);
    return 2;
  }
  console.log(`PaymentIntent ${pi.body.id}: ${pi.body.status}, ${pi.body.amount} minor units ${pi.body.currency.toUpperCase()}, livemode=${pi.body.livemode}`);

  // 2. Demo tenant, people and the stripe-test integration.
  const org = await rawPrisma().organization.findUnique({ where: { slug: DEMO_SLUG } });
  if (!org) {
    console.error("Demo tenant not found. Run pnpm db:seed first.");
    return 2;
  }
  const orgId = org.id;
  const run = <T,>(fn: (db: TenantDb) => Promise<T>) => withTenant(orgId, fn);
  const userCtx = async (email: string) => {
    const u = await rawPrisma().user.findUniqueOrThrow({ where: { email } });
    const m = (await listUserMemberships(u.id)).find((x) => x.orgId === orgId)!;
    return makeContext(orgId, { type: "user", id: u.id, label: u.name, permissions: m.permissions, membershipId: m.membershipId });
  };
  const engineerCtx = await userCtx("karim.nassar@meridian-demo.example");
  const ownerCtx = await userCtx("nadia.haddad@meridian-demo.example");
  const approverCtx = await userCtx("lina.mansour@meridian-demo.example");
  const { integration, agent } = await run(async (db) => ({
    integration: await db.integration.findUniqueOrThrow({ where: { orgId_key: { orgId, key: "stripe-test" } } }),
    agent: await db.agent.findUniqueOrThrow({ where: { orgId_slug: { orgId, slug: "support-refund-agent" } } }),
  }));
  await run((db) => storeCredential(db, engineerCtx, integration.id, STRIPE_CREDENTIAL_NAME, key));
  if (integration.status !== "active") await run((db) => setIntegrationStatus(db, ownerCtx, integration.id, "active", "Stripe test-mode key connected by stripe-sandbox-check"));
  const conn = await testIntegrationConnection(run, engineerCtx, integration.id);
  console.log(`Connection test: ${conn.ok ? "ok" : "FAILED"} (${conn.detail})`);
  if (!conn.ok) return 2;

  // 3. The journey through the gateway.
  const agentCtx = makeContext(orgId, { type: "agent", id: agent.id });
  const stamp = Date.now().toString(36);
  const submit = (step: string, amount: number, idem: string) =>
    authorizeAndExecute(withTenant, agentCtx, {
      tool: "refund-payment",
      action: "execute",
      params: { paymentIntentId: pi.body.id, amount, currency: CURRENCY, orderId: `CHECK-${stamp}-${step}`, reason: "requested_by_customer" },
      resource: "support-tickets",
      idempotencyKey: idem,
      justification: `stripe-sandbox-check ${step}`,
      principal: { type: "none" },
      context: {},
      executionMode: "gateway",
    });
  const outcomes: { step: string; r: GatewayResponse }[] = [];
  const small = await submit("small", SMALL, `check-${stamp}-small`);
  outcomes.push({ step: "small refund", r: small });
  const tier = await submit("tier-two", TIER_TWO, `check-${stamp}-tier`);
  if (tier.status === "pending_approval" && tier.approval) {
    const a = await run((db) => db.approvalRequest.findUniqueOrThrow({ where: { id: tier.approval!.approvalRequestId } }));
    const decided = await decideApprovalAndExecute(run, approverCtx, a.id, { decision: "approve", comment: "stripe-sandbox-check: entitled", requestHash: a.requestHash });
    tier.status = decided.receipt?.requestStatus ?? "approved";
    if (decided.receipt) tier.receipt = { status: decided.receipt.status, downstreamSystem: decided.receipt.downstreamSystem, reference: decided.receipt.reference, summary: decided.receipt.summary };
  }
  outcomes.push({ step: "tier-two refund (approved)", r: tier });
  const dup = await submit("small", SMALL, `check-${stamp}-small`);
  outcomes.push({ step: "duplicate (same idempotency key)", r: dup });
  const over = await submit("over", OVER_LIMIT, `check-${stamp}-over`);
  outcomes.push({ step: "over-limit refund", r: over });

  // 4. Reconcile Stripe's records against AEGIS receipts.
  const listed = await listRefundsForPaymentIntent(client, pi.body.id);
  if (!Array.isArray(listed)) {
    console.error("Could not list refunds from Stripe:", JSON.stringify(listed));
    return 2;
  }
  const byId = new Map<string, StripeRefund>(listed.map((r) => [r.id, r]));
  const receipts = await run((db) => db.executionReceipt.findMany({ where: { orgId, actionRequestId: { in: outcomes.map((o) => o.r.requestId) } }, orderBy: { createdAt: "asc" } }));
  let mismatches = 0;
  const rows: Row[] = outcomes.map((o) => {
    const rc = receipts.filter((x) => x.actionRequestId === o.r.requestId).at(-1);
    const stripe = rc?.downstreamReference ? byId.get(rc.downstreamReference) : undefined;
    const receiptAmount = rc ? ((rc.responseSummary as { amountMinor?: number } | null)?.amountMinor ?? null) : null;
    let match: string;
    if (o.step.startsWith("over")) match = o.r.decision === "deny" && !rc ? "ok (denied, no receipt)" : "MISMATCH";
    else if (o.step.startsWith("duplicate")) match = o.r.duplicate && o.r.requestId === small.requestId ? "ok (replayed, no second refund)" : "MISMATCH";
    else match = rc?.status === "succeeded" && stripe && stripe.amount === receiptAmount && stripe.metadata.aegis_request_id === o.r.requestId ? "ok" : "MISMATCH";
    if (match === "MISMATCH") mismatches++;
    return { step: o.step, decision: o.r.decision, status: o.r.status, requestId: o.r.requestId, receiptRef: rc?.downstreamReference ?? null, receiptAmountMinor: receiptAmount, stripeAmountMinor: stripe?.amount ?? null, match };
  });
  printTable(rows);
  const referenced = new Set(receipts.map((rc) => rc.downstreamReference));
  const ours = listed.filter((r) => typeof r.metadata?.aegis_request_id === "string" && outcomes.some((o) => o.r.requestId === r.metadata.aegis_request_id));
  for (const r of ours) {
    if (!referenced.has(r.id)) {
      mismatches++;
      console.error(`Stripe refund ${r.id} (${r.amount} minor units) carries AEGIS metadata but no receipt references it`);
    }
  }
  const expectedMinor = toMinorUnits(SMALL, CURRENCY) + toMinorUnits(TIER_TWO, CURRENCY);
  const actualMinor = ours.reduce((s, r) => s + r.amount, 0);
  console.log(`Stripe holds ${ours.length} refund(s) for this journey totalling ${actualMinor} minor units (${fromMinorUnits(actualMinor, CURRENCY)} ${CURRENCY}); expected ${expectedMinor}.`);
  if (actualMinor !== expectedMinor) mismatches++;
  if (mismatches > 0) {
    console.error(`${mismatches} mismatch(es) between Stripe and AEGIS receipts.`);
    return 1;
  }
  console.log("Every receipt matches Stripe's record. Journey verified against Stripe test mode.");
  return 0;
}

main()
  .then(async (code) => {
    await disconnectAll();
    process.exit(code);
  })
  .catch(async (e) => {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    await disconnectAll();
    process.exit(2);
  });
