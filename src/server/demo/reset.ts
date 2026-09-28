"use server";

import { PrismaClient } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { seedDemo } from "../../../prisma/seed/demo";

let running: Promise<unknown> | null = null;

/** Restore the demo school to its seeded story. Only available inside the demo organization. */
export async function resetDemoAction() {
  const ctx = await getCtx();
  if (!ctx.org.isDemo) return { ok: false, error: "not_demo" };
  if (!ctx.persona && !ctx.can("demo.reset")) return { ok: false, error: "forbidden" };
  const res = await runDemoReset();
  revalidatePath("/", "layout");
  return { ok: true, ms: res.ms };
}

/** Shared by the button, the nightly worker job and scripts. Serialized with a Postgres advisory lock. */
export async function runDemoReset(): Promise<{ ms: number }> {
  if (running) return (await running) as { ms: number };
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required for demo reset");
  const job = (async () => {
    const owner = new PrismaClient({ datasourceUrl: url });
    try {
      await owner.$executeRaw`SELECT pg_advisory_lock(424242)`;
      try {
        return await seedDemo(owner);
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
