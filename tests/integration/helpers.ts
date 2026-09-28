import { PrismaClient } from "@prisma/client";

/** Owner connection for test setup and teardown only (bypasses RLS as table owner). */
export function ownerClient() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required for integration tests");
  return new PrismaClient({ datasourceUrl: url });
}

export function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
