// Demo reset core, without Next.js request dependencies, so the worker and scripts can call it.
import { PrismaClient } from "@prisma/client";
import { seedDemo } from "../../../prisma/seed/demo";

let running: Promise<{ ms: number }> | null = null;

/** Restore the demo school to its seeded story. Serialized in-process and with a Postgres advisory lock. */
export async function runDemoResetCore(): Promise<{ ms: number }> {
  if (running) return running;
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required for demo reset");
  const job = (async () => {
    const owner = new PrismaClient({ datasourceUrl: url });
    try {
      await owner.$executeRaw`SELECT pg_advisory_lock(424242)`;
      try {
        const res = await seedDemo(owner);
        return { ms: res.ms };
      } finally {
        await owner.$executeRaw`SELECT pg_advisory_unlock(424242)`;
      }
    } finally {
      await owner.$disconnect();
    }
  })();
  running = job;
  try {
    return await job;
  } finally {
    running = null;
  }
}
