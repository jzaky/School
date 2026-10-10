import { rawPrisma, type Prisma } from "@aegis/db";
import { hostname } from "node:os";

export interface JobHandlerContext {
  jobId: string;
  orgId: string | null;
  attempt: number;
}
export type JobHandler = (payload: Record<string, unknown>, ctx: JobHandlerContext) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

/**
 * Schedules a job. The idempotency key makes scheduling itself idempotent: enqueueing the
 * same key twice is a no-op. Call inside the domain transaction when the job must not be lost
 * if the domain write fails (pass `tx`).
 */
export async function enqueueJob(input: { type: string; payload: Record<string, unknown>; idempotencyKey: string; orgId?: string | null; runAt?: Date; maxAttempts?: number }, tx?: Prisma.TransactionClient) {
  const client = tx ?? rawPrisma();
  // jobs has no RLS (platform table); it only carries ids, never content.
  return client.job.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: { type: input.type, payload: input.payload as Prisma.InputJsonValue, idempotencyKey: input.idempotencyKey, orgId: input.orgId ?? null, runAt: input.runAt ?? new Date(), maxAttempts: input.maxAttempts ?? 5 },
    update: {},
  });
}

const workerId = `${hostname()}:${process.pid}`;

/** Claims up to `limit` due jobs with SKIP LOCKED so several workers never run the same job. */
export async function claimJobs(limit = 10) {
  const db = rawPrisma();
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM jobs
      WHERE status = 'pending' AND run_at <= now()
      ORDER BY run_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}`;
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    await tx.job.updateMany({ where: { id: { in: ids } }, data: { status: "running", lockedAt: new Date(), lockedBy: workerId, attempts: { increment: 1 } } });
    return tx.job.findMany({ where: { id: { in: ids } } });
  });
}

export async function runJob(job: { id: string; type: string; payload: unknown; orgId: string | null; attempts: number; maxAttempts: number }) {
  const handler = handlers.get(job.type);
  const db = rawPrisma();
  if (!handler) {
    await db.job.update({ where: { id: job.id }, data: { status: "failed", lastError: `no handler for ${job.type}`, lockedAt: null, lockedBy: null } });
    return;
  }
  try {
    await handler((job.payload ?? {}) as Record<string, unknown>, { jobId: job.id, orgId: job.orgId, attempt: job.attempts });
    await db.job.update({ where: { id: job.id }, data: { status: "done", lockedAt: null, lockedBy: null, lastError: null } });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 1000) : String(err);
    const exhausted = job.attempts >= job.maxAttempts;
    const backoffMs = Math.min(10 * 60_000, 2 ** job.attempts * 5_000);
    await db.job.update({
      where: { id: job.id },
      data: { status: exhausted ? "failed" : "pending", runAt: exhausted ? undefined : new Date(Date.now() + backoffMs), lastError: message, lockedAt: null, lockedBy: null },
    });
  }
}

/** Releases jobs whose worker died mid-run. */
export async function recoverStaleJobs(staleMs = 10 * 60_000) {
  return rawPrisma().job.updateMany({ where: { status: "running", lockedAt: { lt: new Date(Date.now() - staleMs) } }, data: { status: "pending", lockedAt: null, lockedBy: null, lastError: "recovered after stale lock" } });
}

export async function jobStats() {
  const rows = await rawPrisma().job.groupBy({ by: ["status"], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Record<string, number>;
}

export function registeredJobTypes(): string[] {
  return [...handlers.keys()];
}
