// BullMQ queues and post-commit effect flushing, shared by the web app (through ./queue) and the worker.
// This module has no "server-only" marker so the standalone worker process can import it.
import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { Effect } from "@/server/db";

const g = globalThis as unknown as { __redis?: IORedis; __queues?: Map<string, Queue> };

function connection() {
  if (!process.env.REDIS_URL) return null;
  if (!g.__redis) {
    g.__redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableOfflineQueue: false, lazyConnect: false });
    g.__redis.on("error", () => undefined);
  }
  return g.__redis;
}

export function queue(name: string) {
  const conn = connection();
  if (!conn) return null;
  g.__queues ??= new Map();
  let q = g.__queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: conn, defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 500, removeOnFail: 1000 } });
    g.__queues.set(name, q);
  }
  return q;
}

/**
 * Enqueue side effects after the database transaction has committed.
 * Every job carries a deterministic jobId, so a retry never enqueues twice.
 * If Redis is unavailable the rows stay QUEUED and the worker's sweeper delivers them later.
 */
export async function flushEffects(effects: Effect[]) {
  for (const e of effects) {
    const q = queue(e.queue);
    if (!q) continue;
    try {
      await q.add(e.name, e.data, { jobId: e.jobId, delay: e.delayMs });
    } catch (err) {
      console.error(`[queue] could not enqueue ${e.queue}:${e.name}`, err instanceof Error ? err.message : err);
    }
  }
}

/** Close queue connections (worker shutdown). */
export async function closeQueues() {
  for (const q of g.__queues?.values() ?? []) await q.close().catch(() => undefined);
  g.__queues?.clear();
  if (g.__redis) {
    g.__redis.disconnect();
    g.__redis = undefined;
  }
}
