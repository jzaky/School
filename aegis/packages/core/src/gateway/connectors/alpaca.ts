/**
 * Alpaca paper-trading connector (AEGIS Trading).
 *
 * Alpaca's paper trading API is a free, documented sandbox with the same order endpoints as live
 * trading, served from a separate host (paper-api.alpaca.markets) with paper-only keys. The
 * connector submits one order per gateway request (POST /v2/orders), uses the gateway's idempotency
 * key as the order's client_order_id (Alpaca enforces uniqueness, so a replay can never create a
 * second order), looks orders up by that id for reconciliation and calls GET /v2/account as the
 * connection check.
 *
 * Money safety: this connector cannot reach a live account. Paper key ids start with "PK" and live
 * key ids with "AK"; any other credential is refused when stored and again at execution time. The
 * base URL must be Alpaca's paper host (or a local emulator for tests); the live host is refused.
 *
 * What AEGIS executes is exactly what was approved: the connector checks the consumed grant against
 * the parameters, refuses a limit order whose declared notional is not qty times the limit price,
 * and submits market orders by notional so the declared value is what the broker fills.
 *
 * Outcomes follow docs/CONNECTORS.md: failed means nothing happened downstream; unknown means the
 * order may exist and reconciliation must look; succeeded carries the Alpaca order id.
 */
import { z } from "zod";
import { hashObject } from "../../lib/crypto.js";
import type { DownstreamContext, DownstreamResult, DownstreamSystem } from "../simulators.js";

export const ALPACA_SYSTEM_KEY = "alpaca-paper";
export const ALPACA_PAPER_BASE_URL = "https://paper-api.alpaca.markets";
export const ALPACA_LIVE_HOST = "api.alpaca.markets";
export const ALPACA_CREDENTIAL_NAME = "api-key";
export const ALPACA_TIMEOUT_MS = 10_000;
export const ALPACA_PAPER_KEY_MESSAGE = "Only Alpaca paper-trading keys can be stored, as KEYID:SECRET where the key id starts with PK. Live keys (AK...) are refused so no real money can trade.";
/** Declared notional may differ from qty times limit price by this fraction (rounding). */
export const NOTIONAL_TOLERANCE = 0.005;

export function parseAlpacaCredential(secret: string): { keyId: string; secretKey: string } | null {
  const s = secret.trim();
  const i = s.indexOf(":");
  if (i <= 0) return null;
  const keyId = s.slice(0, i).trim();
  const secretKey = s.slice(i + 1).trim();
  if (!/^PK[A-Z0-9]{6,}$/.test(keyId) || secretKey.length < 8) return null;
  return { keyId, secretKey };
}

export function isAlpacaPaperCredential(secret: string): boolean {
  return parseAlpacaCredential(secret) !== null;
}

export function resolveAlpacaBaseUrl(settings: Record<string, unknown> | null | undefined): string {
  const fromSettings = typeof settings?.baseUrl === "string" && /^https?:\/\//.test(settings.baseUrl) ? settings.baseUrl : null;
  return fromSettings ?? process.env.ALPACA_API_BASE ?? ALPACA_PAPER_BASE_URL;
}

/** The live host is never allowed, whatever the settings say. */
export function isLiveAlpacaHost(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).host.toLowerCase() === ALPACA_LIVE_HOST;
  } catch {
    return true;
  }
}

export const orderParamsSchema = z
  .object({
    symbol: z.string().regex(/^[A-Z0-9.\-/]{1,12}$/, "symbol must be an upper-case ticker"),
    side: z.enum(["buy", "sell"]),
    type: z.enum(["market", "limit"]),
    qty: z.number().positive(),
    /** The order's value in the account currency, as the agent declares it. */
    notional: z.number().positive(),
    limitPrice: z.number().positive().optional(),
    timeInForce: z.enum(["day", "gtc", "ioc", "fok"]).default("day"),
    /** The agent's own order reference; the gateway's duplicate detection keys on it. */
    reference: z.string().min(1).max(120),
    reason: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.type === "limit" && p.limitPrice === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["limitPrice"], message: "limit orders need a limitPrice" });
    if (p.type === "limit" && p.limitPrice !== undefined) {
      const implied = p.qty * p.limitPrice;
      if (Math.abs(implied - p.notional) > NOTIONAL_TOLERANCE * p.notional) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["notional"], message: `declared notional ${p.notional} does not match qty times limit price (${round2(implied)})` });
    }
  });
export type OrderParams = z.infer<typeof orderParamsSchema>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------- HTTP ----------

