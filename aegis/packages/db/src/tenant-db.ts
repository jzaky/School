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
  /** Attempts on deadlock or serialization failure. Default 3. */
  retries?: number;
  /** Milliseconds to wait for a connection and the lock before starting. Default 10s. */
  maxWait?: number;
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
  const attempts = opts.retries ?? 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SELECT set_config('app.current_org', '${orgId}', true)`);
          if (!opts.readOnly) await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('evidence:' || '${orgId}'))`);
          return fn(tx);
        },
        { timeout: opts.timeout ?? 15_000, maxWait: opts.maxWait ?? 10_000 },
      );
    } catch (err) {
      // PostgreSQL aborts one side of a deadlock (40P01) or a serialization conflict (40001); the whole
      // transaction rolled back, so re-running `fn` is safe and is the standard remedy.
      if (attempt < attempts && isRetryable(err)) {
        await new Promise((r) => setTimeout(r, 50 * attempt + Math.floor(Math.random() * 100)));
        continue;
      }
      throw err;
    }
  }
}

function isRetryable(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${JSON.stringify((err as { meta?: unknown }).meta ?? "")}` : String(err);
  return /40P01|deadlock detected|40001|could not serialize/.test(text);
}

/** Convenience alias matching the name used across the codebase. */
export const tenantDb = withTenant;
