import type { TenantDb } from "@aegis/db";
import { decryptSecret, hashObject } from "../lib/crypto.js";
import { consumeGrant } from "./grants.js";

/**
 * Simulated downstream systems for the demonstrations. Each one behaves like a real protected
 * service: it refuses to act unless the gateway's execution grant verifies against the exact
 * parameters it was handed, and it needs the integration credential from the vault. State lives
 * in the integration's `settings.ledger` so it survives restarts and shows in the console.
 */
export interface DownstreamRequest {
  grantToken: string;
  toolKey: string;
  action: string;
  params: Record<string, unknown>;
  correlationId: string;
  agentSlug: string;
}
export interface DownstreamResult {
  ok: boolean;
  reference: string | null;
  summary: Record<string, unknown>;
  error?: string;
}

export interface DownstreamSystem {
  key: string;
  execute(db: TenantDb, orgId: string, integrationId: string, req: DownstreamRequest): Promise<DownstreamResult>;
}

async function requireCredential(db: TenantDb, integrationId: string, name = "service-token"): Promise<string> {
  const cred = await db.credential.findUnique({ where: { integrationId_name: { integrationId, name } } });
  if (!cred || cred.revokedAt) throw new Error(`credential ${name} unavailable (missing or revoked)`);
  return decryptSecret(cred.secretEnc, `credential:${cred.id}:${cred.name}`);
}

/** Every simulator verifies the grant first. This is the "downstream verifies authorization" step. */
async function verify(db: TenantDb, req: DownstreamRequest): Promise<string> {
  const check = await consumeGrant(db, req.grantToken, hashObject({ toolKey: req.toolKey, action: req.action, params: req.params }));
  if (!check.ok) throw new Error(`execution grant rejected: ${check.reason}`);
  return check.actionRequestId;
}

async function appendLedger(db: TenantDb, integrationId: string, entry: Record<string, unknown>) {
  const integ = await db.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const settings = (integ.settings ?? {}) as Record<string, unknown>;
  const ledger = Array.isArray(settings.ledger) ? (settings.ledger as unknown[]) : [];
  ledger.unshift({ ...entry, at: new Date().toISOString() });
  await db.integration.update({ where: { id: integrationId }, data: { settings: { ...settings, ledger: ledger.slice(0, 200) } as object } });
}

export const coreBankingSimulator: DownstreamSystem = {
  key: "core-banking-sim",
  async execute(db, _orgId, integrationId, req) {
    await requireCredential(db, integrationId);
    const requestId = await verify(db, req);
    const p = req.params as { fromAccount: string; toAccount: string; amount: number; currency: string; reference?: string };
    const reference = `TRF-${requestId.slice(0, 8).toUpperCase()}`;
    await appendLedger(db, integrationId, { type: "transfer", reference, fromAccount: p.fromAccount, toAccount: p.toAccount, amount: p.amount, currency: p.currency, agent: req.agentSlug, correlationId: req.correlationId });
    return { ok: true, reference, summary: { posted: true, amount: p.amount, currency: p.currency, valueDate: new Date().toISOString().slice(0, 10) } };
  },
};

export const supportPlatformSimulator: DownstreamSystem = {
  key: "support-platform-sim",
  async execute(db, _orgId, integrationId, req) {
    await requireCredential(db, integrationId);
    const requestId = await verify(db, req);
    if (req.toolKey === "issue-refund") {
      const p = req.params as { orderId: string; customerId: string; amount: number; currency: string; reason?: string };
      const reference = `RFD-${requestId.slice(0, 8).toUpperCase()}`;
      await appendLedger(db, integrationId, { type: "refund", reference, orderId: p.orderId, amount: p.amount, currency: p.currency, agent: req.agentSlug, correlationId: req.correlationId });
      return { ok: true, reference, summary: { refunded: true, amount: p.amount, currency: p.currency, orderId: p.orderId } };
    }
    const p = req.params as { ticketId: string; status?: string };
    const reference = `TKT-${p.ticketId}`;
    await appendLedger(db, integrationId, { type: "ticket_update", reference, status: p.status ?? null, agent: req.agentSlug, correlationId: req.correlationId });
    return { ok: true, reference, summary: { updated: true, ticketId: p.ticketId } };
  },
};

export const emailGatewaySimulator: DownstreamSystem = {
  key: "email-gateway-sim",
  async execute(db, _orgId, integrationId, req) {
    await requireCredential(db, integrationId);
    const requestId = await verify(db, req);
    const p = req.params as { to: string; subject: string };
    const reference = `MSG-${requestId.slice(0, 8).toUpperCase()}`;
    await appendLedger(db, integrationId, { type: "email", reference, toDomain: p.to.split("@")[1] ?? null, subjectLength: p.subject.length, agent: req.agentSlug, correlationId: req.correlationId });
    return { ok: true, reference, summary: { queued: true } };
  },
};

export const crmSimulator: DownstreamSystem = {
  key: "crm-sim",
  async execute(db, _orgId, integrationId, req) {
    await requireCredential(db, integrationId);
    const requestId = await verify(db, req);
    if (req.toolKey === "export-customer-records") {
      const p = req.params as { segment: string; destination: string; fields?: string[] };
      const reference = `EXP-${requestId.slice(0, 8).toUpperCase()}`;
      await appendLedger(db, integrationId, { type: "export", reference, segment: p.segment, destination: p.destination, fieldCount: p.fields?.length ?? 0, agent: req.agentSlug, correlationId: req.correlationId });
      return { ok: true, reference, summary: { exported: true, records: 1240, destination: p.destination } };
    }
    const p = req.params as { customerId: string; fields?: string[] };
    return { ok: true, reference: `CUST-${p.customerId}`, summary: { customerId: p.customerId, fields: p.fields ?? ["name", "tier"], tier: "gold", syntheticRecord: true } };
  },
};

export const warehouseSimulator: DownstreamSystem = {
  key: "data-warehouse-sim",
  async execute(db, _orgId, integrationId, req) {
    await requireCredential(db, integrationId);
    await verify(db, req);
    const p = req.params as { sql: string };
    const isRead = /^\s*(select|with)\b/i.test(p.sql) && !/\b(insert|update|delete|drop|alter|truncate|grant)\b/i.test(p.sql);
    if (!isRead) return { ok: false, reference: null, summary: {}, error: "warehouse accepts read-only queries" };
    return { ok: true, reference: `QRY-${Date.now().toString(36)}`, summary: { rows: 42, syntheticResult: true } };
  },
};

const systems = new Map<string, DownstreamSystem>([coreBankingSimulator, supportPlatformSimulator, emailGatewaySimulator, crmSimulator, warehouseSimulator].map((s) => [s.key, s]));

export function registerDownstreamSystem(s: DownstreamSystem) {
  systems.set(s.key, s);
}
export function getDownstreamSystem(key: string): DownstreamSystem | undefined {
  return systems.get(key);
}
