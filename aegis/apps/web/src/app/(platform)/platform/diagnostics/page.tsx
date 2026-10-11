import type { Metadata } from "next";
import { ownerPrisma } from "@aegis/db";
import { env } from "@aegis/core";
import { requirePlatformAdmin } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { KeyValue } from "@/components/ui/key-value";
import { Badge } from "@/components/ui/badge";
import { VerifyChainTool } from "@/components/platform/verify-chain";

export const metadata: Metadata = { title: "Operational Diagnostics" };
export const dynamic = "force-dynamic";

/** Host and database name only. Credentials and query strings are never rendered. */
function dbTarget(url: string | undefined): string {
  if (!url) return "not set";
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "unparseable";
  }
}

export default async function DiagnosticsPage() {
  await requirePlatformAdmin();
  const e = env();
  const orgs = await ownerPrisma().organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } });
  return (
    <div>
      <PageHeader title="Operational Diagnostics" description="Configuration summary for this web process. Secrets are never displayed." badges={<Badge tone="info">Platform admin</Badge>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Environment">
          <KeyValue
            items={[
              { label: "NODE_ENV", value: e.NODE_ENV, mono: true },
              { label: "Demo mode", value: e.AEGIS_DEMO_MODE ? <Badge tone="approval">On</Badge> : <Badge>Off</Badge> },
              { label: "Database", value: dbTarget(e.DATABASE_URL), mono: true },
              { label: "Migration connection", value: e.MIGRATION_DATABASE_URL ? "configured" : "not set" },
              { label: "Redis", value: e.REDIS_URL ? <Badge tone="allow">Configured</Badge> : <Badge>Not configured</Badge> },
              { label: "OTEL endpoint", value: e.OTEL_EXPORTER_OTLP_ENDPOINT ? <Badge tone="allow">Set</Badge> : <Badge>Not set</Badge> },
              { label: "OTEL service", value: e.OTEL_SERVICE_NAME, mono: true },
              { label: "Evidence signing key", value: e.EVIDENCE_SIGNING_KEY ? <Badge tone="allow">Present</Badge> : <Badge tone="approval">Missing</Badge> },
              { label: "Email provider", value: e.RESEND_API_KEY ? "Resend" : "console (logs only)" },
              { label: "Web URL", value: e.WEB_PUBLIC_URL, mono: true },
              { label: "API URL", value: e.API_PUBLIC_URL, mono: true },
              { label: "Log level", value: e.LOG_LEVEL, mono: true },
            ]}
          />
        </Panel>
        <Panel title="Verify evidence chain for a tenant" description="Recomputes every hash and checkpoint signature. Recorded as a platform event.">
          <VerifyChainTool orgs={orgs} />
        </Panel>
      </div>
    </div>
  );
}
