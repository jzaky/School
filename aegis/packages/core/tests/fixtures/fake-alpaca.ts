/**
 * A small HTTP server emulating the slice of Alpaca's paper trading API the connector uses, with
 * Alpaca-shaped JSON and Alpaca's client_order_id rule:
 *  - POST /v2/orders creates an order; a reused client_order_id is refused with 422 code 40010001
 *  - GET /v2/orders:by_client_order_id and GET /v2/orders/{id} look orders up
 *  - GET /v2/account answers an ACTIVE paper account
 *  - only key ids starting with PK are accepted (403 otherwise), as on the paper host
 * Failure injection: "lost-response" creates the order and then destroys the socket; "drop-before-processing"
 * destroys the socket before doing anything; "server-error" answers 500 without creating anything.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

export type FakeAlpacaMode = "normal" | "lost-response" | "drop-before-processing" | "server-error";

export interface FakeOrder {
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

export interface RecordedAlpacaRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface FakeAlpaca {
  url: string;
  mode: FakeAlpacaMode;
  requests: RecordedAlpacaRequest[];
  orders(): FakeOrder[];
  /** Symbols the fake knows; others are refused with 422 as Alpaca does for unknown assets. */
  symbols: Set<string>;
  reset(): void;
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

export async function startFakeAlpaca(): Promise<FakeAlpaca> {
  const orders: FakeOrder[] = [];
  const requests: RecordedAlpacaRequest[] = [];
  const state: { mode: FakeAlpacaMode } = { mode: "normal" };
  const symbols = new Set(["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA"]);

  const auth = (req: IncomingMessage, res: ServerResponse): boolean => {
    const id = String(req.headers["apca-api-key-id"] ?? "");
    const secret = String(req.headers["apca-api-secret-key"] ?? "");
    if (!/^PK[A-Z0-9]{6,}$/.test(id) || secret.length < 8) {
      send(res, 403, { code: 40110000, message: "forbidden." });
      return false;
    }
    return true;
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://fake");
    let body: Record<string, unknown> = {};
    if (raw) {
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v ?? "")]));
    requests.push({ method: req.method ?? "GET", path: url.pathname, headers, body });
    if (!auth(req, res)) return;

    if (req.method === "GET" && url.pathname === "/v2/account") {
      return send(res, 200, { id: "paper-account", account_number: "PA3FAKE", status: "ACTIVE", currency: "USD", cash: "100000", buying_power: "200000", trading_blocked: false, pattern_day_trader: false });
    }
    if (req.method === "GET" && url.pathname === "/v2/orders:by_client_order_id") {
      const cid = url.searchParams.get("client_order_id");
      const o = orders.find((x) => x.client_order_id === cid);
      if (!o) return send(res, 404, { code: 40410000, message: "order not found" });
      return send(res, 200, o);
    }
    const one = url.pathname.match(/^\/v2\/orders\/([0-9a-f-]{36})$/);
    if (req.method === "GET" && one) {
      const o = orders.find((x) => x.id === one[1]);
      if (!o) return send(res, 404, { code: 40410000, message: "order not found" });
      return send(res, 200, o);
    }
    if (req.method === "POST" && url.pathname === "/v2/orders") {
      if (state.mode === "drop-before-processing") return req.socket.destroy();
      if (state.mode === "server-error") return send(res, 500, { code: 50010000, message: "internal server error (simulated)" });
      const cid = typeof body.client_order_id === "string" ? body.client_order_id : randomUUID();
      if (orders.some((o) => o.client_order_id === cid)) return send(res, 422, { code: 40010001, message: "client_order_id must be unique" });
      const symbol = String(body.symbol ?? "");
      if (!symbols.has(symbol)) return send(res, 422, { code: 40010001, message: `asset "${symbol}" cannot be found` });
      const qty = body.qty !== undefined ? Number(body.qty) : null;
      const notional = body.notional !== undefined ? Number(body.notional) : null;
      if ((qty === null && notional === null) || (qty !== null && !(qty > 0)) || (notional !== null && !(notional > 0))) return send(res, 422, { code: 40010001, message: "qty or notional is required and must be positive" });
      const type = String(body.type ?? "market");
      if (type === "limit" && !(Number(body.limit_price) > 0)) return send(res, 422, { code: 40010001, message: "limit_price is required for limit orders" });
      if (type === "market" && !["day", "ioc", "fok", "gtc"].includes(String(body.time_in_force))) return send(res, 422, { code: 40010001, message: "invalid time_in_force" });
      const price = type === "limit" ? Number(body.limit_price) : 100;
      const filledQty = qty !== null ? qty : Math.round(((notional ?? 0) / price) * 1_000_000) / 1_000_000;
      const order: FakeOrder = {
        id: randomUUID(),
        client_order_id: cid,
        status: type === "market" ? "filled" : "accepted",
        symbol,
        side: String(body.side ?? "buy"),
        type,
        time_in_force: String(body.time_in_force ?? "day"),
        qty: qty !== null ? String(qty) : null,
        notional: notional !== null ? String(notional) : null,
        filled_qty: type === "market" ? String(filledQty) : "0",
        filled_avg_price: type === "market" ? String(price) : null,
        limit_price: type === "limit" ? String(body.limit_price) : null,
        submitted_at: new Date().toISOString(),
      };
      orders.push(order);
      if (state.mode === "lost-response") return req.socket.destroy();
      return send(res, 200, order);
    }
    send(res, 404, { code: 40410000, message: `endpoint not found: ${req.method} ${url.pathname}` });
  };

  const server: Server = createServer((req, res) => {
    handler(req, res).catch((e) => send(res, 500, { code: 50010000, message: e instanceof Error ? e.message : "fake failure" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const fake: FakeAlpaca = {
    url: `http://127.0.0.1:${port}`,
    get mode() {
      return state.mode;
    },
    set mode(m: FakeAlpacaMode) {
      state.mode = m;
    },
    requests,
    orders: () => orders.slice(),
    symbols,
    reset() {
      orders.length = 0;
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
