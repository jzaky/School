import type { TenantDb } from "@aegis/db";
import { decryptSecret, hashObject } from "../lib/crypto.js";
import { stripeTestConnector } from "./connectors/stripe.js";
import { alpacaPaperConnector } from "./connectors/alpaca.js";
import { HTTPS_INTEGRATION_TYPE, httpsConnector } from "./connectors/https.js";

/**
 * Downstream systems: the things the gateway executes against once a request is allowed or
 * approved. Two kinds exist in this build:
 *
 * - simulated: in-process stand-ins for the demonstrations. They keep a visible ledger in the
 *   integration's `settings.ledger`, refuse to act unless handed a consumed grant bound to the exact
 *   parameters, and honour the downstream idempotency key (a repeat of one request is one entry).
 * - sandbox: real providers in their documented test mode (see gateway/connectors/). They never move
 *   real money and are labelled as sandbox in the console.
 *
 * Every system reports an explicit outcome. `unknown` means "the call may have happened and we did
 * not get a definitive answer"; the gateway records it as such and reconciles later rather than
 * guessing. A system that cannot look up earlier attempts must not claim `unknown` is resolvable.
 */
export type DownstreamKind = "simulated" | "sandbox" | "live";

export interface DownstreamContext {
  orgId: string;
  integrationId: string;
  /** Runs work inside a tenant transaction (ledgers, state). Never hold it across network calls. */
  run<T>(fn: (db: TenantDb) => Promise<T>): Promise<T>;
  /** Decrypted vault credential of this integration. Throws when missing or revoked. */
  credential(name?: string): Promise<string>;
}

export interface DownstreamRequest {
  actionRequestId: string;
  /** Stable for the life of the action request; repeats must be treated as the same operation downstream. */
  idempotencyKey: string;
  attempt: number;
  toolKey: string;
  action: string;
  params: Record<string, unknown>;
  correlationId: string;
  agentSlug: string;
  /** The consumed execution grant. In-process systems check its hash against the parameters they were handed. */
  grant: { requestHash: string; consumedAt: Date };
}

export type DownstreamOutcome = "succeeded" | "failed" | "unknown";

export interface DownstreamResult {
  outcome: DownstreamOutcome;
  reference: string | null;
  summary: Record<string, unknown>;
  error?: string;
}

export interface DownstreamSystem {
  key: string;
  kind: DownstreamKind;
  label: string;
  execute(ctx: DownstreamContext, req: DownstreamRequest): Promise<DownstreamResult>;
  /** Looks up the outcome of an earlier attempt by idempotency key. Returns `unknown` only when it genuinely cannot tell. */
  reconcile?(ctx: DownstreamContext, req: DownstreamRequest): Promise<DownstreamResult>;
  /** Cheap authenticated call proving the credential and network path work. */
  testConnection?(ctx: DownstreamContext): Promise<{ ok: boolean; detail: string }>;
  /** Vetoes a credential before it is stored (for example a live payments key). Returns a plain-language reason, or null to accept. */
  validateCredential?(name: string, secret: string): string | null;
  /**
   * Lists the system's own recent operations so AEGIS can compare them with what it authorized.
   * `aegisRequestId` is the action request the operation carries (through its idempotency key or
   * metadata), or null when it carries none: an operation made around the gateway.
   */
  listRecentOperations?(ctx: DownstreamContext, since: Date): Promise<{ reference: string; aegisRequestId: string | null; at: Date; summary: Record<string, unknown> }[]>;
}

const AEGIS_KEY = /^aegis:([0-9a-f-]{36})$/i;
/** The request id inside a gateway idempotency key (`aegis:<uuid>`), or null. */
export function requestIdFromIdempotencyKey(key: unknown): string | null {
  return typeof key === "string" ? (AEGIS_KEY.exec(key)?.[1] ?? null) : null;
}

export async function readIntegrationCredential(db: TenantDb, integrationId: string, name = "service-token"): Promise<string> {
  const cred = await db.credential.findUnique({ where: { integrationId_name: { integrationId, name } } });
  if (!cred || cred.revokedAt) throw new Error(`credential ${name} unavailable (missing or revoked)`);
  return decryptSecret(cred.secretEnc, `credential:${cred.id}:${cred.name}`);
}

/** In-process "downstream verifies authorization": the grant the gateway consumed must bind exactly these parameters. */
function assertGrantBindsParams(req: DownstreamRequest) {
  const expected = hashObject({ toolKey: req.toolKey, action: req.action, params: req.params });
  if (expected !== req.grant.requestHash) throw new Error("execution grant rejected: parameters do not match the authorised request");
}

interface LedgerEntry extends Record<string, unknown> {
  idempotencyKey: string;
  reference: string;
  at: string;
}

