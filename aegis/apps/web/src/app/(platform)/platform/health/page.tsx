import type { Metadata } from "next";
import { rawPrisma } from "@aegis/db";
import { env, jobStats, signingKeyId } from "@aegis/core";
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
  return (
    <div>
      <PageHeader title="Infrastructure Health" description="Live checks from this web process. The API and worker report separately." badges={<Badge tone="info">Platform admin</Badge>} />
      <div className="grid gap-3 md:grid-cols-4">
        <StatPanel label="Database" value={dbOk ? "Reachable" : "Unreachable"} tone={dbOk ? "allow" : "deny"} footer={dbOk ? `SELECT 1 in ${dbLatency} ms` : dbError ?? "error"} />
        <StatPanel label="Evidence signing key" value={signing ? "Present" : "Missing"} tone={signing ? "allow" : "approval"} footer={signing ? `key id ${keyId}` : "Checkpoints are not signed"} />
        <StatPanel label="Redis" value={redis ? "Configured" : "Not configured"} tone={redis ? "allow" : "neutral"} footer="Rate limits and live events" />
        <StatPanel label="Process uptime" value={formatUptime(process.uptime())} footer={`node ${process.version}`} />
      </div>
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
