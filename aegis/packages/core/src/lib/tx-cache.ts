import type { TenantDb } from "@aegis/db";

/**
 * Per-transaction caches (docs/PERFORMANCE.md). Keyed by the transaction client object, so they live exactly
 * as long as one transaction and are never shared between requests.
 *
 * Organization settings: a gateway decision reads them in several places (pause state, injection response,
 * autonomy rules, model governance, tool security). The decision primes the cache once; nothing on the
 * decision path writes settings, and transactions that were not primed always read the database.
 */
const settingsCache = new WeakMap<object, Map<string, Promise<unknown>>>();

export function primeOrgSettingsCache(db: TenantDb) {
  if (!settingsCache.has(db)) settingsCache.set(db, new Map());
}

export function orgSettings(db: TenantDb, orgId: string): Promise<unknown> {
  const load = () => db.organization.findUnique({ where: { id: orgId }, select: { settings: true } }).then((o) => o?.settings ?? null);
  const cache = settingsCache.get(db);
  if (!cache) return load();
  let p = cache.get(orgId);
  if (!p) {
    p = load();
    cache.set(orgId, p);
  }
  return p;
}
