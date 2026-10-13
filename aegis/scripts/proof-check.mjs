#!/usr/bin/env node
/**
 * Keeps the public Proof page honest. Counts the test cases that exist in the repository and the
 * shared framework catalog, and compares them with the figures stated in
 * apps/web/src/content/proof.ts. Exits non-zero when a stated figure is stale, so CI fails before a
 * wrong number can reach the site.
 *
 *   node scripts/proof-check.mjs          check
 *   node scripts/proof-check.mjs --print  print the live figures (to copy into proof.ts)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function files(dir, ext) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(ext))
    .map((d) => join(dir, d.name));
}
function count(file, re) {
  return (readFileSync(file, "utf8").match(re) ?? []).length;
}

const coreTests = files(join(ROOT, "packages/core/tests"), ".test.ts").reduce((n, f) => n + count(f, /^\s*it\(/gm), 0);
const dbTests = files(join(ROOT, "packages/db/tests"), ".test.ts").reduce((n, f) => n + count(f, /^\s*it\(/gm), 0);
const e2eFiles = files(join(ROOT, "apps/web/tests/e2e"), ".spec.ts");
const e2eTests = e2eFiles.reduce((n, f) => n + count(f, /^\s*test\(/gm), 0);

// Catalog controls: one `c(` call per control in the seed files.
const catalogDir = join(ROOT, "packages/core/src/seed/frameworks");
const catalogFiles = files(catalogDir, ".ts").filter((f) => !/\/(index|types)\.ts$/.test(f));
const controls = catalogFiles.reduce((n, f) => n + count(f, /^\s*c\(/gm), 0);
const catalogs = catalogFiles.reduce((n, f) => n + count(f, /^export const [A-Z0-9_]+: FrameworkSeed = \{/gm), 0);

const live = { coreTests, dbTests, e2eFiles: e2eFiles.length, e2eTests, catalogs, controls };

if (process.argv.includes("--print")) {
  console.log(JSON.stringify(live, null, 2));
  process.exit(0);
}

const proofSource = readFileSync(join(ROOT, "apps/web/src/content/proof.ts"), "utf8");
const stated = {};
for (const key of Object.keys(live)) {
  const m = proofSource.match(new RegExp(`${key}:\\s*(\\d+)`));
  if (!m) {
    console.error(`proof-check: apps/web/src/content/proof.ts does not state FIGURES.${key}`);
    process.exit(1);
  }
  stated[key] = Number(m[1]);
}
let stale = 0;
for (const key of Object.keys(live)) {
  if (stated[key] !== live[key]) {
    stale++;
    console.error(`proof-check: ${key} is stated as ${stated[key]} but the repository has ${live[key]}`);
  }
}
if (stale) {
  console.error("proof-check: update FIGURES in apps/web/src/content/proof.ts (run with --print for the live values)");
  process.exit(1);
}
console.log(`proof-check: Proof page figures match the repository (${JSON.stringify(live)})`);
