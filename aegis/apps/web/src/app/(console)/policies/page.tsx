import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { listPolicies } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { PoliciesTable, type PolicyRow } from "@/components/control/policies-table";
import { NewPolicyDialog } from "@/components/control/new-policy-dialog";
import { approverRoleOptions } from "@/server/queries/policy-roles";
import { toolOptions } from "@/server/queries/control";

export const metadata: Metadata = { title: "Policies" };
export const dynamic = "force-dynamic";

export default async function PoliciesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("policies:read");
  const sp = await searchParams;
  const category = typeof sp.category === "string" ? sp.category : "";
  const state = typeof sp.state === "string" ? sp.state : "";
  const { policies, decisionCounts, roles, tools } = await withTenant(c.ctx.orgId, async (db) => {
    const [policies, roles, tools] = await Promise.all([listPolicies(db, c.ctx), approverRoleOptions(db, c.ctx.orgId), toolOptions(db, c.ctx.orgId)]);
    const versionIds = await db.policyVersion.findMany({ where: { orgId: c.ctx.orgId }, select: { id: true, policyId: true } });
    const byPolicy = new Map<string, string[]>();
    for (const v of versionIds) byPolicy.set(v.policyId, [...(byPolicy.get(v.policyId) ?? []), v.id]);
    const decisionCounts = new Map<string, number>();
    await Promise.all(policies.map(async (p) => decisionCounts.set(p.id, await db.authorizationDecision.count({ where: { orgId: c.ctx.orgId, policyVersionIds: { hasSome: byPolicy.get(p.id) ?? [] } } }))));
    return { policies, decisionCounts, roles, tools };
  });
  const rows: PolicyRow[] = policies
    .filter((p) => !p.archived)
    .filter((p) => !category || p.category === category)
    .filter((p) => !state || p.latestVersion?.state === state)
    .map((p) => ({ id: p.id, name: p.name, key: p.key, description: p.description, category: p.category, activeVersion: p.activeVersion?.version ?? null, latestVersion: p.latestVersion?.version ?? null, latestState: p.latestVersion?.state ?? null, assignments: p.assignments.length, decisions: decisionCounts.get(p.id) ?? 0, versions: p._count.versions, updatedAt: p.updatedAt.toISOString() }));
  return (
    <div>
      <PageHeader title="Policies" description="Versioned authorization rules evaluated on every action request. Drafts are edited, reviewed with embedded tests, then activated by a second person." badges={<DemoBadge show={c.org.demoMode} />} actions={<NewPolicyDialog canWrite={c.can("policies:write")} roles={roles} tools={tools.map((t) => ({ key: t.key, name: t.name }))} />} />
      <PoliciesTable rows={rows} filters={{ category, state }} />
    </div>
  );
}
