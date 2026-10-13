import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { agentListFilter, agentPostures, listAgents, listTeams } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { memberOptions, userNames } from "@/server/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { AgentsTable, type AgentRow } from "@/components/agents/agents-table";
import { RegisterAgentDialog } from "@/components/agents/register-agent-dialog";
import { ExportCsvButton } from "@/components/agents/export-csv-button";

export const metadata: Metadata = { title: "AI Agents" };
export const dynamic = "force-dynamic";

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("agents:read");
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = agentListFilter.safeParse(flat);
  const filter = parsed.success ? parsed.data : agentListFilter.parse({});
  const canWrite = c.can("agents:write");
  const { page, pickers, postures } = await withTenant(c.ctx.orgId, async (db) => {
    const page = await listAgents(db, c.ctx, filter);
    const postures = await agentPostures(db, c.ctx, page.items);
    const pickers = canWrite ? { members: await memberOptions(db, c.ctx.orgId), teams: c.can("users:read") ? await listTeams(db, c.ctx) : [] } : { members: [], teams: [] };
    return { page, pickers, postures };
  });
  const names = await userNames(page.items.map((a) => a.businessOwnerId));
  const rows: AgentRow[] = page.items.map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    status: a.status,
    posture: postures.get(a.id)?.posture ?? "restricted",
    postureSentence: postures.get(a.id)?.sentence ?? "",
    environment: a.environment,
    riskTier: a.riskTier,
    modelProvider: a.modelProvider,
    modelId: a.modelId,
    toolsCount: a.tools.filter((t) => !t.revokedAt).length,
    owner: names.get(a.businessOwnerId ?? "") ?? "",
    lastActivityAt: a.lastActivityAt?.toISOString() ?? null,
    requests: a._count.requests,
  }));
  const filters = { q: filter.q ?? "", status: filter.status ?? "", environment: filter.environment ?? "", riskTier: filter.riskTier ?? "" };
  return (
    <div>
      <PageHeader
        title="AI Agents"
        description="Every agent that can reach the Action Gateway, with its lifecycle state, autonomy posture, owners and tool access."
        badges={<DemoBadge show={c.org.demoMode} />}
        actions={
          <>
            <ExportCsvButton filter={Object.fromEntries(Object.entries(filters).filter(([, v]) => v))} disabled={page.total === 0} />
            <RegisterAgentDialog canWrite={canWrite} members={pickers.members.map((m) => ({ value: m.userId, label: m.name, description: m.roleName }))} teams={pickers.teams.map((t) => ({ value: t.id, label: t.name, description: t.key }))} />
          </>
        }
      />
      <AgentsTable rows={rows} pagination={{ page: page.page, pageSize: page.pageSize, total: page.total }} filters={filters} />
    </div>
  );
}