export interface AlpacaClient {
  baseUrl: string;
  keyId: string;
  secretKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type AlpacaHttpResult<T> = { kind: "ok"; status: number; body: T } | { kind: "error"; status: number; code: number | null; message: string } | { kind: "transport"; error: string };

/** One Alpaca call with a hard timeout. Never throws: transport problems come back as `transport`. */
export async function alpacaRequest<T = Record<string, unknown>>(client: AlpacaClient, method: "GET" | "POST" | "DELETE", path: string, opts: { json?: Record<string, unknown>; query?: Record<string, string | number | undefined> } = {}): Promise<AlpacaHttpResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), client.timeoutMs ?? ALPACA_TIMEOUT_MS);
  const qs = opts.query ? Object.entries(opts.query).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
  const url = `${client.baseUrl.replace(/\/$/, "")}${path}${qs ? `?${qs}` : ""}`;
  const headers: Record<string, string> = { "apca-api-key-id": client.keyId, "apca-api-secret-key": client.secretKey, accept: "application/json" };
  let body: string | undefined;
  if (opts.json) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  try {
    const res = await (client.fetchImpl ?? fetch)(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        return { kind: "transport", error: `malformed response (HTTP ${res.status})` };
      }
    }
    if (res.ok) {
      if (!json || typeof json !== "object") return { kind: "transport", error: `empty response (HTTP ${res.status})` };
      return { kind: "ok", status: res.status, body: json as T };
    }
    const err = (json ?? {}) as { code?: number; message?: string };
    return { kind: "error", status: res.status, code: typeof err.code === "number" ? err.code : null, message: typeof err.message === "string" ? err.message : `HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? `timeout after ${client.timeoutMs ?? ALPACA_TIMEOUT_MS}ms` : e.message) : "request failed";
    return { kind: "transport", error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  status: string;
  symbol: string;
  side: string;
  type: string;
  time_in_force: string;
  qty: string | null;
  notional: string | null;
  filled_qty: string | null;
  filled_avg_price: string | null;
  limit_price: string | null;
  submitted_at: string;
}

/** Body for POST /v2/orders. Market orders go by notional; limit orders by qty and price. */
export function buildOrderBody(p: OrderParams, clientOrderId: string): Record<string, unknown> {
  const base = { symbol: p.symbol, side: p.side, type: p.type, time_in_force: p.timeInForce, client_order_id: clientOrderId };
  if (p.type === "limit") return { ...base, qty: String(p.qty), limit_price: String(p.limitPrice) };
  return { ...base, notional: String(round2(p.notional)) };
}

export async function getOrderByClientId(client: AlpacaClient, clientOrderId: string): Promise<{ order: AlpacaOrder } | { missing: true } | { unknown: string }> {
  const r = await alpacaRequest<AlpacaOrder>(client, "GET", "/v2/orders:by_client_order_id", { query: { client_order_id: clientOrderId } });
  if (r.kind === "transport") return { unknown: r.error };
  if (r.kind === "error") {
    if (r.status === 404) return { missing: true };
    return { unknown: `Alpaca ${r.status}: ${r.message}` };
  }
  if (typeof r.body.id !== "string") return { unknown: "malformed order response" };
  return { order: r.body };
}

function orderSummary(o: AlpacaOrder, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { orderId: o.id, clientOrderId: o.client_order_id, orderStatus: o.status, symbol: o.symbol, side: o.side, type: o.type, qty: o.qty, notional: o.notional, filledQty: o.filled_qty, filledAvgPrice: o.filled_avg_price, limitPrice: o.limit_price, submittedAt: o.submitted_at, paper: true, ...extra };
}

async function clientFor(ctx: DownstreamContext): Promise<{ client: AlpacaClient } | { refused: string }> {
  const settings = await ctx.run(async (db) => {
    const integ = await db.integration.findUnique({ where: { id: ctx.integrationId }, select: { settings: true } });
    return (integ?.settings ?? {}) as Record<string, unknown>;
  });
  let raw: string;
  try {
    raw = await ctx.credential(ALPACA_CREDENTIAL_NAME);
  } catch (e) {
    return { refused: e instanceof Error ? e.message : "credential unavailable" };
  }
  const cred = parseAlpacaCredential(raw);
  if (!cred) return { refused: ALPACA_PAPER_KEY_MESSAGE };
  const baseUrl = resolveAlpacaBaseUrl(settings);
  if (isLiveAlpacaHost(baseUrl)) return { refused: "The live Alpaca host is refused; this connector only trades on paper-api.alpaca.markets" };
  return { client: { baseUrl, keyId: cred.keyId, secretKey: cred.secretKey } };
}

function failed(error: string, summary: Record<string, unknown> = {}): DownstreamResult {
  return { outcome: "failed", reference: null, summary, error };
}
function unknown(error: string, summary: Record<string, unknown> = {}): DownstreamResult {
  return { outcome: "unknown", reference: null, summary, error };
}

const DUPLICATE_CLIENT_ORDER_ID = 40010001;

export const alpacaPaperConnector: DownstreamSystem = {
  key: ALPACA_SYSTEM_KEY,
  kind: "sandbox",
  label: "Alpaca (paper trading)",

  validateCredential(_name, secret) {
    return isAlpacaPaperCredential(secret) ? null : ALPACA_PAPER_KEY_MESSAGE;
  },

  async execute(ctx, req): Promise<DownstreamResult> {
    if (req.toolKey !== "place-order") return failed(`alpaca-paper does not implement tool ${req.toolKey}`);
    const parsed = orderParamsSchema.safeParse(req.params);
    if (!parsed.success) return failed(`invalid order parameters: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    if (hashObject({ toolKey: req.toolKey, action: req.action, params: req.params }) !== req.grant.requestHash) return failed("execution grant rejected: parameters do not match the authorised request");
    const c = await clientFor(ctx);
    if ("refused" in c) return failed(c.refused);
    const body = buildOrderBody(parsed.data, req.idempotencyKey);
    const extra = { requestedNotional: parsed.data.notional, requestedQty: parsed.data.qty, attempt: req.attempt };
    // Everything above happened before any byte left the gateway. From here on, ambiguity is `unknown`.
    const r = await alpacaRequest<AlpacaOrder>(c.client, "POST", "/v2/orders", { json: body });
    if (r.kind === "transport") return unknown(r.error, { alpaca: { responded: false }, ...extra });
    if (r.kind === "error") {
      if (r.status === 422 && (r.code === DUPLICATE_CLIENT_ORDER_ID || /client_order_id/i.test(r.message))) {
        // The order for this request already exists (an earlier attempt reached Alpaca). Fetch it.
        const found = await getOrderByClientId(c.client, req.idempotencyKey);
        if ("order" in found) return { outcome: "succeeded", reference: found.order.id, summary: orderSummary(found.order, { ...extra, idempotentReplay: true }) };
        return unknown(`Alpaca reports a duplicate client_order_id but the order could not be fetched${"unknown" in found ? `: ${found.unknown}` : ""}`, { alpaca: { responded: true, httpStatus: 422 }, ...extra });
      }
      const label = `Alpaca ${r.status}${r.code ? ` (${r.code})` : ""}: ${r.message}`;
      if (r.status >= 500 || r.status === 429) return unknown(label, { alpaca: { responded: true, httpStatus: r.status, code: r.code }, ...extra });
      return failed(label, { alpaca: { responded: true, httpStatus: r.status, code: r.code }, ...extra });
    }
    if (typeof r.body.id !== "string") return unknown("Alpaca answered with an unexpected body", { alpaca: { responded: true, httpStatus: r.status }, ...extra });
    return { outcome: "succeeded", reference: r.body.id, summary: orderSummary(r.body, extra) };
  },

  /** Looks the order up by client_order_id (the gateway's idempotency key). Definitive absence means nothing was placed. */
  async reconcile(ctx, req): Promise<DownstreamResult> {
    const c = await clientFor(ctx);
    if ("refused" in c) return unknown(`cannot look up Alpaca: ${c.refused}`);
    const found = await getOrderByClientId(c.client, req.idempotencyKey);
    if ("unknown" in found) return unknown(found.unknown, { reconcileStrategy: "lookup" });
    if ("missing" in found) return failed("Alpaca holds no order for this request; nothing was placed", { reconcileStrategy: "lookup" });
    return { outcome: "succeeded", reference: found.order.id, summary: orderSummary(found.order, { reconcileStrategy: "lookup" }) };
  },

  async testConnection(ctx) {
    const c = await clientFor(ctx);
    if ("refused" in c) return { ok: false, detail: c.refused };
    const r = await alpacaRequest<{ status?: string; currency?: string; buying_power?: string; trading_blocked?: boolean }>(c.client, "GET", "/v2/account");
    if (r.kind === "transport") return { ok: false, detail: `Alpaca unreachable: ${r.error}` };
    if (r.kind === "error") return { ok: false, detail: `Alpaca ${r.status}: ${r.message}` };
    if (r.body.status !== "ACTIVE") return { ok: false, detail: `Alpaca paper account is ${r.body.status ?? "unknown"}, not ACTIVE` };
    if (r.body.trading_blocked) return { ok: false, detail: "Alpaca paper account has trading blocked" };
    return { ok: true, detail: `Alpaca paper account ACTIVE, buying power ${r.body.currency ?? "USD"} ${r.body.buying_power ?? "unknown"}` };
  },
};
