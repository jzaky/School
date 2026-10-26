// Background fee work for the worker ("fees" queue and the maintenance scheduler). No "server-only" marker: the
// standalone worker imports this module. Error messages are never logged with values (they can carry names).
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects, queue } from "@/server/queue-core";
import { billingJob, FEES_QUEUE, processBillingBatch } from "./billing";
import { sendDueFeeReminders } from "./notices";

export type BillingBatchJob = { orgId: string; runId: string; n: number };

const STALE_MS = 2 * 60_000;

/** One batch of a billing run, then the next batch is queued (deterministic job ids, so a retry never doubles). */
export async function runBillingBatchJob(data: BillingBatchJob, opts: { flush?: (e: Effect[]) => Promise<void>; batchSize?: number } = {}) {
  const effects: Effect[] = [];
  let done = true;
  try {
    const res = await tenantTx(data.orgId, (tx) => processBillingBatch(execCtx(tx, data.orgId, { effects, now: new Date() }), data.runId, { batchSize: opts.batchSize }), { timeout: 120_000 });
    done = res.done;
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : err instanceof Error ? err.name : "Error";
    await tenantTx(data.orgId, (tx) => tx.billingRun.updateMany({ where: { id: data.runId, orgId: data.orgId }, data: { error: code.slice(0, 80) } })).catch(() => undefined);
    throw err;
  }
  if (!done) effects.push(billingJob(data.orgId, data.runId, Number(data.n) + 1));
  await (opts.flush ?? flushEffects)(effects);
  return done ? "completed" : "continued";
}

/**
 * Runs a billing run in this process when no queue is available (no REDIS_URL): batch after batch, each in its own
 * transaction, so the request that started it returns at once.
 */
export async function runBillingInline(orgId: string, runId: string, maxBatches = 10_000) {
  for (let i = 0; i < maxBatches; i++) {
    const effects: Effect[] = [];
    const res = await tenantTx(orgId, (tx) => processBillingBatch(execCtx(tx, orgId, { effects, now: new Date() }), runId), { timeout: 120_000 });
    await flushEffects(effects);
    if (res.done) return;
  }
}

/** Start processing a new run: on the worker when a queue exists, otherwise inline in the background. */
export async function kickBillingRun(orgId: string, runId: string, effect: Effect) {
  if (queue(FEES_QUEUE)) {
    await flushEffects([effect]);
    return "queued" as const;
  }
  void runBillingInline(orgId, runId).catch(async (err) => {
    const code = err instanceof Error ? err.name : "Error";
    await tenantTx(orgId, (tx) => tx.billingRun.updateMany({ where: { id: runId, orgId }, data: { error: code } })).catch(() => undefined);
  });
  return "inline" as const;
}

/** Every few minutes: a run with no progress for a while is queued again from its cursor. */
export async function resumeStaleBillingRuns(orgId: string, now = new Date(), flush: (e: Effect[]) => Promise<void> = flushEffects) {
  const stale = await tenantTx(orgId, (tx) =>
    tx.billingRun.findMany({ where: { orgId, status: { in: ["QUEUED", "RUNNING"] }, updatedAt: { lt: new Date(now.getTime() - STALE_MS) } }, select: { id: true, updatedAt: true } }),
  );
  await flush(stale.map((r) => billingJob(orgId, r.id, r.updatedAt.getTime())));
  return stale.length;
}

/** Daily fee reminders for one school. */
export async function runFeeReminders(orgId: string, opts: { now?: Date; flush?: (e: Effect[]) => Promise<void> } = {}) {
  const effects: Effect[] = [];
  const res = await tenantTx(orgId, (tx) => sendDueFeeReminders(execCtx(tx, orgId, { now: opts.now ?? new Date(), effects })), { timeout: 300_000 });
  await (opts.flush ?? flushEffects)(effects);
  return res;
}
