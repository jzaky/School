// Base Prisma client connected as app_user (DATABASE_URL).
// Do not import this in request code. Use tenantDb(orgId) or userDb(userId) from ./tenant-db.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

/**
 * SLOW_QUERY_MS (optional): log every database query that takes at least this many milliseconds, with its time
 * and SQL text. Parameters are never logged (they can hold personal data), only the statement with $1 placeholders.
 */
const SLOW_MS = Number(process.env.SLOW_QUERY_MS) || 0;

function create(): PrismaClient {
  if (process.env.NODE_ENV === "development" && !SLOW_MS) return new PrismaClient({ log: ["warn", "error"] });
  // Prisma's own error log prints the failing query's arguments (names, dates of birth and so on). Outside
  // development only the model and operation are logged; the error itself still reaches the caller.
  // errorFormat "minimal" also keeps the arguments out of error messages that the server may print.
  if (SLOW_MS > 0) {
    const timed = new PrismaClient({ log: [{ emit: "event", level: "error" }, { emit: "event", level: "query" }], errorFormat: "minimal" });
    timed.$on("error", (e) => console.error(`[prisma] query error${e.target ? ` in ${e.target}` : ""}`));
    timed.$on("query", (e) => {
      if (e.duration >= SLOW_MS) console.warn(`[slow-query] ${e.duration}ms ${e.query.replace(/\s+/g, " ").slice(0, 4000)}`);
    });
    return timed as unknown as PrismaClient;
  }
  const client = new PrismaClient({ log: [{ emit: "event", level: "error" }], errorFormat: "minimal" });
  client.$on("error", (e) => console.error(`[prisma] query error${e.target ? ` in ${e.target}` : ""}`));
  return client as unknown as PrismaClient;
}

export const prisma = globalForPrisma.__prisma ?? create();

if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;
