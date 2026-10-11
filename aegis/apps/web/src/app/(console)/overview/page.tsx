import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { getConsoleContext } from "@/server/session";
import { loadOverview } from "@/server/queries/overview";
import { PageHeader } from "@/components/ui/page-header";
import { StatPanel } from "@/components/ui/stat-panel";
import { Panel } from "@/components/ui/panel";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Timeline } from "@/components/ui/timeline";
import { StatusBadge } from "@/components/ui/status";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AgentsByStatusChart } from "@/components/overview/agents-by-status-chart";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { statusTone } from "@/lib/status";

export const metadata: Metadata = { title: "Command Center" };
export const dynamic = "force-dynamic";

function evidenceTone(type: string) {
  if (/denied|revoked|failed|deleted|suspended/.test(type)) return "deny" as const;
  if (/allowed|activated|active|granted|approved|created|issued|accepted/.test(type)) return "allow" as const;
  if (/approval|pending/.test(type)) return "approval" as const;
  return "neutral" as const;
}

export default async function OverviewPage() {
  const c = await getConsoleContext();
  const o = await loadOverview(c);
  const chain = o.evidence.chain;
  const chainLabel = chain.valid ? "Chain valid" : chain.firstBadSeq ? `Chain broken at seq ${chain.firstBadSeq}` : "Checkpoint signature mismatch";
  const canAgents = c.can("agents:read");
  return (
    <div>
      <PageHeader title="Command Center" description={`${c.org.name}: agents, decisions, approvals and evidence at a glance.`} badges={<DemoBadge show={c.org.demoMode} />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatPanel label="Registered agents" value={o.agents.registered} footer="Excludes archived" />
        <StatPanel label="Active agents" value={o.agents.active} tone="allow" />
        <StatPanel label="Suspended agents" value={o.agents.suspended} tone={o.agents.suspended > 0 ? "approval" : undefined} />
        <StatPanel label="Actions evaluated" value={o.requests.total} footer="All action requests" />
        <StatPanel label="Allowed" value={o.requests.allowed} tone="allow" />
        <StatPanel label="Denied" value={o.requests.denied} tone={o.requests.denied > 0 ? "deny" : undefined} />
        <StatPanel label="Awaiting approval" value={o.requests.awaiting} tone={o.requests.awaiting > 0 ? "approval" : undefined} />
        <StatPanel label="Open alerts" value={o.openAlerts} tone={o.openAlerts > 0 ? "approval" : undefined} />
        <StatPanel label="Open incidents" value={o.openIncidents} tone={o.openIncidents > 0 ? "critical" : undefined} />
        <StatPanel label="Evidence events" value={o.evidence.count} footer={<span className={chain.valid ? "text-allow" : "text-deny"}>{chainLabel}</span>} hint={`Hash chain recomputed over ${chain.checked} events. Checkpoints: ${chain.checkpoints.length}`} />
        <StatPanel label="Members" value={o.members} footer="Active memberships" />
        <StatPanel label="Chain checkpoints" value={chain.checkpoints.length} footer={chain.checkpoints.length ? `${chain.checkpoints.filter((cp) => cp.valid).length} signatures valid` : "Written by the worker"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel title="Agents by status" description="Lifecycle distribution across all registered agents" className="xl:col-span-1">
          <AgentsByStatusChart data={o.agents.byStatus} />
          <table className="sr-only">
            <caption>Agents by status</caption>
            <tbody>
              {o.agents.byStatus.map((r) => (
                <tr key={r.status}>
                  <th scope="row">{r.status}</th>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Recent evidence" description="Latest 15 events on the tamper-evident ledger" className="xl:col-span-2">
          <Timeline
            emptyText="No evidence recorded yet"
            items={o.recentEvidence.map((e) => ({
              id: e.id,
              tone: evidenceTone(e.type),
              title: (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-mono text-xs text-fg">{e.type}</span>
                  <span className="text-fg-dim">by</span>
                  <span>{e.actor}</span>
                  {e.subjectType === "agent" && e.subjectId && canAgents ? (
                    <Link href={`/agents/${e.subjectId}`} className="inline-flex items-center gap-0.5 text-accent hover:underline">
                      {e.subjectLabel ?? "agent"}
                      <ArrowUpRight className="h-3 w-3" aria-hidden />
                    </Link>
                  ) : (
                    <span className="text-fg-muted">
                      {e.subjectType}
                      {e.subjectLabel ? `: ${e.subjectLabel}` : ""}
                    </span>
                  )}
                </span>
              ),
              meta: <span className="font-mono">seq {e.seq}</span>,
              time: <span title={formatDateTime(e.occurredAt)}>{timeAgo(e.occurredAt)}</span>,
            }))}
          />
        </Panel>
      </div>

      <Panel title="Agents needing attention" description="Suspended agents and drafts older than 7 days" className="mt-4" padded={false}>
        {o.attention.length === 0 ? (
          <EmptyState title="Nothing needs attention" description="No suspended agents and no stale drafts." />
        ) : (
          <ul className="divide-y divide-line">
            {o.attention.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <AlertTriangle className={`h-4 w-4 shrink-0 ${a.status === "suspended" ? "text-approval" : "text-fg-dim"}`} aria-hidden />
                  <div className="min-w-0">
                    {canAgents ? (
                      <Link href={`/agents/${a.id}`} className="text-sm font-medium text-fg hover:underline">
                        {a.name}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-fg">{a.name}</span>
                    )}
                    <div className="truncate text-xs text-fg-muted">{a.status === "suspended" ? a.statusReason || "Suspended without a recorded reason" : `Draft since ${formatDateTime(a.createdAt)}`}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={statusTone(a.riskTier)}>{a.riskTier} risk</Badge>
                  <StatusBadge status={a.status} />
                  <span className="text-xs tabular text-fg-dim">{timeAgo(a.statusChangedAt ?? a.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
