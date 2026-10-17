import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { getLabRun, isAegisError } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Note } from "@/components/ui/note";
import { StatPanel } from "@/components/ui/stat-panel";
import { formatDateTime } from "@/lib/utils";
import type { Tone } from "@/lib/status";

export const metadata: Metadata = { title: "Lab run" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTCOME_TONE: Record<string, Tone> = { control: "info", defended: "allow", gap: "deny", inconclusive: "approval", error: "critical" };

export default async function LabRunPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePermission("security:read");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const run = await withTenant(
    c.ctx.orgId,
    async (db) => {
      try {
        return await getLabRun(db, c.ctx, id);
      } catch (e) {
        if (isAegisError(e) && e.code === "not_found") return null;
        throw e;
      }
    },
    { readOnly: true },
  );
  if (!run) notFound();
  const counts = (run.summary as { counts?: Record<string, number> }).counts ?? {};
  const tool = (run.summary as { tool?: string }).tool ?? "";
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Attack Simulation Lab", href: "/security/lab" }, { label: formatDateTime(run.startedAt) }]}
        title="Lab run"
        badges={<DemoBadge show={c.org.demoMode} />}
        description={
          <>
            A clone of {run.target?.name ?? "an agent"} attacked through <span className="font-mono">{tool}</span>, {formatDateTime(run.startedAt)}. Status: {run.status}.
          </>
        }
      />
      {run.error ? (
        <Note tone="warning" className="mb-4">
          The run stopped early: {run.error}
        </Note>
      ) : null}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPanel label="Defended" value={counts.defended ?? 0} tone="allow" />
        <StatPanel label="Gaps" value={counts.gap ?? 0} tone={(counts.gap ?? 0) > 0 ? "deny" : "neutral"} footer="Allowed with current settings" />
        <StatPanel label="Inconclusive" value={counts.inconclusive ?? 0} tone={(counts.inconclusive ?? 0) > 0 ? "approval" : "neutral"} footer="The control request was not allowed" />
        <StatPanel label="Errors" value={counts.error ?? 0} tone={(counts.error ?? 0) > 0 ? "deny" : "neutral"} />
      </div>
      <Panel title="Results" description="Every request below is on the evidence record and opens in the Action Gateway">
        <ol className="divide-y divide-line" data-testid="lab-results">
          {run.results.map((r) => (
            <li key={r.id} className="py-3" data-scenario={r.scenarioKey} data-outcome={r.outcome}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={OUTCOME_TONE[r.outcome] ?? "neutral"}>{r.outcome}</Badge>
                <span className="font-medium text-fg">{r.title}</span>
                {r.references.map((ref) => (
                  <Badge key={ref} mono>
                    {ref}
                  </Badge>
                ))}
              </div>
              <p className="mt-1 text-xs text-fg-muted">{r.attack}</p>
              <p className="mt-1 text-sm text-fg">
                <span className="text-fg-muted">Expected:</span> {r.expected} <span className="text-fg-muted">Observed:</span> {r.observed}
              </p>
              {r.remedy ? (
                <p className="mt-1 text-sm text-fg" data-testid="lab-remedy">
                  <span className="text-fg-muted">To close it:</span> {r.remedy}
                </p>
              ) : null}
              {r.actionRequestIds.length ? (
                <p className="mt-1 flex flex-wrap gap-2 text-xs">
                  {r.actionRequestIds.map((rid) => (
                    <Link key={rid} href={`/gateway/${rid}`} className="font-mono text-accent hover:underline">
                      {rid.slice(-8)}
                    </Link>
                  ))}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
