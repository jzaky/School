import { PrismaClient } from "@prisma/client";

declare global {
   
  var __aegisPrisma: PrismaClient | undefined;
   
  var __aegisOwnerPrisma: PrismaClient | undefined;
}

const logLevels: ("warn" | "error")[] = ["warn", "error"];

/**
 * Application connection (aegis_app). Never use this directly for tenant data:
 * go through tenantDb(orgId) so RLS has a tenant context. Direct use is only
 * valid for global tables (users, sessions, jobs, platform_events, deployment_versions).
 */
export function rawPrisma(): PrismaClient {
  if (!globalThis.__aegisPrisma) {
    globalThis.__aegisPrisma = new PrismaClient({ log: logLevels });
  }
  return globalThis.__aegisPrisma;
}

/**
 * Owner connection (MIGRATION_DATABASE_URL). Bypasses RLS because the owner owns the tables.
 * Allowed only in migrations, seeds and isolation tests. Application processes (api, web, worker) never
 * hold this credential in production; platform admin reads global tables through rawPrisma and tenant
 * counts through withTenant.
 */
export function ownerPrisma(): PrismaClient {
  if (!globalThis.__aegisOwnerPrisma) {
    const url = process.env.MIGRATION_DATABASE_URL;
    if (!url) throw new Error("MIGRATION_DATABASE_URL is required for owner access");
    globalThis.__aegisOwnerPrisma = new PrismaClient({ log: logLevels, datasourceUrl: url });
  }
  return globalThis.__aegisOwnerPrisma;
}

export async function disconnectAll(): Promise<void> {
  await Promise.all([globalThis.__aegisPrisma?.$disconnect(), globalThis.__aegisOwnerPrisma?.$disconnect()]);
  globalThis.__aegisPrisma = undefined;
  globalThis.__aegisOwnerPrisma = undefined;
}
