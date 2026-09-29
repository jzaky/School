// Import US institutions from the College Scorecard API.
//   npx tsx scripts/import-scorecard.ts --snapshot            fetch everything and write prisma/seed/data/us-institutions.json.gz
//   npx tsx scripts/import-scorecard.ts --org horizon         fetch and upsert into one organization's University table
//   npx tsx scripts/import-scorecard.ts --org horizon --from-snapshot   upsert from the committed snapshot (no network)
// Options: --max-pages N (DEMO_KEY allows only a few requests per hour).
// Key: COLLEGE_SCORECARD_API_KEY (free from https://api.data.gov/signup), DEMO_KEY otherwise.
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { importInstitutions, runScorecardImport, scorecardKey, ScorecardError, type ImportStore, type UsInstitution } from "../src/server/pathways/scorecard";
import { snapshotInstitutions, universityStore, writeSnapshot, SNAPSHOT_FILE } from "../src/server/pathways/us-data";

config({ quiet: true });

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? "") : null;
};
const flag = (name: string) => args.includes(`--${name}`);

async function main() {
  const slug = opt("org");
  const maxPages = opt("max-pages") ? Number(opt("max-pages")) : undefined;
  const db = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL });
  try {
    const org = slug ? await db.organization.findUnique({ where: { slug } }) : null;
    if (slug && !org) throw new Error(`organization not found: ${slug}`);
    const noop: ImportStore = { existing: async () => [], createMany: async (r) => r.length, update: async () => {} };
    const store = org ? universityStore(db, org.id) : noop;

    if (flag("from-snapshot")) {
      if (!org) throw new Error("--from-snapshot needs --org");
      const rows = snapshotInstitutions();
      if (!rows.length) throw new Error(`no snapshot at ${SNAPSHOT_FILE}`);
      console.log(await importInstitutions(store, rows));
      return;
    }

    const collected: UsInstitution[] = [];
    const key = scorecardKey();
    console.log(`College Scorecard import with ${key === "DEMO_KEY" ? "DEMO_KEY (rate limited)" : "COLLEGE_SCORECARD_API_KEY"}`);
    const res = await runScorecardImport({
      store,
      apiKey: key,
      maxPages,
      collect: (rows) => collected.push(...rows),
      onPage: (page, total) => console.log(`page ${page + 1}, ${Math.min((page + 1) * 100, total)} of ${total}`),
    });
    console.log(res);
    if (flag("snapshot")) {
      writeSnapshot(collected);
      console.log(`wrote ${collected.length} institutions to ${SNAPSHOT_FILE}`);
    }
  } catch (e) {
    if (e instanceof ScorecardError) console.error(`Scorecard import failed: ${e.code}${e.status ? ` (${e.status})` : ""}`);
    else console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

void main();
