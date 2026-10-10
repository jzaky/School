import { rawPrisma, type ApiKeySubject, type TenantDb } from "@aegis/db";
import { randomBytes } from "node:crypto";
import { randomToken, sha256Hex } from "../lib/crypto.js";
import type { OrgContext } from "../lib/context.js";
import { appendEvidence } from "../evidence/ledger.js";

/** Keys look like aegis_ak_<prefix>_<secret>. The prefix is stored in clear for lookup, the rest hashed. */
export function generateApiKey(): { key: string; prefix: string; keyHash: string } {
  const prefix = randomBytes(6).toString("hex");
  const secret = randomToken(32);
  const key = `aegis_ak_${prefix}_${secret}`;
  return { key, prefix, keyHash: sha256Hex(key) };
}

export async function issueApiKey(db: TenantDb, ctx: OrgContext, input: { name: string; subjectType: ApiKeySubject; subjectId: string; scopes?: string[]; expiresAt?: Date | null }) {
  const gen = generateApiKey();
  const row = await db.apiKey.create({
    data: {
      orgId: ctx.orgId,
      name: input.name,
      prefix: gen.prefix,
      keyHash: gen.keyHash,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      scopes: input.scopes ?? [],
      expiresAt: input.expiresAt ?? null,
      createdBy: ctx.actor.type === "user" ? ctx.actor.id : null,
    },
  });
  await appendEvidence(db, ctx, { type: "api_key.issued", subjectType: input.subjectType, subjectId: input.subjectId, payload: { apiKeyId: row.id, prefix: gen.prefix, scopes: row.scopes } });
  // The full key is returned exactly once and never stored.
  return { key: gen.key, record: row };
}

export async function revokeApiKey(db: TenantDb, ctx: OrgContext, apiKeyId: string, reason: string) {
  const row = await db.apiKey.update({ where: { id: apiKeyId }, data: { revokedAt: new Date() } });
  await appendEvidence(db, ctx, { type: "api_key.revoked", subjectType: row.subjectType, subjectId: row.subjectId, payload: { apiKeyId, prefix: row.prefix, reason } });
  return row;
}

export interface ResolvedApiKey {
  id: string;
  orgId: string;
  subjectType: ApiKeySubject;
  subjectId: string;
  scopes: string[];
}

/**
 * Resolves a presented key. Uses the global connection because the org is unknown before lookup;
 * the lookup is by unique hash only and returns the org, which then scopes everything else.
 */
export async function resolveApiKey(presented: string | undefined): Promise<ResolvedApiKey | null> {
  if (!presented || !presented.startsWith("aegis_ak_")) return null;
  // SECURITY DEFINER function: the only cross-tenant read, by unique hash (see prisma/rls.sql).
  const row = await rawPrisma().$queryRaw<{ id: string; org_id: string; subject_type: ApiKeySubject; subject_id: string; scopes: string[]; expires_at: Date | null; revoked_at: Date | null }[]>`
    SELECT * FROM aegis_resolve_api_key(${sha256Hex(presented)})`;
  const k = row[0];
  if (!k || k.revoked_at || (k.expires_at && k.expires_at < new Date())) return null;
  void rawPrisma().$executeRaw`SELECT aegis_touch_api_key(${k.id}::uuid)`.catch(() => undefined);
  return { id: k.id, orgId: k.org_id, subjectType: k.subject_type, subjectId: k.subject_id, scopes: k.scopes };
}
