import type { Prisma, PrismaClient } from "@prisma/client";
import { rawPrisma } from "./client.js";

/** A Prisma client bound to one tenant for the duration of a transaction. */
export type TenantDb = Prisma.TransactionClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, label = "id"): string {
  if (!UUID_RE.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

export interface TenantTxOptions {
  /** Milliseconds before the transaction is aborted. Default 15s. */
  timeout?: number;
  /** Use a specific client (tests). */
  client?: PrismaClient;
  /** Skip the per-organization serialization lock (read-only work that never appends evidence). */
  readOnly?: boolean;
}

/**
 * Run `fn` inside a transaction where every statement sees only `orgId`'s rows.
 * The tenant context is a transaction-local setting, so it cannot leak between
 * requests that share a pooled connection.
 *
 * Writing transactions for one organization are serialized with a transaction-scoped
 * advisory lock taken before any row is touched. This keeps the evidence chain strictly
 * ordered and removes the deadlock class where one transaction holds row locks and waits
 * for the chain lock while another holds the chain lock and waits for the rows. Governance
 * workloads are modest; the cost is one lock wait per tenant transaction.
 */
export async function withTenant<T>(orgId: string, fn: (db: TenantDb) => Promise<T>, opts: TenantTxOptions = {}): Promise<T> {
  assertUuid(orgId, "orgId");
  const client = opts.client ?? rawPrisma();
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_org', '${orgId}', true)`);
      if (!opts.readOnly) await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('evidence:' || '${orgId}'))`);
      return fn(tx);
    },
    { timeout: opts.timeout ?? 15_000, maxWait: 5_000 },
  );
}

/** Convenience alias matching the name used across the codebase. */
export const tenantDb = withTenant;
