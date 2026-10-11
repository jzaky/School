import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { AUTOMATED_EVIDENCE_TYPES, getFramework, isAegisError } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { isUuid } from "@/server/queries/shield";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Badge } from "@/components/ui/badge";
import { Note } from "@/components/ui/note";
import { KeyValue } from "@/components/ui/key-value";
import { Panel } from "@/components/ui/panel";
import { ControlsTable } from "@/components/audit/controls-table";
import { ImportCsvDialog } from "@/components/audit/import-csv-dialog";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Framework ${id.slice(0, 8)}` };
}

export default async function FrameworkPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePermission("audit:read");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withTenant(
    c.ctx.orgId,
    async (db) => {
      try {
        const framework = await getFramework(db, c.ctx, id);
        const assessments = await db.assessment.count({ where: { orgId: c.ctx.orgId, frameworkId: id } });
        return { framework, assessments };
      } catch (e) {
        if (isAegisError(e) && e.code === "not_found") return null;
        throw e;
      }
    },
    { readOnly: true },
  );
  if (!data) notFound();
  const { framework, assessments } = data;
  const custom = framework.isCustom && framework.orgId === c.org.id;
  const canWrite = c.can("audit:write");
  const iso = /iso/i.test(framework.key) || /ISO/.test(framework.name);
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Standards", href: "/audit/standards" }, { label: framework.name }]}
        title={framework.name}
        badges={
          <>
            {framework.shared ? <Badge tone="info">Shared catalog</Badge> : <Badge tone="neutral">Custom</Badge>}
            {framework.version ? <Badge mono>v{framework.version}</Badge> : null}
            <DemoBadge show={c.org.demoMode} />
          </>
        }
        description={framework.description || undefined}
        actions={<ImportCsvDialog frameworkId={framework.id} custom={custom} canWrite={canWrite} />}
      />
      {framework.licenseNote ? <Note tone={iso ? "warning" : "info"} className="mb-4">{framework.licenseNote}</Note> : null}
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Framework" className="lg:col-span-1">
          <KeyValue
            items={[
              { label: "Key", value: framework.key, mono: true },
              { label: "Publisher", value: framework.publisher || null },
              { label: "Version", value: framework.version || null, mono: true },
              { label: "Controls", value: framework.controls.length },
              { label: "Categories", value: framework.categories.length },
              { label: "Assessments", value: assessments },
              { label: "Added", value: formatDateTime(framework.createdAt) },
            ]}
          />
        </Panel>
        <Panel title="How controls are assessed" className="lg:col-span-2">
          <p className="text-sm text-fg-muted">For each control the engine searches the selected documents with BM25 using the title, summary and keywords, measures keyword overlap and normative language in the best passage, and, when an automated evidence type is set, checks this organization&apos;s own AEGIS records. The result is covered, partial, ambiguous or missing with a confidence score. Similarity is not proof of compliance; every finding is labelled Automated until a person validates it.</p>
        </Panel>
      </div>
      <ControlsTable frameworkId={framework.id} controls={framework.controls.map((ctl) => ({ id: ctl.id, code: ctl.code, title: ctl.title, summary: ctl.summary, category: ctl.category, keywords: ctl.keywords, automatedEvidenceType: ctl.automatedEvidenceType }))} categories={framework.categories} custom={custom} canWrite={canWrite} evidenceTypes={AUTOMATED_EVIDENCE_TYPES} />
    </div>
  );
}
