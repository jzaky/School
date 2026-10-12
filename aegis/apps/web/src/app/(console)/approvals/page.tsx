import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { approvalListFilter, listApprovals } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { userNames } from "@/server/queries/users";
import { explanationKey, ruleExplanations } from "@/server/queries/approvals";
import { describeRequest, keyParams } from "@/lib/describe-request";
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
  const currency = typeof c.org.settings.currency === "string" ? c.org.settings.currency : "AED";
  const { page, counts, toolSystems, rules } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const [page, grouped, tools] = await Promise.all([
        listApprovals(db, c.ctx, filter),
        db.approvalRequest.groupBy({ by: ["status"], where: { orgId: c.ctx.orgId }, _count: { _all: true } }),
        db.tool.findMany({ where: { orgId: c.ctx.orgId }, select: { id: true, integration: { select: { name: true } } } }),
      ]);
      const rules = await ruleExplanations(db, page.items);
      const by = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Record<string, number>;
      const counts = { pending: (by.pending ?? 0) + (by.more_info ?? 0) + (by.escalated ?? 0), approved: by.approved ?? 0, rejected: by.rejected ?? 0, expired: by.expired ?? 0, all: grouped.reduce((n, g) => n + g._count._all, 0) };
      return { page, counts, toolSystems: new Map(tools.map((t) => [t.id, t.integration?.name ?? null])), rules };
    },
    { readOnly: true },
  );
  const names = await userNames(page.items.flatMap((a) => [a.assignedUserId, a.escalatedToUserId]));
  const rows: ApprovalRow[] = page.items.map((a) => {
    const kp = keyParams(a.request.params);
    const rule = rules.get(explanationKey(a));
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
      summary: describeRequest(a.request.toolKey, a.request.action, a.request.params, currency),
      targetSystem: a.request.toolId ? (toolSystems.get(a.request.toolId) ?? null) : null,
      amount: kp.amount,
      currency: kp.currency,
      destination: kp.destination,
      orderId: kp.orderId,
      customerId: kp.customerId,
      reason: kp.reason,
      toAccount: kp.toAccount,
      triggeringRule: a.triggeringRuleId,
      whyApproval: rule?.description ?? (a.reason || null),
      policyName: rule?.policyName ?? null,
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
      <PageHeader title="Approvals" description="Actions a policy stopped for a person. Approving runs exactly what is shown here; nothing runs while a request is pending, and an expired request can never be used." badges={<DemoBadge show={c.org.demoMode} />} actions={c.org.demoMode ? <LinkButton href="/gateway/demos">Run demo scenarios</LinkButton> : undefined} />
      <ApprovalsList rows={rows} status={filter.status} mine={filter.mine} counts={counts} pagination={{ page: page.page, pageSize: page.pageSize, total: page.total }} canDecide={c.can("approvals:decide")} />
    </div>
  );
}
