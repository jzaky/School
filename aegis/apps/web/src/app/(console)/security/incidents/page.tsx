import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { incidentListFilter, incidentStats, listIncidents } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { agentNames, agentPicks, flatParams, meanTimeToResolveHours } from "@/server/queries/shield";
import { userNames } from "@/server/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { StatPanel } from "@/components/ui/stat-panel";
import { IncidentsTable, type IncidentRow } from "@/components/shield/incidents-table";
import { CreateIncidentDialog } from "@/components/shield/create-incident-dialog";

export const metadata: Metadata = { title: "Incidents" };
export const dynamic = "force-dynamic";

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("security:read");
  const flat = flatParams(await searchParams);
  const parsed = incidentListFilter.safeParse(flat);
  const filter = parsed.success ? parsed.data : incidentListFilter.parse({});
  const canWrite = c.can("security:write");
  const { page, stats, mttr, agents, agentMap } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const [page, stats, mttr, agents] = await Promise.all([listIncidents(db, c.ctx, filter), incidentStats(db, c.ctx), meanTimeToResolveHours(db, c.ctx.orgId), agentPicks(db, c.ctx.orgId)]);
      const agentMap = await agentNames(db, page.items.flatMap((i) => i.agentIds));
      return { page, stats, mttr, agents, agentMap };
    },
    { readOnly: true },
  );
  const names = await userNames(page.items.map((i) => i.assigneeId));
  const rows: IncidentRow[] = page.items.map((i) => ({
    id: i.id,
    number: i.number,
    title: i.title,
    severity: i.severity,
    status: i.status,
    assignee: names.get(i.assigneeId ?? "") ?? null,
    agents: i.agentIds.map((a) => agentMap.get(a)?.name ?? "Agent"),
    linkedEvents: i._count.securityEvents,
    createdAt: i.createdAt.toISOString(),
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
  }));
  const openBySeverity = `${stats.bySeverity.critical ?? 0} critical, ${stats.bySeverity.high ?? 0} high, ${stats.bySeverity.medium ?? 0} medium, ${stats.bySeverity.low ?? 0} low (all statuses)`;
  return (
    <div>
      <PageHeader title="Incident Center" description="Numbered cases that group security events, notes and status changes. Every change is written to the evidence ledger." badges={<DemoBadge show={c.org.demoMode} />} actions={<CreateIncidentDialog canWrite={canWrite} agents={agents.map((a) => ({ id: a.id, name: a.name, slug: a.slug }))} />} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPanel label="Open incidents" value={stats.openTotal} tone={stats.openTotal > 0 ? "approval" : "allow"} footer={openBySeverity} />
        <StatPanel label="Investigating" value={stats.byStatus.investigating ?? 0} tone="info" />
        <StatPanel label="Contained" value={stats.byStatus.contained ?? 0} />
        <StatPanel label="Mean time to resolve" value={mttr ? (mttr.hours >= 48 ? `${(mttr.hours / 24).toFixed(1)} d` : `${mttr.hours} h`) : "n/a"} footer={mttr ? `over ${mttr.sample} resolved incident${mttr.sample === 1 ? "" : "s"}` : "No resolved incidents yet"} />
      </div>
      <IncidentsTable rows={rows} pagination={{ page: page.page, pageSize: page.pageSize, total: page.total }} status={filter.status ?? "all"} counts={stats.byStatus} />
    </div>
  );
}
