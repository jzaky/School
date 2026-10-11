import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { listTasks, taskListFilter, type HistoryEntry } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { flatParams, isUuid, membersWithPermission } from "@/server/queries/shield";
import { documentPicks, findingPicks } from "@/server/queries/audit";
import { userNames } from "@/server/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { StatPanel } from "@/components/ui/stat-panel";
import { RemediationTable, type TaskRow } from "@/components/audit/remediation-table";
import { CreateTaskDialog } from "@/components/audit/create-task-dialog";

export const metadata: Metadata = { title: "Remediation" };
export const dynamic = "force-dynamic";

export default async function RemediationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("audit:read");
  const flat = flatParams(await searchParams);
  const parsed = taskListFilter.safeParse(flat);
  const filter = parsed.success ? parsed.data : taskListFilter.parse({});
  const canWrite = c.can("audit:write");
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 86400_000);
  const { page, stats, owners, documents, findings } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const [page, open, overdue, review, resolved30, owners, documents, findings] = await Promise.all([
        listTasks(db, c.ctx, filter),
        db.remediationTask.count({ where: { orgId: c.ctx.orgId, status: { not: "resolved" } } }),
        db.remediationTask.count({ where: { orgId: c.ctx.orgId, status: { not: "resolved" }, dueAt: { lt: now } } }),
        db.remediationTask.count({ where: { orgId: c.ctx.orgId, status: "review" } }),
        db.remediationTask.count({ where: { orgId: c.ctx.orgId, status: "resolved", updatedAt: { gte: since30 } } }),
        membersWithPermission(db, c.ctx.orgId, "audit:write"),
        documentPicks(db, c.ctx.orgId),
        canWrite ? findingPicks(db, c.ctx.orgId) : [],
      ]);
      return { page, stats: { open, overdue, review, resolved30 }, owners, documents, findings };
    },
    { readOnly: true },
  );
  const histories = page.items.map((t) => (Array.isArray(t.history) ? (t.history as unknown as HistoryEntry[]) : []));
  const names = await userNames([...page.items.map((t) => t.ownerId), ...histories.flatMap((h) => h.map((e) => e.by))]);
  const rows: TaskRow[] = page.items.map((t, i) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    ownerId: t.ownerId,
    ownerName: names.get(t.ownerId ?? "") ?? null,
    dueAt: t.dueAt?.toISOString() ?? null,
    overdue: t.overdue,
    updatedAt: t.updatedAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
    finding: t.finding ? { id: t.finding.id, code: t.finding.control.code, title: t.finding.control.title, assessmentId: t.finding.assessmentId, status: t.finding.humanStatus ?? t.finding.status } : null,
    evidenceDocumentIds: t.evidenceDocumentIds,
    history: (histories[i] ?? []).map((h) => ({ at: h.at, by: h.by, byName: h.by ? (names.get(h.by) ?? "Member") : null, from: h.from, to: h.to, note: h.note })),
  }));
  const filters = { status: filter.status, ownerId: filter.ownerId ?? "", overdue: filter.overdue ? "true" : "" };
  const initialTaskId = flat.task && isUuid(flat.task) ? flat.task : undefined;
  return (
    <div>
      <PageHeader title="Remediation" description="Work items that close assessment findings. Tasks move open, in progress, review, resolved; reopening and sending back require a note." badges={<DemoBadge show={c.org.demoMode} />} actions={<CreateTaskDialog canWrite={canWrite} owners={owners.map((o) => ({ userId: o.userId, name: o.name, roleName: o.roleName }))} findings={findings.map((f) => ({ id: f.id, code: f.code, title: f.title, assessmentName: f.assessmentName }))} />} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPanel label="Open" value={stats.open} tone={stats.open > 0 ? "approval" : "allow"} footer="Not yet resolved" />
        <StatPanel label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? "deny" : "neutral"} />
        <StatPanel label="In review" value={stats.review} tone="info" />
        <StatPanel label="Resolved, 30 days" value={stats.resolved30} tone="allow" />
      </div>
      <RemediationTable rows={rows} pagination={{ page: page.page, pageSize: page.pageSize, total: page.total }} filters={filters} owners={owners.map((o) => ({ userId: o.userId, name: o.name, roleName: o.roleName }))} documents={documents.map((d) => ({ id: d.id, title: d.title, status: d.status }))} canWrite={canWrite} initialTaskId={initialTaskId} />
    </div>
  );
}
