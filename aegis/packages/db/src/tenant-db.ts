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
  /**
   * "upfront" (default): take the organization lock before any row is touched. Right for short
   * request-path transactions (gateway, approvals, console actions).
   * "lazy": do not take the lock up front; appendEvidence takes it when it writes. Right for long
   * jobs (monitoring runs, assessments, seeding) that would otherwise block the request path for
   * their whole duration. Deadlocks that this can cause are resolved by the retry below.
   * "deferred": evidence appended during the transaction is buffered and written, under the organization
   * lock, just before the transaction commits (docs/PERFORMANCE.md). The lock then covers only the ledger
   * writes and the commit, not the work before them. Code using this mode must protect any other
   * invariant it relied on the organization lock for with a narrower lock (the gateway takes per-agent,
   * per-idempotency-key and per-reference locks).
   */
  lock?: "upfront" | "lazy" | "deferred";
  /** Attempts on deadlock or serialization failure. Default 3. */
  retries?: number;
  /** Milliseconds to wait for a connection and the lock before starting. Default 10s. */
  maxWait?: number;
}

const beforeCommit = new WeakMap<object, (() => Promise<void>)[]>();
const deferredTx = new WeakSet<object>();

/** True when evidence in this transaction is buffered until just before commit ("deferred" lock mode). */
export function isDeferredTransaction(tx: TenantDb): boolean {
  return deferredTx.has(tx);
}

/** Registers work to run inside the transaction after its body, just before commit, in registration order. */
export function onBeforeCommit(tx: TenantDb, fn: () => Promise<void>) {
  const list = beforeCommit.get(tx);
  if (!list) throw new Error("onBeforeCommit needs a transaction opened by withTenant");
  list.push(fn);
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
          if (!opts.readOnly && (opts.lock ?? "upfront") === "upfront") await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('evidence:' || '${orgId}'))`);
          beforeCommit.set(tx, []);
          if (opts.lock === "deferred" && !opts.readOnly) deferredTx.add(tx);
          const out = await fn(tx);
          // Runs whatever was registered, including callbacks registered by earlier callbacks.
          const list = beforeCommit.get(tx)!;
          for (let i = 0; i < list.length; i++) await list[i]!();
          return out;
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
