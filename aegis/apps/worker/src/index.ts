import { withTenant, disconnectAll } from "@aegis/db";
import { claimJobs, env, expireApproval, expireOverdueApprovals, logger, recoverStaleJobs, registerJobHandler, runJob, systemContext, writeCheckpoint } from "@aegis/core";
import { rawPrisma } from "@aegis/db";
import { registerModuleHandlers } from "./handlers.js";

const log = logger.child({ component: "worker" });

// ---- Core handlers ----
registerJobHandler("approval.expire", async (payload) => {
  const { approvalRequestId, orgId } = payload as { approvalRequestId: string; orgId: string };
  await withTenant(orgId, (db) => expireApproval(db, systemContext(orgId), approvalRequestId));
});

registerJobHandler("approvals.sweep", async () => {
  const orgs = await rawPrisma().organization.findMany({ select: { id: true } });
  for (const o of orgs) {
    const n = await withTenant(o.id, (db) => expireOverdueApprovals(db, systemContext(o.id)));
    if (n) log.info({ orgId: o.id, expired: n }, "expired overdue approvals");
  }
});

registerJobHandler("evidence.checkpoint", async () => {
  const orgs = await rawPrisma().organization.findMany({ select: { id: true } });
  for (const o of orgs) await withTenant(o.id, (db) => writeCheckpoint(db, o.id));
});

registerModuleHandlers();

/** Recurring jobs are re-scheduled by key so there is always exactly one pending instance. */
async function scheduleRecurring() {
  const { enqueueJob } = await import("@aegis/core");
  const minute = Math.floor(Date.now() / 60_000);
  await enqueueJob({ type: "approvals.sweep", payload: {}, idempotencyKey: `approvals.sweep:${minute}`, runAt: new Date() });
  await enqueueJob({ type: "evidence.checkpoint", payload: {}, idempotencyKey: `evidence.checkpoint:${Math.floor(minute / 5)}`, runAt: new Date() });
  await enqueueJob({ type: "monitoring.run", payload: {}, idempotencyKey: `monitoring.run:${minute}`, runAt: new Date() });
}

let stopping = false;
async function loop() {
  await recoverStaleJobs();
  let lastRecurring = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastRecurring > 60_000) {
        await scheduleRecurring();
        lastRecurring = Date.now();
      }
      const jobs = await claimJobs(10);
      if (jobs.length === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      for (const j of jobs) await runJob(j);
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "worker loop error");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

log.info({ env: env().NODE_ENV }, "aegis-worker starting");
void loop();
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    stopping = true;
    await disconnectAll();
    process.exit(0);
  });
}
