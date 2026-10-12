import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { getApproval, isAegisError } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { userNames } from "@/server/queries/users";
import { approverOptions } from "@/server/queries/control";
import { explanationKey, ruleExplanations } from "@/server/queries/approvals";
import { actionNoun, describeRequest, keyParams } from "@/lib/describe-request";
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
      const [approvers, rules] = await Promise.all([approverOptions(db, c.ctx.orgId), ruleExplanations(db, [a])]);
      return { a, approvers, rule: rules.get(explanationKey(a)) ?? null };
    } catch (e) {
      if (isAegisError(e) && e.code === "not_found") return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { a, approvers, rule } = data;
  const names = await userNames([a.assignedUserId, a.escalatedToUserId, a.request.principalUserId, a.request.agent.businessOwnerId, a.request.agent.technicalOwnerId, ...a.responses.map((r) => [r.userId, r.targetUserId]).flat(), ...a.history.flatMap((h) => h.responses.map((r) => r.userId)), ...a.evidence.filter((e) => e.actorType === "user").map((e) => e.actorId)]);
  const currency = typeof c.org.settings.currency === "string" ? c.org.settings.currency : "AED";
  const kp = keyParams(a.request.params);
  const summary = describeRequest(a.request.toolKey, a.request.action, a.request.params, currency);
  const noun = actionNoun(a.request.toolKey);
  const isOpen = ["pending", "more_info", "escalated"].includes(a.status);
  const riskIndicators = Array.isArray(a.request.riskIndicators) ? (a.request.riskIndicators as string[]) : [];
  const canReassign = c.can("approvals:decide") && (c.can("users:write") || a.assignedUserId === c.session.user.id);
  const decision = a.request.decisions[0] ?? null;
  const explanation = (decision?.explanation ?? {}) as { decidingRule?: { policy: string; rule: string; effect: string } | null };
  const receipt = a.request.receipts[0] ?? null;
  const whoMayDecide = `${a.requiredApprovals} approval${a.requiredApprovals === 1 ? "" : "s"} ${a.requiredRoles.length ? `from ${a.requiredRoles.join(" or ")}` : "from anyone who may decide approvals"}. The agent's owners and the person who asked for this cannot approve it.`;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Approvals", href: "/approvals" }, { label: `Approval ${a.id.slice(0, 8)}` }]}
        title={`Requested ${noun}`}
        badges={
          <>
            <StatusBadge status={a.status} />
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
          </span>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="What is being asked" data-testid="approval-summary-card">
            <p className="text-lg font-semibold text-fg" data-testid="approval-sentence">
              {summary}
            </p>
            <KeyValue
              className="mt-3"
              columns={2}
              items={[
                { label: "Amount", value: kp.amount !== null ? <span className="text-base font-semibold tabular">{formatMoney(kp.amount, kp.currency ?? currency)}</span> : null },
                { label: "Customer", value: kp.customerId, mono: true },
                { label: "Order reference", value: kp.orderId, mono: true },
                { label: "Payment reference", value: kp.paymentIntentId, mono: true },
                { label: "Account", value: kp.toAccount, mono: true },
                { label: "Destination", value: kp.destination, mono: true },
                { label: "Reason given", value: kp.reason },
                { label: "Asked by", value: <Link href={`/agents/${a.request.agent.id}`} className="text-accent hover:underline">{a.request.agent.name}</Link> },
                { label: "On behalf of", value: a.request.principalUserId ? (names.get(a.request.principalUserId) ?? "user") : a.request.principalRef || null },
                { label: "Target system", value: a.tool?.integration ? <Link href={`/integrations/${a.tool.integration.id}`} className="text-accent hover:underline">{a.tool.integration.name}</Link> : null },
              ].filter((i) => i.value !== null && i.value !== undefined && i.value !== "")}
            />
            <div className="mt-3 rounded-md border border-line bg-bg px-3 py-2 text-sm">
              <div className="text-xs text-fg-dim">Justification from the agent</div>
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
          <Panel title="Why a person is needed" data-testid="approval-why">
            <div className="space-y-2 text-sm">
              {rule?.description || a.triggeringRuleId ? (
                <p>
                  {rule?.description ?? "A policy rule requires approval for this action."}
                  {rule?.policyName && rule.policyId ? (
                    <span className="text-fg-muted">
                      {" "}
                      (policy{" "}
                      <Link href={`/policies/${rule.policyId}?v=${rule.policyVersionId}&tab=rules`} className="text-accent hover:underline">
                        {rule.policyName} v{rule.version}
                      </Link>
                      )
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="text-fg-muted">Required by data protection settings{explanation.decidingRule ? ` after rule ${explanation.decidingRule.policy}/${explanation.decidingRule.rule}` : ""}.</p>
              )}
              {rule?.instructions || a.reason ? <p className="rounded-md border border-approval/30 bg-approval/5 px-3 py-2 text-xs text-fg">What to check before approving: {rule?.instructions ?? a.reason}</p> : null}
              <p className="text-xs text-fg-muted">Needs {whoMayDecide}</p>
              {a.escalatedToUserId ? <Badge tone="critical">Escalated to {names.get(a.escalatedToUserId) ?? "approver"}</Badge> : a.assignedUserId ? <Badge tone="info">Assigned to {names.get(a.assignedUserId) ?? "approver"}</Badge> : null}
            </div>
          </Panel>
          {receipt ? (
            <Panel title="What happened downstream">
              <p className="text-sm text-fg">
                {receipt.status === "succeeded" ? `Executed through ${receipt.downstreamSystem}.` : receipt.status === "failed" ? `The call to ${receipt.downstreamSystem} failed; nothing was changed there.` : receipt.status === "unknown" ? `${receipt.downstreamSystem} did not confirm the outcome. A person must check the system and settle the result from the action request.` : `Skipped: the call to ${receipt.downstreamSystem} was not made.`}
                {receipt.downstreamReference ? (
                  <>
                    {" "}
                    Reference <span className="font-mono">{receipt.downstreamReference}</span>.
                  </>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-fg-dim">{formatDateTime(receipt.createdAt)}</p>
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
          <details className="group rounded-panel border border-line bg-bg-elev" data-testid="technical-details">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-fg marker:text-fg-dim">
              Technical details
              <span className="ms-2 text-xs font-normal text-fg-muted">parameters, request hash, decision trace and evidence</span>
            </summary>
            <div className="space-y-4 border-t border-line p-4">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Request</h3>
                <KeyValue
                  className="mt-1"
                  columns={2}
                  items={[
                    { label: "Tool", value: a.tool ? `${a.tool.name} (${a.tool.key})` : a.request.toolKey, mono: true },
                    { label: "Action", value: a.request.action, mono: true },
                    { label: "Resource", value: a.request.resourceKey, mono: true },
                    { label: "Correlation id", value: a.request.correlationId, mono: true },
                    { label: "Agent risk tier", value: <Badge tone={statusTone(a.request.agent.riskTier)}>{statusLabel(a.request.agent.riskTier)}</Badge> },
                    { label: "Business owner", value: names.get(a.request.agent.businessOwnerId ?? "") ?? null },
                    { label: "Technical owner", value: names.get(a.request.agent.technicalOwnerId ?? "") ?? null },
                    { label: "Action request", value: <Link href={`/gateway/${a.actionRequestId}`} className="text-accent hover:underline">Open in the Action Gateway</Link> },
                  ]}
                />
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Parameters</h3>
                <p className="mb-1 text-xs text-fg-muted">Exactly what will execute. The hash is bound to the decision.</p>
                <CodeBlock code={JSON.stringify(a.request.params, null, 2)} />
                <p className="mt-2 font-mono text-[11px] text-fg-dim">request hash {a.requestHash}</p>
              </div>
              {decision ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Decision trace</h3>
                  <p className="mb-1 text-xs text-fg-muted">
                    Result <span className="font-mono">{decision.result}</span>, evaluator <span className="font-mono">{decision.evaluator}</span>, matched rules {decision.matchedRuleIds.length ? decision.matchedRuleIds.join(", ") : "none"}, {decision.latencyMs} ms.
                  </p>
                  <CodeBlock code={JSON.stringify(decision.explanation, null, 2)} copy={false} />
                </div>
              ) : null}
              {receipt ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Execution receipt</h3>
                  <CodeBlock className="mt-1" code={JSON.stringify(receipt.responseSummary, null, 2)} copy={false} />
                </div>
              ) : null}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Evidence</h3>
                <p className="mb-1 text-xs text-fg-muted">Ledger entries for correlation {a.request.correlationId}</p>
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
              </div>
            </div>
          </details>
        </div>
        <div className="space-y-4">
          <ApprovalDecisionForm approvalId={a.id} requestId={a.actionRequestId} requestHash={a.requestHash} canDecide={a.eligibility.canDecide} eligibilityReasons={a.eligibility.reasons} canReassign={canReassign && isOpen} approvers={approvers.filter((p) => p.userId !== c.session.user.id)} status={a.status} isOpen={isOpen} summary={summary} />
          <Panel title="Approval history for this agent" description="Last 10 other requests" padded={false}>
            {a.history.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-fg-dim">No other approval requests for this agent.</p>
            ) : (
              <SimpleTable caption="Approval history" className="rounded-none border-0">
                <thead>
                  <tr>
                    <Th>Request</Th>
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
                          <Link href={`/approvals/${h.id}`} className="text-xs text-accent hover:underline">
                            {describeRequest(h.request.toolKey, "", h.request.params, currency)}
                          </Link>
                        </Td>
                        <Td>{hp.amount !== null ? formatMoney(hp.amount, hp.currency ?? currency) : <span className="text-fg-dim">n/a</span>}</Td>
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
        </div>
      </div>
    </div>
  );
}
