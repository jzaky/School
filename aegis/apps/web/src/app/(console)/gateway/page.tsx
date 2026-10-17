import type { Metadata } from "next";
import { FlaskConical } from "lucide-react";
import { withTenant } from "@aegis/db";
import { governanceMetrics, listActionRequests, requestListFilter } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { agentOptions, keyParams } from "@/server/queries/control";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { StatPanel } from "@/components/ui/stat-panel";
import { LinkButton } from "@/components/ui/link-button";
import { GatewayTable, type RequestRow } from "@/components/control/gateway-table";
import { EmergencyControls } from "@/components/control/emergency-controls";

export const metadata: Metadata = { title: "Action Gateway" };
export const dynamic = "force-dynamic";

export default async function GatewayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("gateway:read");
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = requestListFilter.safeParse(flat);
  const filter = parsed.success ? parsed.data : requestListFilter.parse({});
  const canControl = c.can("agents:control");
  const canAdmin = c.can("org:admin");
  const { page, today, agents, toolKeys, integrations } = await withTenant(c.ctx.orgId, async (db) => {
    const [page, today, agents, tools, integrations] = await Promise.all([
      listActionRequests(db, c.ctx, filter),
      governanceMetrics(db, c.ctx, 1),
      agentOptions(db, c.ctx.orgId),
      db.tool.findMany({ where: { orgId: c.ctx.orgId }, select: { key: true }, orderBy: { key: "asc" } }),
      canControl ? db.integration.findMany({ where: { orgId: c.ctx.orgId }, select: { id: true, name: true, key: true, status: true, credentials: { select: { id: true, name: true, revokedAt: true } } }, orderBy: { name: "asc" } }) : [],
    ]);
    return { page, today, agents, toolKeys: tools.map((t) => t.key), integrations };
  });
  const rows: RequestRow[] = page.items.map((r) => {
    const kp = keyParams(r.params);
    const d = r.decisions[0];
    const rc = r.receipts[0];
    return { id: r.id, createdAt: r.createdAt.toISOString(), agentName: r.agent.name, agentSlug: r.agent.slug, toolKey: r.toolKey, action: r.action, resourceKey: r.resourceKey, amount: kp.amount, currency: kp.currency, status: r.status, decision: d?.result ?? null, matchedRules: d?.matchedRuleIds ?? [], latencyMs: d?.latencyMs ?? null, receiptRef: rc?.downstreamReference ?? null, receiptStatus: rc?.status ?? null };
  });
  const filters = { status: filter.status ?? "", agentId: filter.agentId ?? "", tool: filter.tool ?? "", q: filter.q ?? "", since: typeof flat.since === "string" ? flat.since : "" };
  const settings = c.org.settings as { gatewayPaused?: boolean; gatewayPausedReason?: string; gatewayPausedBy?: string };
  const a = today.actions;
  return (
    <div>
      <PageHeader
        title="Action Gateway"
        description="The Action Gateway is the one door every agent action goes through. This page shows every action an agent tried, the decision it got and what was actually carried out. The figures below cover the last 24 hours."
        badges={<DemoBadge show={c.org.demoMode} />}
        actions={
          c.org.demoMode ? (
            <LinkButton href="/gateway/demos">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden />
              Run demo scenarios
            </LinkButton>
          ) : undefined
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatPanel label="Evaluated" value={a.evaluated} footer="Decisions in the last 24 hours" />
        <StatPanel label="Allowed" value={a.allowed} tone="allow" />
        <StatPanel label="Denied" value={a.denied} tone={a.denied > 0 ? "deny" : undefined} />
        <StatPanel label="Approval required" value={a.approvalRequired} tone={a.approvalRequired > 0 ? "approval" : undefined} footer={`${a.awaitingApproval} waiting for a person now`} />
        <StatPanel label="Executed" value={a.executed} tone="allow" />
        <StatPanel label="Failed" value={a.failed} tone={a.failed > 0 ? "deny" : undefined} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <GatewayTable rows={rows} pagination={{ page: page.page, pageSize: page.pageSize, total: page.total }} filters={filters} agents={agents.map((x) => ({ id: x.id, name: x.name }))} tools={toolKeys} />
        </div>
        <div>
          <EmergencyControls paused={!!settings.gatewayPaused} pausedReason={settings.gatewayPausedReason ?? null} pausedBy={settings.gatewayPausedBy ?? null} canAdmin={canAdmin} canControl={canControl} agents={agents.map((x) => ({ id: x.id, name: x.name, slug: x.slug, status: x.status, tools: x.tools }))} integrations={integrations.map((i) => ({ id: i.id, name: i.name, key: i.key, status: i.status, credentials: i.credentials.map((cr) => ({ id: cr.id, name: cr.name, revoked: !!cr.revokedAt })) }))} />
        </div>
      </div>
    </div>
  );
}
