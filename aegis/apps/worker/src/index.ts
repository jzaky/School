import { withTenant, disconnectAll } from "@aegis/db";
import { assertApplicationProcess, auditAllEnforcementPaths, claimJobs, expireTemporaryAccess, env, expireApproval, expireHeldRequest, expireHeldRequests, expireOverdueApprovals, installConnectors, installShield, logger, reconcileExecution, recoverStaleJobs, registerJobHandler, runJob, startTelemetry, sweepStuckExecutions, systemContext, writeCheckpoint } from "@aegis/core";
import { rawPrisma } from "@aegis/db";
import { registerModuleHandlers } from "./handlers.js";

const log = logger.child({ component: "worker" });
assertApplicationProcess("worker");

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
    const held = await withTenant(o.id, (db) => expireHeldRequests(db, systemContext(o.id)));
    if (held) log.info({ orgId: o.id, expired: held }, "expired quarantined or waiting requests");
    const access = await withTenant(o.id, (db) => expireTemporaryAccess(db, systemContext(o.id)));
    if (access) log.info({ orgId: o.id, expired: access }, "temporary access ended");
  }
});

/** A quarantined request or one waiting for more information whose window has passed. */
registerJobHandler("request.expire", async (payload) => {
  const { actionRequestId, orgId } = payload as { actionRequestId: string; orgId: string };
  await withTenant(orgId, (db) => expireHeldRequest(db, systemContext(orgId), actionRequestId));
});

/** Resolves an ambiguous downstream outcome from the downstream system's own records. */
registerJobHandler("execution.reconcile", async (payload) => {
  const { actionRequestId, orgId } = payload as { actionRequestId: string; orgId: string };
  const out = await reconcileExecution((fn) => withTenant(orgId, fn), systemContext(orgId), actionRequestId);
  log.info({ orgId, actionRequestId, status: out.requestStatus }, "execution reconciled");
});

/** Safety net for requests left `executing` by a crash between the downstream call and the receipt. */
registerJobHandler("executions.sweep", async () => {
  const orgs = await rawPrisma().organization.findMany({ select: { id: true } });
  for (const o of orgs) {
    const n = await sweepStuckExecutions((fn) => withTenant(o.id, fn), systemContext(o.id));
    if (n) log.info({ orgId: o.id, reconciled: n }, "stuck executions reconciled");
  }
});

registerJobHandler("evidence.checkpoint", async () => {
  const orgs = await rawPrisma().organization.findMany({ select: { id: true } });
  for (const o of orgs) await withTenant(o.id, (db) => writeCheckpoint(db, o.id));
});

/** Looks for actions taken around the gateway on every observable integration. */
registerJobHandler("enforcement.audit", async () => {
  const orgs = await rawPrisma().organization.findMany({ select: { id: true } });
  for (const o of orgs) {
    try {
      const results = await auditAllEnforcementPaths((fn) => withTenant(o.id, fn), systemContext(o.id), { windowHours: 2 });
      const outside = results.reduce((n, r) => n + r.findings.length, 0);
      if (outside) log.warn({ orgId: o.id, outside }, "actions outside the gateway detected");
    } catch (e) {
      log.error({ orgId: o.id, err: e instanceof Error ? e.message : String(e) }, "enforcement audit failed");
    }
  }
});

registerModuleHandlers();

/** Recurring jobs are re-scheduled by key so there is always exactly one pending instance. */
async function scheduleRecurring() {
  const { enqueueJob } = await import("@aegis/core");
  const minute = Math.floor(Date.now() / 60_000);
  await enqueueJob({ type: "approvals.sweep", payload: {}, idempotencyKey: `approvals.sweep:${minute}`, runAt: new Date() });
  await enqueueJob({ type: "executions.sweep", payload: {}, idempotencyKey: `executions.sweep:${minute}`, runAt: new Date() });
  await enqueueJob({ type: "evidence.checkpoint", payload: {}, idempotencyKey: `evidence.checkpoint:${Math.floor(minute / 5)}`, runAt: new Date() });
  await enqueueJob({ type: "monitoring.run", payload: {}, idempotencyKey: `monitoring.run:${minute}`, runAt: new Date() });
  await enqueueJob({ type: "audit.retention", payload: {}, idempotencyKey: `audit.retention:${Math.floor(minute / 1440)}`, runAt: new Date() });
  await enqueueJob({ type: "enforcement.audit", payload: {}, idempotencyKey: `enforcement.audit:${Math.floor(minute / 60)}`, runAt: new Date() });
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

const telemetry = await startTelemetry("worker");
installShield();
installConnectors();
log.info({ env: env().NODE_ENV }, "aegis-worker starting");
void loop();
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    stopping = true;
    await telemetry.shutdown();
    await disconnectAll();
    process.exit(0);
  });
}
