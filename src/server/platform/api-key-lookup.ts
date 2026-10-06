// Pre-tenant lookup for the REST API.
//
// This is the documented "platform admin" exception to CLAUDE.md hard rule 2, the same as
// src/server/platform/join-lookup.ts. A request that carries an API key has no organization context yet,
// and the app role cannot read another school's keys. This one function uses the owner client to answer one
// question (which school and key a key hash belongs to) and returns ids only. Everything after that goes
// through tenantDb / tenantTx with the organization id it returns.
//
// Rules: the input is shape-checked before it reaches a query, only the hash is compared, nothing is written.
import { catalogDb } from "@/server/platform/catalog-db";
import { hashApiKey, looksLikeApiKey } from "@/server/integrations/key-format";

export class ApiUnavailableError extends Error {
  constructor() {
    super("api:unavailable");
  }
}

export async function findApiKey(key: string): Promise<{ orgId: string; keyId: string } | null> {
  if (!looksLikeApiKey(key)) return null;
  const db = catalogDb();
  if (!db) throw new ApiUnavailableError();
  const row = await db.apiKey.findUnique({ where: { keyHash: hashApiKey(key) }, select: { id: true, orgId: true } });
  return row ? { orgId: row.orgId, keyId: row.id } : null;
}
