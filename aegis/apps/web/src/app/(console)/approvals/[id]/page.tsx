import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { getApproval, isAegisError } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { userNames } from "@/server/queries/users";
import { approverOptions, keyParams } from "@/server/queries/control";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, StatusCell } from "@/components/ui/status";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { KeyValue } from "@/components/ui/key-value";
import { CodeBlock } from "@/components/ui/code-block";
import { Timeline } from "@/components/ui/timeline";
import { Countdown } from "@/components/ui/countdown";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { ApprovalDecisionForm } from "@/components/control/approval-decision";
import { formatDateTime, formatMoney, timeAgo } from "@/lib/utils";
import { statusLabel, statusTone } from "@/lib/status";

export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Approval ${id.slice(0, 8)}` };
}

export default async function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePermission("gateway:read");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const data = await withTenant(c.ctx.orgId, async (db) => {
    try {
      const a = await getApproval(db, c.ctx, id);
      const approvers = await approverOptions(db, c.ctx.orgId);
      return { a, approvers };
    } catch (e) {
      if (isAegisError(e) && e.code === "not_found") return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { a, approvers } = data;
  const names = await userNames([a.assignedUserId, a.escalatedToUserId, a.request.principalUserId, a.request.agent.businessOwnerId, a.request.agent.technicalOwnerId, ...a.responses.map((r) => [r.userId, r.targetUserId]).flat(), ...a.history.flatMap((h) => h.responses.map((r) => r.userId)), ...a.evidence.filter((e) => e.actorType === "user").map((e) => e.actorId)]);
  const kp = keyParams(a.request.params);
  const isOpen = ["pending", "more_info", "escalated"].includes(a.status);
  const riskIndicators = Array.isArray(a.request.riskIndicators) ? (a.request.riskIndicators as string[]) : [];
  const canReassign = c.can("approvals:decide") && (c.can("users:write") || a.assignedUserId === c.session.user.id);
  const decision = a.request.decisions[0] ?? null;
  const explanation = (decision?.explanation ?? {}) as { decidingRule?: { policy: string; rule: string; effect: string } | null };
  const receipt = a.request.receipts[0] ?? null;
  const ruleId = a.triggeringRuleId?.split("/").pop() ?? null;
  const ruleDoc = a.policyVersion ? ((a.policyVersion.document as { rules?: { id: string; description?: string; approval?: { instructions?: string; roles?: string[] } }[] }).rules ?? []).find((r) => r.id === ruleId) : undefined;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Approvals", href: "/approvals" }, { label: `Approval ${a.id.slice(0, 8)}` }]}
        title={
          <>
            {a.request.agent.name} <span className="text-fg-dim">wants to</span> <span className="font-mono">{a.request.toolKey}</span>
          </>
        }
        badges={
          <>
            <StatusBadge status={a.status} />
            {kp.amount !== null ? <Badge tone="approval" className="text-sm">{formatMoney(kp.amount, kp.currency ?? "AED")}</Badge> : null}
            <DemoBadge show={c.org.demoMode} />
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3">
            <span>Requested {formatDateTime(a.createdAt)}</span>
            {isOpen ? (
              <span>
                Expires in <Countdown until={a.expiresAt} className="font-medium" />
              </span>
            ) : (
              <span>{a.decidedAt ? `Decided ${formatDateTime(a.decidedAt)}` : `Expired ${formatDateTime(a.expiresAt)}`}</span>
            )}
            <Link href={`/gateway/${a.actionRequestId}`} className="text-accent hover:underline">
              Open the action request
            </Link>
          </span>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="What the agent asked for">
            <KeyValue
              columns={2}
              items={[
                { label: "Agent", value: <Link href={`/agents/${a.request.agent.id}`} className="text-accent hover:underline">{a.request.agent.name}</Link> },
                { label: "Agent risk tier", value: <Badge tone={statusTone(a.request.agent.riskTier)}>{statusLabel(a.request.agent.riskTier)}</Badge> },
                { label: "Tool", value: a.tool ? `${a.tool.name} (${a.tool.key})` : a.request.toolKey },
                { label: "Action", value: a.request.action, mono: true },
                { label: "Target system", value: a.tool?.integration ? <Link href={`/integrations/${a.tool.integration.id}`} className="text-accent hover:underline">{a.tool.integration.name}</Link> : null },
                { label: "Resource", value: a.request.resourceKey, mono: true },
                { label: "Principal", value: a.request.principalUserId ? (names.get(a.request.principalUserId) ?? "user") : a.request.principalRef || null },
                { label: "Correlation id", value: a.request.correlationId, mono: true },
                { label: "Business owner", value: names.get(a.request.agent.businessOwnerId ?? "") ?? null },
                { label: "Technical owner", value: names.get(a.request.agent.technicalOwnerId ?? "") ?? null },
              ]}
            />
            <div className="mt-3 rounded-md border border-line bg-bg px-3 py-2 text-sm">
              <div className="text-xs text-fg-dim">Business justification</div>
              {a.request.justification || <span className="text-fg-dim">none given</span>}
            </div>
            {riskIndicators.length ? (
              <div className="mt-3 flex flex-wrap items-center gap-1 text-xs">
                <span className="text-fg-dim">Risk indicators:</span>
                {riskIndicators.map((r) => (
                  <Badge key={r} tone="approval" mono>
                    {r}
                  </Badge>
                ))}
              </div>
            ) : null}
          </Panel>
          <Panel title="Parameters" description="Exactly what will execute. The hash below is bound to your decision.">
            <CodeBlock code={JSON.stringify(a.request.params, null, 2)} />
            <p className="mt-2 font-mono text-[11px] text-fg-dim">request hash {a.requestHash}</p>
          </Panel>
          <Panel title="Why a human is needed">
            <div className="space-y-2 text-sm">
              {a.triggeringRuleId ? (
                <p>
                  Rule <span className="font-mono">{a.triggeringRuleId}</span>
                  {a.policyVersion ? (
                    <>
                      {" "}
                      in{" "}
                      <Link href={`/policies/${a.policyVersion.policyId}?v=${a.policyVersion.id}&tab=rules`} className="text-accent hover:underline">
                        {a.policyVersion.policy.name} v{a.policyVersion.version}
                      </Link>
                    </>
                  ) : null}
                  {ruleDoc?.description ? <span className="text-fg-muted">: {ruleDoc.description}</span> : null}
                </p>
              ) : (
                <p className="text-fg-muted">Required by data protection settings{explanation.decidingRule ? ` after rule ${explanation.decidingRule.policy}/${explanation.decidingRule.rule}` : ""}.</p>
              )}
              {a.reason ? <p className="rounded-md border border-approval/30 bg-approval/5 px-3 py-2 text-xs text-fg">Instructions to approvers: {a.reason}</p> : null}
              <p className="text-xs text-fg-muted">
                Needs {a.requiredApprovals} approval{a.requiredApprovals === 1 ? "" : "s"}
                {a.requiredRoles.length ? ` from ${a.requiredRoles.join(" or ")}` : " from anyone with approvals:decide"}. Separation of duties: agent owners and the requesting principal cannot approve.
              </p>
              {a.escalatedToUserId ? <Badge tone="critical">Escalated to {names.get(a.escalatedToUserId) ?? "approver"}</Badge> : a.assignedUserId ? <Badge tone="info">Assigned to {names.get(a.assignedUserId) ?? "approver"}</Badge> : null}
            </div>
          </Panel>
          {receipt ? (
            <Panel title="Execution receipt">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusBadge status={receipt.status === "succeeded" ? "executed" : receipt.status} />
                <span className="text-fg-muted">via</span>
                <span className="font-mono">{receipt.downstreamSystem}</span>
                {receipt.downstreamReference ? (
                  <>
                    <span className="text-fg-muted">reference</span>
                    <span className="font-mono text-fg">{receipt.downstreamReference}</span>
                  </>
                ) : null}
                <span className="ms-auto text-fg-dim">{formatDateTime(receipt.createdAt)}</span>
              </div>
              <CodeBlock className="mt-2" code={JSON.stringify(receipt.responseSummary, null, 2)} copy={false} />
            </Panel>
          ) : null}
          <Panel title="Responses">
            <Timeline
              emptyText="No responses yet"
              items={a.responses.map((r) => ({
                id: r.id,
                tone: r.decision === "approve" ? ("allow" as const) : r.decision === "reject" ? ("deny" as const) : r.decision === "info_provided" ? ("info" as const) : ("approval" as const),
                title: (
                  <span>
                    <span className="font-medium">{names.get(r.userId) ?? "User"}</span> <span className="text-fg-muted">{statusLabel(r.decision).toLowerCase()}</span>
                    {r.targetUserId ? <span className="text-fg-muted"> to {names.get(r.targetUserId) ?? "approver"}</span> : null}
                  </span>
                ),
                meta: r.comment || undefined,
                time: <span title={formatDateTime(r.createdAt)}>{timeAgo(r.createdAt)}</span>,
              }))}
            />
          </Panel>
        </div>
        <div className="space-y-4">
          <ApprovalDecisionForm approvalId={a.id} requestId={a.actionRequestId} requestHash={a.requestHash} canDecide={a.eligibility.canDecide} eligibilityReasons={a.eligibility.reasons} canReassign={canReassign && isOpen} approvers={approvers.filter((p) => p.userId !== c.session.user.id)} status={a.status} isOpen={isOpen} />
          <Panel title="Approval history for this agent" description="Last 10 other requests" padded={false}>
            {a.history.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-fg-dim">No other approval requests for this agent.</p>
            ) : (
              <SimpleTable caption="Approval history" className="rounded-none border-0">
                <thead>
                  <tr>
                    <Th>Tool</Th>
                    <Th>Amount</Th>
                    <Th>Status</Th>
                    <Th>When</Th>
                  </tr>
                </thead>
                <tbody>
                  {a.history.map((h) => {
                    const hp = keyParams(h.request.params);
                    return (
                      <Tr key={h.id}>
                        <Td>
                          <Link href={`/approvals/${h.id}`} className="font-mono text-xs text-accent hover:underline">
                            {h.request.toolKey}
                          </Link>
                        </Td>
                        <Td>{hp.amount !== null ? formatMoney(hp.amount, hp.currency ?? "AED") : <span className="text-fg-dim">n/a</span>}</Td>
                        <Td>
                          <StatusCell status={h.status} />
                        </Td>
                        <Td className="text-xs text-fg-muted" title={formatDateTime(h.createdAt)}>
                          {timeAgo(h.createdAt)}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </SimpleTable>
            )}
          </Panel>
          <Panel title="Evidence" description={`Ledger entries for correlation ${a.request.correlationId.slice(0, 18)}`}>
            <Timeline
              emptyText="No evidence recorded"
              items={a.evidence.map((e) => ({
                id: e.id,
                tone: /denied|failed|rejected|expired|mismatch/.test(e.type) ? ("deny" as const) : /executed|approved|granted|allow/.test(e.type) ? ("allow" as const) : /approval/.test(e.type) ? ("approval" as const) : ("neutral" as const),
                title: (
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="font-mono text-xs">{e.type}</span>
                    <span className="text-fg-dim">by</span>
                    <span>{e.actorType === "user" ? (names.get(e.actorId ?? "") ?? "User") : e.actorType === "agent" ? a.request.agent.name : e.actorType}</span>
                  </span>
                ),
                meta: <span className="font-mono">seq {e.seq.toString()} · {e.hash.slice(0, 12)}</span>,
                time: <span title={formatDateTime(e.occurredAt)}>{timeAgo(e.occurredAt)}</span>,
              }))}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
