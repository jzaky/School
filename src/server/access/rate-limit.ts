// Fixed-window rate limits for public endpoints (join, invite accept, sign-in).
// Uses Redis when REDIS_URL is set so limits hold across web instances; falls back to process memory.
// Keys are hashed so no email address or IP is stored in clear.
import { createHash } from "node:crypto";
import IORedis from "ioredis";

const g = globalThis as unknown as { __rlRedis?: IORedis | null; __rlMem?: Map<string, { n: number; until: number }> };

function redis(): IORedis | null {
  if (g.__rlRedis !== undefined) return g.__rlRedis;
  if (!process.env.REDIS_URL) return (g.__rlRedis = null);
  const r = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false, connectTimeout: 1500 });
  r.on("error", () => undefined);
  g.__rlRedis = r;
  return r;
}

function mem() {
  g.__rlMem ??= new Map();
  return g.__rlMem;
}

const hashed = (key: string) => `rl:${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;

export type RateResult = { ok: boolean; count: number; retryAfterSec: number };

/** Count one hit against `key`. ok is false once more than `limit` hits land inside the window. */
export async function hit(key: string, limit: number, windowSec: number): Promise<RateResult> {
  const k = hashed(key);
  const r = redis();
  if (r && r.status === "ready") {
    try {
      const n = await r.incr(k);
      if (n === 1) await r.expire(k, windowSec);
      const ttl = n > limit ? await r.ttl(k) : 0;
      return { ok: n <= limit, count: n, retryAfterSec: Math.max(0, ttl) };
    } catch {
      // Fall through to the in-memory counter.
    }
  }
  const m = mem();
  const now = Date.now();
  const cur = m.get(k);
  if (!cur || cur.until <= now) {
    m.set(k, { n: 1, until: now + windowSec * 1000 });
    if (m.size > 20_000) for (const [key2, v] of m) if (v.until <= now) m.delete(key2);
    return { ok: 1 <= limit, count: 1, retryAfterSec: 0 };
  }
  cur.n++;
  return { ok: cur.n <= limit, count: cur.n, retryAfterSec: cur.n > limit ? Math.ceil((cur.until - now) / 1000) : 0 };
}

/** Read the current count without adding a hit. */
export async function peek(key: string): Promise<number> {
  const k = hashed(key);
  const r = redis();
  if (r && r.status === "ready") {
    try {
      return Number((await r.get(k)) ?? 0);
    } catch {
      // Fall through.
    }
  }
  const cur = mem().get(k);
  return cur && cur.until > Date.now() ? cur.n : 0;
}

export async function clear(key: string) {
  const k = hashed(key);
  const r = redis();
  if (r && r.status === "ready") await r.del(k).catch(() => undefined);
  mem().delete(k);
}

/**
 * Client IP from proxy headers, for rate limits. Proxies append the address they saw to X-Forwarded-For, so only
 * the entries added by our own proxies can be trusted: the client's address is TRUSTED_PROXY_HOPS entries from the
 * right (default 1, one hosting proxy). Anything to the left of it was sent by the client and is ignored.
 */
export function clientIp(h: Headers, env: NodeJS.ProcessEnv | { TRUSTED_PROXY_HOPS?: string } = process.env): string {
  const hops = Math.min(10, Math.max(1, Number.parseInt(env.TRUSTED_PROXY_HOPS ?? "1", 10) || 1));
  const chain = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fromChain = chain.length ? chain[Math.max(0, chain.length - hops)] : null;
  const ip = fromChain ?? h.get("x-real-ip")?.trim() ?? "local";
  return ip.slice(0, 64) || "local";
}
