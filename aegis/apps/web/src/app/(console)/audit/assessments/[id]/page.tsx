import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { getAssessment, isAegisError, listExports } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { isUuid, membersWithPermission } from "@/server/queries/shield";
import { exportAssessmentIds } from "@/server/queries/audit";
import { userNames } from "@/server/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status";
import { Panel } from "@/components/ui/panel";
import { KeyValue } from "@/components/ui/key-value";
import { StatPanel } from "@/components/ui/stat-panel";
import { Note } from "@/components/ui/note";
import { RunAssessmentButton } from "@/components/audit/run-assessment-button";
import { FindingsList, type FindingView } from "@/components/audit/findings-list";
import { ExportsTable, GenerateReportForm } from "@/components/audit/reports-panel";
import { findingLabel, findingTone } from "@/components/audit/format";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Assessment ${id.slice(0, 8)}` };
}

type Summary = { engine?: string; coveragePercent?: number; weightedCoveragePercent?: number; counts?: Record<string, number>; chunkCount?: number; automatedArtifacts?: number; durationMs?: number; error?: string };

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePermission("audit:read");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const canWrite = c.can("audit:write");
  const canReports = c.can("reports:read");
  const data = await withTenant(
    c.ctx.orgId,
    async (db) => {
      try {
        const a = await getAssessment(db, c.ctx, id);
        const [owners, exports, chunks] = await Promise.all([
          canWrite ? membersWithPermission(db, c.ctx.orgId, "audit:write") : [],
          canReports ? listExports(db, c.ctx, 200) : [],
          db.documentChunk.findMany({ where: { id: { in: a.findings.flatMap((f) => f.artifacts.map((x) => x.chunkId)).filter((x): x is string => !!x) } }, select: { id: true, idx: true, page: true, documentId: true } }),
        ]);
        const exportMap = await exportAssessmentIds(db, c.ctx.orgId, exports.map((e) => e.id));
        return { a, owners, exports: exports.filter((e) => exportMap.get(e.id) === a.id), chunks };
      } catch (e) {
        if (isAegisError(e) && e.code === "not_found") return null;
        throw e;
      }
    },
    { readOnly: true },
  );
  if (!data) notFound();
  const { a, owners, exports, chunks } = data;
  const names = await userNames([a.startedBy, ...a.findings.map((f) => f.validatedBy), ...exports.map((e) => e.createdBy)]);
  const chunkById = new Map(chunks.map((ch) => [ch.id, ch]));
  const docTitle = new Map(a.documents.map((d) => [d.id, d.title]));
  const summary = (a.summary ?? {}) as Summary;
  const counts = summary.counts ?? { covered: 0, partial: 0, ambiguous: 0, missing: 0 };
  const findings: FindingView[] = a.findings.map((f) => ({
    id: f.id,
    code: f.control.code,
    title: f.control.title,
    summary: f.control.summary,
    category: f.control.category || "General",
    status: f.status,
    humanStatus: f.humanStatus,
    effectiveStatus: f.effectiveStatus,
    conclusion: f.conclusion,
    confidence: f.confidence,
    rationale: f.rationale,
    recommendation: f.recommendation,
    validatedBy: names.get(f.validatedBy ?? "") ?? (f.validatedBy ? "a member" : null),
    validatedAt: f.validatedAt?.toISOString() ?? null,
    validationNote: f.validationNote,
    resolvedAt: f.resolvedAt?.toISOString() ?? null,
    artifacts: f.artifacts.map((x) => {
      const ch = x.chunkId ? chunkById.get(x.chunkId) : undefined;
      return { id: x.id, kind: x.kind, documentTitle: x.documentId ? (docTitle.get(x.documentId) ?? "document") : null, page: ch?.page ?? null, chunkIdx: ch?.idx ?? null, excerpt: x.excerpt, score: x.score, reference: x.reference };
    }),
    tasks: f.remediation.map((t) => ({ id: t.id, title: t.title, status: t.status, dueAt: t.dueAt?.toISOString() ?? null })),
  }));
  const exportRows = exports.map((e) => ({ id: e.id, kind: e.kind, format: e.format, size: e.size, sha256: e.sha256, createdBy: names.get(e.createdBy ?? "") ?? null, createdAt: e.createdAt.toISOString(), assessmentId: a.id, assessmentName: a.name, frameworkName: a.framework.name }));

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Assessments", href: "/audit/assessments" }, { label: a.name }]}
        title={a.name}
        badges={
          <>
            <StatusBadge status={a.status} label={a.status === "completed" ? "Completed" : undefined} />
            <Badge mono>{summary.engine ?? "aegis-lexical-v1"}</Badge>
            <DemoBadge show={c.org.demoMode} />
          </>
        }
        description={
          <>
            <Link href={`/audit/standards/${a.frameworkId}`} className="text-accent hover:underline">
              {a.framework.name}
            </Link>
            {a.framework.version ? ` ${a.framework.version}` : ""}, {a.completedAt ? `completed ${formatDateTime(a.completedAt)}` : `created ${formatDateTime(a.createdAt)}`}
            {a.startedBy ? ` by ${names.get(a.startedBy) ?? "a member"}` : ""}.
          </>
        }
        actions={<RunAssessmentButton assessmentId={a.id} status={a.status} canWrite={canWrite} controlCount={a.findings.length} />}
      />
      <div data-testid="assessment-disclaimer" className="mb-4">
        <Note tone="warning">{a.disclaimer}</Note>
      </div>
      {a.status === "failed" && summary.error ? <Note tone="danger" className="mb-4">Last run failed: {summary.error}</Note> : null}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatPanel label="Coverage" value={a.status === "completed" ? `${summary.coveragePercent ?? 0}%` : "n/a"} tone={(summary.coveragePercent ?? 0) >= 70 ? "allow" : (summary.coveragePercent ?? 0) >= 40 ? "approval" : "deny"} footer={summary.weightedCoveragePercent !== undefined ? `${summary.weightedCoveragePercent}% counting partial at half` : undefined} />
        {(["covered", "partial", "ambiguous", "missing"] as const).map((s) => (
          <StatPanel key={s} label={findingLabel(s)} value={counts[s] ?? 0} tone={findingTone(s)} />
        ))}
        <StatPanel label="Human validated" value={`${a.review.validated}/${a.findings.length}`} tone={a.review.pending === 0 && a.findings.length > 0 ? "allow" : "approval"} footer={`${a.review.pending} automated findings still waiting for a person to confirm`} />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Scope and inputs" className="lg:col-span-2">
          <KeyValue
            columns={2}
            items={[
              { label: "Scope", value: a.scope || null },
              { label: "Engine", value: summary.engine ?? "aegis-lexical-v1", mono: true },
              { label: "Documents", value: a.documents.length ? a.documents.map((d) => `${d.title} (${d.chunkCount} chunks)`).join("; ") : "none: only AEGIS's own records were used" },
              { label: "Passages searched (chunks)", value: summary.chunkCount ?? null },
              { label: "Automated evidence items (artifacts)", value: summary.automatedArtifacts ?? null },
              { label: "Run duration", value: summary.durationMs !== undefined ? `${summary.durationMs} ms` : null },
            ]}
          />
        </Panel>
        <Panel title="Reports" description="Every finding in a report is labelled Automated or Human validated, and every PDF page carries the disclaimer.">
          {a.status === "completed" ? <GenerateReportForm assessments={[{ id: a.id, name: a.name, frameworkName: a.framework.name }]} fixedAssessmentId={a.id} canGenerate={canWrite} compact /> : <p className="text-xs text-fg-dim">Reports can be generated once the assessment has completed.</p>}
          <div className="mt-3">
            <ExportsTable rows={exportRows} showAssessment={false} canDownload={canReports} />
          </div>
        </Panel>
      </div>
      {a.status === "completed" || findings.length > 0 ? (
        <FindingsList assessmentId={a.id} findings={findings} categories={a.categories} canWrite={canWrite} owners={owners.map((o) => ({ userId: o.userId, name: o.name, roleName: o.roleName }))} />
      ) : (
        <Panel title="Findings">
          <p className="text-xs text-fg-dim">{a.status === "running" ? "The assessment is running. Refresh in a moment." : "Run the assessment to produce findings."}</p>
        </Panel>
      )}
    </div>
  );
}
