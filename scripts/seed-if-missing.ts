// Container start: seeds the demo school only when DEMO_MODE=true and the demo organization does not exist yet.
// Uses the owner role (MIGRATION_DATABASE_URL) and the same advisory lock as the demo reset, so two
// replicas starting together seed at most once.
import { PrismaClient } from "@prisma/client";
import { DEMO_SLUG, seedDemo } from "../prisma/seed/demo";

async function main() {
  if (process.env.DEMO_MODE !== "true") {
    console.log("[seed-if-missing] DEMO_MODE is not true, skipping");
    return;
  }
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required to seed");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await db.$executeRaw`SELECT pg_advisory_lock(424242)`;
    try {
      const existing = await db.organization.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true } });
      if (existing) {
        console.log("[seed-if-missing] demo organization present, skipping");
        return;
      }
      const res = await seedDemo(db, { log: (m) => console.log(`[seed] ${m}`) });
      console.log(`[seed-if-missing] seeded demo organization in ${res.ms}ms`);
    } finally {
      await db.$executeRaw`SELECT pg_advisory_unlock(424242)`;
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("[seed-if-missing] failed", e instanceof Error ? e.message : e);
  process.exit(1);
});
