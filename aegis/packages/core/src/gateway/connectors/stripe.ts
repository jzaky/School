/**
 * Stripe refund connector, test mode only.
 *
 * Stripe test mode is a free, documented sandbox: test payment methods (pm_card_visa), the refunds
 * API (POST /v1/refunds), native request idempotency through the Idempotency-Key header, lookups by
 * id and by payment intent, and GET /v1/balance as a cheap authenticated connection check.
 *
 * Money safety: the connector refuses every key that is not a test-mode key (sk_test_ or rk_test_),
 * both when the credential is stored (validateCredential) and again at execution time. It therefore
 * cannot initiate a live transaction whatever the vault holds.
 *
 * Outcome semantics (see docs/CONNECTORS.md):
 *  - failed: nothing happened downstream. Validation errors before sending, a refused key, a grant
 *    that does not bind these parameters, and definitive 4xx answers from Stripe.
 *  - unknown: the request may have reached Stripe but no definitive answer came back (timeout,
 *    connection reset, 5xx, malformed body, rate limiting). The gateway keeps the request executing
 *    and calls reconcile, never retries blindly.
 *  - succeeded: Stripe returned the refund object. The reference is the Stripe refund id (re_...).
 *
 * The helpers are exported so scripts/stripe-sandbox-check.mts shares them instead of duplicating.
 */
import { z } from "zod";
import { hashObject } from "../../lib/crypto.js";
import type { DownstreamContext, DownstreamRequest, DownstreamResult, DownstreamSystem } from "../simulators.js";

export const STRIPE_SYSTEM_KEY = "stripe-test";
/** Pinned so a Stripe default-version change cannot alter response shapes under us. */
export const STRIPE_API_VERSION = "2024-06-20";
export const STRIPE_DEFAULT_BASE_URL = "https://api.stripe.com";
export const STRIPE_CREDENTIAL_NAME = "secret-key";
export const STRIPE_TIMEOUT_MS = 10_000;
/** Stripe keeps idempotency keys for 24 hours; a replay inside the window returns the original result. */
export const STRIPE_IDEMPOTENCY_WINDOW_MS = 24 * 3600_000;
export const STRIPE_TEST_KEY_MESSAGE = "Only Stripe test-mode keys (sk_test_ or rk_test_) can be stored. Live keys are refused so no real money can move.";

export function isStripeTestKey(secret: string): boolean {
  const s = secret.trim();
  return /^(sk|rk)_test_[A-Za-z0-9]+$/.test(s);
}

/** Currencies Stripe charges in whole units (no minor unit). */
export const ZERO_DECIMAL_CURRENCIES = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
/** Currencies with three decimals; Stripe requires amounts to be a multiple of ten minor units. */
export const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

/** Converts a major-unit amount (12.50) to Stripe minor units (1250), honouring the currency's exponent. */
export function toMinorUnits(amount: number, currency: string): number {
  const c = currency.toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be a positive number");
  const factor = ZERO_DECIMAL_CURRENCIES.has(c) ? 1 : THREE_DECIMAL_CURRENCIES.has(c) ? 1000 : 100;
  const minor = Math.round(amount * factor);
  if (Math.abs(minor - amount * factor) > 1e-6) throw new Error(`amount ${amount} has more precision than ${c} allows`);
  if (factor === 1000 && minor % 10 !== 0) throw new Error(`${c} amounts must be a multiple of 0.010`);
  return minor;
}

export function fromMinorUnits(minor: number, currency: string): number {
  const c = currency.toUpperCase();
  const factor = ZERO_DECIMAL_CURRENCIES.has(c) ? 1 : THREE_DECIMAL_CURRENCIES.has(c) ? 1000 : 100;
  return minor / factor;
}

export const refundParamsSchema = z
  .object({
    paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/, "paymentIntentId must look like pi_..."),
    amount: z.number().positive(),
    currency: z.string().regex(/^[A-Za-z]{3}$/, "currency must be a three-letter ISO code"),
    orderId: z.string().max(200).optional(),
    customerId: z.string().max(200).optional(),
    reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).optional(),
  })
  .strict();
export type RefundParams = z.infer<typeof refundParamsSchema>;

// ---------- HTTP ----------

export interface StripeErrorBody {
  error: { type?: string; code?: string; message?: string; param?: string };
}
export type StripeHttpResult<T> = { kind: "ok"; status: number; body: T } | { kind: "error"; status: number; error: StripeErrorBody["error"] } | { kind: "transport"; error: string };

