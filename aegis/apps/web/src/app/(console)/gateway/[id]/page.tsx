import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { getActionRequest, isAegisError } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { userNames } from "@/server/queries/users";
import { keyParams } from "@/server/queries/control";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, StatusCell } from "@/components/ui/status";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { KeyValue } from "@/components/ui/key-value";
import { CodeBlock } from "@/components/ui/code-block";
import { Timeline } from "@/components/ui/timeline";
import { Countdown } from "@/components/ui/countdown";
import { Note } from "@/components/ui/note";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { DecisionPanel, type Explanation } from "@/components/control/decision-trace";
import { ExecutionControls } from "@/components/control/execution-controls";
import { HeldRequestPanel } from "@/components/control/held-request";
import { formatDateTime, formatMoney, timeAgo } from "@/lib/utils";
import { statusLabel } from "@/lib/status";

export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Request ${id.slice(0, 8)}` };
}

function evidenceTone(type: string) {
  if (/denied|failed|rejected|expired|conflict|mismatch/.test(type)) return "deny" as const;
  if (/allow|executed|approved|granted/.test(type)) return "allow" as const;
  if (/approval|pending|require/.test(type)) return "approval" as const;
  return "neutral" as const;
}

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePermission("gateway:read");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const data = await withTenant(c.ctx.orgId, async (db) => {
    try {
      const req = await getActionRequest(db, c.ctx, id);
      const versionIds = [...new Set(req.decisions.flatMap((d) => d.policyVersionIds))];
      const versions = versionIds.length ? await db.policyVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, version: true, policyId: true, policy: { select: { key: true } } } }) : [];
      const tool = req.toolId ? await db.tool.findUnique({ where: { id: req.toolId }, select: { name: true, integration: { select: { id: true, name: true, key: true } } } }) : null;
      return { req, versions, tool };
    } catch (e) {
      if (isAegisError(e) && e.code === "not_found") return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { req, versions, tool } = data;
  const names = await userNames([req.principalUserId, ...req.approvals.flatMap((a) => [a.assignedUserId, a.escalatedToUserId, ...a.responses.map((r) => r.userId)]), ...req.evidence.filter((e) => e.actorType === "user").map((e) => e.actorId)]);
  const policyLinks = new Map(versions.map((v) => [v.id, { policyId: v.policyId, key: v.policy.key, version: v.version }]));
  const decision = req.decisions.at(-1) ?? null;
  const explanation = ((decision?.explanation ?? {}) as Explanation) ?? {};
  const kp = keyParams(req.params);
  const ctx = (req.context ?? {}) as Record<string, unknown>;
  const riskIndicators = Array.isArray(req.riskIndicators) ? (req.riskIndicators as string[]) : [];
  const reasons: string[] = decision ? ((req.evidence.find((e) => e.type === `gateway.decision.${decision.result}`)?.payload as { reasons?: string[] } | undefined)?.reasons ?? []) : [];
  const shieldMasked = Array.isArray(explanation.shield) && explanation.shield.length > 0;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Action Gateway", href: "/gateway" }, { label: `Request ${req.id.slice(0, 8)}` }]}
        title={
          <span className="font-mono">
            {req.toolKey} / {req.action}
          </span>
        }
        badges={
          <>
            <StatusBadge status={req.status} />
            {decision ? <StatusBadge status={decision.result} label={`Decision: ${statusLabel(decision.result)}`} /> : null}
            <Badge>{statusLabel(req.environment)}</Badge>
            <DemoBadge show={c.org.demoMode} />
          </>
        }
        description={
          <>
            Requested {formatDateTime(req.createdAt)} by{" "}
            <Link href={`/agents/${req.agent.id}`} className="text-accent hover:underline">
              {req.agent.name}
            </Link>
            {kp.amount !== null ? <span className="ms-2 font-medium text-fg">{formatMoney(kp.amount, kp.currency ?? "AED")}</span> : null}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Request" className="xl:col-span-2">
          <KeyValue
            columns={2}
            items={[
              { label: "Agent", value: <Link href={`/agents/${req.agent.id}`} className="text-accent hover:underline">{req.agent.name}</Link> },
              { label: "Agent status", value: <StatusCell status={req.agent.status} /> },
              { label: "Tool", value: tool ? `${tool.name} (${req.toolKey})` : req.toolKey, mono: !tool },
              { label: "Action", value: req.action, mono: true },
              { label: "Integration", value: tool?.integration ? <Link href={`/integrations/${tool.integration.id}`} className="text-accent hover:underline">{tool.integration.name}</Link> : null },
              { label: "Resource", value: req.resourceKey, mono: true },
              { label: "On behalf of (principal)", value: req.principalUserId ? (names.get(req.principalUserId) ?? req.principalUserId) : req.principalRef || null },
              { label: "Environment", value: statusLabel(req.environment) },
              { label: "Trace reference (correlation id)", value: req.correlationId, mono: true },
              { label: "Duplicate guard (idempotency key)", value: req.idempotencyKey, mono: true },
              { label: "Parameter fingerprint (params hash)", value: req.paramsHash, mono: true },
              { label: "Execution mode", value: typeof ctx.executionMode === "string" ? ctx.executionMode : "gateway" },
              { label: "Completed", value: req.completedAt ? formatDateTime(req.completedAt) : null },
              { label: "Risk indicators", value: riskIndicators.length ? <span className="flex flex-wrap justify-end gap-1">{riskIndicators.map((r) => <Badge key={r} tone="approval" mono>{r}</Badge>)}</span> : null },
            ]}
          />
          {req.justification ? (
            <div className="mt-3 rounded-md border border-line bg-bg px-3 py-2 text-sm">
              <div className="text-xs text-fg-dim">The agent&apos;s business reason</div>
              {req.justification}
            </div>
          ) : null}
        </Panel>
        <Panel title="Parameters" description={shieldMasked ? "Shield, the data protection check, inspected these values; sensitive ones may be hidden." : "The exact values the agent sent, checked against the format the tool expects (its schema)"}>
          <CodeBlock code={JSON.stringify(req.params, null, 2)} />
          {Object.keys(ctx).filter((k) => k !== "executionMode" && k !== "ip").length ? <CodeBlock className="mt-3" label="Caller context" code={JSON.stringify(Object.fromEntries(Object.entries(ctx).filter(([k]) => k !== "executionMode" && k !== "ip")), null, 2)} /> : null}
        </Panel>

        <Panel title="Decision" description="The same request always gets the same answer, and every rule and comparison that led to it is recorded" className="xl:col-span-3">
          {decision ? <DecisionPanel result={decision.result} explanation={explanation} reasons={reasons} policyVersionIds={decision.policyVersionIds} policyLinks={policyLinks} latencyMs={decision.latencyMs} /> : <Note tone="warning">No decision recorded for this request.</Note>}
        </Panel>

        {req.approvals.length ? (
          <Panel title="Approval" className="xl:col-span-2">
            {req.approvals.map((a) => (
              <div key={a.id} className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={a.status} />
                  <Link href={`/approvals/${a.id}`} className="text-sm text-accent hover:underline">
                    Open in Approval Center
                  </Link>
                  <span className="text-xs text-fg-muted">
                    Needs {a.requiredApprovals} approval{a.requiredApprovals === 1 ? "" : "s"}
                    {a.requiredRoles.length ? ` from ${a.requiredRoles.join(" or ")}` : ""}
                  </span>
                  {["pending", "more_info", "escalated"].includes(a.status) ? (
                    <span className="text-xs text-fg-muted">
                      Expires in <Countdown until={a.expiresAt} />
                    </span>
                  ) : (
                    <span className="text-xs text-fg-dim">Expiry {formatDateTime(a.expiresAt)}</span>
                  )}
                </div>
                {a.triggeringRuleId ? (
                  <p className="text-xs text-fg-muted">
                    Triggered by <span className="font-mono">{a.triggeringRuleId}</span>
                    {a.reason ? `: ${a.reason}` : ""}
                  </p>
                ) : null}
                {a.assignedUserId || a.escalatedToUserId ? <p className="text-xs text-fg-muted">{a.escalatedToUserId ? `Escalated to ${names.get(a.escalatedToUserId) ?? "approver"}` : `Assigned to ${names.get(a.assignedUserId!) ?? "approver"}`}</p> : null}
                <Timeline
                  emptyText="No responses yet"
                  items={a.responses.map((r) => ({
                    id: r.id,
                    tone: r.decision === "approve" ? ("allow" as const) : r.decision === "reject" ? ("deny" as const) : ("approval" as const),
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
              </div>
            ))}
          </Panel>
        ) : null}

        <Panel title="Execution" description="A one-time permission slip (grant) is tied to this exact request before anything runs, and the receipt comes back from the other system" className={req.approvals.length ? "" : "xl:col-span-2"}>
          <div className="mb-3 space-y-3">
            <HeldRequestPanel requestId={req.id} status={req.status} decision={decision?.result ?? ""} restrictions={((decision?.explanation ?? {}) as { restrictions?: string[] }).restrictions ?? []} moreInformation={((decision?.explanation ?? {}) as { moreInformation?: { fields: string[]; message: string } | null }).moreInformation ?? null} canRelease={c.can("security:write")} />
            <ExecutionControls requestId={req.id} status={req.status} canControl={c.can("agents:control")} canDecide={c.can("approvals:decide")} downstreamKind={req.receipts[0]?.downstreamSystem?.endsWith("-sim") ? "simulated" : req.receipts[0] ? "sandbox" : null} />
          </div>
          {req.grants.length === 0 && req.receipts.length === 0 ? (
            <p className="text-xs text-fg-dim">Nothing has run. {req.status === "denied" ? "A refused request never reaches the other system." : req.status === "pending_approval" ? "Waiting for a person to approve it." : req.status === "approved" ? "Approved; it has not started running yet." : ""}</p>
          ) : (
            <div className="space-y-3">
              {req.grants.length ? (
                <SimpleTable caption="One-time permission slips (execution grants)">
                  <thead>
                    <tr>
                      <Th>Grant</Th>
                      <Th>Issued</Th>
                      <Th>Expires</Th>
                      <Th>State</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {req.grants.map((g) => (
                      <Tr key={g.id}>
                        <Td mono>{g.id.slice(0, 8)}</Td>
                        <Td>{formatDateTime(g.createdAt)}</Td>
                        <Td>{formatDateTime(g.expiresAt)}</Td>
                        <Td>{g.consumedAt ? <Badge tone="allow">used {timeAgo(g.consumedAt)}</Badge> : g.voidedAt ? <Badge tone="deny">cancelled: {g.voidReason ?? "withdrawn"}</Badge> : g.expiresAt < new Date() ? <Badge>expired unused</Badge> : <Badge tone="info">ready to use</Badge>}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </SimpleTable>
              ) : null}
              {req.receipts.map((r) => (
                <div key={r.id} className="rounded-md border border-line bg-bg p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={r.status === "succeeded" ? "executed" : r.status === "unknown" ? "unknown" : r.status} />
                    {r.attempt > 1 ? <Badge>attempt {r.attempt}</Badge> : null}
                    <span className="text-fg-muted">via</span>
                    <span className="font-mono">{r.downstreamSystem}</span>
                    {r.downstreamReference ? (
                      <>
                        <span className="text-fg-muted">reference</span>
                        <span className="font-mono text-fg">{r.downstreamReference}</span>
                      </>
                    ) : null}
                    <span className="ms-auto tabular text-fg-dim">
                      {r.durationMs} ms · {formatDateTime(r.createdAt)}
                    </span>
                  </div>
                  <CodeBlock className="mt-2" code={JSON.stringify(r.responseSummary, null, 2)} copy={false} />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Evidence" description={`Entries in the record (ledger) that share trace reference ${req.correlationId}`} className="xl:col-span-3">
          <Timeline
            emptyText="No record entries for this trace reference"
            items={req.evidence.map((e) => ({
              id: e.id,
              tone: evidenceTone(e.type),
              title: (
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="font-mono text-xs">{e.type}</span>
                  <span className="text-fg-dim">by</span>
                  <span>{e.actorType === "user" ? (names.get(e.actorId ?? "") ?? "User") : e.actorType === "agent" ? req.agent.name : e.actorType}</span>
                </span>
              ),
              meta: (
                <span className="font-mono">
                  seq {e.seq.toString()} · {e.hash.slice(0, 16)}
                </span>
              ),
              time: <span title={formatDateTime(e.occurredAt)}>{timeAgo(e.occurredAt)}</span>,
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}
