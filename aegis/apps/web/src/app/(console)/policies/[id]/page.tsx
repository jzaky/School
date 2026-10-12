import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { extractRefundSettings, getPolicy, isAegisError, listPolicyHistory, policyDocumentSchema, refundDocumentMatchesSettings, type PolicyDocument } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { userNames } from "@/server/queries/users";
import { agentOptions, teamOptions, toolOptions } from "@/server/queries/control";
import { approverRoleOptions } from "@/server/queries/policy-roles";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { Timeline } from "@/components/ui/timeline";
import { UrlTabs } from "@/components/ui/url-tabs";
import { Note } from "@/components/ui/note";
import { RulesView } from "@/components/control/rules-view";
import { PolicyEditor } from "@/components/control/policy-editor";
import { PolicySimulator } from "@/components/control/policy-simulator";
import { PolicyVersionsTable, type PolicyVersionRow } from "@/components/control/policy-versions";
import { AssignPolicyDialog, AssignmentsTable } from "@/components/control/policy-assignments";
import { PolicyActions } from "@/components/control/policy-actions";
import { RefundThresholdsPanel } from "@/components/control/policy-thresholds";
import { RefundTester } from "@/components/control/policy-refund-form";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { statusLabel } from "@/lib/status";

export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Policy ${id.slice(0, 8)}` };
}

function historyTone(type: string) {
  if (type === "activated" || type === "created") return "allow" as const;
  if (type === "deactivated") return "deny" as const;
  if (type === "rolled_back") return "approval" as const;
  if (type === "submitted") return "info" as const;
  return "neutral" as const;
}

export default async function PolicyDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; v?: string }> }) {
  const c = await requirePermission("policies:read");
  const { id } = await params;
  const { tab, v } = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const data = await withTenant(c.ctx.orgId, async (db) => {
    try {
      const policy = await getPolicy(db, c.ctx, id);
      const [agents, teams, tools, history, roles] = await Promise.all([agentOptions(db, c.ctx.orgId), teamOptions(db, c.ctx.orgId), toolOptions(db, c.ctx.orgId), listPolicyHistory(db, c.ctx, { policyId: id, limit: 100 }), approverRoleOptions(db, c.ctx.orgId)]);
      return { policy, agents, teams, tools, history, roles };
    } catch (e) {
      if (isAegisError(e) && e.code === "not_found") return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { policy, agents, teams, tools, history, roles } = data;
  const names = await userNames([policy.createdBy, ...policy.versions.flatMap((x) => [x.createdBy, x.approvedBy]), ...history.map((h) => h.actorId)]);
  const selected = (v && policy.versions.find((x) => x.id === v)) || (policy.currentVersionId ? policy.versions.find((x) => x.id === policy.currentVersionId) : undefined) || policy.versions[0] || null;
  const parsed = selected ? policyDocumentSchema.safeParse(selected.document) : null;
  const doc: PolicyDocument | null = parsed?.success ? parsed.data : null;
  const canWrite = c.can("policies:write");
  const canActivate = c.can("policies:activate");
  const fourEyes = c.org.settings.policyFourEyes !== false;
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const versionRows: PolicyVersionRow[] = policy.versions.map((x) => ({ id: x.id, version: x.version, state: x.state, changeNote: x.changeNote, createdByName: names.get(x.createdBy ?? "") ?? "system", approvedByName: x.approvedBy ? (names.get(x.approvedBy) ?? "user") : null, activatedAt: x.activatedAt?.toISOString() ?? null, retiredAt: x.retiredAt?.toISOString() ?? null, createdAt: x.createdAt.toISOString(), contentHash: x.contentHash }));
  const assignmentRows = policy.assignments.map((a) => ({ id: a.id, targetType: a.targetType, targetId: a.targetId, targetLabel: a.targetType === "org" ? c.org.name : a.targetType === "team" ? (teamById.get(a.targetId ?? "")?.name ?? "Unknown team") : (agentById.get(a.targetId ?? "")?.name ?? "Unknown agent"), priority: a.priority, createdAt: a.createdAt.toISOString() }));
  const defaultTool = doc?.appliesTo.tools[0] ?? tools[0]?.key ?? "issue-refund";
  const defaultParams = defaultTool === "initiate-transfer" ? '{\n  "amount": 250000,\n  "currency": "AED",\n  "toAccount": "AE45 0030 0000 9876 5432 100"\n}' : defaultTool === "issue-refund" ? '{\n  "amount": 1200,\n  "currency": "AED",\n  "orderId": "ORD-1001"\n}' : "{\n  \n}";
  const versionLabel = selected ? `v${selected.version} (${statusLabel(selected.state)})` : "no version";
  // Guided refund policies: the template settings travel with the document under meta.template.
  const refundSettings = doc ? extractRefundSettings(doc) : null;
  const refundDiverged = refundSettings ? !refundDocumentMatchesSettings(doc) : false;
  const toolsLite = tools.map((t) => ({ key: t.key, name: t.name }));

  const rulesTab = !selected ? (
    <Note tone="warning">This policy has no versions.</Note>
  ) : doc ? (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        Showing {versionLabel}
        {selected.id !== policy.currentVersionId && policy.currentVersionId ? <span>(the active version is v{policy.versions.find((x) => x.id === policy.currentVersionId)?.version})</span> : null}
        <span className="ms-auto">Select another version in the Versions tab.</span>
      </div>
      <RulesView doc={doc} />
    </div>
  ) : (
    <Note tone="danger">The stored document of {versionLabel} does not validate against the current schema: {parsed && !parsed.success ? parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join("; ") : ""}</Note>
  );

  const historyTab = (
    <Panel>
      <Timeline
        emptyText="No history recorded"
        items={history.map((h) => {
          const ver = policy.versions.find((x) => x.id === h.versionId);
          return {
            id: h.id,
            tone: historyTone(h.type),
            title: (
              <span className="flex flex-wrap items-center gap-x-2">
                <Badge tone={historyTone(h.type)}>{statusLabel(h.type)}</Badge>
                {ver ? <span className="font-mono text-xs">v{ver.version}</span> : null}
                <span className="text-fg-dim">by</span>
                <span>{names.get(h.actorId ?? "") ?? "system"}</span>
              </span>
            ),
            meta: h.note || undefined,
            time: <span title={formatDateTime(h.createdAt)}>{timeAgo(h.createdAt)}</span>,
          };
        })}
      />
    </Panel>
  );

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Policies", href: "/policies" }, { label: policy.name }]}
        title={policy.name}
        badges={
          <>
            {selected ? <StatusBadge status={selected.state} label={`v${selected.version}: ${statusLabel(selected.state)}`} /> : null}
            {policy.currentVersionId ? <Badge tone="allow">Active v{policy.versions.find((x) => x.id === policy.currentVersionId)?.version}</Badge> : <Badge>No active version</Badge>}
            <Badge>{statusLabel(policy.category)}</Badge>
            <DemoBadge show={c.org.demoMode} />
          </>
        }
        description={
          <>
            {policy.description || null}
            <span className="block font-mono text-xs text-fg-dim">
              {policy.key} · {policy.decisionCount} decisions used versions of this policy
            </span>
          </>
        }
        actions={
          <>
            <PolicyActions policyId={policy.id} policyName={policy.name} version={selected ? { id: selected.id, version: selected.version, state: selected.state, createdBy: selected.createdBy, document: selected.document } : null} activeVersionId={policy.currentVersionId} userId={c.session.user.id} canWrite={canWrite} canActivate={canActivate} fourEyes={fourEyes} />
            <AssignPolicyDialog policyId={policy.id} agents={agents.map((a) => ({ value: a.id, label: a.name, description: a.slug }))} teams={teams.map((t) => ({ value: t.id, label: t.name, description: t.key }))} canActivate={canActivate} hasActive={!!policy.currentVersionId} />
          </>
        }
      />
      <UrlTabs
        label="Policy sections"
        initial={tab}
        tabs={[
          ...(refundSettings && selected
            ? [{ id: "thresholds", label: "Thresholds", content: <RefundThresholdsPanel policyId={policy.id} version={{ id: selected.id, version: selected.version, state: selected.state }} settings={refundSettings} diverged={refundDiverged} roles={roles} tools={toolsLite} canWrite={canWrite} /> }]
            : []),
          { id: "rules", label: "Rules", count: doc?.rules.length, content: rulesTab },
          { id: "editor", label: "Editor", content: selected ? <PolicyEditor policyId={policy.id} version={{ id: selected.id, version: selected.version, state: selected.state, document: selected.document }} canWrite={canWrite} /> : <Note tone="warning">No version to edit.</Note> },
          {
            id: "simulate",
            label: "Simulate",
            content: selected ? (
              <div className="space-y-4">
                {refundSettings ? <RefundTester settings={refundSettings} versionId={selected.id} idPrefix="sim-try" description={`Plain-language check against ${versionLabel}. Nothing is recorded. The full simulator below accepts any tool and parameters.`} /> : null}
                <PolicySimulator versionId={selected.id} versionLabel={versionLabel} tools={toolsLite} agents={agents.map((a) => ({ id: a.id, name: a.name, slug: a.slug }))} defaultTool={defaultTool} defaultParams={defaultParams} />
              </div>
            ) : (
              <Note tone="warning">No version to simulate.</Note>
            ),
          },
          { id: "versions", label: "Versions", count: policy.versions.length, content: <PolicyVersionsTable policyId={policy.id} versions={versionRows} selectedId={selected?.id ?? ""} activeId={policy.currentVersionId} canActivate={canActivate} /> },
          { id: "assignments", label: "Assignments", count: policy.assignments.length, content: <AssignmentsTable policyId={policy.id} rows={assignmentRows} canActivate={canActivate} /> },
          { id: "history", label: "History", count: history.length, content: historyTab },
        ]}
      />
    </div>
  );
}
