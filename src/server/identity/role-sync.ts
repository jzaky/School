// Keeps built-in roles in step with the code on deploy, so new permissions reach existing schools.
// Roles a school has customized (Role.customized) and roles a school made (isSystem false) are never touched.
// A built-in role that is new in the code (for example head_of_it) is added to every school that lacks it.
import { SYSTEM_ROLES } from "./permissions";

type Query = (sql: string, params: unknown[]) => Promise<{ rowCount: number | null }>;

export async function syncSystemRoles(query: Query, opts: { orgId?: string } = {}): Promise<number> {
  let synced = 0;
  for (const r of SYSTEM_ROLES) {
    const res = opts.orgId
      ? await query(`UPDATE "Role" SET permissions = $1 WHERE key = $2 AND "isSystem" = true AND customized = false AND "orgId" = $3`, [r.permissions, r.key, opts.orgId])
      : await query(`UPDATE "Role" SET permissions = $1 WHERE key = $2 AND "isSystem" = true AND customized = false`, [r.permissions, r.key]);
    synced += res.rowCount ?? 0;
    // New built-in roles: one row per school that does not have the key yet. The unique (orgId, key) index
    // keeps this idempotent when two deploys run at once.
    const add = await query(
      `INSERT INTO "Role" (id, "orgId", key, "nameEn", "nameAr", "descEn", "descAr", permissions, "isSystem", customized, "createdAt", "updatedAt")
       SELECT 'r' || substr(md5(o.id || ':' || $1), 1, 24), o.id, $1, $2, $3, $4, $5, $6, true, false, now(), now()
       FROM "Organization" o
       WHERE NOT EXISTS (SELECT 1 FROM "Role" x WHERE x."orgId" = o.id AND x.key = $1)${opts.orgId ? ` AND o.id = $7` : ""}
       ON CONFLICT ("orgId", key) DO NOTHING`,
      opts.orgId ? [r.key, r.nameEn, r.nameAr, r.descEn, r.descAr, r.permissions, opts.orgId] : [r.key, r.nameEn, r.nameAr, r.descEn, r.descAr, r.permissions],
    );
    synced += add.rowCount ?? 0;
  }
  return synced;
}
