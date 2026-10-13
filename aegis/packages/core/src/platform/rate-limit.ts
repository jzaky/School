import { createHash } from "node:crypto";
import { rawPrisma } from "@aegis/db";
import { logger } from "../lib/logger.js";

/**
 * Fixed-window rate limiting shared by every replica (S14). Counters live in PostgreSQL, which every
 * AEGIS deployment already has, so limits hold across API and web replicas instead of multiplying with
 * them. One atomic upsert per check. If the database cannot be reached the check falls back to a
 * per-process counter rather than letting every request through.
 */

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  /** Milliseconds until the current window ends. */
  resetInMs: number;
}

const local = new Map<string, { windowStart: number; count: number }>();

function windowStartOf(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

/** A stable bucket key for a secret such as an API key: never the secret itself, never a guessable fragment of it. */
export function secretBucketKey(prefix: string, secret: string): string {
  return `${prefix}:${createHash("sha256").update(secret).digest("hex").slice(0, 32)}`;
}

export async function consumeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitResult> {
  const start = windowStartOf(now, windowMs);
  const resetInMs = start + windowMs - now;
  try {
    const rows = await rawPrisma().$queryRaw<{ count: number }[]>`
      INSERT INTO rate_limit_buckets (key, window_start, count) VALUES (${key}, ${new Date(start)}, 1)
      ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_buckets.count + 1
      RETURNING count`;
    const count = Number(rows[0]?.count ?? 1);
    return { allowed: count <= limit, count, limit, resetInMs };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "shared rate limit unavailable; using the per-process counter");
    const cur = local.get(key);
    const entry = cur && cur.windowStart === start ? cur : { windowStart: start, count: 0 };
    entry.count += 1;
    local.set(key, entry);
    if (local.size > 10_000) for (const [k, v] of local) if (v.windowStart < start) local.delete(k);
    return { allowed: entry.count <= limit, count: entry.count, limit, resetInMs };
  }
}

/** Deletes windows that ended more than `olderThanMs` ago. Run from the worker. */
export async function purgeRateLimitBuckets(olderThanMs = 24 * 60 * 60 * 1000, now = Date.now()): Promise<number> {
  const r = await rawPrisma().rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(now - olderThanMs) } } });
  return r.count;
}

/**
 * A store for @fastify/rate-limit backed by the shared counters. The plugin calls `incr` once per
 * request and expects the current count and the time to live of the window.
 */
export class SharedRateLimitStore {
  private readonly windowMs: number;
  constructor(options: { timeWindow?: unknown }) {
    this.windowMs = typeof options.timeWindow === "number" ? options.timeWindow : 60_000;
  }
  /** Called by the plugin as incr(key, callback, timeWindowMs, max). */
  incr(key: string, callback: (err: Error | null, result?: { current: number; ttl: number }) => void, timeWindow?: number, max?: number): void {
    const windowMs = typeof timeWindow === "number" && timeWindow > 0 ? timeWindow : this.windowMs;
    consumeRateLimit(`api:${key}`, max ?? Number.MAX_SAFE_INTEGER, windowMs)
      .then((r) => callback(null, { current: r.count, ttl: r.resetInMs }))
      .catch((e: unknown) => callback(e instanceof Error ? e : new Error(String(e))));
  }
  child(routeOptions: { timeWindow?: unknown }): SharedRateLimitStore {
    return new SharedRateLimitStore({ timeWindow: typeof routeOptions.timeWindow === "number" ? routeOptions.timeWindow : this.windowMs });
  }
}
