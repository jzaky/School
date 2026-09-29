// Keeps built-in roles in step with the code on deploy, so new permissions reach existing schools.
// Roles a school has customized (Role.customized) and roles a school made (isSystem false) are never touched.
import { SYSTEM_ROLES } from "./permissions";

type Query = (sql: string, params: unknown[]) => Promise<{ rowCount: number | null }>;

export async function syncSystemRoles(query: Query, opts: { orgId?: string } = {}): Promise<number> {
  let synced = 0;
  for (const r of SYSTEM_ROLES) {
    const res = opts.orgId
      ? await query(`UPDATE "Role" SET permissions = $1 WHERE key = $2 AND "isSystem" = true AND customized = false AND "orgId" = $3`, [r.permissions, r.key, opts.orgId])
      : await query(`UPDATE "Role" SET permissions = $1 WHERE key = $2 AND "isSystem" = true AND customized = false`, [r.permissions, r.key]);
    synced += res.rowCount ?? 0;
  }
  return synced;
}
