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
}

/**
 * Run `fn` inside a transaction where every statement sees only `orgId`'s rows.
 * The tenant context is a transaction-local setting, so it cannot leak between
 * requests that share a pooled connection.
 */
export async function withTenant<T>(orgId: string, fn: (db: TenantDb) => Promise<T>, opts: TenantTxOptions = {}): Promise<T> {
  assertUuid(orgId, "orgId");
  const client = opts.client ?? rawPrisma();
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_org', '${orgId}', true)`);
      return fn(tx);
    },
    { timeout: opts.timeout ?? 15_000, maxWait: 5_000 },
  );
}

/** Convenience alias matching the name used across the codebase. */
export const tenantDb = withTenant;
