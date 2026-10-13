import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { listSecurityEvents, securityEventFilter, securityEventStats } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { agentPicks, flatParams } from "@/server/queries/shield";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { StatPanel } from "@/components/ui/stat-panel";
import { EventsTable, type EventRow } from "@/components/shield/events-table";

export const metadata: Metadata = { title: "Security Events" };
export const dynamic = "force-dynamic";

export default async function SecurityEventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("security:read");
  const flat = flatParams(await searchParams);
  const parsed = securityEventFilter.safeParse(flat);
  const filter = parsed.success ? parsed.data : securityEventFilter.parse({});
  const { page, stats, agents } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const [page, stats, agents] = await Promise.all([listSecurityEvents(db, c.ctx, filter), securityEventStats(db, c.ctx), agentPicks(db, c.ctx.orgId)]);
      return { page, stats, agents };
    },
    { readOnly: true },
  );
  const rows: EventRow[] = page.items.map((e) => ({
    id: e.id,
    createdAt: e.createdAt.toISOString(),
    severity: e.severity,
    type: e.type,
    title: e.title,
    agentId: e.agentId,
    agentName: e.agent?.name ?? null,
    actionRequestId: e.actionRequestId,
    status: e.status,
    incidentNumber: e.incident?.number ?? null,
    incidentId: e.incident?.id ?? null,
  }));
  const types = Object.keys(stats.windows["30d"].byType).sort();
  if (filter.type && !types.includes(filter.type)) types.push(filter.type);
  const filters = { severity: filter.severity ?? "", status: filter.status ?? "", type: filter.type ?? "", agentId: filter.agentId ?? "", since: flat.since ?? "" };
  const w = stats.windows;
  const sevLine = (s: typeof w["24h"]) => `${s.bySeverity.critical ?? 0} critical, ${s.bySeverity.high ?? 0} high, ${s.bySeverity.medium ?? 0} medium, ${s.bySeverity.low ?? 0} low`;
  return (
    <div>
      <PageHeader title="Security Events" description="Things the Action Gateway, the Shield data protection check, monitoring and integrations flagged for a security analyst to look at. Review each one, dismiss it, or group related events into an incident." badges={<DemoBadge show={c.org.demoMode} />} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPanel label="Open" value={stats.open} tone={stats.open > 0 ? "approval" : "neutral"} footer="Waiting for an analyst to review (triage)" />
        <StatPanel label="Last 24 hours" value={w["24h"].total} footer={sevLine(w["24h"])} tone={(w["24h"].bySeverity.critical ?? 0) > 0 ? "critical" : undefined} />
        <StatPanel label="Last 7 days" value={w["7d"].total} footer={sevLine(w["7d"])} />
        <StatPanel label="Last 30 days" value={w["30d"].total} footer={sevLine(w["30d"])} />
      </div>
      <EventsTable rows={rows} pagination={{ page: page.page, pageSize: page.pageSize, total: page.total }} filters={filters} types={types} agents={agents.map((a) => ({ id: a.id, name: a.name }))} />
    </div>
  );
}