async function readLedger(db: TenantDb, integrationId: string): Promise<{ settings: Record<string, unknown>; ledger: LedgerEntry[] }> {
  const integ = await db.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const settings = (integ.settings ?? {}) as Record<string, unknown>;
  const ledger = Array.isArray(settings.ledger) ? (settings.ledger as LedgerEntry[]) : [];
  return { settings, ledger };
}

/**
 * Appends one ledger entry per idempotency key. Returns the existing entry when the key was seen,
 * which is how a real payments API behaves: a retried request with the same key returns the first result.
 */
async function appendLedgerOnce(ctx: DownstreamContext, req: DownstreamRequest, entry: Record<string, unknown> & { reference: string }): Promise<{ entry: LedgerEntry; duplicate: boolean }> {
  return ctx.run(async (db) => {
    const { settings, ledger } = await readLedger(db, ctx.integrationId);
    const existing = ledger.find((e) => e.idempotencyKey === req.idempotencyKey);
    if (existing) return { entry: existing, duplicate: true };
    const row: LedgerEntry = { ...entry, idempotencyKey: req.idempotencyKey, at: new Date().toISOString() };
    ledger.unshift(row);
    await db.integration.update({ where: { id: ctx.integrationId }, data: { settings: { ...settings, ledger: ledger.slice(0, 200) } as object } });
    return { entry: row, duplicate: false };
  });
}

async function lookupLedger(ctx: DownstreamContext, req: DownstreamRequest): Promise<DownstreamResult> {
  const { ledger } = await ctx.run((db) => readLedger(db, ctx.integrationId));
  const hit = ledger.find((e) => e.idempotencyKey === req.idempotencyKey);
  if (!hit) return { outcome: "failed", reference: null, summary: { reconciled: true, found: false }, error: "no downstream record for this request; the operation did not happen" };
  return { outcome: "succeeded", reference: hit.reference, summary: { reconciled: true, found: true, ...hit } };
}

/** Shared skeleton for the simulators: credential, grant binding, idempotent ledger write. */
function simulator(key: string, label: string, act: (req: DownstreamRequest, requestRef: string) => { entry: Record<string, unknown>; summary: Record<string, unknown>; reference?: string } | { reject: string }): DownstreamSystem {
  return {
    key,
    kind: "simulated",
    label,
    async execute(ctx, req) {
      try {
        await ctx.credential();
        assertGrantBindsParams(req);
      } catch (e) {
        // Nothing was sent: a definitive failure, not an ambiguous one.
        return { outcome: "failed", reference: null, summary: {}, error: e instanceof Error ? e.message : "rejected" };
      }
      // The random tail of the request id: the head of a UUIDv7 is a timestamp and collides within one second.
      const requestRef = req.actionRequestId.replace(/-/g, "").slice(-8).toUpperCase();
      const planned = act(req, requestRef);
      if ("reject" in planned) return { outcome: "failed", reference: null, summary: {}, error: planned.reject };
      const reference = planned.reference ?? `${String(planned.entry.type ?? "op").toUpperCase().slice(0, 3)}-${requestRef}`;
      const { entry, duplicate } = await appendLedgerOnce(ctx, req, { ...planned.entry, reference, agent: req.agentSlug, correlationId: req.correlationId });
      return { outcome: "succeeded", reference: entry.reference, summary: { ...planned.summary, ...(duplicate ? { idempotentReplay: true } : {}) } };
    },
    reconcile: (ctx, req) => lookupLedger(ctx, req),
    async listRecentOperations(ctx, since) {
      const { ledger } = await ctx.run((db) => readLedger(db, ctx.integrationId));
      return ledger
        .map((e) => ({ reference: String(e.reference), aegisRequestId: requestIdFromIdempotencyKey(e.idempotencyKey), at: new Date(String(e.at)), summary: { type: e.type ?? null } }))
        .filter((e) => !Number.isNaN(e.at.getTime()) && e.at >= since);
    },
    async testConnection(ctx) {
      try {
        await ctx.credential();
        return { ok: true, detail: "Simulated system reachable; credential present" };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : "credential missing" };
      }
    },
  };
}

export const coreBankingSimulator = simulator("core-banking-sim", "Core banking (simulated)", (req, ref) => {
  const p = req.params as { fromAccount: string; toAccount: string; amount: number; currency: string; reference?: string };
  return { entry: { type: "transfer", fromAccount: p.fromAccount, toAccount: p.toAccount, amount: p.amount, currency: p.currency }, reference: `TRF-${ref}`, summary: { posted: true, amount: p.amount, currency: p.currency, valueDate: new Date().toISOString().slice(0, 10) } };
});

