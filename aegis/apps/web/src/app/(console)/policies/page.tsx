import type { Metadata } from "next";
import Link from "next/link";
import { withTenant } from "@aegis/db";
import { listPolicies, listPolicyExceptions, organizationConflicts, parsePolicyDocument, policyEnforcement, policyRecommendations, SECTOR_TEMPLATES } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { Note } from "@/components/ui/note";
import { UrlTabs } from "@/components/ui/url-tabs";
import { CodeBlock } from "@/components/ui/code-block";
import { PoliciesTable, type PolicyRow } from "@/components/control/policies-table";
import { NewPolicyDialog } from "@/components/control/new-policy-dialog";
import { ExceptionActions, ExceptionRequestForm, SectorTemplatePanel } from "@/components/control/policy-insights";
import { approverRoleOptions } from "@/server/queries/policy-roles";
import { toolOptions } from "@/server/queries/control";
import { formatDateTime } from "@/lib/utils";
import type { Tone } from "@/lib/status";

export const metadata: Metadata = { title: "Policies" };
export const dynamic = "force-dynamic";

const SEVERITY_TONE: Record<string, Tone> = { high: "deny", medium: "approval", low: "neutral" };
const EXCEPTION_TONE: Record<string, Tone> = { requested: "approval", active: "allow", expired: "neutral", rejected: "neutral", revoked: "neutral" };

