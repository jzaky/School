// Runs Prisma migrations as the owner role, makes sure app_user exists, then applies prisma/rls.sql.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";
import { SYSTEM_ROLES } from "../src/server/identity/permissions";

const ownerUrl = process.env.MIGRATION_DATABASE_URL;
const appPassword = process.env.APP_USER_PASSWORD;
if (!ownerUrl) throw new Error("MIGRATION_DATABASE_URL is required");
if (!appPassword) throw new Error("APP_USER_PASSWORD is required");

async function main() {
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env } });

  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const quoted = appPassword!.replace(/'/g, "''");
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          CREATE ROLE app_user LOGIN PASSWORD '${quoted}';
        ELSE
          ALTER ROLE app_user WITH LOGIN PASSWORD '${quoted}';
        END IF;
      END $$;`);
    const db = new URL(ownerUrl!).pathname.replace(/^\//, "");
    await client.query(`GRANT CONNECT ON DATABASE "${db}" TO app_user`);
    const sql = readFileSync(new URL("../prisma/rls.sql", import.meta.url), "utf8");
    await client.query(sql);
    // Keep built-in roles in step with the code, so new permissions reach existing schools on deploy.
    let synced = 0;
    for (const r of SYSTEM_ROLES) {
      const res = await client.query(`UPDATE "Role" SET permissions = $1 WHERE key = $2 AND "isSystem" = true`, [r.permissions, r.key]);
      synced += res.rowCount ?? 0;
    }
    console.log(`db:migrate complete: migrations applied, app_user ready, RLS applied, ${synced} system roles synced`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