export const supportPlatformSimulator = simulator("support-platform-sim", "Support platform (simulated)", (req, ref) => {
  if (req.toolKey === "issue-refund") {
    const p = req.params as { orderId: string; customerId: string; amount: number; currency: string; reason?: string };
    return { entry: { type: "refund", orderId: p.orderId, amount: p.amount, currency: p.currency }, reference: `RFD-${ref}`, summary: { refunded: true, amount: p.amount, currency: p.currency, orderId: p.orderId } };
  }
  const p = req.params as { ticketId: string; status?: string };
  return { entry: { type: "ticket_update", status: p.status ?? null }, reference: `TKT-${p.ticketId}`, summary: { updated: true, ticketId: p.ticketId } };
});

export const emailGatewaySimulator = simulator("email-gateway-sim", "Email gateway (simulated)", (req, ref) => {
  const p = req.params as { to: string; subject: string };
  return { entry: { type: "email", toDomain: p.to.split("@")[1] ?? null, subjectLength: p.subject.length }, reference: `MSG-${ref}`, summary: { queued: true } };
});

export const crmSimulator = simulator("crm-sim", "CRM (simulated)", (req, ref) => {
  if (req.toolKey === "export-customer-records") {
    const p = req.params as { segment: string; destination: string; fields?: string[] };
    return { entry: { type: "export", segment: p.segment, destination: p.destination, fieldCount: p.fields?.length ?? 0 }, reference: `EXP-${ref}`, summary: { exported: true, records: 1240, destination: p.destination } };
  }
  const p = req.params as { customerId: string; fields?: string[] };
  return { entry: { type: "lookup", customerId: p.customerId }, reference: `CUST-${p.customerId}`, summary: { customerId: p.customerId, fields: p.fields ?? ["name", "tier"], tier: "gold", syntheticRecord: true } };
});

export const warehouseSimulator = simulator("data-warehouse-sim", "Data warehouse (simulated)", (req, ref) => {
  const p = req.params as { sql: string };
  const isRead = /^\s*(select|with)\b/i.test(p.sql) && !/\b(insert|update|delete|drop|alter|truncate|grant)\b/i.test(p.sql);
  if (!isRead) return { reject: "warehouse accepts read-only queries" };
  return { entry: { type: "query" }, reference: `QRY-${ref}`, summary: { rows: 42, syntheticResult: true } };
});

export const brokerageSimulator = simulator("brokerage-sim", "Brokerage (simulated)", (req, ref) => {
  const p = req.params as { symbol: string; side: string; type: string; qty: number; notional: number; limitPrice?: number; reference?: string };
  if (p.type === "limit" && (typeof p.limitPrice !== "number" || p.limitPrice <= 0)) return { reject: "limit orders need a limitPrice" };
  if (p.type === "limit" && typeof p.limitPrice === "number" && Math.abs(p.qty * p.limitPrice - p.notional) > 0.005 * p.notional) return { reject: `declared notional ${p.notional} does not match qty times limit price` };
  const fillPrice = p.type === "limit" ? p.limitPrice! : Math.round((p.notional / p.qty) * 100) / 100;
  return { entry: { type: "order", symbol: p.symbol, side: p.side, orderType: p.type, qty: p.qty, notional: p.notional, clientReference: p.reference ?? null }, reference: `ORD-${ref}`, summary: { accepted: true, status: p.type === "market" ? "filled" : "accepted", symbol: p.symbol, side: p.side, qty: p.qty, notional: p.notional, fillPrice, paper: true, syntheticFill: true } };
});

// The sandbox connectors are part of the default registry so every module instance (the Next.js console bundles
// core separately from instrumentation.ts) resolves them; installConnectors() re-registers them explicitly.
const systems = new Map<string, DownstreamSystem>([coreBankingSimulator, supportPlatformSimulator, emailGatewaySimulator, crmSimulator, warehouseSimulator, brokerageSimulator, stripeTestConnector, alpacaPaperConnector].map((s) => [s.key, s]));

export function registerDownstreamSystem(s: DownstreamSystem) {
  systems.set(s.key, s);
}
export function getDownstreamSystem(key: string): DownstreamSystem | undefined {
  return systems.get(key);
}
/**
 * The system an integration executes against: one registered under the integration's own key (the
 * simulators and sandbox connectors), otherwise the generic HTTPS connector for integrations of type
 * "https" (any customer system that implements the AEGIS execution protocol).
 */
export function resolveDownstreamSystem(integration: { key: string; type: string }): DownstreamSystem | undefined {
  return systems.get(integration.key) ?? (integration.type === HTTPS_INTEGRATION_TYPE ? httpsConnector : undefined);
}
export function listDownstreamSystems(): DownstreamSystem[] {
  return [...systems.values()];
}
