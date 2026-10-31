#!/usr/bin/env node
/**
 * Scaffolds a drop-in framework catalog.
 *
 *   node scripts/new-catalog.mjs <key> "<name>" ["<publisher>"]
 *   e.g. node scripts/new-catalog.mjs mas-feat "MAS FEAT principles" "Monetary Authority of Singapore"
 *
 * Writes packages/core/src/seed/frameworks/catalogs/<key>.json with one example control. Fill in
 * the controls (original one-sentence summaries only, never the standard's text), then run
 * `pnpm --filter @aegis/core exec vitest run tests/frameworks-checker.test.ts` and `pnpm db:seed`
 * (or `node scripts/seed-frameworks.mjs`). See docs/FRAMEWORKS.md.
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [key, name, publisher = ""] = process.argv.slice(2);
if (!key || !name || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(key)) {
  console.error('usage: node scripts/new-catalog.mjs <key> "<name>" ["<publisher>"]  (key: lowercase letters, digits, dots, hyphens)');
  process.exit(2);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(root, "packages/core/src/seed/frameworks/catalogs", `${key}.json`);
const seed = {
  key,
  name,
  version: "",
  publisher,
  licenseNote: `${name} is published by ${publisher || "its issuer"}. AEGIS references its identifiers only; every title and summary is original AEGIS wording describing the objective and is not the text of the source. Obtain the source from its publisher. Mapping an AEGIS record to an entry here is not a compliance statement.`,
  description: `What ${name} covers, in one or two sentences, and which AEGIS records can evidence it.`,
  controls: [
    {
      code: "1",
      title: "Example control title",
      summary: "One original sentence describing what the control asks the organization to do, in AEGIS's own words.",
      category: "Section or domain name",
      keywords: ["keyword", "another keyword"],
      automatedEvidenceType: "approval_workflow",
    },
  ],
};
// "wx": create only, so an existing catalog is never overwritten (and there is no check-then-write race).
try {
  writeFileSync(file, JSON.stringify(seed, null, 2) + "\n", { flag: "wx" });
} catch (e) {
  if (e.code !== "EEXIST") throw e;
  console.error(`${file} already exists`);
  process.exit(1);
}
console.log(`wrote ${file}`);
console.log("next: fill in the controls, keep summaries original, then run the catalog test and reseed (docs/FRAMEWORKS.md)");
