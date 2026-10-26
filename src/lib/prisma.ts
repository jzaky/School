// Base Prisma client connected as app_user (DATABASE_URL).
// Do not import this in request code. Use tenantDb(orgId) or userDb(userId) from ./tenant-db.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

function create(): PrismaClient {
  if (process.env.NODE_ENV === "development") return new PrismaClient({ log: ["warn", "error"] });
  // Prisma's own error log prints the failing query's arguments (names, dates of birth and so on). Outside
  // development only the model and operation are logged; the error itself still reaches the caller.
  // errorFormat "minimal" also keeps the arguments out of error messages that the server may print.
  const client = new PrismaClient({ log: [{ emit: "event", level: "error" }], errorFormat: "minimal" });
  client.$on("error", (e) => console.error(`[prisma] query error${e.target ? ` in ${e.target}` : ""}`));
  return client;
}

export const prisma = globalForPrisma.__prisma ?? create();

if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;
