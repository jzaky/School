import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { listExports } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { assessmentNames, assessmentPicks, exportAssessmentIds } from "@/server/queries/audit";
import { userNames } from "@/server/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { Note } from "@/components/ui/note";
import { ExportsTable, GenerateReportForm, ReportKindList, type ExportRow } from "@/components/audit/reports-panel";

export const metadata: Metadata = { title: "Audit Reports" };
export const dynamic = "force-dynamic";

export default async function AuditReportsPage() {
  const c = await requirePermission("audit:read");
  const canReports = c.can("reports:read");
  const canWrite = c.can("audit:write");
  const { exports, assessments, exportMap, assessmentMap } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const [exports, assessments] = await Promise.all([canReports ? listExports(db, c.ctx, 200) : [], assessmentPicks(db, c.ctx.orgId, true)]);
      const exportMap = await exportAssessmentIds(db, c.ctx.orgId, exports.map((e) => e.id));
      const assessmentMap = await assessmentNames(db, [...exportMap.values()]);
      return { exports, assessments, exportMap, assessmentMap };
    },
    { readOnly: true },
  );
  const names = await userNames(exports.map((e) => e.createdBy));
  const rows: ExportRow[] = exports.map((e) => {
    const aid = exportMap.get(e.id) ?? null;
    const a = aid ? assessmentMap.get(aid) : undefined;
    return { id: e.id, kind: e.kind, format: e.format, size: e.size, sha256: e.sha256, createdBy: names.get(e.createdBy ?? "") ?? null, createdAt: e.createdAt.toISOString(), assessmentId: aid, assessmentName: a?.name ?? null, frameworkName: a?.frameworkName ?? null };
  });
  return (
    <div>
      <PageHeader title="Audit Reports" description="Reports produced from completed assessments. Each is stored with a fingerprint (SHA-256) so you can prove a downloaded file is the one on record." badges={<DemoBadge show={c.org.demoMode} />} />
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Generate a report" className="lg:col-span-1">
          {assessments.length === 0 ? <p className="text-xs text-fg-dim">Complete an assessment first; reports are generated from its findings.</p> : <GenerateReportForm assessments={assessments.map((a) => ({ id: a.id, name: a.name, frameworkName: a.frameworkName }))} canGenerate={canWrite} />}
        </Panel>
        <Panel title="Report kinds" description="Every finding in every report carries an Automated or Human validated label. PDF pages carry the engine disclaimer." className="lg:col-span-2">
          <ReportKindList />
        </Panel>
      </div>
      {!canReports ? <Note className="mb-4">You need the reports:read permission to list and download reports; ask an administrator.</Note> : null}
      <ExportsTable rows={rows} canDownload={canReports} />
    </div>
  );
}
