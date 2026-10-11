import type { TenantDb } from "@aegis/db";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { hmacHex, randomToken } from "../lib/crypto.js";
import { conflict } from "../lib/errors.js";
import { env } from "../env.js";

/**
 * Execution grants bind an approved decision to the exact request hash. A downstream system
 * (or the gateway's own executor) must present the grant to execute. Invariants:
 *
 * 1. At most one live grant (unconsumed, unvoided) exists per action request. Enforced here and by
 *    a partial unique index, so two callers cannot each obtain a grant and execute twice.
 * 2. Consuming a grant moves the request to `executing`. From then on no new grant can be issued
 *    and no other grant verifies, whatever the downstream system does with the first one.
 * 3. Pause, suspension and revocation void live grants. A voided grant never verifies.
 *
 * A single-use token is not exactly-once execution: the downstream call can still be ambiguous
 * (sent, response lost). That case is handled by the downstream idempotency key and the
 * reconciliation flow in gateway.ts, not by the grant.
 */
export const GRANT_TTL_MS = 5 * 60_000;

export function hashGrantToken(token: string): string {
  return hmacHex(env().AEGIS_SESSION_SECRET, `grant:${token}`);
}

/** Statuses from which a grant may be issued (and, once consumed, from which execution may start). */
export const EXECUTABLE_STATUSES = ["allowed", "approved"] as const;

async function gatewayPaused(db: TenantDb, orgId: string): Promise<{ paused: boolean; reason?: string }> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const s = (org?.settings ?? {}) as { gatewayPaused?: boolean; gatewayPausedReason?: string };
  return { paused: !!s.gatewayPaused, reason: s.gatewayPausedReason };
}

/** Voids every live grant of one request. Returns the number voided. */
export async function voidGrantsForRequest(db: TenantDb, actionRequestId: string, reason: string, now = new Date()) {
  const r = await db.executionGrant.updateMany({ where: { actionRequestId, consumedAt: null, voidedAt: null }, data: { voidedAt: now, voidReason: reason } });
  return r.count;
}

/** Voids every live grant in the organization, optionally restricted to one agent. Used by pause, suspension and revocation. */
export async function voidLiveGrants(db: TenantDb, ctx: OrgContext, reason: string, filter: { agentId?: string } = {}) {
  const now = ctx.now ?? new Date();
  const live = await db.executionGrant.findMany({ where: { orgId: ctx.orgId, consumedAt: null, voidedAt: null, ...(filter.agentId ? { request: { agentId: filter.agentId } } : {}) }, select: { id: true, actionRequestId: true } });
  if (live.length === 0) return 0;
  await db.executionGrant.updateMany({ where: { id: { in: live.map((g) => g.id) } }, data: { voidedAt: now, voidReason: reason } });
  await appendEvidence(db, ctx, { type: "gateway.grants_voided", subjectType: "organization", subjectId: ctx.orgId, payload: { reason, count: live.length, actionRequestIds: live.map((g) => g.actionRequestId), agentId: filter.agentId ?? null } });
  return live.length;
}

/**
 * Issues the single live grant for a request. Expired grants are voided first; an outstanding live
 * grant, a consumed grant (request already executing) or a non-executable request status refuses.
 * The unique index turns a race between two issuers into a conflict for the loser.
 */
export async function issueGrant(db: TenantDb, orgId: string, actionRequestId: string, requestHash: string, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const request = await db.actionRequest.findUnique({ where: { id: actionRequestId }, select: { status: true, agent: { select: { status: true } } } });
  if (!request) throw conflict("Action request not found");
  if (!(EXECUTABLE_STATUSES as readonly string[]).includes(request.status)) throw conflict(`Request is ${request.status}; a grant can only be issued for an allowed or approved request`);
  if (request.agent.status !== "active") throw conflict(`Agent is ${request.agent.status}; no grant issued`);
  const paused = await gatewayPaused(db, orgId);
  if (paused.paused) throw conflict(`Gateway is paused: ${paused.reason ?? "emergency control"}; no grant issued`);
  await db.executionGrant.updateMany({ where: { actionRequestId, consumedAt: null, voidedAt: null, expiresAt: { lte: now } }, data: { voidedAt: now, voidReason: "expired" } });
  const live = await db.executionGrant.count({ where: { actionRequestId, consumedAt: null, voidedAt: null } });
  if (live > 0) throw conflict("An execution grant is already outstanding for this request; it must be used or expire before another is issued");
  const token = `aegis_gr_${randomToken(24)}`;
  try {
    const row = await db.executionGrant.create({ data: { orgId, actionRequestId, tokenHash: hashGrantToken(token), requestHash, expiresAt: new Date(now.getTime() + GRANT_TTL_MS) } });
    return { token, grant: row };
  } catch (e) {
    if (e instanceof Error && /execution_grants_one_live_per_request|Unique constraint/.test(e.message)) throw conflict("An execution grant is already outstanding for this request");
    throw e;
  }
}

export type GrantCheck = { ok: true; actionRequestId: string; requestHash: string } | { ok: false; reason: "unknown" | "expired" | "consumed" | "voided" | "hash_mismatch" | "request_not_executable" | "gateway_paused" | "agent_inactive" };

/**
 * Verifies and consumes a grant atomically, and moves the request to `executing` so nothing else
 * can start it. Called by the gateway's executor and by downstream systems (through the API) before
 * they act. `requestHash` is the hash the caller computed from the parameters it holds, so a
 * parameter swap between approval and execution is detected here.
 */
export async function consumeGrant(db: TenantDb, token: string, requestHash: string, opts: { now?: Date } = {}): Promise<GrantCheck> {
  const now = opts.now ?? new Date();
  const grant = await db.executionGrant.findUnique({ where: { tokenHash: hashGrantToken(token) }, include: { request: { select: { id: true, status: true, orgId: true, executionAttempts: true, agent: { select: { status: true } } } } } });
  if (!grant) return { ok: false, reason: "unknown" };
  if (grant.consumedAt) return { ok: false, reason: "consumed" };
  if (grant.voidedAt) return { ok: false, reason: "voided" };
  if (grant.expiresAt < now) return { ok: false, reason: "expired" };
  if (grant.requestHash !== requestHash) return { ok: false, reason: "hash_mismatch" };
  if (!(EXECUTABLE_STATUSES as readonly string[]).includes(grant.request.status)) return { ok: false, reason: "request_not_executable" };
  if (grant.request.agent.status !== "active") return { ok: false, reason: "agent_inactive" };
  const paused = await gatewayPaused(db, grant.request.orgId);
  if (paused.paused) return { ok: false, reason: "gateway_paused" };
  const updated = await db.executionGrant.updateMany({ where: { id: grant.id, consumedAt: null, voidedAt: null }, data: { consumedAt: now } });
  if (updated.count !== 1) return { ok: false, reason: "consumed" };
  const moved = await db.actionRequest.updateMany({ where: { id: grant.actionRequestId, status: { in: [...EXECUTABLE_STATUSES] } }, data: { status: "executing", executionStartedAt: grant.request.executionAttempts === 0 ? now : undefined, executionAttempts: { increment: 1 }, downstreamIdempotencyKey: `aegis:${grant.actionRequestId}`, updatedAt: now } });
  if (moved.count !== 1) return { ok: false, reason: "request_not_executable" };
  return { ok: true, actionRequestId: grant.actionRequestId, requestHash: grant.requestHash };
}
