/**
 * A minimal reference adapter for the AEGIS execution protocol v1 (docs/CONNECTORS.md). It keeps
 * operations in memory; a real adapter stores them in the system's own database, keyed by the
 * idempotency key, in the same transaction as the change it makes.
 *
 * Run: AEGIS_SIGNING_SECRET=<same value as the integration's signing-secret> npx tsx examples/https-adapter.ts
 * Serve it over HTTPS (behind your load balancer or gateway) and register its URL as the base URL.
 */
import { createServer, type ServerResponse } from "node:http";
import { parseAegisExecution, verifyAegisSignature, type AegisOperationAnswer } from "../src/index.js";

const secret = process.env.AEGIS_SIGNING_SECRET ?? "";
if (secret.length < 32) throw new Error("Set AEGIS_SIGNING_SECRET (at least 32 characters)");

type Op = AegisOperationAnswer & { idempotencyKey: string; at: string };
const operations = new Map<string, Op>();

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

createServer((req, res) => {
  let body = "";
  req.on("data", (c: Buffer) => (body += c.toString("utf8")));
  req.on("end", () => {
    const ok = verifyAegisSignature({ secret, timestamp: req.headers["aegis-timestamp"] as string | undefined, signature: req.headers["aegis-signature"] as string | undefined, body });
    if (!ok) return send(res, 401, { error: "bad signature" });
    const url = new URL(req.url ?? "/", "http://adapter");

    if (req.method === "GET" && url.pathname === "/aegis/v1/health") return send(res, 200, { ok: true });

    if (req.method === "POST" && url.pathname === "/aegis/v1/execute") {
      const exec = parseAegisExecution(body);
      if (!exec) return send(res, 400, { error: "not an AEGIS v1 execution" });
      const done = operations.get(exec.idempotencyKey);
      if (done) return send(res, 200, done); // at most once per key
      // Do the real work here, then record its outcome under the idempotency key.
      const op: Op = { status: "succeeded", reference: `op-${operations.size + 1}`, summary: { tool: exec.tool }, idempotencyKey: exec.idempotencyKey, at: new Date().toISOString() };
      operations.set(exec.idempotencyKey, op);
      return send(res, 200, op);
    }

    const one = /^\/aegis\/v1\/operations\/(.+)$/.exec(url.pathname);
    if (req.method === "GET" && one) {
      const op = operations.get(decodeURIComponent(one[1]!));
      return op ? send(res, 200, op) : send(res, 404, { error: "no such operation" });
    }

    if (req.method === "GET" && url.pathname === "/aegis/v1/operations") {
      const since = new Date(url.searchParams.get("since") ?? 0).getTime();
      return send(res, 200, { operations: [...operations.values()].filter((o) => new Date(o.at).getTime() >= since) });
    }
    send(res, 404, { error: "not found" });
  });
}).listen(Number(process.env.PORT ?? 8787));
