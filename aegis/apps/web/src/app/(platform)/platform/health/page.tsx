import type { Metadata } from "next";
import { rawPrisma } from "@aegis/db";
import { env, evaluateOperationalAlerts, jobStats, listDeadLetterJobs, OPS_THRESHOLDS, signingKeyId } from "@aegis/core";
import { RequeueButton } from "@/components/platform/requeue-button";
import { formatDateTime } from "@/lib/utils";
import { requirePlatformAdmin } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { KeyValue } from "@/components/ui/key-value";
import { StatPanel } from "@/components/ui/stat-panel";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Infrastructure Health" };
export const dynamic = "force-dynamic";

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d ? `${d}d ` : ""}${h}h ${m}m`;
}

export default async function HealthPage() {
  await requirePlatformAdmin();
  const started = Date.now();
  let dbOk = false;
  let dbError: string | null = null;
  let dbLatency = 0;
  try {
    await rawPrisma().$queryRaw`SELECT 1`;
    dbOk = true;
    dbLatency = Date.now() - started;
  } catch (e) {
    dbError = e instanceof Error ? e.name : "error";
  }
  const jobs = dbOk ? await jobStats() : {};
  const signing = !!process.env.EVIDENCE_SIGNING_KEY;
  let keyId = "none";
  try {
    keyId = signingKeyId();
  } catch {
    keyId = "invalid";
  }
  const redis = !!env().REDIS_URL;
  const [alerts, dead] = dbOk ? await Promise.all([evaluateOperationalAlerts(), listDeadLetterJobs(20)]) : [[], []];
  return (
    <div>
      <PageHeader title="Infrastructure Health" description="Live checks from this web process. The API and worker report separately." badges={<Badge tone="info">Platform admin</Badge>} />
      <div className="grid gap-3 md:grid-cols-4">
        <StatPanel label="Database" value={dbOk ? "Reachable" : "Unreachable"} tone={dbOk ? "allow" : "deny"} footer={dbOk ? `SELECT 1 in ${dbLatency} ms` : dbError ?? "error"} />
        <StatPanel label="Evidence signing key" value={signing ? "Present" : "Missing"} tone={signing ? "allow" : "approval"} footer={signing ? `key id ${keyId}` : "Checkpoints are not signed"} />
        <StatPanel label="Redis" value={redis ? "Configured, unused" : "Not used"} tone="neutral" footer="The job queue, rate limits and sessions are in PostgreSQL" />
        <StatPanel label="Process uptime" value={formatUptime(process.uptime())} footer={`node ${process.version}`} />
      </div>
      <Panel title="Operational alerts" description={`Evaluated now from the database, as the worker does every five minutes. Thresholds: checkpoint lag over ${OPS_THRESHOLDS.checkpointLagMinutes} minutes, ${OPS_THRESHOLDS.evaluationErrors15m} evaluation errors in 15 minutes, ${OPS_THRESHOLDS.overdueJobs} overdue jobs, any dead-lettered job, unresolved executions after ${OPS_THRESHOLDS.unresolvedExecutionMinutes} minutes.${env().AEGIS_OPS_ALERT_WEBHOOK ? " New alerts are also posted to the operations webhook." : " No operations webhook is configured; alerts are recorded as platform events."}`} className="mt-4" padded={false}>
        {alerts.length ? (
          <ul className="divide-y divide-line" data-testid="ops-alerts">
            {alerts.map((a) => (
              <li key={a.key} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-sm" data-alert={a.key}>
                <span>
                  <span className="font-medium text-fg">{a.title}</span>
                  {a.org ? <span className="ms-1.5 font-mono text-xs text-fg-dim">{a.org}</span> : null}
                  <span className="block text-fg-muted">{a.detail}</span>
                </span>
                <Badge tone={a.severity === "critical" ? "deny" : "approval"}>{a.severity}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-fg-muted" data-testid="ops-alerts-none">
            No alert is firing.
          </p>
        )}
      </Panel>
      <Panel title="Dead-letter queue" description="Jobs that used all their attempts. Fix the cause, then requeue: the job runs again with a fresh set of attempts." className="mt-4" padded={false}>
        {dead.length ? (
          <ul className="divide-y divide-line" data-testid="dead-letter-jobs">
            {dead.map((j) => (
              <li key={j.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-mono text-xs text-fg">{j.type}</span>
                  <span className="block text-xs text-fg-muted">
                    {j.attempts} of {j.maxAttempts} attempts, last {formatDateTime(j.updatedAt)}: {j.lastError ?? "no error recorded"}
                  </span>
                </span>
                <RequeueButton jobId={j.id} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-fg-muted">The dead-letter queue is empty.</p>
        )}
      </Panel>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Job queue" description="PostgreSQL-backed queue, counted by status">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(["pending", "running", "done", "failed"] as const).map((s) => (
              <StatPanel key={s} label={s} value={jobs[s] ?? 0} tone={s === "failed" && (jobs[s] ?? 0) > 0 ? "deny" : s === "running" ? "info" : undefined} />
            ))}
          </div>
        </Panel>
        <Panel title="Runtime">
          <KeyValue
            items={[
              { label: "Node version", value: process.version, mono: true },
              { label: "Platform", value: `${process.platform} ${process.arch}`, mono: true },
              { label: "NODE_ENV", value: env().NODE_ENV, mono: true },
              { label: "Memory (RSS)", value: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`, mono: true },
              { label: "Checked at", value: new Date().toISOString(), mono: true },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
