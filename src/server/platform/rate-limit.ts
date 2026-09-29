// Fixed-window rate limits for public endpoints (sign-up, verification resend).
// Uses Redis when REDIS_URL is set, so limits hold across web instances; otherwise an in-process map.
// Keys are hashed, so no email address or IP is stored in Redis in the clear.
import { createHash } from "node:crypto";
import IORedis from "ioredis";

const g = globalThis as unknown as { __rlRedis?: IORedis | null; __rlMem?: Map<string, { count: number; resetAt: number }> };

function redis(): IORedis | null {
  if (g.__rlRedis !== undefined) return g.__rlRedis;
  const url = process.env.REDIS_URL;
  if (!url) return (g.__rlRedis = null);
  const client = new IORedis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
  client.on("error", () => undefined);
  return (g.__rlRedis = client);
}

const hashKey = (key: string) => `rl:${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;

export type RateResult = { ok: boolean; remaining: number; retryAfterSec: number };

function memoryHit(k: string, limit: number, windowMs: number, now: number): RateResult {
  g.__rlMem ??= new Map();
  const cur = g.__rlMem.get(k);
  if (!cur || cur.resetAt <= now) {
    g.__rlMem.set(k, { count: 1, resetAt: now + windowMs });
    if (g.__rlMem.size > 10_000) for (const [key, v] of g.__rlMem) if (v.resetAt <= now) g.__rlMem.delete(key);
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  cur.count++;
  return { ok: cur.count <= limit, remaining: Math.max(0, limit - cur.count), retryAfterSec: Math.ceil((cur.resetAt - now) / 1000) };
}

/** Count one hit for `key`. Returns ok false once more than `limit` hits land in the window. */
export async function rateLimit(key: string, limit: number, windowMs: number, opts: { now?: number; memoryOnly?: boolean } = {}): Promise<RateResult> {
  const k = hashKey(key);
  const now = opts.now ?? Date.now();
  const client = opts.memoryOnly ? null : redis();
  if (client && client.status === "ready") {
    try {
      const res = await client.multi().set(k, "0", "PX", windowMs, "NX").incr(k).pttl(k).exec();
      const count = Number(res?.[1]?.[1] ?? 1);
      const ttl = Number(res?.[2]?.[1] ?? windowMs);
      return { ok: count <= limit, remaining: Math.max(0, limit - count), retryAfterSec: Math.ceil(Math.max(ttl, 0) / 1000) };
    } catch {
      // Redis hiccup: fall back to this instance's memory rather than blocking sign-up.
    }
  }
  return memoryHit(k, limit, windowMs, now);
}

/** Reset counters (tests). */
export function resetMemoryLimits() {
  g.__rlMem?.clear();
}
