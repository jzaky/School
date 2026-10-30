/**
 * Generic HTTPS connector: puts AEGIS in front of any customer system without custom code in AEGIS.
 *
 * The customer exposes a small adapter on their system (the AEGIS execution protocol, v1, documented
 * in docs/CONNECTORS.md) and registers an integration of type "https" with that adapter's base URL
 * and a signing secret. For every allowed or approved action, AEGIS consumes the one-time grant and
 * then calls the adapter:
 *
 *   POST {base}/aegis/v1/execute                    the action, signed; carries the idempotency key
 *   GET  {base}/aegis/v1/operations/{idempotencyKey} the outcome of an earlier attempt (reconciliation)
 *   GET  {base}/aegis/v1/operations?since=<ISO>      recent operations (enforcement-path audit)
 *   GET  {base}/aegis/v1/health                      connection test
 *
 * Every request is signed: AEGIS-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<body>"> with the
 * integration's "signing-secret" credential, and AEGIS-Timestamp, so the adapter can refuse anything
 * that did not come from this AEGIS deployment or that is replayed later. An optional "bearer-token"
 * credential is sent as Authorization: Bearer for systems that also want their own token.
 *
 * Outcomes, following the gateway's rules (gateway/simulators.ts):
 *  - succeeded: 2xx with {"status":"succeeded"}; the reference is the system's own id.
 *  - failed: 2xx with {"status":"failed"}, any other 4xx except 408, 409 and 429, a redirect (never
 *    followed), or no record of the operation on reconciliation (404): nothing happened downstream.
 *  - unknown: 2xx with {"status":"pending"}, 408, 409, 429, 5xx, a timeout, a dropped connection or an
 *    unreadable body. The call may have happened, so the gateway reconciles by idempotency key and
 *    never retries blindly.
 *
 * Network safety: the base URL must be HTTPS and resolve to public addresses only, checked when the
 * call is made and pinned for the connection (no DNS rebinding); redirects are not followed; bodies
 * are capped at 64 KB; every call times out after 10 seconds.
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { env } from "../../env.js";
import { hmacHex } from "../../lib/crypto.js";
import { assertSafeDestinationUrl, pinnedLookup } from "../../integrations/destinations.js";
import type { DownstreamContext, DownstreamRequest, DownstreamResult, DownstreamSystem } from "../simulators.js";

/** Same rule as simulators.requestIdFromIdempotencyKey (kept local: the registry imports this module). */
function requestIdFromIdempotencyKey(key: unknown): string | null {
  return typeof key === "string" ? (/^aegis:([0-9a-f-]{36})$/i.exec(key)?.[1] ?? null) : null;
}

export const HTTPS_INTEGRATION_TYPE = "https";
export const HTTPS_SYSTEM_KEY = "https-generic";
export const SIGNING_SECRET = "signing-secret";
export const BEARER_TOKEN = "bearer-token";
export const HTTPS_TIMEOUT_MS = 10_000;
const MAX_BODY = 64 * 1024;

export interface HttpCall {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
}
export interface HttpAnswer {
  status: number;
  body: string;
}
export type HttpTransport = (call: HttpCall) => Promise<HttpAnswer>;

/** Pinned-DNS transport: the address checked is the address connected to. */
export const defaultTransport: HttpTransport = (call) =>
  new Promise((resolve, reject) => {
    const url = new URL(call.url);
    const client = url.protocol === "https:" ? httpsRequest : httpRequest;
    const r = client(url, { method: call.method, headers: call.headers, lookup: pinnedLookup(env().AEGIS_ALLOW_PRIVATE_DESTINATIONS), timeout: HTTPS_TIMEOUT_MS }, (res) => {
      let body = "";
      let size = 0;
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        size += chunk.length;
        if (size > MAX_BODY) return r.destroy(new Error("The system's answer was larger than 64 KB"));
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    r.on("timeout", () => r.destroy(new Error(`The system did not answer within ${HTTPS_TIMEOUT_MS / 1000} seconds`)));
    r.on("error", reject);
    r.end(call.body);
  });

let transport: HttpTransport = defaultTransport;
/** Tests replace the transport; production uses the pinned-DNS transport. */
export function setHttpsTransport(t: HttpTransport | null) {
  transport = t ?? defaultTransport;
}

/** The signature an adapter checks: hex HMAC-SHA256 of "<timestamp>.<body>" with the signing secret. */
export function signExecution(secret: string, timestamp: string, body: string): string {
  return `v1=${hmacHex(secret, `${timestamp}.${body}`)}`;
}

async function target(ctx: DownstreamContext): Promise<{ base: string; secret: string; bearer: string | null }> {
  const baseUrl = await ctx.run(async (db) => (await db.integration.findUnique({ where: { id: ctx.integrationId }, select: { baseUrl: true } }))?.baseUrl ?? null);
  if (!baseUrl) throw new Error("The integration has no base URL for its AEGIS adapter");
  const safe = await assertSafeDestinationUrl(baseUrl);
  const secret = await ctx.credential(SIGNING_SECRET);
  const bearer = await ctx.credential(BEARER_TOKEN).catch(() => null);
  return { base: safe.toString().replace(/\/$/, ""), secret, bearer };
}

async function call(ctx: DownstreamContext, method: "GET" | "POST", path: string, payload: unknown, idempotencyKey?: string): Promise<HttpAnswer> {
  const t = await target(ctx);
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "AEGIS-Connector/1",
    "aegis-timestamp": timestamp,
    "aegis-signature": signExecution(t.secret, timestamp, body),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    ...(t.bearer ? { authorization: `Bearer ${t.bearer}` } : {}),
  };
  return transport({ method, url: `${t.base}${path}`, headers, body });
}

type AdapterAnswer = { status?: unknown; reference?: unknown; summary?: unknown; error?: unknown };

function parse(body: string): AdapterAnswer | null {
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === "object" ? (v as AdapterAnswer) : null;
  } catch {
    return null;
  }
}

