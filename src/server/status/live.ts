// Live checks for the public /status page, run by the web app on each view.
import "server-only";
import IORedis from "ioredis";
import { statusDb } from "@/lib/tenant-db";
import { checkDatabase, checkRedis, checkWorker, uptimeHistory, type Checks, type DayStatus } from "./status";

const g = globalThis as unknown as { __statusRedis?: IORedis | null };

function redis(): IORedis | null {
  if (g.__statusRedis !== undefined) return g.__statusRedis;
  const url = process.env.REDIS_URL;
  if (!url) return (g.__statusRedis = null);
  const client = new IORedis(url, { maxRetriesPerRequest: 1, connectTimeout: 3000 });
  client.on("error", () => undefined);
  return (g.__statusRedis = client);
}

export async function liveChecks(now = new Date()): Promise<Checks> {
  const r = redis();
  const [database, redisUp, worker] = await Promise.all([checkDatabase(statusDb), checkRedis(r), checkWorker(r, now)]);
  // This page is served by the web app, so the web app is up.
  return { web: true, database, redis: redisUp, worker };
}

export async function history(now = new Date()): Promise<DayStatus[] | null> {
  try {
    return await uptimeHistory(statusDb, now);
  } catch {
    return null;
  }
}
