import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { approvalListFilter, listApprovals } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { userNames } from "@/server/queries/users";
import { keyParams } from "@/server/queries/control";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { LinkButton } from "@/components/ui/link-button";
import { ApprovalsList, type ApprovalRow } from "@/components/control/approvals-list";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("gateway:read");
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = approvalListFilter.safeParse({ ...flat, mine: flat.mine === "1" || flat.mine === "true" });
  const filter = parsed.success ? parsed.data : approvalListFilter.parse({});
  const { page, counts, toolSystems } = await withTenant(c.ctx.orgId, async (db) => {
    const [page, grouped, tools] = await Promise.all([
      listApprovals(db, c.ctx, filter),
      db.approvalRequest.groupBy({ by: ["status"], where: { orgId: c.ctx.orgId }, _count: { _all: true } }),
      db.tool.findMany({ where: { orgId: c.ctx.orgId }, select: { id: true, integration: { select: { name: true } } } }),
    ]);
    const by = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Record<string, number>;
    const counts = { pending: (by.pending ?? 0) + (by.more_info ?? 0) + (by.escalated ?? 0), approved: by.approved ?? 0, rejected: by.rejected ?? 0, expired: by.expired ?? 0, all: grouped.reduce((n, g) => n + g._count._all, 0) };
    return { page, counts, toolSystems: new Map(tools.map((t) => [t.id, t.integration?.name ?? null])) };
  });
  const names = await userNames(page.items.flatMap((a) => [a.assignedUserId, a.escalatedToUserId]));
  const rows: ApprovalRow[] = page.items.map((a) => {
    const kp = keyParams(a.request.params);
    return {
      id: a.id,
      status: a.status,
      requestId: a.actionRequestId,
      agentId: a.request.agent.id,
      agentName: a.request.agent.name,
      agentSlug: a.request.agent.slug,
      riskTier: a.request.agent.riskTier,
      toolKey: a.request.toolKey,
      action: a.request.action,
      targetSystem: a.request.toolId ? (toolSystems.get(a.request.toolId) ?? null) : null,
      amount: kp.amount,
      currency: kp.currency,
      destination: kp.destination,
      orderId: kp.orderId,
      toAccount: kp.toAccount,
      triggeringRule: a.triggeringRuleId,
      riskIndicators: Array.isArray(a.request.riskIndicators) ? (a.request.riskIndicators as string[]) : [],
      justification: a.request.justification,
      expiresAt: a.expiresAt.toISOString(),
      createdAt: a.createdAt.toISOString(),
      decidedAt: a.decidedAt?.toISOString() ?? null,
      assignedTo: a.assignedUserId ? (names.get(a.assignedUserId) ?? "approver") : null,
      escalatedTo: a.escalatedToUserId ? (names.get(a.escalatedToUserId) ?? "approver") : null,
      requiredRoles: a.requiredRoles,
      responses: a.responses.length,
    };
  });
  return (
    <div>
      <PageHeader title="Human Approval Center" description="Actions a policy stopped for a person. Approval executes exactly what was presented; nothing runs while a request is pending, and expired requests can never be used." badges={<DemoBadge show={c.org.demoMode} />} actions={c.org.demoMode ? <LinkButton href="/gateway/demos">Run demo scenarios</LinkButton> : undefined} />
      <ApprovalsList rows={rows} status={filter.status} mine={filter.mine} counts={counts} pagination={{ page: page.page, pageSize: page.pageSize, total: page.total }} />
    </div>
  );
}