export default async function PoliciesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("policies:read");
  const sp = await searchParams;
  const category = typeof sp.category === "string" ? sp.category : "";
  const state = typeof sp.state === "string" ? sp.state : "";
  const tab = typeof sp.tab === "string" ? sp.tab : undefined;
  const data = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const [policies, roles, tools, enforcement, conflicts, recommendations, exceptions, agents] = await Promise.all([listPolicies(db, c.ctx), approverRoleOptions(db, c.ctx.orgId), toolOptions(db, c.ctx.orgId), policyEnforcement(db, c.ctx), organizationConflicts(db, c.ctx), policyRecommendations(db, c.ctx), listPolicyExceptions(db, c.ctx), db.agent.findMany({ where: { isLab: false, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
      const versionIds = await db.policyVersion.findMany({ where: { orgId: c.ctx.orgId }, select: { id: true, policyId: true } });
      const byPolicy = new Map<string, string[]>();
      for (const v of versionIds) byPolicy.set(v.policyId, [...(byPolicy.get(v.policyId) ?? []), v.id]);
      const decisionCounts = new Map<string, number>();
      await Promise.all(policies.map(async (p) => decisionCounts.set(p.id, await db.authorizationDecision.count({ where: { orgId: c.ctx.orgId, policyVersionIds: { hasSome: byPolicy.get(p.id) ?? [] } } }))));
      return { policies, decisionCounts, roles, tools, enforcement, conflicts, recommendations, exceptions, agents };
    },
    { readOnly: true, timeout: 30_000 },
  );
  const rows: PolicyRow[] = data.policies
    .filter((p) => !p.archived)
    .filter((p) => !category || p.category === category)
    .filter((p) => !state || p.latestVersion?.state === state)
    .map((p) => {
      const e = data.enforcement.get(p.id);
      return { id: p.id, name: p.name, key: p.key, description: p.description, category: p.category, enforcement: { state: e?.state ?? "no_active_version", text: e?.text ?? "", agents: e?.agents.length ?? 0, exceptions: e?.activeExceptions ?? 0 }, activeVersion: p.activeVersion?.version ?? null, latestVersion: p.latestVersion?.version ?? null, latestState: p.latestVersion?.state ?? null, assignments: p.assignments.length, decisions: data.decisionCounts.get(p.id) ?? 0, versions: p._count.versions, updatedAt: p.updatedAt.toISOString() };
    });
  const activePolicies = data.policies.filter((p) => p.activeVersion).map((p) => ({ id: p.id, name: p.name, rules: parsePolicyDocument(p.activeVersion!.document).rules.map((r) => r.id) }));
  const conflictsTab = (
    <div className="space-y-4" data-testid="policy-conflicts">
      <Note tone="info">
        Rules combine by strictness: when several match, the strictest decides. A conflict is two rules with different outcomes that can match the same request, so the less strict one has no effect there. Each conflict below was confirmed by building an example request and evaluating it. Checked {data.conflicts.pairsChecked} rule pairs across {data.conflicts.agentSets} sets of policies that apply together; {data.conflicts.notAnalyzed} pairs use regular expressions or negated text tests the analysis cannot decide, and are not claimed safe.
      </Note>
      {data.conflicts.conflicts.length === 0 && data.conflicts.deadRules.length === 0 ? <p className="text-sm text-fg-muted">No conflicts found among the rules that could be analyzed.</p> : null}
      {data.conflicts.deadRules.map((d) => (
        <Panel key={`${d.policyKey}/${d.ruleId}`} title={`${d.policyKey}/${d.ruleId} can never match`} description={d.reason} />
      ))}
      {data.conflicts.conflicts.map((x) => (
        <Panel key={`${x.a.policyKey}/${x.a.ruleId}|${x.b.policyKey}/${x.b.ruleId}`} title={`${x.a.policyKey}/${x.a.ruleId} (${x.a.effect}) and ${x.b.policyKey}/${x.b.ruleId} (${x.b.effect})`} actions={<Badge tone={SEVERITY_TONE[x.severity] ?? "neutral"}>{x.severity}</Badge>}>
          <p className="text-sm text-fg">{x.explanation}</p>
          <p className="mt-1 text-xs text-fg-muted">Agents affected: {x.agents.join(", ")}</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-accent">Example request both rules match</summary>
            <CodeBlock className="mt-2" code={JSON.stringify(x.witness, null, 2)} />
          </details>
        </Panel>
      ))}
    </div>
  );
  const exceptionsTab = (
    <div className="space-y-4">
      <Panel title="Exceptions" description="An exception skips one rule for one agent until it expires (at most 90 days). It needs a second person with policies:activate, never applies under a delegation, and every decision it touches records it. Data protection, uncertainty and autonomy still apply.">
        {data.exceptions.length === 0 ? (
          <p className="text-sm text-fg-muted">No exceptions.</p>
        ) : (
          <ul className="divide-y divide-line text-sm" data-testid="policy-exceptions">
            {data.exceptions.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-state={x.state}>
                <span>
                  <Badge tone={EXCEPTION_TONE[x.state] ?? "neutral"}>{x.state}</Badge> <span className="font-mono text-xs">{x.policyKey}/{x.ruleId}</span> for {x.agent?.name ?? "unknown agent"}
                  {x.toolKey ? ` (${x.toolKey})` : ""}, until {formatDateTime(x.expiresAt)}
                  <span className="block text-xs text-fg-muted">{x.reason}</span>
                </span>
                <ExceptionActions id={x.id} state={x.state} isRequester={x.requestedBy === c.ctx.actor.id} canActivate={c.can("policies:activate")} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Request an exception">{activePolicies.length && data.agents.length ? <ExceptionRequestForm policies={activePolicies} agents={data.agents} canWrite={c.can("policies:write")} /> : <p className="text-sm text-fg-muted">Exceptions need an active policy and an active agent.</p>}</Panel>
    </div>
  );
  const recommendationsTab = (
    <div className="space-y-3" data-testid="policy-recommendations">
      <Note tone="info">Drawn from the last 30 days of recorded decisions, approvals, assignments and Attack Simulation Lab results. Nothing is changed automatically; replay a change before making it.</Note>
      {data.recommendations.length === 0 ? <p className="text-sm text-fg-muted">No recommendations from the last 30 days.</p> : null}
      {data.recommendations.map((r, i) => (
        <Panel key={`${r.kind}-${i}`} title={r.title} actions={<Badge>{r.kind.replace(/_/g, " ")}</Badge>}>
          <p className="text-sm text-fg-muted">{r.detail}</p>
          <Link href={r.href} className="mt-2 inline-block text-xs text-accent hover:underline">
            Open
          </Link>
        </Panel>
      ))}
    </div>
  );
  return (
    <div>
      <PageHeader title="Policies" description="The rules that decide what an agent may do, checked on every request. Each change is a new version: a draft is edited, reviewed with its built-in tests, then switched on by a second person." badges={<DemoBadge show={c.org.demoMode} />} actions={<NewPolicyDialog canWrite={c.can("policies:write")} roles={data.roles} tools={data.tools.map((t) => ({ key: t.key, name: t.name }))} />} />
      <UrlTabs
        label="Policy areas"
        initial={tab}
        tabs={[
          { id: "policies", label: "Policies", count: rows.length, content: <PoliciesTable rows={rows} filters={{ category, state }} /> },
          { id: "conflicts", label: "Conflicts", count: data.conflicts.conflicts.length + data.conflicts.deadRules.length, content: conflictsTab },
          { id: "exceptions", label: "Exceptions", count: data.exceptions.filter((x) => x.state === "requested" || x.state === "active").length, content: exceptionsTab },
          { id: "recommendations", label: "Recommendations", count: data.recommendations.length, content: recommendationsTab },
          { id: "templates", label: "Sector templates", content: <Panel title="Start from a sector template" description="Illustrative starting points, not legal or regulatory advice. Every template carries its own tests."><SectorTemplatePanel templates={SECTOR_TEMPLATES} tools={data.tools.map((t) => ({ key: t.key, name: t.name }))} canWrite={c.can("policies:write")} /></Panel> },
        ]}
      />
    </div>
  );
}
