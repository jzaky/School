// Base Prisma client connected as app_user (DATABASE_URL).
// Do not import this in request code. Use tenantDb(orgId) or userDb(userId) from ./tenant-db.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

/**
 * SLOW_QUERY_MS (optional): log every database query that takes at least this many milliseconds, with its time
 * and SQL text. Parameters are never logged (they can hold personal data), only the statement with $1 placeholders.
 */
function createClient(): PrismaClient {
  const slowMs = Number(process.env.SLOW_QUERY_MS) || 0;
  const level = process.env.NODE_ENV === "development" ? (["warn", "error"] as const) : (["error"] as const);
  if (slowMs > 0) {
    const client = new PrismaClient({ log: [{ emit: "event", level: "query" }, ...level.map((l) => ({ emit: "stdout" as const, level: l }))] });
    client.$on("query", (e) => {
      if (e.duration >= slowMs) console.warn(`[slow-query] ${e.duration}ms ${e.query.replace(/\s+/g, " ").slice(0, 4000)}`);
    });
    return client as unknown as PrismaClient;
  }
  return new PrismaClient({ log: [...level] });
}

export const prisma = globalForPrisma.__prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;
