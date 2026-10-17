#!/usr/bin/env node
/**
 * Seeds (or re-seeds) the shared framework catalogs only, with the owner connection. Idempotent.
 * Loads the monorepo .env for MIGRATION_DATABASE_URL.
 *
 *   node scripts/seed-frameworks.mjs
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const code = `
import("./src/seed/frameworks/index.ts").then(async (m) => {
  const total = m.SHARED_FRAMEWORKS.reduce((n, f) => n + f.controls.length, 0);
  console.log("catalogs", m.SHARED_FRAMEWORKS.length, "controls", total);
  const r = await m.seedSharedFrameworks();
  console.log("seeded", r.frameworks.map((f) => f.key + ":" + f.controls).join(" "));
  const db = await import("@aegis/db");
  await db.disconnectAll();
}).catch((e) => { console.error(e); process.exit(1); });
`;
const r = spawnSync("npx", ["tsx", `--env-file=${resolve(root, ".env")}`, "-e", code], { cwd: resolve(root, "packages/core"), stdio: "inherit" });
process.exit(r.status ?? 1);
