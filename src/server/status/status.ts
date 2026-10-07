// Public service status: live checks and the 90-day uptime history shown on /status.
// Only up or down per component leaves this module: never hostnames, versions or error text.
// The worker writes a heartbeat to Redis every minute and one UptimeSample row per 5-minute slot.
// No "server-only" marker: the worker imports it.
import type { PrismaClient } from "@prisma/client";
import type IORedis from "ioredis";

export const HEARTBEAT_KEY = "status:worker:heartbeat";
/** The worker counts as up when its last heartbeat is younger than this. */
export const HEARTBEAT_MAX_AGE_MS = 3 * 60_000;
export const SLOT_MS = 5 * 60_000;
export const HISTORY_DAYS = 90;
const RETAIN_DAYS = 100;

export type Component = "web" | "database" | "redis" | "worker";
export const COMPONENTS: Component[] = ["web", "database", "redis", "worker"];
export type Checks = { web: boolean | null; database: boolean; redis: boolean; worker: boolean };

/** Start of the 5-minute slot that contains `d` (UTC). */
export function slotStart(d: Date): Date {
  return new Date(Math.floor(d.getTime() / SLOT_MS) * SLOT_MS);
}

async function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), ms)))]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkDatabase(db: Pick<PrismaClient, "$queryRaw">): Promise<boolean> {
  try {
    await within(db.$queryRaw`SELECT 1`, 3000);
    return true;
  } catch {
    return false;
  }
}

export async function checkRedis(redis: IORedis | null): Promise<boolean> {
  if (!redis) return false;
  try {
    return (await within(redis.ping(), 2000)) === "PONG";
  } catch {
    return false;
  }
}

export function heartbeatFresh(value: string | null | undefined, now: Date): boolean {
  const ts = Number(value);
  return Number.isFinite(ts) && ts > 0 && now.getTime() - ts <= HEARTBEAT_MAX_AGE_MS && ts <= now.getTime() + 60_000;
}

export async function checkWorker(redis: IORedis | null, now: Date): Promise<boolean> {
  if (!redis) return false;
  try {
    return heartbeatFresh(await within(redis.get(HEARTBEAT_KEY), 2000), now);
  } catch {
    return false;
  }
}

/** Record the worker's heartbeat. Overwrites one key, so repeats are harmless. */
export async function writeHeartbeat(redis: IORedis, now = new Date()) {
  await redis.set(HEARTBEAT_KEY, String(now.getTime()), "PX", 10 * 60_000);
}

/** Is the web app answering? Checked from the worker against APP_URL/api/health. Null when APP_URL is unset. */
export async function checkWeb(): Promise<boolean | null> {
  const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  if (!base) return null;
  try {
    const res = await within(fetch(`${base}/api/health`, { cache: "no-store", redirect: "manual" }), 8000);
    return res.ok;
  } catch {
    return false;
  }
}

export const allUp = (c: Pick<Checks, "database" | "redis" | "worker"> & { web: boolean | null }) => c.database && c.redis && c.worker && c.web !== false;

type SampleDb = Pick<PrismaClient, "uptimeSample">;

/** Write the sample for the slot containing `now`. The slot is the key: a second write in the same slot is skipped. */
export async function recordSample(db: SampleDb, checks: Checks, now = new Date()): Promise<{ written: boolean; slot: Date }> {
  const slot = slotStart(now);
  const res = await db.uptimeSample.createMany({ data: [{ slot, ...checks }], skipDuplicates: true });
  await db.uptimeSample.deleteMany({ where: { slot: { lt: new Date(now.getTime() - RETAIN_DAYS * 86_400_000) } } });
  return { written: res.count === 1, slot };
}

/**
 * Per UTC day: slots expected since monitoring began, samples written, samples with everything up, uptime
 * percent, and down samples per component. A slot with no sample counts as down (the worker or database
 * could not record it). Days before the first sample have uptime null.
 */
export type DayStatus = { day: string; expected: number; samples: number; up: number; uptime: number | null; components: Record<Component, number> };

const DAY_MS = 86_400_000;

/** One entry per UTC day for the last `days` days, oldest first. */
export async function uptimeHistory(db: SampleDb, now = new Date(), days = HISTORY_DAYS): Promise<DayStatus[]> {
  const startDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * DAY_MS);
  const [rows, first] = await Promise.all([
    db.uptimeSample.findMany({ where: { slot: { gte: startDay } }, select: { slot: true, web: true, database: true, redis: true, worker: true } }),
    db.uptimeSample.findFirst({ orderBy: { slot: "asc" }, select: { slot: true } }),
  ]);
  // The current slot may not be written yet, so it is not expected.
  const lastExpected = slotStart(now).getTime();
  const map = new Map<string, DayStatus>();
  for (let i = 0; i < days; i++) {
    const dayStart = startDay.getTime() + i * DAY_MS;
    const from = first ? Math.max(dayStart, first.slot.getTime()) : Infinity;
    const to = Math.min(dayStart + DAY_MS, lastExpected);
    const expected = to > from ? Math.ceil((to - from) / SLOT_MS) : 0;
    const day = new Date(dayStart).toISOString().slice(0, 10);
    map.set(day, { day, expected, samples: 0, up: 0, uptime: null, components: { web: 0, database: 0, redis: 0, worker: 0 } });
  }
  for (const r of rows) {
    const d = map.get(r.slot.toISOString().slice(0, 10));
    if (!d) continue;
    d.samples++;
    if (allUp(r)) d.up++;
    if (r.web === false) d.components.web++;
    if (!r.database) d.components.database++;
    if (!r.redis) d.components.redis++;
    if (!r.worker) d.components.worker++;
  }
  return [...map.values()].map((d) => {
    const expected = Math.max(d.expected, d.samples);
    return { ...d, expected, uptime: expected ? Math.round((Math.min(d.up, expected) / expected) * 10000) / 100 : null };
  });
}

/** Overall uptime percentage across the days that have data, or null. */
export function overallUptime(days: DayStatus[]): number | null {
  const expected = days.reduce((s, d) => s + d.expected, 0);
  if (!expected) return null;
  return Math.round((days.reduce((s, d) => s + Math.min(d.up, d.expected), 0) / expected) * 10000) / 100;
}
