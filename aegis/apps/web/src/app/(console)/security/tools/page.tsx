import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { listToolSecurityOverview } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { agentPicks, resourcePicks } from "@/server/queries/shield";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { StatPanel } from "@/components/ui/stat-panel";
import { ToolsTable, type ToolRow } from "@/components/shield/tools-table";
import { EvaluateToolForm } from "@/components/shield/evaluate-tool-form";

export const metadata: Metadata = { title: "Tool Security" };
export const dynamic = "force-dynamic";

export default async function ToolSecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("security:read");
  const sp = await searchParams;
  const { tools, agents, resources } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const [tools, agents, resources] = await Promise.all([listToolSecurityOverview(db, c.ctx), agentPicks(db, c.ctx.orgId), resourcePicks(db, c.ctx.orgId)]);
      return { tools, agents, resources };
    },
    { readOnly: true },
  );
  const rows: ToolRow[] = tools.map((t) => ({ ...t, recentSecurityEvents: t.recentSecurityEvents.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })) }));
  const unrestricted = rows.filter((t) => t.allowedDomains.length === 0 && t.allowedResourceKeys.length === 0).length;
  const denied = rows.reduce((a, t) => a + t.deniedCount7d, 0);
  const requests = rows.reduce((a, t) => a + t.requestCount7d, 0);
  const initialAgent = typeof sp.agentId === "string" ? sp.agentId : undefined;
  const initialTool = typeof sp.tool === "string" ? sp.tool : undefined;
  return (
    <div>
      <PageHeader title="Tool Security" description="Every tool agents can use, with which agents may use it, where it may send data, which resources it may touch and how often it was refused recently. You can also test a hypothetical call against the same checks the Action Gateway runs." badges={<DemoBadge show={c.org.demoMode} />} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPanel label="Tools" value={rows.length} footer={`${rows.filter((t) => t.enabled).length} enabled`} />
        <StatPanel label="Without restrictions" value={unrestricted} tone={unrestricted > 0 ? "approval" : "allow"} footer="No list of allowed destinations or resources" />
        <StatPanel label="Requests, 7 days" value={requests} />
        <StatPanel label="Denied, 7 days" value={denied} tone={denied > 0 ? "deny" : "neutral"} footer={requests ? `${Math.round((denied / requests) * 100)}% of requests` : undefined} />
      </div>
      <div className="space-y-4">
        <ToolsTable rows={rows} />
        <EvaluateToolForm agents={agents.map((a) => ({ id: a.id, name: a.name, slug: a.slug, status: a.status }))} tools={rows.map((t) => ({ key: t.key, name: t.name }))} resources={resources} initial={{ agentId: initialAgent, toolKey: initialTool }} />
      </div>
    </div>
  );
}
