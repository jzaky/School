// CLI: npm run db:seed. Runs as the owner role (MIGRATION_DATABASE_URL).
import { PrismaClient } from "@prisma/client";
import { seedDemo } from "./demo";

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required to seed");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const res = await seedDemo(db, { log: (m) => console.log(`[seed] ${m}`) });
    console.log(`[seed] done: org ${res.orgId} in ${res.ms}ms`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