function fromAdapter(a: AdapterAnswer | null, httpStatus: number): DownstreamResult {
  const reference = typeof a?.reference === "string" ? a.reference : null;
  const summary = a?.summary && typeof a.summary === "object" ? (a.summary as Record<string, unknown>) : {};
  if (a?.status === "succeeded") return { outcome: "succeeded", reference, summary: { ...summary, httpStatus } };
  if (a?.status === "failed") return { outcome: "failed", reference, summary: { ...summary, httpStatus }, error: typeof a.error === "string" ? a.error.slice(0, 300) : "The system refused the action" };
  if (a?.status === "pending") return { outcome: "unknown", reference, summary: { ...summary, httpStatus, pending: true }, error: "The system accepted the action but has not finished it" };
  return { outcome: "unknown", reference: null, summary: { httpStatus }, error: "The system answered without a readable status" };
}

/** Classifies an HTTP answer to execute or to a reconciliation lookup. */
export function classify(answer: HttpAnswer, mode: "execute" | "lookup"): DownstreamResult {
  const s = answer.status;
  if (s >= 200 && s < 300) return fromAdapter(parse(answer.body), s);
  if (mode === "lookup" && s === 404) return { outcome: "failed", reference: null, summary: { httpStatus: s }, error: "The system has no record of this operation, so it did not happen" };
  if (s >= 300 && s < 400) return { outcome: "failed", reference: null, summary: { httpStatus: s }, error: "The system answered with a redirect, which AEGIS does not follow" };
  if (s === 408 || s === 409 || s === 429 || s >= 500) return { outcome: "unknown", reference: null, summary: { httpStatus: s }, error: `HTTP ${s}: the outcome is not known yet` };
  const a = parse(answer.body);
  return { outcome: "failed", reference: null, summary: { httpStatus: s }, error: typeof a?.error === "string" ? `HTTP ${s}: ${a.error.slice(0, 300)}` : `HTTP ${s}` };
}

/** A network error before any answer: the request may have reached the system. Configuration errors are definitive. */
function networkResult(e: unknown): DownstreamResult {
  const msg = e instanceof Error ? e.message : String(e);
  const config = /base URL|HTTPS|private|valid URL|credential|resolve|unavailable/.test(msg);
  return { outcome: config ? "failed" : "unknown", reference: null, summary: {}, error: msg.slice(0, 300) };
}

export const httpsConnector: DownstreamSystem = {
  key: HTTPS_SYSTEM_KEY,
  kind: "live",
  label: "Customer system over HTTPS (AEGIS execution protocol v1)",
  async execute(ctx: DownstreamContext, req: DownstreamRequest): Promise<DownstreamResult> {
    const payload = {
      protocol: "aegis-execution/1",
      requestId: req.actionRequestId,
      idempotencyKey: req.idempotencyKey,
      attempt: req.attempt,
      tool: req.toolKey,
      action: req.action,
      params: req.params,
      correlationId: req.correlationId,
      agent: req.agentSlug,
      grant: { requestHash: req.grant.requestHash, consumedAt: req.grant.consumedAt.toISOString() },
    };
    try {
      return classify(await call(ctx, "POST", "/aegis/v1/execute", payload, req.idempotencyKey), "execute");
    } catch (e) {
      return networkResult(e);
    }
  },
  async reconcile(ctx: DownstreamContext, req: DownstreamRequest): Promise<DownstreamResult> {
    try {
      return classify(await call(ctx, "GET", `/aegis/v1/operations/${encodeURIComponent(req.idempotencyKey)}`, undefined), "lookup");
    } catch (e) {
      // A configuration error during reconciliation does not prove nothing happened: stay unknown.
      return { ...networkResult(e), outcome: "unknown" };
    }
  },
  async testConnection(ctx: DownstreamContext) {
    try {
      const a = await call(ctx, "GET", "/aegis/v1/health", undefined);
      if (a.status >= 200 && a.status < 300) return { ok: true, detail: "The adapter answered and accepted AEGIS's signature" };
      return { ok: false, detail: a.status === 401 || a.status === 403 ? `The adapter refused the signature or token (HTTP ${a.status}): check the signing secret` : `The adapter answered HTTP ${a.status}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
  validateCredential(name: string, secret: string) {
    if (name === SIGNING_SECRET) return secret.length >= 32 ? null : "The signing secret must be at least 32 characters; generate a random one and give the same value to the adapter.";
    if (name === BEARER_TOKEN) return secret.trim().length >= 8 ? null : "The bearer token looks too short.";
    return `This connector uses two credentials: "${SIGNING_SECRET}" (required) and "${BEARER_TOKEN}" (optional).`;
  },
  async listRecentOperations(ctx: DownstreamContext, since: Date) {
    const a = await call(ctx, "GET", `/aegis/v1/operations?since=${encodeURIComponent(since.toISOString())}`, undefined);
    if (a.status < 200 || a.status >= 300) throw new Error(`The adapter's operations list answered HTTP ${a.status}`);
    const body = parse(a.body) as { operations?: unknown } | null;
    if (!body || !Array.isArray(body.operations)) throw new Error("The adapter's operations list is not in the expected format");
    return (body.operations as { reference?: unknown; idempotencyKey?: unknown; at?: unknown; summary?: unknown }[]).map((o) => ({
      reference: String(o.reference ?? ""),
      aegisRequestId: requestIdFromIdempotencyKey(o.idempotencyKey),
      at: new Date(String(o.at ?? since.toISOString())),
      summary: o.summary && typeof o.summary === "object" ? (o.summary as Record<string, unknown>) : {},
    }));
  },
};
