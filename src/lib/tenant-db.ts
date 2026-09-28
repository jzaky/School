// Tenant-scoped database access.
// Every query runs inside a transaction that first sets app.current_org_id, which the
// Row-Level Security policies in prisma/rls.sql check. The app role cannot bypass RLS,
// so a query from one tenant can never read or change another tenant's rows.
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

const GLOBAL_MODELS = new Set(["User", "Account", "VerificationToken", "Organization"]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);

function assertId(value: string, label: string) {
  if (!value || typeof value !== "string") throw new Error(`${label} is required for scoped database access`);
}

function withOrgId(data: unknown, orgId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => withOrgId(d, orgId));
  if (data && typeof data === "object") {
    const row = data as Record<string, unknown>;
    if (row.orgId !== undefined && row.orgId !== orgId) {
      throw new Error("Cross-tenant write blocked: orgId does not match the active organization");
    }
    return { ...row, orgId };
  }
  return data;
}

function buildTenantClient(orgId: string) {
  return prisma.$extends({
    name: "tenant",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const a = args as Record<string, unknown>;
          if (!GLOBAL_MODELS.has(model)) {
            if (CREATE_OPS.has(operation) && a.data) a.data = withOrgId(a.data, orgId);
            if (operation === "upsert" && a.create) a.create = withOrgId(a.create, orgId);
          }
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`,
            query(a),
          ]);
          return result;
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof buildTenantClient>;

const cache = new Map<string, TenantDb>();
const MAX_CACHED = 50;

/** Database client scoped to one organization. Use this in all request code. */
export function tenantDb(orgId: string): TenantDb {
  assertId(orgId, "orgId");
  let client = cache.get(orgId);
  if (!client) {
    client = buildTenantClient(orgId);
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
    cache.set(orgId, client);
  }
  return client;
}

export type TenantTx = Prisma.TransactionClient;

/** Interactive transaction scoped to one organization. */
export async function tenantTx<T>(
  orgId: string,
  fn: (tx: TenantTx) => Promise<T>,
  options?: { timeout?: number; maxWait?: number },
): Promise<T> {
  assertId(orgId, "orgId");
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
      return fn(tx);
    },
    { timeout: options?.timeout ?? 15000, maxWait: options?.maxWait ?? 5000 },
  );
}

/**
 * Pre-tenant access for a signed-in user: lets them read only their own memberships and the
 * organizations they belong to. Used at sign-in and when switching organizations.
 */
export async function userScope<T>(userId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  assertId(userId, "userId");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    return fn(tx);
  });
}

/** Global identity tables (User, Account, VerificationToken). No tenant data lives here. */
export const identityDb = {
  user: prisma.user,
  account: prisma.account,
  verificationToken: prisma.verificationToken,
};

/** Read-only view of organizations visible without a session (the public demo school). */
export async function publicOrgBySlug(slug: string) {
  return prisma.organization.findFirst({ where: { slug, isDemo: true } });
}

export type { PrismaClient };
