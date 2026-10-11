import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { assessmentDashboard, assessmentListFilter, listAssessments } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { flatParams } from "@/server/queries/shield";
import { documentPicks, frameworkPicks } from "@/server/queries/audit";
import { userNames } from "@/server/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { StatPanel } from "@/components/ui/stat-panel";
import { Note } from "@/components/ui/note";
import { AssessmentsTable, type AssessmentRow } from "@/components/audit/assessments-table";
import { NewAssessmentDialog } from "@/components/audit/new-assessment-dialog";

export const metadata: Metadata = { title: "Assessments" };
export const dynamic = "force-dynamic";

type Summary = { coveragePercent?: number; counts?: { covered: number; partial: number; ambiguous: number; missing: number } };

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("audit:read");
  const flat = flatParams(await searchParams);
  const parsed = assessmentListFilter.safeParse(flat);
  const filter = parsed.success ? parsed.data : assessmentListFilter.parse({});
  const canWrite = c.can("audit:write");
  const { page, dashboard, frameworks, documents } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const [page, dashboard, frameworks, documents] = await Promise.all([listAssessments(db, c.ctx, filter), assessmentDashboard(db, c.ctx), frameworkPicks(db), canWrite ? documentPicks(db, c.ctx.orgId, true) : []]);
      return { page, dashboard, frameworks, documents };
    },
    { readOnly: true },
  );
  const names = await userNames(page.items.map((a) => a.startedBy));
  const rows: AssessmentRow[] = page.items.map((a) => {
    const s = (a.summary ?? {}) as Summary;
    return {
      id: a.id,
      name: a.name,
      frameworkName: a.framework.name,
      frameworkVersion: a.framework.version,
      status: a.status,
      scope: a.scope,
      documents: a.documentIds.length,
      coveragePercent: a.status === "completed" ? (s.coveragePercent ?? 0) : null,
      counts: a.status === "completed" && s.counts ? s.counts : null,
      startedBy: names.get(a.startedBy ?? "") ?? null,
      createdAt: a.createdAt.toISOString(),
      completedAt: a.completedAt?.toISOString() ?? null,
    };
  });
  const avgCoverage = dashboard.frameworks.length ? Math.round(dashboard.frameworks.reduce((acc, f) => acc + f.coveragePercent, 0) / dashboard.frameworks.length) : null;
  return (
    <div>
      <PageHeader title="Assessments" description="Lexical assessments of your documents against a framework, with findings per control that a person validates." badges={<DemoBadge show={c.org.demoMode} />} actions={<NewAssessmentDialog canWrite={canWrite} frameworks={frameworks.map((f) => ({ id: f.id, name: f.name, version: f.version, controlCount: f.controlCount }))} documents={documents.map((d) => ({ id: d.id, title: d.title, chunkCount: d.chunkCount }))} />} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPanel label="Frameworks assessed" value={dashboard.frameworks.length} footer={dashboard.frameworks.map((f) => f.framework.key).join(", ") || "No completed assessments"} />
        <StatPanel label="Average coverage" value={avgCoverage === null ? "n/a" : `${avgCoverage}%`} tone={avgCoverage === null ? "neutral" : avgCoverage >= 70 ? "allow" : avgCoverage >= 40 ? "approval" : "deny"} footer="Latest run per framework, covered controls only" />
        <StatPanel label="Open remediation" value={dashboard.remediation.open} tone={dashboard.remediation.overdue > 0 ? "deny" : "neutral"} footer={`${dashboard.remediation.overdue} overdue`} />
        <StatPanel label="Awaiting validation" value={dashboard.review.pending} tone={dashboard.review.pending > 0 ? "approval" : "allow"} footer={`${dashboard.review.validated} findings human validated`} />
      </div>
      <Note className="mb-4">{dashboard.disclaimer}</Note>
      <AssessmentsTable rows={rows} pagination={{ page: page.page, pageSize: page.pageSize, total: page.total }} />
    </div>
  );
}
