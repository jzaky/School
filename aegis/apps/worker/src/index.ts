import { createServer } from "node:http";
import { withTenant, disconnectAll } from "@aegis/db";
import { assertApplicationProcess, auditAllEnforcementPaths, claimJobs, dispatchEvents, expireTemporaryAccess, env, expireApproval, expireHeldRequest, expireHeldRequests, expireOverdueApprovals, installConnectors, installShield, logger, periodOf, prometheusText, purgeRateLimitBuckets, recomputeCalibration, recordOperationalAlerts, reconcileExecution, recoverStaleJobs, registerJobHandler, runJob, snapshotUsage, startTelemetry, sweepStuckExecutions, systemContext, writeCheckpoint } from "@aegis/core";
import { rawPrisma } from "@aegis/db";
import { registerModuleHandlers } from "./handlers.js";

/** Organization jobs act for the organization on the job row; a job without one is refused. */
function requireOrg(ctx: { orgId: string | null }): string {
  if (!ctx.orgId) throw new Error("job has no organization");
  return ctx.orgId;
}

const log = logger.child({ component: "worker" });
assertApplicationProcess("worker");

// ---- Core handlers ----
registerJobHandler("approval.expire", async (payload, ctx) => {
  const { approvalRequestId } = payload as { approvalRequestId: string };
  const orgId = requireOrg(ctx);
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
registerJobHandler("request.expire", async (payload, ctx) => {
  const { actionRequestId } = payload as { actionRequestId: string };
  const orgId = requireOrg(ctx);
  await withTenant(orgId, (db) => expireHeldRequest(db, systemContext(orgId), actionRequestId));
});

/** Resolves an ambiguous downstream outcome from the downstream system's own records. */
registerJobHandler("execution.reconcile", async (payload, ctx) => {
  const { actionRequestId } = payload as { actionRequestId: string };
  const orgId = requireOrg(ctx);
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

/** Sends new governance events to each organization's event destinations (docs/ENTERPRISE_INTEGRATIONS.md). */
registerJobHandler("events.dispatch", async () => {
  const orgs = await rawPrisma().organization.findMany({ select: { id: true } });
  for (const o of orgs) {
    const out = await dispatchEvents((fn) => withTenant(o.id, fn), o.id);
    if (out.delivered || out.failed) log.info({ orgId: o.id, delivered: out.delivered, failed: out.failed }, "events dispatched");
  }
});

/** Records each organization's usage for the current month, and the previous month in the first days of a month (docs/COMMERCIAL_READINESS.md). */
registerJobHandler("usage.snapshot", async () => {
  const now = new Date();
  const periods = [periodOf(now)];
  if (now.getUTCDate() <= 3) periods.push(periodOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15))));
  const orgs = await rawPrisma().organization.findMany({ select: { id: true } });
  for (const o of orgs) for (const p of periods) await withTenant(o.id, (db) => snapshotUsage(db, o.id, p, now));
});

/** Platform operational alerts (docs/PERFORMANCE.md): recorded once per hour each, optionally posted to a webhook. */
registerJobHandler("ops.alerts", async () => {
  const out = await recordOperationalAlerts();
  if (out.recorded) log.warn({ firing: out.firing, recorded: out.recorded }, "operational alerts recorded");
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

/** Recomputes every agent's calibration from its labelled outcomes (last 90 days). */
registerJobHandler("uncertainty.calibrate", async () => {
  const orgs = await rawPrisma().organization.findMany({ select: { id: true } });
  for (const o of orgs) {
    const written = await withTenant(o.id, (db) => recomputeCalibration(db, systemContext(o.id)), { lock: "lazy", timeout: 60_000 });
    if (written.length) log.info({ orgId: o.id, profiles: written.length }, "calibration recomputed");
  }
});

/** Deletes shared rate-limit windows that ended more than a day ago. */
registerJobHandler("rate-limits.purge", async () => {
  const n = await purgeRateLimitBuckets();
  if (n) log.info({ deleted: n }, "expired rate-limit windows deleted");
});

registerModuleHandlers();

/** Recurring jobs are re-scheduled by key so there is always exactly one pending instance. */
async function scheduleRecurring() {
  const { enqueueJob } = await import("@aegis/core");
  const minute = Math.floor(Date.now() / 60_000);
  await enqueueJob({ type: "approvals.sweep", payload: {}, idempotencyKey: `approvals.sweep:${minute}`, runAt: new Date() });
  await enqueueJob({ type: "executions.sweep", payload: {}, idempotencyKey: `executions.sweep:${minute}`, runAt: new Date() });
  await enqueueJob({ type: "events.dispatch", payload: {}, idempotencyKey: `events.dispatch:${minute}`, runAt: new Date() });
  await enqueueJob({ type: "evidence.checkpoint", payload: {}, idempotencyKey: `evidence.checkpoint:${Math.floor(minute / 5)}`, runAt: new Date() });
  await enqueueJob({ type: "monitoring.run", payload: {}, idempotencyKey: `monitoring.run:${minute}`, runAt: new Date() });
  await enqueueJob({ type: "audit.retention", payload: {}, idempotencyKey: `audit.retention:${Math.floor(minute / 1440)}`, runAt: new Date() });
  await enqueueJob({ type: "enforcement.audit", payload: {}, idempotencyKey: `enforcement.audit:${Math.floor(minute / 60)}`, runAt: new Date() });
  await enqueueJob({ type: "rate-limits.purge", payload: {}, idempotencyKey: `rate-limits.purge:${Math.floor(minute / 60)}`, runAt: new Date() });
  await enqueueJob({ type: "ops.alerts", payload: {}, idempotencyKey: `ops.alerts:${Math.floor(minute / 5)}`, runAt: new Date() });
  await enqueueJob({ type: "usage.snapshot", payload: {}, idempotencyKey: `usage.snapshot:${Math.floor(minute / 360)}`, runAt: new Date() });
  await enqueueJob({ type: "uncertainty.calibrate", payload: {}, idempotencyKey: `uncertainty.calibrate:${Math.floor(minute / 60)}`, runAt: new Date() });
}

// Optional Prometheus endpoint for the worker's own metrics (jobs, deliveries, executions, circuits).
// Bound to 127.0.0.1 only; scrape it from a sidecar or the same host.
const metricsPort = env().AEGIS_WORKER_METRICS_PORT;
if (metricsPort) {
  createServer((req, res) => {
    if (req.url !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" }).end(prometheusText());
  }).listen(metricsPort, "127.0.0.1", () => log.info({ port: metricsPort }, "worker metrics listening on 127.0.0.1"));
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
