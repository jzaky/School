// School API keys: create (shown once), revoke, and authenticate a request.
//
// A key acts for the school with the permissions of the person who created it, limited by its scopes. If that
// person is suspended or loses integrations.manage, the key stops working until someone else makes a new one.
// Usage is audited once per key per hour (with the number of requests since the last event), not per request.
// Requests are rate limited per key.
import { tenantDb } from "@/lib/tenant-db";
import { cleanScopes } from "@/lib/integrations/scopes";
import { permissionsOf } from "@/server/identity/can";
import { audit } from "@/server/audit/audit";
import { hit } from "@/server/access/rate-limit";
import { findApiKey } from "@/server/platform/api-key-lookup";
import type { ImportActor } from "@/server/imports/access";
import { generateApiKey } from "./key-format";

export const MAX_ACTIVE_KEYS = 25;
/** Requests per key per minute. */
export const RATE_LIMIT_PER_MINUTE = 120;
const USAGE_AUDIT_EVERY_MS = 60 * 60 * 1000;

export type KeyActor = { orgId: string; membershipId: string; userId: string };

export class KeyError extends Error {
  constructor(public code: "LABEL" | "SCOPES" | "TOO_MANY" | "NOT_FOUND") {
    super(`apikey:${code}`);
  }
}

export async function createApiKey(actor: KeyActor, input: { label: string; scopes: unknown[] }) {
  const label = String(input.label ?? "").replace(/\s+/g, " ").trim();
  if (label.length < 1 || label.length > 80) throw new KeyError("LABEL");
  const scopes = cleanScopes(Array.isArray(input.scopes) ? input.scopes : []);
  if (!scopes.length) throw new KeyError("SCOPES");
  const db = tenantDb(actor.orgId);
  if ((await db.apiKey.count({ where: { revokedAt: null } })) >= MAX_ACTIVE_KEYS) throw new KeyError("TOO_MANY");
  const { key, prefix, hash } = generateApiKey();
  const row = await db.apiKey.create({ data: { orgId: actor.orgId, label, prefix, keyHash: hash, scopes, createdById: actor.membershipId } });
  await audit(db, actor.orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "integrations.api_key_created", entityType: "ApiKey", entityId: row.id, meta: { label, prefix, scopes } });
  return { id: row.id, key, prefix };
}

export async function revokeApiKey(actor: KeyActor, id: string, now = new Date()) {
  const db = tenantDb(actor.orgId);
  const res = await db.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now, revokedById: actor.membershipId } });
  if (res.count === 0) throw new KeyError("NOT_FOUND");
  const row = await db.apiKey.findUnique({ where: { id }, select: { prefix: true, label: true, useCount: true, unauditedUses: true } });
  await audit(db, actor.orgId, {
    actorId: actor.membershipId,
    actorUserId: actor.userId,
    action: "integrations.api_key_revoked",
    entityType: "ApiKey",
    entityId: id,
    meta: { prefix: row?.prefix, label: row?.label, requests: row?.useCount ?? 0, unauditedRequests: row?.unauditedUses ?? 0 },
  });
}

export type ApiAuth =
  | { ok: true; orgId: string; keyId: string; prefix: string; scopes: string[]; actor: ImportActor }
  | { ok: false; status: 401 | 403 | 429 | 503; code: "UNAUTHORIZED" | "KEY_REVOKED" | "KEY_OWNER_INACTIVE" | "RATE_LIMITED" | "UNAVAILABLE"; retryAfterSec?: number };

/** Checks the key, the person behind it and the rate limit, and records the use. */
export async function authenticateApiKey(key: string | null, now = new Date()): Promise<ApiAuth> {
  if (!key) return { ok: false, status: 401, code: "UNAUTHORIZED" };
  let found: Awaited<ReturnType<typeof findApiKey>>;
  try {
    found = await findApiKey(key);
  } catch {
    return { ok: false, status: 503, code: "UNAVAILABLE" };
  }
  if (!found) return { ok: false, status: 401, code: "UNAUTHORIZED" };
  const db = tenantDb(found.orgId);
  const row = await db.apiKey.findUnique({ where: { id: found.keyId } });
  if (!row) return { ok: false, status: 401, code: "UNAUTHORIZED" };
  if (row.revokedAt) return { ok: false, status: 401, code: "KEY_REVOKED" };
  const owner = await db.membership.findUnique({ where: { id: row.createdById }, select: { id: true, userId: true, status: true, roles: { select: { role: { select: { key: true, permissions: true } } } } } });
  const perms = permissionsOf(owner);
  if (!owner || !perms.has("integrations.manage")) return { ok: false, status: 403, code: "KEY_OWNER_INACTIVE" };
  const rate = await hit(`apikey:${row.id}`, RATE_LIMIT_PER_MINUTE, 60);
  if (!rate.ok) return { ok: false, status: 429, code: "RATE_LIMITED", retryAfterSec: Math.max(1, rate.retryAfterSec) };
  await recordUse(found.orgId, row.id, now);
  return { ok: true, orgId: found.orgId, keyId: row.id, prefix: row.prefix, scopes: row.scopes, actor: { orgId: found.orgId, membershipId: owner.id, userId: owner.userId, perms } };
}

/** Counts the request, and writes one usage audit event per key per hour with the requests since the last one. */
export async function recordUse(orgId: string, keyId: string, now = new Date()) {
  const db = tenantDb(orgId);
  const row = await db.apiKey.update({ where: { id: keyId }, data: { lastUsedAt: now, useCount: { increment: 1 }, unauditedUses: { increment: 1 } }, select: { prefix: true, unauditedUses: true, lastAuditAt: true, createdById: true } });
  if (row.lastAuditAt && now.getTime() - row.lastAuditAt.getTime() < USAGE_AUDIT_EVERY_MS) return;
  // Only one request wins the claim, so concurrent requests never write two events for the same hour.
  const claim = await db.apiKey.updateMany({
    where: { id: keyId, lastAuditAt: row.lastAuditAt ?? null },
    data: { lastAuditAt: now, unauditedUses: { decrement: row.unauditedUses } },
  });
  if (claim.count !== 1) return;
  await audit(db, orgId, {
    actorId: row.createdById,
    action: "integrations.api_key_used",
    entityType: "ApiKey",
    entityId: keyId,
    meta: { prefix: row.prefix, requests: row.unauditedUses, since: row.lastAuditAt?.toISOString() ?? null },
  });
}