/** Stripe's form encoding: nested objects become bracketed keys (metadata[aegis_request_id]=...). */
export function encodeForm(fields: Record<string, string | number | boolean | undefined | Record<string, string | undefined>>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (typeof v === "object") {
      for (const [nk, nv] of Object.entries(v)) if (nv !== undefined) parts.push(`${encodeURIComponent(`${k}[${nk}]`)}=${encodeURIComponent(nv)}`);
    } else parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join("&");
}

export interface StripeClient {
  baseUrl: string;
  key: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * One Stripe call with a hard timeout. Never throws: transport problems come back as `transport`
 * so callers decide between failed and unknown explicitly.
 */
export async function stripeRequest<T = Record<string, unknown>>(client: StripeClient, method: "GET" | "POST", path: string, opts: { form?: Record<string, string | number | boolean | undefined | Record<string, string | undefined>>; idempotencyKey?: string; query?: Record<string, string | number | undefined> } = {}): Promise<StripeHttpResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), client.timeoutMs ?? STRIPE_TIMEOUT_MS);
  const qs = opts.query ? Object.entries(opts.query).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
  const url = `${client.baseUrl.replace(/\/$/, "")}${path}${qs ? `?${qs}` : ""}`;
  const headers: Record<string, string> = { authorization: `Bearer ${client.key}`, "stripe-version": STRIPE_API_VERSION, accept: "application/json" };
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  let body: string | undefined;
  if (method === "POST") {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = encodeForm(opts.form ?? {});
  }
  try {
    const res = await (client.fetchImpl ?? fetch)(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      return { kind: "transport", error: `malformed response (HTTP ${res.status})` };
    }
    if (res.ok) {
      if (!json || typeof json !== "object") return { kind: "transport", error: `empty response (HTTP ${res.status})` };
      return { kind: "ok", status: res.status, body: json as T };
    }
    const err = (json as Partial<StripeErrorBody> | null)?.error ?? {};
    return { kind: "error", status: res.status, error: { type: err.type, code: err.code, message: err.message, param: err.param } };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? `timeout after ${client.timeoutMs ?? STRIPE_TIMEOUT_MS}ms` : e.message) : "request failed";
    return { kind: "transport", error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export interface StripeRefund {
  id: string;
  object: "refund";
  amount: number;
  currency: string;
  status: string;
  payment_intent: string | null;
  charge: string | null;
  reason: string | null;
  metadata: Record<string, string>;
  created: number;
  livemode?: boolean;
}
export interface StripeList<T> {
  object: "list";
  data: T[];
  has_more: boolean;
}

/** Form body for POST /v1/refunds. Shared by execute, the replay fallback and the sandbox check script. */
export function buildRefundForm(params: RefundParams, meta: { requestId: string; orgId: string; correlationId: string }): { form: Record<string, string | number | undefined | Record<string, string | undefined>>; amountMinor: number } {
  const amountMinor = toMinorUnits(params.amount, params.currency);
  return {
    amountMinor,
    form: {
      payment_intent: params.paymentIntentId,
      amount: amountMinor,
      reason: params.reason,
      metadata: { aegis_request_id: meta.requestId, aegis_org_id: meta.orgId, aegis_correlation_id: meta.correlationId, aegis_order_id: params.orderId },
    },
  };
}

/** Every refund of a payment intent (paginated). `null` when the payment intent is not found; throws on transport or server trouble. */
export async function listRefundsForPaymentIntent(client: StripeClient, paymentIntentId: string): Promise<StripeRefund[] | { definitiveMissing: true } | { unknown: string }> {
  const all: StripeRefund[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await stripeRequest<StripeList<StripeRefund>>(client, "GET", "/v1/refunds", { query: { payment_intent: paymentIntentId, limit: 100, starting_after: startingAfter } });
    if (r.kind === "transport") return { unknown: r.error };
    if (r.kind === "error") {
      if (r.status === 404 || r.error.code === "resource_missing") return { definitiveMissing: true };
      return { unknown: `Stripe ${r.status} ${r.error.code ?? r.error.type ?? ""}: ${r.error.message ?? "lookup failed"}` };
    }
    if (!Array.isArray(r.body.data)) return { unknown: "malformed list response" };
    all.push(...r.body.data);
    if (!r.body.has_more || r.body.data.length === 0) break;
    startingAfter = r.body.data[r.body.data.length - 1]!.id;
  }
  return all;
}

function refundSummary(refund: StripeRefund, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { refundId: refund.id, refundStatus: refund.status, amountMinor: refund.amount, amount: fromMinorUnits(refund.amount, refund.currency), currency: refund.currency.toUpperCase(), paymentIntent: refund.payment_intent, livemode: refund.livemode ?? false, ...extra };
}

export function resolveBaseUrl(settings: Record<string, unknown> | null | undefined): string {
  const fromSettings = typeof settings?.baseUrl === "string" && /^https?:\/\//.test(settings.baseUrl) ? settings.baseUrl : null;
  return fromSettings ?? process.env.STRIPE_API_BASE ?? STRIPE_DEFAULT_BASE_URL;
}

async function clientFor(ctx: DownstreamContext): Promise<{ client: StripeClient } | { refused: string }> {
  const settings = await ctx.run(async (db) => {
    const integ = await db.integration.findUnique({ where: { id: ctx.integrationId }, select: { settings: true } });
    return (integ?.settings ?? {}) as Record<string, unknown>;
  });
  let key: string;
  try {
    key = (await ctx.credential(STRIPE_CREDENTIAL_NAME)).trim();
  } catch (e) {
    return { refused: e instanceof Error ? e.message : "credential unavailable" };
  }
  // Second gate: even a key that reached the vault by another path is refused here if it is not test mode.
  if (!isStripeTestKey(key)) return { refused: STRIPE_TEST_KEY_MESSAGE };
  return { client: { baseUrl: resolveBaseUrl(settings), key } };
}

function failed(error: string, summary: Record<string, unknown> = {}): DownstreamResult {
  return { outcome: "failed", reference: null, summary, error };
}
function unknown(error: string, summary: Record<string, unknown> = {}): DownstreamResult {
  return { outcome: "unknown", reference: null, summary, error };
}

/** Classifies a POST /v1/refunds answer into a gateway outcome. */
function refundOutcome(r: StripeHttpResult<StripeRefund>, extra: Record<string, unknown>): DownstreamResult {
  if (r.kind === "transport") return unknown(r.error, { stripe: { responded: false }, ...extra });
  if (r.kind === "error") {
    const label = `Stripe ${r.status} ${r.error.code ?? r.error.type ?? "error"}: ${r.error.message ?? "request rejected"}`;
    // 5xx and 429: Stripe did not give a definitive answer about this operation.
    if (r.status >= 500 || r.status === 429) return unknown(label, { stripe: { responded: true, httpStatus: r.status, code: r.error.code ?? null }, ...extra });
    // Other 4xx: definitive, nothing was created (charge_already_refunded, resource_missing, idempotency_error, auth).
    return failed(label, { stripe: { responded: true, httpStatus: r.status, code: r.error.code ?? null }, ...extra });
  }
  if (r.body.object !== "refund" || typeof r.body.id !== "string") return unknown("Stripe answered with an unexpected body", { stripe: { responded: true, httpStatus: r.status }, ...extra });
  return { outcome: "succeeded", reference: r.body.id, summary: refundSummary(r.body, extra) };
}

export const stripeTestConnector: DownstreamSystem = {
  key: STRIPE_SYSTEM_KEY,
  kind: "sandbox",
  label: "Stripe (test mode)",

  validateCredential(_name, secret) {
    return isStripeTestKey(secret) ? null : STRIPE_TEST_KEY_MESSAGE;
  },

  async execute(ctx: DownstreamContext, req: DownstreamRequest): Promise<DownstreamResult> {
    if (req.toolKey !== "refund-payment") return failed(`stripe-test does not implement tool ${req.toolKey}`);
    const parsed = refundParamsSchema.safeParse(req.params);
    if (!parsed.success) return failed(`invalid refund parameters: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    // The grant the gateway consumed must bind exactly these parameters (defence in depth, as the simulators do).
    if (hashObject({ toolKey: req.toolKey, action: req.action, params: req.params }) !== req.grant.requestHash) return failed("execution grant rejected: parameters do not match the authorised request");
    let built: ReturnType<typeof buildRefundForm>;
    try {
      built = buildRefundForm(parsed.data, { requestId: req.actionRequestId, orgId: ctx.orgId, correlationId: req.correlationId });
    } catch (e) {
      return failed(e instanceof Error ? e.message : "invalid amount");
    }
    const c = await clientFor(ctx);
    if ("refused" in c) return failed(c.refused);
    // Everything above happened before any byte left the gateway. From here on, ambiguity is `unknown`.
    const r = await stripeRequest<StripeRefund>(c.client, "POST", "/v1/refunds", { form: built.form, idempotencyKey: req.idempotencyKey });
    return refundOutcome(r, { requestedAmountMinor: built.amountMinor, requestedCurrency: parsed.data.currency.toUpperCase(), attempt: req.attempt });
  },

  /**
   * Looks the refund up by the AEGIS request id carried in Stripe's metadata. When the list is
   * definitive and empty: if Stripe had answered the original attempt (any HTTP status recorded on
   * the receipt) nothing was created and the request failed; if no answer ever arrived and the
   * idempotency key is still fresh, the original POST is replayed with the same key, which Stripe
   * resolves to at most one refund (the original if it exists, otherwise a single new one).
   */
  async listRecentOperations(ctx, since) {
    const c = await clientFor(ctx);
    if ("refused" in c) throw new Error(c.refused);
    const r = await stripeRequest<StripeList<StripeRefund>>(c.client, "GET", "/v1/refunds", { query: { limit: 100, "created[gte]": Math.floor(since.getTime() / 1000) } });
    if (r.kind !== "ok") throw new Error(r.kind === "transport" ? r.error : `Stripe ${r.status}: ${r.error.message ?? "list failed"}`);
    return r.body.data.map((x) => ({ reference: x.id, aegisRequestId: x.metadata?.aegis_request_id ?? null, at: new Date(x.created * 1000), summary: { amountMinor: x.amount, currency: x.currency, status: x.status } }));
  },
  async reconcile(ctx: DownstreamContext, req: DownstreamRequest): Promise<DownstreamResult> {
    const parsed = refundParamsSchema.safeParse(req.params);
    if (!parsed.success) return failed("invalid refund parameters; nothing could have been sent");
    const c = await clientFor(ctx);
    if ("refused" in c) return unknown(`cannot look up Stripe: ${c.refused}`);
    const listed = await listRefundsForPaymentIntent(c.client, parsed.data.paymentIntentId);
    if ("unknown" in listed) return unknown(listed.unknown, { reconcileStrategy: "list" });
    if ("definitiveMissing" in listed) return failed("payment intent does not exist in Stripe; no refund was created", { reconcileStrategy: "list" });
    const hit = listed.find((r) => r.metadata?.aegis_request_id === req.actionRequestId);
    if (hit) return { outcome: "succeeded", reference: hit.id, summary: refundSummary(hit, { reconcileStrategy: "list" }) };

    const stripeResponded = await ctx.run(async (db) => {
      const receipts = await db.executionReceipt.findMany({ where: { actionRequestId: req.actionRequestId, downstreamSystem: STRIPE_SYSTEM_KEY }, orderBy: { createdAt: "desc" }, select: { responseSummary: true } });
      return receipts.some((x) => ((x.responseSummary ?? {}) as { stripe?: { responded?: boolean } }).stripe?.responded === true);
    });
    if (stripeResponded) return failed("Stripe holds no refund for this request and had answered the original attempt; nothing was created", { reconcileStrategy: "list" });

    const fresh = Date.now() - req.grant.consumedAt.getTime() < STRIPE_IDEMPOTENCY_WINDOW_MS;
    if (!fresh) return failed("Stripe holds no refund for this request and the idempotency window has passed; nothing was created", { reconcileStrategy: "list" });

    // Replay: same key, same body. Safe because Stripe returns the saved result for a reused key and
    // refuses a reused key with a different body, so at most one refund can ever exist for this request.
    let built: ReturnType<typeof buildRefundForm>;
    try {
      built = buildRefundForm(parsed.data, { requestId: req.actionRequestId, orgId: ctx.orgId, correlationId: req.correlationId });
    } catch (e) {
      return failed(e instanceof Error ? e.message : "invalid amount");
    }
    const r = await stripeRequest<StripeRefund>(c.client, "POST", "/v1/refunds", { form: built.form, idempotencyKey: req.idempotencyKey });
    if (r.kind === "error" && r.error.type === "idempotency_error") return unknown(`Stripe refused the replay: ${r.error.message ?? "idempotency conflict"}; a human must check this key`, { reconcileStrategy: "replay" });
    return refundOutcome(r, { reconcileStrategy: "replay", requestedAmountMinor: built.amountMinor, requestedCurrency: parsed.data.currency.toUpperCase() });
  },

  async testConnection(ctx: DownstreamContext) {
    const c = await clientFor(ctx);
    if ("refused" in c) return { ok: false, detail: c.refused };
    const r = await stripeRequest<{ object: string; livemode: boolean }>(c.client, "GET", "/v1/balance");
    if (r.kind === "transport") return { ok: false, detail: `Stripe unreachable: ${r.error}` };
    if (r.kind === "error") return { ok: false, detail: `Stripe ${r.status} ${r.error.code ?? r.error.type ?? ""}: ${r.error.message ?? "request rejected"}`.trim() };
    if (r.body.livemode === true) return { ok: false, detail: "Stripe answered with livemode=true; this connector refuses live mode" };
    return { ok: true, detail: "Stripe test mode reachable, livemode=false" };
  },
};
