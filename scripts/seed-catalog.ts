// CLI: npm run db:seed-catalog. Seeds the global university catalog (owner role, MIGRATION_DATABASE_URL).
// Idempotent and fast when nothing changed, so it runs on every deploy after migrations.
import { PrismaClient } from "@prisma/client";
import { seedGlobalCatalog } from "../prisma/seed/catalog";

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required to seed the catalog");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await seedGlobalCatalog(db, { log: (m) => console.log(`[seed-catalog] ${m}`) });
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("[seed-catalog] failed", e instanceof Error ? e.message : e);
  process.exit(1);
});
