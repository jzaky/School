/**
 * Runs Prisma migrations as the owner role, then applies RLS and integrity triggers.
 * Usage: tsx scripts/migrate.ts [--dev [--name <name>]]
 */
import "./env.js";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationUrl) {
  console.error("MIGRATION_DATABASE_URL is required");
  process.exit(1);
}
const appRole = process.env.AEGIS_APP_ROLE ?? "aegis_app";
const args = process.argv.slice(2);
const dev = args.includes("--dev");
const nameIdx = args.indexOf("--name");
const name = nameIdx >= 0 ? args[nameIdx + 1] : undefined;

const env = { ...process.env, DATABASE_URL: migrationUrl };
if (dev) {
  execSync(`npx prisma migrate dev ${name ? `--name ${name}` : ""} --skip-seed`, { stdio: "inherit", cwd: root, env });
} else {
  execSync("npx prisma migrate deploy", { stdio: "inherit", cwd: root, env });
}

const client = new pg.Client({ connectionString: migrationUrl });
await client.connect();
try {
  const roleExists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [appRole]);
  if (roleExists.rowCount === 0) {
    const pw = process.env.AEGIS_APP_PASSWORD;
    if (!pw) throw new Error(`Role ${appRole} does not exist and AEGIS_APP_PASSWORD is not set to create it`);
    await client.query(`CREATE ROLE "${appRole}" LOGIN PASSWORD '${pw.replace(/'/g, "''")}' NOBYPASSRLS`);
    console.log(`created role ${appRole}`);
  }
  await client.query(`SELECT set_config('aegis.app_role', $1, false)`, [appRole]);
  const sql = readFileSync(join(root, "prisma", "rls.sql"), "utf8");
  await client.query(sql);
  console.log("RLS and integrity triggers applied");
} finally {
  await client.end();
}
