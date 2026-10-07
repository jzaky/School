// Platform admin: delete a whole school (tenant) and its stored files.
//
// This is a documented exception to CLAUDE.md hard rule 2: removing every row of a tenant needs the
// owner role (audit rows are append-only for app_user and organizations cannot be deleted by it).
// It uses PLATFORM_DATABASE_URL (falling back to MIGRATION_DATABASE_URL) and is only reachable by a
// platform admin (User.isPlatformAdmin or an email in PLATFORM_ADMIN_EMAILS).
// The school's own audit log goes with it, so one PlatformAuditEvent is written with ids and counts
// only (no names, emails or record content).
import { PrismaClient } from "@prisma/client";
import { tenantTablesInDeleteOrder } from "../../../prisma/seed/lib";
import { deleteOrgObjects, listOrgObjects } from "@/server/documents/storage-core";
export { isPlatformAdmin } from "./catalog-db";

const g = globalThis as unknown as { __platformDb?: PrismaClient };

export function platformDbUrl() {
  return process.env.PLATFORM_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || null;
}

/** Owner client for platform tooling, or null when no owner URL is configured. */
export function platformDb(): PrismaClient | null {
  const url = platformDbUrl();
  if (!url) return null;
  g.__platformDb ??= new PrismaClient({ datasourceUrl: url });
  return g.__platformDb;
}

export type SchoolDeletionReport = {
  org: { id: string; slug: string; nameEn: string; nameAr: string; isDemo: boolean; createdAt: Date };
  tables: Array<{ table: string; rows: number }>;
  totalRows: number;
  files: number;
  /** Sign-in accounts used only at this school (deleted with it) and accounts shared with other schools (kept). */
  users: { exclusive: number; shared: number };
};

export type DeleteBlock = "DEMO_SCHOOL" | "CURRENT_SCHOOL" | "NOT_FOUND" | "CONFIRM";

async function exclusiveUserIds(db: PrismaClient, orgId: string): Promise<{ exclusive: string[]; shared: number }> {
  const rows = await db.$queryRaw<Array<{ userId: string; others: bigint }>>`
    SELECT m."userId", (SELECT COUNT(*) FROM "Membership" o WHERE o."userId" = m."userId" AND o."orgId" <> ${orgId}) AS others
    FROM "Membership" m JOIN "User" u ON u.id = m."userId"
    WHERE m."orgId" = ${orgId} AND u."isPlatformAdmin" = false`;
  const exclusive = rows.filter((r) => Number(r.others) === 0).map((r) => r.userId);
  return { exclusive, shared: rows.length - exclusive.length };
}

/** Dry run: what deleting the school would remove. Changes nothing. */
export async function schoolDeletionReport(db: PrismaClient, orgId: string): Promise<SchoolDeletionReport | null> {
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) return null;
  const tables: SchoolDeletionReport["tables"] = [];
  for (const table of await tenantTablesInDeleteOrder(db)) {
    const [{ n }] = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*) AS n FROM "${table}" WHERE "orgId" = $1`, orgId);
    if (Number(n) > 0) tables.push({ table, rows: Number(n) });
  }
  tables.sort((a, b) => b.rows - a.rows || a.table.localeCompare(b.table));
  const users = await exclusiveUserIds(db, orgId);
  return {
    org: { id: org.id, slug: org.slug, nameEn: org.nameEn, nameAr: org.nameAr, isDemo: org.isDemo, createdAt: org.createdAt },
    tables,
    totalRows: tables.reduce((s, t) => s + t.rows, 0),
    files: (await listOrgObjects(orgId)).length,
    users: { exclusive: users.exclusive.length, shared: users.shared },
  };
}

/**
 * Delete the school: stored files, every tenant row, the organization, and sign-in accounts used only
 * there. `confirm` must equal the school's slug. Returns the report of what was removed.
 */
export async function deleteSchool(
  db: PrismaClient,
  orgId: string,
  input: { confirm: string; actorUserId: string; actorOrgId: string },
): Promise<{ ok: true; report: SchoolDeletionReport; filesRemoved: number; usersRemoved: number } | { ok: false; error: DeleteBlock }> {
  const report = await schoolDeletionReport(db, orgId);
  if (!report) return { ok: false, error: "NOT_FOUND" };
  if (report.org.isDemo) return { ok: false, error: "DEMO_SCHOOL" };
  if (orgId === input.actorOrgId) return { ok: false, error: "CURRENT_SCHOOL" };
  if (input.confirm.trim() !== report.org.slug) return { ok: false, error: "CONFIRM" };

  const filesRemoved = await deleteOrgObjects(orgId);
  const order = await tenantTablesInDeleteOrder(db);
  const { exclusive } = await exclusiveUserIds(db, orgId);
  await db.$transaction(
    async (tx) => {
      for (const table of order) await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "orgId" = $1`, orgId);
      await tx.organization.delete({ where: { id: orgId } });
      if (exclusive.length) await tx.user.deleteMany({ where: { id: { in: exclusive } } });
      await tx.platformAuditEvent.create({
        data: {
          action: "school.delete",
          orgRef: orgId,
          actorUserId: input.actorUserId,
          meta: { tables: Object.fromEntries(report.tables.map((t) => [t.table, t.rows])), totalRows: report.totalRows, files: filesRemoved, usersRemoved: exclusive.length, usersKept: report.users.shared },
        },
      });
    },
    { timeout: 300_000, maxWait: 10_000 },
  );
  return { ok: true, report, filesRemoved, usersRemoved: exclusive.length };
}
