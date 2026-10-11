import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { documentListFilter, listDocuments } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { flatParams } from "@/server/queries/shield";
import { userNames } from "@/server/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { StatPanel } from "@/components/ui/stat-panel";
import { Note } from "@/components/ui/note";
import { DocumentsTable, type DocumentRow } from "@/components/audit/documents-table";
import { UploadDocumentDialog } from "@/components/audit/upload-document-dialog";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("audit:read");
  const flat = flatParams(await searchParams);
  const parsed = documentListFilter.safeParse(flat);
  const filter = parsed.success ? parsed.data : documentListFilter.parse({});
  const canWrite = c.can("audit:write");
  const { page, all } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const [page, all] = await Promise.all([listDocuments(db, c.ctx, filter), db.document.groupBy({ by: ["status"], where: { orgId: c.ctx.orgId }, _count: { _all: true }, _sum: { size: true, chunkCount: true } })]);
      return { page, all };
    },
    { readOnly: true },
  );
  const names = await userNames(page.items.map((d) => d.uploadedBy));
  const rows: DocumentRow[] = page.items.map((d) => ({
    id: d.id,
    title: d.title,
    filename: d.filename,
    mime: d.mime,
    size: d.size,
    sha256: d.sha256,
    status: d.status,
    error: d.error,
    pageCount: d.pageCount,
    chunkCount: d.chunkCount,
    retentionUntil: d.retentionUntil?.toISOString() ?? null,
    uploadedBy: names.get(d.uploadedBy ?? "") ?? null,
    createdAt: d.createdAt.toISOString(),
  }));
  const count = (s: string) => all.find((r) => r.status === s)?._count._all ?? 0;
  const totalDocs = all.reduce((a, r) => a + r._count._all, 0);
  const totalChunks = all.reduce((a, r) => a + (r._sum.chunkCount ?? 0), 0);
  const totalBytes = all.reduce((a, r) => a + (r._sum.size ?? 0), 0);
  return (
    <div>
      <PageHeader title="Documents" description="Policies and procedures the assessment engine searches for evidence. Files are stored under opaque names in this deployment and chunked for lexical retrieval." badges={<DemoBadge show={c.org.demoMode} />} actions={<UploadDocumentDialog canWrite={canWrite} />} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPanel label="Documents" value={totalDocs} footer={`${(totalBytes / (1024 * 1024)).toFixed(1)} MB stored`} />
        <StatPanel label="Parsed" value={count("parsed")} tone="allow" footer={`${totalChunks} chunks indexed`} />
        <StatPanel label="Failed" value={count("failed")} tone={count("failed") > 0 ? "deny" : "neutral"} />
        <StatPanel label="Awaiting parse" value={count("uploaded") + count("parsing")} />
      </div>
      <Note className="mb-4">Documents never leave this deployment. Parsing runs in this process, content is never logged, and the evidence ledger records only size, type and hash.</Note>
      <DocumentsTable rows={rows} pagination={{ page: page.page, pageSize: page.pageSize, total: page.total }} canWrite={canWrite} />
    </div>
  );
}
