import type { TenantDb } from "@aegis/db";
import { hmacHex, randomToken } from "../lib/crypto.js";
import { env } from "../env.js";

/**
 * Execution grants bind an approved decision to the exact request hash. A downstream system
 * (or the gateway's own executor) must present the grant to execute; a grant is single use and
 * short lived. Tokens are stored hashed.
 */
const GRANT_TTL_MS = 5 * 60_000;

export function hashGrantToken(token: string): string {
  return hmacHex(env().AEGIS_SESSION_SECRET, `grant:${token}`);
}

export async function issueGrant(db: TenantDb, orgId: string, actionRequestId: string, requestHash: string) {
  const token = `aegis_gr_${randomToken(24)}`;
  const row = await db.executionGrant.create({ data: { orgId, actionRequestId, tokenHash: hashGrantToken(token), requestHash, expiresAt: new Date(Date.now() + GRANT_TTL_MS) } });
  return { token, grant: row };
}

export type GrantCheck = { ok: true; actionRequestId: string } | { ok: false; reason: "unknown" | "expired" | "consumed" | "hash_mismatch" | "request_not_executable" };

/**
 * Verifies and consumes a grant atomically. Called by downstream systems before they act.
 * `requestHash` is the hash the downstream system computed from the parameters it was handed,
 * so a parameter swap between approval and execution is detected here as well.
 */
export async function consumeGrant(db: TenantDb, token: string, requestHash: string): Promise<GrantCheck> {
  const grant = await db.executionGrant.findUnique({ where: { tokenHash: hashGrantToken(token) }, include: { request: { select: { status: true, agent: { select: { status: true } } } } } });
  if (!grant) return { ok: false, reason: "unknown" };
  if (grant.consumedAt) return { ok: false, reason: "consumed" };
  if (grant.expiresAt < new Date()) return { ok: false, reason: "expired" };
  if (grant.requestHash !== requestHash) return { ok: false, reason: "hash_mismatch" };
  if (!["allowed", "approved"].includes(grant.request.status) || grant.request.agent.status !== "active") return { ok: false, reason: "request_not_executable" };
  const updated = await db.executionGrant.updateMany({ where: { id: grant.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (updated.count !== 1) return { ok: false, reason: "consumed" };
  return { ok: true, actionRequestId: grant.actionRequestId };
}
