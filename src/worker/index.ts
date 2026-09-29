// Worker process: npm run worker. Runs BullMQ processors for every queue the app enqueues to,
// plus repeatable maintenance jobs (sweeper, retention, nightly demo reset).
// Tenant work always goes through tenantDb / tenantTx. The platform client is used only to list organizations.
import { PrismaClient } from "@prisma/client";
import { Worker, type Job, type Processor } from "bullmq";
import IORedis from "ioredis";
import type { DeliverJob, ReminderJob, ResumeJob, TestIdempotentJob } from "./handlers";

async function loadDotenv() {
  // Local development convenience. In production the platform injects variables and .env is absent.
  try {
    const dotenv = await import("dotenv");
    dotenv.config({ quiet: true });
  } catch {
    // dotenv is optional
  }
}

function describeError(err: unknown) {
  // Error messages can carry query values, so only the class and code are logged.
  if (err && typeof err === "object") {
    const e = err as { name?: string; code?: string };
    return `${e.name ?? "Error"}${e.code ? ` code=${e.code}` : ""}`;
  }
  return "Error";
}

async function main() {
  await loadDotenv();
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log("[worker] REDIS_URL is not set: background jobs are disabled, exiting");
    process.exit(0);
  }

  // Imported after dotenv so DATABASE_URL and friends are in place when Prisma initializes.
  const handlers = await import("./handlers");
  const { queue, closeQueues } = await import("@/server/queue-core");
  const { prisma } = await import("@/lib/prisma");
  const { runDemoResetCore } = await import("@/server/demo/run-reset");

  // Organization rows are only fully listable by the owner role (RLS hides non-demo orgs from app_user).
  const platform = process.env.MIGRATION_DATABASE_URL ? new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL }) : prisma;
  const demoMode = process.env.DEMO_MODE === "true";

  async function forEachOrg(label: string, fn: (orgId: string) => Promise<unknown>) {
    const ids = await handlers.listOrgIds(platform);
    let failed = 0;
    for (const id of ids) {
      try {
        await fn(id);
      } catch (err) {
        failed++;
        console.error(`[worker] ${label} failed for org ${id}: ${describeError(err)}`);
      }
    }
    if (failed) throw new Error(`${label} failed for ${failed} organization(s)`);
  }

  const processors: Record<string, Processor> = {
    notify: async (job: Job) => {
      if (job.name !== "deliver") throw new Error(`unknown job ${job.name}`);
      return handlers.deliverOutbound(job.data as DeliverJob);
    },
    reminders: async (job: Job) => {
      if (job.name !== "appointment") throw new Error(`unknown job ${job.name}`);
      return handlers.sendAppointmentReminder(job.data as ReminderJob);
    },
    workflow: async (job: Job) => {
      if (job.name !== "resume") throw new Error(`unknown job ${job.name}`);
      return handlers.resumeWorkflowRun(job.data as ResumeJob);
    },
    maintenance: async (job: Job) => {
      switch (job.name) {
        case "sweep":
          return forEachOrg("sweep", (orgId) => handlers.sweepOrg(orgId));
        case "retention":
          return forEachOrg("retention", (orgId) => handlers.sweepRetention(orgId));
        case "demo-reset":
          if (!demoMode) return "skipped";
          return runDemoResetCore();
        case "applications.reminders":
          return forEachOrg("applications.reminders", async (orgId) => (await import("@/server/applications/reminders")).runApplicationReminders(orgId));
        case "test.idempotent":
          return handlers.testIdempotent(job.data as TestIdempotentJob);
        default:
          throw new Error(`unknown job ${job.name}`);
      }
    },
  };

  const connections: IORedis[] = [];
  const workers = Object.entries(processors).map(([name, processor]) => {
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    connection.on("error", () => undefined);
    connections.push(connection);
    const w = new Worker(name, processor, { connection, concurrency: name === "maintenance" ? 1 : 5 });
    w.on("failed", (job, err) => console.error(`[worker] ${name}:${job?.name ?? "?"} job ${job?.id ?? "?"} failed: ${describeError(err)}`));
    w.on("error", (err) => console.error(`[worker] ${name} worker error: ${describeError(err)}`));
    return w;
  });

  // Repeatable jobs. upsertJobScheduler is idempotent, so restarts and extra replicas do not duplicate them.
  const maintenance = queue("maintenance");
  if (maintenance) {
    await maintenance.upsertJobScheduler("sweep", { every: 60_000 }, { name: "sweep", opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 } });
    // 23:30 UTC is 03:30 in Dubai, after the nightly demo reset.
    await maintenance.upsertJobScheduler("retention", { pattern: "30 23 * * *", tz: "UTC" }, { name: "retention", opts: { attempts: 3 } });
    // 03:45 UTC is 07:45 in Dubai: application reminders arrive before school starts.
    await maintenance.upsertJobScheduler("applications.reminders", { pattern: "45 3 * * *", tz: "UTC" }, { name: "applications.reminders", opts: { attempts: 3 } });
    if (demoMode) {
      // 22:00 UTC is 02:00 in Dubai.
      await maintenance.upsertJobScheduler("demo-reset", { pattern: "0 22 * * *", tz: "UTC" }, { name: "demo-reset", opts: { attempts: 2 } });
    } else {
      await maintenance.removeJobScheduler("demo-reset");
    }
  }
  console.log(`[worker] started: queues=${Object.keys(processors).join(",")} demoReset=${demoMode ? "on" : "off"} email=${process.env.RESEND_API_KEY ? "resend" : "console"}`);

  let stopping = false;
  async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} received, finishing active jobs`);
    const force = setTimeout(() => {
      console.error("[worker] shutdown timed out, exiting");
      process.exit(1);
    }, 25_000);
    force.unref();
    await Promise.allSettled(workers.map((w) => w.close()));
    await closeQueues();
    for (const c of connections) c.disconnect();
    await Promise.allSettled([prisma.$disconnect(), platform === prisma ? Promise.resolve() : platform.$disconnect()]);
    console.log("[worker] stopped");
    process.exit(0);
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(`[worker] fatal: ${describeError(err)}`, err instanceof Error ? err.message.slice(0, 300) : "");
  process.exit(1);
});
