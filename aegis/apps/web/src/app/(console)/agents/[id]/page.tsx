import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { AGENT_TRANSITIONS, agentPosture, getAgent, isAegisError, listResources, listTools } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { userNames } from "@/server/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { KeyValue } from "@/components/ui/key-value";
import { Panel } from "@/components/ui/panel";
import { CodeBlock } from "@/components/ui/code-block";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusCell } from "@/components/ui/status";
import { AgentLifecycleActions } from "@/components/agents/agent-lifecycle";
import { AgentTabs } from "@/components/agents/agent-tabs";
import { ToolsTab } from "@/components/agents/tools-tab";
import { PermissionsTab } from "@/components/agents/permissions-tab";
import { VersionsTab } from "@/components/agents/versions-tab";
import { ApiKeysTab } from "@/components/agents/api-keys-tab";
import type { AgentCaps } from "@/components/agents/types";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { statusLabel, statusTone } from "@/lib/status";

export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Agent ${id.slice(0, 8)}` };
}

export default async function AgentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const c = await requirePermission("agents:read");
  const { id } = await params;
  const { tab } = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const canEvidence = c.can("evidence:read");
  const data = await withTenant(c.ctx.orgId, async (db) => {
    try {
      const agent = await getAgent(db, c.ctx, id);
      const [tools, resources, team, evidence, posture] = await Promise.all([
        listTools(db, c.ctx),
        listResources(db, c.ctx),
        agent.teamId ? db.team.findUnique({ where: { id: agent.teamId }, select: { id: true, name: true, key: true } }) : null,
        canEvidence ? db.evidenceEvent.findMany({ where: { orgId: c.ctx.orgId, subjectType: "agent", subjectId: id }, orderBy: { seq: "desc" }, take: 50 }) : [],
        agentPosture(db, c.ctx, agent),
      ]);
      return { agent, tools, resources, team, evidence, posture };
    } catch (e) {
      if (isAegisError(e) && e.code === "not_found") return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { agent, tools, resources, team, evidence, posture } = data;
  const names = await userNames([agent.businessOwnerId, agent.technicalOwnerId, ...agent.versions.map((v) => v.createdBy), ...evidence.filter((e) => e.actorType === "user").map((e) => e.actorId)]);
  const caps: AgentCaps = { canWrite: c.can("agents:write"), canControl: c.can("agents:control"), editable: agent.status !== "revoked" && agent.status !== "archived", status: agent.status };
  const activeTools = agent.tools.filter((t) => !t.revokedAt).length;
  const activePerms = agent.permissions.filter((p) => !p.revokedAt).length;
  const activeKeys = agent.apiKeys.filter((k) => !k.revokedAt).length;
  const metadata = agent.metadata && typeof agent.metadata === "object" && Object.keys(agent.metadata as object).length ? JSON.stringify(agent.metadata, null, 2) : null;

  const overview = (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Identity">
        <KeyValue
          items={[
            { label: "Slug", value: agent.slug, mono: true },
            { label: "Description", value: agent.description || null },
            { label: "Environment", value: statusLabel(agent.environment) },
            { label: "Model", value: agent.modelProvider || agent.modelId ? `${agent.modelProvider}${agent.modelProvider && agent.modelId ? " / " : ""}${agent.modelId}` : null, mono: true },
            { label: "Risk tier", value: <Badge tone={statusTone(agent.riskTier)}>{statusLabel(agent.riskTier)}</Badge> },
            { label: "Most sensitive data it may handle (classification limit)", value: <Badge tone={statusTone(agent.dataClassificationLimit)}>{statusLabel(agent.dataClassificationLimit)}</Badge> },
            { label: "Current version", value: `v${agent.currentVersion}`, mono: true },
          ]}
        />
      </Panel>
      <Panel title="Ownership and state">
        <KeyValue
          items={[
            { label: "Business owner", value: names.get(agent.businessOwnerId ?? "") ?? null },
            { label: "Technical owner", value: names.get(agent.technicalOwnerId ?? "") ?? null },
            { label: "Team", value: team ? (c.can("users:read") ? <Link href="/org/teams" className="text-accent hover:underline">{team.name}</Link> : team.name) : null },
            { label: "Status", value: <StatusBadge status={agent.status} /> },
            {
              label: "Autonomy posture",
              value: (
                <span className="block text-end" data-testid="agent-posture" data-posture={posture.posture}>
                  <Badge tone={statusTone(posture.posture)}>{posture.label}</Badge>
                  <span className="mt-1 block text-xs text-fg-muted">{posture.sentence}</span>
                </span>
              ),
            },
            { label: "Status reason", value: agent.statusReason || null },
            { label: "Status changed", value: agent.statusChangedAt ? formatDateTime(agent.statusChangedAt) : null },
            { label: "Last activity", value: agent.lastActivityAt ? formatDateTime(agent.lastActivityAt) : null },
            { label: "Registered", value: formatDateTime(agent.createdAt) },
          ]}
        />
      </Panel>
      <Panel title="Request outcomes" description="Everything this agent has asked to do, counted by what happened to it" className="lg:col-span-2">
        {Object.keys(agent.statusCounts).length === 0 ? (
          <p className="text-xs text-fg-dim">No action requests yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(agent.statusCounts).map(([s, n]) => (
              <Badge key={s} tone={statusTone(s)}>
                {statusLabel(s)} <span className="tabular">{n as number}</span>
              </Badge>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Metadata" className="lg:col-span-2">
        {metadata ? <CodeBlock code={metadata} /> : <p className="text-xs text-fg-dim">No additional details (metadata) recorded.</p>}
      </Panel>
    </div>
  );

  const policies = (
    <div className="space-y-3">
      <div className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-fg">Policy management arrives in the Control release. The assignments listed here cannot be changed from this page.</div>
      {agent.assignments.length === 0 ? (
        <EmptyState title="No policies assigned" description="Rules that apply to this agent will appear here, whether they are set for the whole organization, for its team or for this agent alone." />
      ) : (
        <div className="overflow-hidden rounded-panel border border-line bg-bg-elev">
          <table className="w-full text-[13px]">
            <thead className="bg-bg-elev-2/95 text-xs text-fg-muted">
              <tr>
                <th className="h-9 px-3 text-start font-medium">Policy</th>
                <th className="h-9 px-3 text-start font-medium">Scope</th>
                <th className="h-9 px-3 text-start font-medium">Active version</th>
                <th className="h-9 px-3 text-end font-medium">Priority</th>
              </tr>
            </thead>
            <tbody>
              {agent.assignments.map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="h-9 px-3">
                    <span className="font-medium">{a.policy.name}</span> <span className="font-mono text-[11px] text-fg-dim">{a.policy.key}</span>
                  </td>
                  <td className="h-9 px-3">{a.targetType === "org" ? "Organization" : a.targetType === "team" ? "Team" : "This agent"}</td>
                  <td className="h-9 px-3">{a.policy.versions[0] ? <Badge tone="allow">v{a.policy.versions[0].version}</Badge> : <Badge>No active version</Badge>}</td>
                  <td className="h-9 px-3 text-end tabular">{a.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const activity = agent.recentRequests.length === 0 ? (
    <EmptyState title="No action requests yet" description="Everything the agent asks to do goes through the Action Gateway, the one door for every agent action. Each request and its decision will be listed here." />
  ) : (
    <div className="overflow-auto rounded-panel border border-line bg-bg-elev">
      <table className="w-full text-[13px]">
        <thead className="bg-bg-elev-2/95 text-xs text-fg-muted">
          <tr>
            <th className="h-9 px-3 text-start font-medium">Time</th>
            <th className="h-9 px-3 text-start font-medium">Tool</th>
            <th className="h-9 px-3 text-start font-medium">Action</th>
            <th className="h-9 px-3 text-start font-medium">Resource</th>
            <th className="h-9 px-3 text-start font-medium">Status</th>
            <th className="h-9 px-3 text-start font-medium">Decision</th>
            <th className="h-9 px-3 text-start font-medium">Correlation</th>
          </tr>
        </thead>
        <tbody>
          {agent.recentRequests.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="h-9 whitespace-nowrap px-3" title={formatDateTime(r.createdAt)}>{timeAgo(r.createdAt)}</td>
              <td className="h-9 px-3 font-mono text-xs">{r.toolKey}</td>
              <td className="h-9 px-3">{r.action}</td>
              <td className="h-9 px-3 font-mono text-xs">{r.resourceKey ?? <span className="text-fg-dim">none</span>}</td>
              <td className="h-9 px-3"><StatusCell status={r.status} /></td>
              <td className="h-9 px-3">{r.decisions[0] ? <StatusCell status={r.decisions[0].result} /> : <span className="text-fg-dim">none</span>}</td>
              <td className="h-9 px-3 font-mono text-[11px] text-fg-dim">{r.correlationId.slice(0, 12)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const evidenceTab = !canEvidence ? (
    <EmptyState title="You need the evidence:read permission to see this" description="Ask an administrator for the Auditor or Governance Manager role to view the record of this agent's events." />
  ) : (
    <Panel>
      <Timeline
        emptyText="No evidence recorded for this agent"
        items={evidence.map((e) => ({
          id: e.id,
          tone: /revoked|suspended|denied|failed/.test(e.type) ? ("deny" as const) : /created|granted|active|issued|registered|added/.test(e.type) ? ("allow" as const) : ("neutral" as const),
          title: (
            <span className="flex flex-wrap items-center gap-x-2">
              <span className="font-mono text-xs">{e.type}</span>
              <span className="text-fg-dim">by</span>
              <span>{e.actorType === "user" ? (names.get(e.actorId ?? "") ?? "User") : e.actorType}</span>
            </span>
          ),
          meta: (
            <span className="font-mono">
              seq {e.seq.toString()} · {e.hash.slice(0, 16)}
              {Object.keys((e.payload as object) ?? {}).length ? ` · ${JSON.stringify(e.payload).slice(0, 160)}` : ""}
            </span>
          ),
          time: <span title={formatDateTime(e.occurredAt)}>{timeAgo(e.occurredAt)}</span>,
        }))}
      />
    </Panel>
  );

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "AI Agents", href: "/agents" }, { label: agent.name }]}
        title={agent.name}
        badges={
          <>
            <StatusBadge status={agent.status} />
            <Badge tone={statusTone(agent.environment)}>{statusLabel(agent.environment)}</Badge>
            <DemoBadge show={c.org.demoMode} />
          </>
        }
        description={agent.description || <span className="font-mono text-xs">{agent.slug}</span>}
        actions={<AgentLifecycleActions agentId={agent.id} agentName={agent.name} status={agent.status} allowedNext={AGENT_TRANSITIONS[agent.status]} canWrite={caps.canWrite} canControl={caps.canControl} />}
      />
      <AgentTabs
        initial={tab}
        tabs={[
          { id: "overview", label: "Overview", content: overview },
          { id: "tools", label: "Tools", count: activeTools, content: <ToolsTab agentId={agent.id} caps={caps} catalog={tools.map((t) => ({ id: t.id, key: t.key, name: t.name, riskLevel: t.riskLevel, enabled: t.enabled, integration: t.integration?.name ?? null }))} tools={agent.tools.map((t) => ({ toolId: t.toolId, key: t.tool.key, name: t.tool.name, description: t.tool.description, riskLevel: t.tool.riskLevel, integration: t.tool.integration?.name ?? null, enabled: t.enabled, toolEnabled: t.tool.enabled, revokedAt: t.revokedAt?.toISOString() ?? null, revokedReason: t.revokedReason, createdAt: t.createdAt.toISOString() }))} /> },
          { id: "permissions", label: "Permissions", count: activePerms, content: <PermissionsTab agentId={agent.id} caps={caps} classificationLimit={agent.dataClassificationLimit} resources={resources.map((r) => ({ id: r.id, key: r.key, name: r.name, type: r.type, classification: r.classification }))} permissions={agent.permissions.map((p) => ({ id: p.id, resourceId: p.resourceId, resourceKey: p.resource.key, resourceName: p.resource.name, classification: p.resource.classification, actions: p.actions, expiresAt: p.expiresAt?.toISOString() ?? null, revokedAt: p.revokedAt?.toISOString() ?? null, createdAt: p.createdAt.toISOString() }))} /> },
          { id: "versions", label: "Versions", count: agent.versions.length, content: <VersionsTab agentId={agent.id} caps={caps} versions={agent.versions.map((v) => ({ id: v.id, version: v.version, manifest: JSON.stringify(v.manifest ?? {}), notes: v.notes, deployedAt: v.deployedAt?.toISOString() ?? null, createdAt: v.createdAt.toISOString(), createdBy: names.get(v.createdBy ?? "") ?? "system", current: v.version === agent.currentVersion }))} /> },
          { id: "policies", label: "Policies", count: agent.assignments.length, content: policies },
          { id: "activity", label: "Activity", count: agent.recentRequests.length, content: activity },
          { id: "keys", label: "API keys", count: activeKeys, content: <ApiKeysTab agentId={agent.id} caps={caps} keys={agent.apiKeys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null, expiresAt: k.expiresAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null }))} /> },
          { id: "evidence", label: "Evidence", count: canEvidence ? evidence.length : undefined, content: evidenceTab },
        ]}
      />
    </div>
  );
}
