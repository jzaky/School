import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { alertFilter, listAlerts } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { userNames } from "@/server/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { LinkButton } from "@/components/ui/link-button";
import { AlertsView, type AlertRow } from "@/components/control/alerts-view";

export const metadata: Metadata = { title: "Alerts" };
export const dynamic = "force-dynamic";

export default async function AlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("monitoring:read");
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = alertFilter.safeParse({ ...flat, pageSize: flat.pageSize ?? 25 });
  const filter = parsed.success ? parsed.data : alertFilter.parse({ pageSize: 25 });
  const focus = typeof flat.focus === "string" ? flat.focus : undefined;
  const { page, counts } = await withTenant(c.ctx.orgId, async (db) => {
    let page = await listAlerts(db, c.ctx, filter);
    // A notification deep link may point at an alert outside the current tab; show it with "all".
    if (focus && !page.items.some((a) => a.id === focus) && filter.status !== "all") {
      const focused = await db.alert.findUnique({ where: { id: focus }, include: { rule: { select: { key: true, name: true, description: true } } } });
      if (focused) {
        const agent = focused.agentId ? await db.agent.findUnique({ where: { id: focused.agentId }, select: { id: true, name: true, slug: true } }) : null;
        page = { ...page, items: [{ ...focused, agent }, ...page.items] };
      }
    }
    const grouped = await db.alert.groupBy({ by: ["status"], where: { orgId: c.ctx.orgId }, _count: { _all: true } });
    const by = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Record<string, number>;
    return { page, counts: { open: by.open ?? 0, acknowledged: by.acknowledged ?? 0, resolved: by.resolved ?? 0, all: grouped.reduce((n, g) => n + g._count._all, 0) } };
  });
  const names = await userNames(page.items.flatMap((a) => [a.acknowledgedBy, a.resolvedBy]));
  const rows: AlertRow[] = page.items.map((a) => {
    const d = (a.detail ?? {}) as Record<string, unknown>;
    return {
      id: a.id,
      severity: a.severity,
      status: a.status,
      title: a.title,
      ruleKey: a.rule?.key ?? null,
      ruleName: a.rule?.name ?? null,
      ruleDescription: a.rule?.description ?? null,
      agentId: a.agentId,
      agentName: a.agent?.name ?? null,
      createdAt: a.createdAt.toISOString(),
      acknowledgedBy: a.acknowledgedBy ? (names.get(a.acknowledgedBy) ?? "user") : null,
      resolvedBy: a.resolvedBy ? (names.get(a.resolvedBy) ?? "user") : null,
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
      detail: JSON.stringify(a.detail ?? {}, null, 2),
      requestIds: Array.isArray(d.requestIds) ? (d.requestIds as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 10) : [],
      approvalRequestId: typeof d.approvalRequestId === "string" ? d.approvalRequestId : null,
      autoResponse: d.autoResponse && typeof d.autoResponse === "object" ? (d.autoResponse as { action: string; outcome: string; note: string }) : null,
    };
  });
  return (
    <div>
      <PageHeader title="Alerts" description="Raised by deterministic monitoring rules over this organization's records. Each alert carries the definition and counts that produced it." badges={<DemoBadge show={c.org.demoMode} />} actions={<LinkButton href="/monitoring">Manage rules</LinkButton>} />
      <AlertsView rows={rows} status={filter.status} severity={filter.severity ?? ""} counts={counts} pagination={{ page: page.page, pageSize: page.pageSize, total: page.total }} canWrite={c.can("monitoring:write")} focus={focus} />
    </div>
  );
}
