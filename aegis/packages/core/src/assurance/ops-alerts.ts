import { rawPrisma, withTenant } from "@aegis/db";
import { env } from "../env.js";
import { breakers } from "../lib/circuit.js";
import { logger } from "../lib/logger.js";
import { assertSafeDestinationUrl, defaultSender } from "../integrations/destinations.js";

/**
 * Operational alerting for the platform team (docs/PERFORMANCE.md). Evaluated by the worker every five
 * minutes from records in the database, so it sees every replica's work. Each firing alert is recorded once
 * per hour as a platform event and, when AEGIS_OPS_ALERT_WEBHOOK is set, posted there (HTTPS, public
 * address, pinned DNS). Alerts carry counts and organization slugs only, never content.
 */

export interface OpsAlert {
  key: string;
  severity: "warning" | "critical";
  title: string;
  detail: string;
  org?: string;
}

export const OPS_THRESHOLDS = {
  deadLetteredLastHour: 1,
  overdueJobs: 50,
  overdueJobMinutes: 10,
  checkpointLagMinutes: 15,
  evaluationErrors15m: 5,
  failedDeliveriesLastHour: 10,
  unresolvedExecutionMinutes: 30,
};

export async function evaluateOperationalAlerts(now = new Date()): Promise<OpsAlert[]> {
  const db = rawPrisma();
  const alerts: OpsAlert[] = [];
  const hourAgo = new Date(now.getTime() - 3600_000);
  const dead = await db.job.count({ where: { status: "failed", updatedAt: { gte: hourAgo } } });
  if (dead >= OPS_THRESHOLDS.deadLetteredLastHour) alerts.push({ key: "jobs.dead_lettered", severity: "warning", title: "Background jobs failed for good", detail: `${dead} job(s) used all their attempts in the last hour; see the dead-letter list on Infrastructure Health` });
  const overdue = await db.job.count({ where: { status: "pending", runAt: { lt: new Date(now.getTime() - OPS_THRESHOLDS.overdueJobMinutes * 60_000) } } });
  if (overdue >= OPS_THRESHOLDS.overdueJobs) alerts.push({ key: "jobs.backlog", severity: "warning", title: "Job queue is backing up", detail: `${overdue} jobs are more than ${OPS_THRESHOLDS.overdueJobMinutes} minutes overdue: the worker is down or too slow` });
  const open = [...breakers.execution.openKeys(), ...breakers.destination.openKeys()];
  if (open.length) alerts.push({ key: "circuits.open", severity: "warning", title: "Circuit breakers open in the worker", detail: `${open.length} downstream system(s) or destination(s) are failing repeatedly` });

  const orgs = await db.organization.findMany({ select: { id: true, slug: true } });
  for (const o of orgs) {
    const found = await withTenant(
      o.id,
      async (t) => {
        const out: OpsAlert[] = [];
        const last = await t.evidenceCheckpoint.findFirst({ where: { orgId: o.id }, orderBy: { throughSeq: "desc" }, select: { throughSeq: true } });
        const uncovered = await t.evidenceEvent.findFirst({ where: { orgId: o.id, ...(last ? { seq: { gt: last.throughSeq } } : {}) }, orderBy: { seq: "asc" }, select: { occurredAt: true } });
        const lag = uncovered ? (now.getTime() - uncovered.occurredAt.getTime()) / 60_000 : 0;
        if (lag > OPS_THRESHOLDS.checkpointLagMinutes) out.push({ key: `evidence.checkpoint_lag:${o.slug}`, severity: "critical", org: o.slug, title: "Evidence is not being checkpointed", detail: `Evidence from ${Math.round(lag)} minutes ago has no signed checkpoint` });
        const errors = await t.authorizationDecision.count({ where: { orgId: o.id, result: "error", createdAt: { gte: new Date(now.getTime() - 15 * 60_000) } } });
        if (errors >= OPS_THRESHOLDS.evaluationErrors15m) out.push({ key: `gateway.errors:${o.slug}`, severity: "critical", org: o.slug, title: "Policy evaluation errors", detail: `${errors} decisions ended in an evaluation error in 15 minutes (each was refused)` });
        const failed = await t.eventDelivery.count({ where: { orgId: o.id, status: "failed", createdAt: { gte: hourAgo } } });
        if (failed >= OPS_THRESHOLDS.failedDeliveriesLastHour) out.push({ key: `destinations.failing:${o.slug}`, severity: "warning", org: o.slug, title: "Event deliveries failing", detail: `${failed} deliveries failed for good in the last hour` });
        const stuck = await t.actionRequest.count({ where: { orgId: o.id, status: "unknown", updatedAt: { lt: new Date(now.getTime() - OPS_THRESHOLDS.unresolvedExecutionMinutes * 60_000) } } });
        if (stuck > 0) out.push({ key: `executions.unresolved:${o.slug}`, severity: "warning", org: o.slug, title: "Executions with an unknown outcome", detail: `${stuck} request(s) have waited over ${OPS_THRESHOLDS.unresolvedExecutionMinutes} minutes for a person to resolve them` });
        return out;
      },
      { readOnly: true, lock: "lazy", timeout: 30_000 },
    );
    alerts.push(...found);
  }
  return alerts;
}

/** Records each firing alert once per hour, and posts new ones to the operations webhook when configured. */
export async function recordOperationalAlerts(now = new Date()): Promise<{ firing: number; recorded: number }> {
  const alerts = await evaluateOperationalAlerts(now);
  const db = rawPrisma();
  const hourAgo = new Date(now.getTime() - 3600_000);
  let recorded = 0;
  for (const a of alerts) {
    const seen = await db.platformEvent.findFirst({ where: { type: "ops.alert", createdAt: { gte: hourAgo }, detail: { path: ["key"], equals: a.key } } });
    if (seen) continue;
    await db.platformEvent.create({ data: { type: "ops.alert", detail: { ...a } } });
    recorded++;
    const hook = env().AEGIS_OPS_ALERT_WEBHOOK;
    if (hook) {
      try {
        await assertSafeDestinationUrl(hook);
        await defaultSender({ url: hook, headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "aegis", ...a, at: now.toISOString() }) });
      } catch (e) {
        logger.warn({ alert: a.key, err: e instanceof Error ? e.message : "error" }, "ops alert webhook failed");
      }
    }
  }
  return { firing: alerts.length, recorded };
}
