/**
 * A small HTTP server emulating the slice of Stripe's API the refund connector uses, with
 * Stripe-shaped JSON and Stripe's idempotency rules:
 *  - the same Idempotency-Key returns the saved result of the first request
 *  - the same key with a different body is refused with a 400 idempotency_error
 *  - refunds beyond the payment intent amount fail with charge_already_refunded
 *  - unknown payment intents fail with 404 resource_missing
 * Failure injection: "lost-response" creates the refund and then destroys the socket; "drop-before-processing"
 * destroys the socket before doing anything; "server-error" answers 500 without creating anything.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

export type FakeMode = "normal" | "lost-response" | "drop-before-processing" | "server-error";

export interface FakeRefund {
  id: string;
  object: "refund";
  amount: number;
  currency: string;
  status: "succeeded";
  payment_intent: string;
  charge: string;
  reason: string | null;
  metadata: Record<string, string>;
  created: number;
  livemode: false;
}

export interface FakePaymentIntent {
  id: string;
  amount: number;
  currency: string;
  charge: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, string>;
}

export interface FakeStripe {
  url: string;
  mode: FakeMode;
  requests: RecordedRequest[];
  refunds(): FakeRefund[];
  paymentIntents(): FakePaymentIntent[];
  seedPaymentIntent(amount: number, currency?: string, id?: string): FakePaymentIntent;
  reset(): void;
  close(): Promise<void>;
}

function parseForm(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split("&")) {
    if (!part) continue;
    const [k, v = ""] = part.split("=");
    out[decodeURIComponent(k!)] = decodeURIComponent(v.replace(/\+/g, " "));
  }
  return out;
}

function nested(body: Record<string, string>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    const m = k.match(new RegExp(`^${prefix}\\[(.+)\\]$`));
    if (m) out[m[1]!] = v;
  }
  return out;
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function stripeError(res: ServerResponse, status: number, type: string, code: string | undefined, message: string, extra: Record<string, unknown> = {}) {
  send(res, status, { error: { type, code, message, ...extra } });
}

export async function startFakeStripe(): Promise<FakeStripe> {
  const intents = new Map<string, FakePaymentIntent>();
  const refunds: FakeRefund[] = [];
  // Idempotency store: key -> { bodyFingerprint, status, body }
  const idem = new Map<string, { fingerprint: string; status: number; body: unknown }>();
  const requests: RecordedRequest[] = [];
  const state: { mode: FakeMode } = { mode: "normal" };

  const auth = (req: IncomingMessage, res: ServerResponse): boolean => {
    const h = req.headers.authorization ?? "";
    const key = h.replace(/^Bearer\s+/i, "");
    if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) {
      stripeError(res, 401, "invalid_request_error", undefined, "Invalid API Key provided");
      return false;
    }
    return true;
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://fake");
    const body = req.method === "POST" ? parseForm(raw) : {};
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v ?? "")]));
    requests.push({ method: req.method ?? "GET", path: url.pathname, headers, body });
    if (!auth(req, res)) return;

    if (req.method === "GET" && url.pathname === "/v1/balance") {
      return send(res, 200, { object: "balance", livemode: false, available: [{ amount: 100000, currency: "aed" }], pending: [] });
    }

    if (req.method === "GET" && url.pathname === "/v1/refunds") {
      const pi = url.searchParams.get("payment_intent");
      if (pi && !intents.has(pi)) return stripeError(res, 404, "invalid_request_error", "resource_missing", `No such payment_intent: '${pi}'`, { param: "payment_intent" });
      const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 10));
      const after = url.searchParams.get("starting_after");
      let data = refunds.filter((r) => !pi || r.payment_intent === pi).slice().reverse();
      if (after) {
        const idx = data.findIndex((r) => r.id === after);
        data = idx >= 0 ? data.slice(idx + 1) : [];
      }
      const page = data.slice(0, limit);
      return send(res, 200, { object: "list", url: "/v1/refunds", has_more: data.length > limit, data: page });
    }

    const one = url.pathname.match(/^\/v1\/refunds\/(re_[A-Za-z0-9]+)$/);
    if (req.method === "GET" && one) {
      const r = refunds.find((x) => x.id === one[1]);
      if (!r) return stripeError(res, 404, "invalid_request_error", "resource_missing", `No such refund: '${one[1]}'`, { param: "id" });
      return send(res, 200, r);
    }

    if (req.method === "POST" && url.pathname === "/v1/refunds") {
      if (state.mode === "drop-before-processing") return req.socket.destroy();
      const key = headers["idempotency-key"];
      const fingerprint = JSON.stringify(Object.entries(body).sort(([a], [b]) => a.localeCompare(b)));
      if (key) {
        const saved = idem.get(key);
        if (saved) {
          if (saved.fingerprint !== fingerprint) return stripeError(res, 400, "idempotency_error", undefined, `Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than '${key}' if you meant to execute a different request.`);
          return send(res, saved.status, saved.body);
        }
      }
      const remember = (status: number, payload: unknown) => {
        if (key) idem.set(key, { fingerprint, status, body: payload });
      };
      if (state.mode === "server-error") {
        const payload = { error: { type: "api_error", message: "An error occurred while processing your request (simulated 500)." } };
        remember(500, payload);
        return send(res, 500, payload);
      }
      const pi = body.payment_intent;
      const intent = pi ? intents.get(pi) : undefined;
      if (!pi || !intent) {
        const payload = { error: { type: "invalid_request_error", code: "resource_missing", param: "payment_intent", message: `No such payment_intent: '${pi ?? ""}'` } };
        remember(404, payload);
        return send(res, 404, payload);
      }
      const amount = body.amount ? Number(body.amount) : intent.amount;
      if (!Number.isInteger(amount) || amount <= 0) {
        const payload = { error: { type: "invalid_request_error", code: "parameter_invalid_integer", param: "amount", message: "Invalid integer: amount" } };
        remember(400, payload);
        return send(res, 400, payload);
      }
      const already = refunds.filter((r) => r.payment_intent === pi).reduce((s, r) => s + r.amount, 0);
      if (already + amount > intent.amount) {
        const payload = { error: { type: "invalid_request_error", code: "charge_already_refunded", message: already >= intent.amount ? `Charge ${intent.charge} has already been refunded.` : `Refund amount (${amount}) is greater than unrefunded amount on charge (${intent.amount - already})` } };
        remember(400, payload);
        return send(res, 400, payload);
      }
      const refund: FakeRefund = { id: `re_${randomBytes(12).toString("hex")}`, object: "refund", amount, currency: intent.currency, status: "succeeded", payment_intent: pi, charge: intent.charge, reason: body.reason ?? null, metadata: nested(body, "metadata"), created: Math.floor(Date.now() / 1000), livemode: false };
      refunds.push(refund);
      remember(200, refund);
      if (state.mode === "lost-response") return req.socket.destroy();
      return send(res, 200, refund);
    }

    stripeError(res, 404, "invalid_request_error", undefined, `Unrecognized request URL (${req.method}: ${url.pathname}).`);
  };

  const server: Server = createServer((req, res) => {
    handler(req, res).catch((e) => stripeError(res, 500, "api_error", undefined, e instanceof Error ? e.message : "fake failure"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const fake: FakeStripe = {
    url: `http://127.0.0.1:${port}`,
    get mode() {
      return state.mode;
    },
    set mode(m: FakeMode) {
      state.mode = m;
    },
    requests,
    refunds: () => refunds.slice(),
    paymentIntents: () => [...intents.values()],
    seedPaymentIntent(amount, currency = "aed", id) {
      const pi: FakePaymentIntent = { id: id ?? `pi_${randomBytes(12).toString("hex")}`, amount, currency: currency.toLowerCase(), charge: `ch_${randomBytes(12).toString("hex")}` };
      intents.set(pi.id, pi);
      return pi;
    },
    reset() {
      intents.clear();
      refunds.length = 0;
      idem.clear();
      requests.length = 0;
      state.mode = "normal";
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
  return fake;
}
