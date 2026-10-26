// Read-only SQL aggregates for admissions, always under the school's row-level security context.
import type { Prisma } from "@prisma/client";
import { tenantTx } from "@/lib/tenant-db";
import type { Tx } from "@/server/db";

/**
 * Run a raw SELECT for one school. Inside a transaction (tenantTx, a server action, the worker) it runs there, so it
 * sees that transaction's writes. The request client (tenantDb) scopes model queries only: raw SQL on it would run
 * without the school set and see no rows, so it gets a short tenant transaction of its own. An interactive
 * transaction client has no $transaction method, which is how the two are told apart.
 */
export function rawQuery<T>(db: Tx, orgId: string, sql: Prisma.Sql): Promise<T> {
  const client = db as unknown as { $transaction?: unknown };
  if (typeof client.$transaction === "function") return tenantTx(orgId, (tx) => tx.$queryRaw<T>(sql));
  return db.$queryRaw<T>(sql);
}
