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
  const orgId = input.orgId ?? null;
  // An organization's job may only name that organization in its payload; the worker refuses a mismatch.
  if (orgId && typeof input.payload.orgId === "string" && input.payload.orgId !== orgId) throw new Error("job payload names a different organization");
  // Jobs carry ids, never content. Row-level security confines a tenant transaction to its own jobs, and the
  // key is stored scoped to the organization so tenants can never collide with each other's keys.
  const key = scopedJobKey(input.idempotencyKey, orgId);
  return client.job.upsert({
    where: { idempotencyKey: key },
    create: { type: input.type, payload: input.payload as Prisma.InputJsonValue, idempotencyKey: key, orgId, runAt: input.runAt ?? new Date(), maxAttempts: input.maxAttempts ?? 5 },
    update: {},
  });
}

/** The stored idempotency key: platform jobs keep the key as given, organization jobs are prefixed with the organization. */
export function scopedJobKey(idempotencyKey: string, orgId: string | null): string {
  return orgId ? `org:${orgId}:${idempotencyKey}` : idempotencyKey;
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
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  // The organization a job acts for is the job row's org_id (written under row-level security by the
  // enqueuing transaction), never a value in the payload. A payload that disagrees is refused unrun.
  if ("orgId" in payload && payload.orgId !== job.orgId) {
    await db.job.update({ where: { id: job.id }, data: { status: "failed", lastError: "payload organization does not match the job's organization", lockedAt: null, lockedBy: null } });
    return;
  }
  try {
    await handler(payload, { jobId: job.id, orgId: job.orgId, attempt: job.attempts });
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
