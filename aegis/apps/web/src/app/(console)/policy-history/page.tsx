import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { listPolicyHistory } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { userNames } from "@/server/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Note } from "@/components/ui/note";
import { PolicyHistoryView, type HistoryRow } from "@/components/assurance/policy-history-view";

export const metadata: Metadata = { title: "Policy History" };
export const dynamic = "force-dynamic";

export default async function PolicyHistoryPage() {
  const c = await requirePermission("policies:read");
  const { events, versions } = await withTenant(c.ctx.orgId, async (db) => {
    const events = await listPolicyHistory(db, c.ctx, { limit: 500 });
    const versionIds = [...new Set(events.map((e) => e.versionId).filter((x): x is string => !!x))];
    const versions = versionIds.length ? await db.policyVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, version: true } }) : [];
    return { events, versions };
  });
  const names = await userNames(events.map((e) => e.actorId));
  const versionNo = new Map(versions.map((v) => [v.id, v.version]));
  const rows: HistoryRow[] = events.map((e) => ({ id: e.id, policyId: e.policyId, policyKey: e.policy.key, policyName: e.policy.name, version: e.versionId ? (versionNo.get(e.versionId) ?? null) : null, type: e.type, actor: names.get(e.actorId ?? "") ?? "system", note: e.note, createdAt: e.createdAt.toISOString() }));
  return (
    <div>
      <PageHeader title="Policy History" description="Every lifecycle event of every policy version in this organization, newest first." badges={<DemoBadge show={c.org.demoMode} />} />
      <Note className="mb-4">Historical versions are never overwritten. Documents of reviewed, active and retired versions are frozen by the database; a rollback creates a new version from the old document and leaves the record intact.</Note>
      <PolicyHistoryView rows={rows} />
    </div>
  );
}
