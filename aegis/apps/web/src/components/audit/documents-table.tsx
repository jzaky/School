"use client";
import { useRegion } from "@/components/region-provider";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { FileCheck2, Trash2 } from "lucide-react";
import { deleteDocumentAction, documentPreviewAction, type DocumentPreview } from "@/server/actions/audit";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, StatusCell } from "@/components/ui/status";
import { Sheet } from "@/components/ui/sheet";
import { KeyValue } from "@/components/ui/key-value";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeAgo } from "@/components/ui/time";
import { Checkbox } from "@/components/ui/switch";
import { formatDateTime } from "@/lib/utils";
import { statusLabel } from "@/lib/status";
import { DOCUMENT_TYPE_LABELS, documentStatusTone, formatBytes } from "./format";

export interface DocumentRow {
  id: string;
  title: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  status: string;
  error: string | null;
  pageCount: number | null;
  chunkCount: number;
  retentionUntil: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

const columns: ColumnDef<DocumentRow, unknown>[] = [
  {
    id: "title",
    header: "Title",
    enableHiding: false,
    cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium text-fg">{row.original.title}</span>
        <span className="block truncate font-mono text-[11px] text-fg-dim">{row.original.filename}</span>
      </span>
    ),
    meta: { width: 320 },
  },
  { id: "type", header: "Type", cell: ({ row }) => <Badge mono>{DOCUMENT_TYPE_LABELS[row.original.mime] ?? row.original.mime}</Badge>, meta: { width: 90 } },
  { id: "size", header: "Size", cell: ({ row }) => formatBytes(row.original.size), meta: { align: "end", width: 90 } },
  { id: "status", header: "Status", cell: ({ row }) => <StatusCell status={row.original.status} label={statusLabel(row.original.status)} />, meta: { width: 110 } },
  { id: "pages", header: "Pages", cell: ({ row }) => row.original.pageCount ?? <span className="text-fg-dim">n/a</span>, meta: { align: "end", width: 70 } },
  { id: "chunks", header: "Chunks", accessorKey: "chunkCount", meta: { align: "end", width: 80 } },
  { id: "retention", header: "Retention", cell: ({ row }) => (row.original.retentionUntil ? <span title={formatDateTime(row.original.retentionUntil)}>until {row.original.retentionUntil.slice(0, 10)}</span> : <span className="text-fg-dim">indefinite</span>) },
  {
    id: "uploaded",
    header: "Uploaded",
    cell: ({ row }) => (
      <span>
        <TimeAgo value={row.original.createdAt} />
        {row.original.uploadedBy ? <span className="text-fg-muted"> by {row.original.uploadedBy}</span> : null}
      </span>
    ),
  },
];

export function DocumentsTable({ rows, pagination, canWrite }: { rows: DocumentRow[]; pagination: { page: number; pageSize: number; total: number }; canWrite: boolean }) {
  const region = useRegion();
  const router = useRouter();
  const [selected, setSelected] = React.useState<DocumentRow | null>(null);
  const [preview, setPreview] = React.useState<DocumentPreview | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [force, setForce] = React.useState(false);

  React.useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setPreview(null);
    setPreviewError(null);
    documentPreviewAction(selected.id).then((r) => {
      if (cancelled) return;
      if (r.ok) setPreview(r.data);
      else setPreviewError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const citedByCompleted = preview?.assessments.filter((a) => a.status === "completed").length ?? 0;

  return (
    <>
      <DataTable columns={columns} data={rows} getRowId={(r) => r.id} onRowClick={setSelected} pagination={pagination} storageKey="audit-documents" caption="Documents" emptyState={<EmptyState icon={FileCheck2} title="No documents" description="Upload policies and procedures to assess them against a framework." />} />
      <Sheet
        open={selected !== null}
        onOpenChange={(o) => {
          if (!o) {
            setSelected(null);
            setForce(false);
          }
        }}
        title={selected?.title ?? ""}
        description={selected ? <span className="font-mono">{selected.filename}</span> : undefined}
        width="lg"
        footer={
          selected ? (
            <Button variant="danger" disabled={!canWrite} disabledReason="Requires audit:write" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Delete document
            </Button>
          ) : undefined
        }
      >
        {selected ? (
          <div className="space-y-5">
            <KeyValue
              columns={2}
              items={[
                { label: "Status", value: <StatusBadge status={selected.status} tone={documentStatusTone(selected.status)} label={statusLabel(selected.status)} /> },
                { label: "Type", value: DOCUMENT_TYPE_LABELS[selected.mime] ?? selected.mime },
                { label: "Size", value: formatBytes(selected.size) },
                { label: "Pages", value: selected.pageCount ?? "n/a" },
                { label: "Chunks", value: selected.chunkCount },
                { label: "SHA-256", value: selected.sha256.slice(0, 24), mono: true },
                { label: "Retention", value: selected.retentionUntil ? `until ${formatDateTime(selected.retentionUntil, region)}` : "indefinite" },
                { label: "Uploaded", value: `${formatDateTime(selected.createdAt, region)}${selected.uploadedBy ? ` by ${selected.uploadedBy}` : ""}` },
              ]}
            />
            {selected.error ? <p className="rounded-md border border-deny/30 bg-deny/10 px-3 py-2 text-xs text-deny">The document could not be read (parse error): {selected.error}</p> : null}
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Assessments citing this document</h3>
              {preview === null && !previewError ? (
                <Skeleton className="h-8 w-full" />
              ) : preview && preview.assessments.length > 0 ? (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {preview.assessments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <Link href={`/audit/assessments/${a.id}`} className="min-w-0 truncate text-accent hover:underline">
                        {a.name} <span className="text-xs text-fg-muted">({a.frameworkName})</span>
                      </Link>
                      <StatusBadge status={a.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-fg-dim">Not referenced by any assessment.</p>
              )}
            </section>
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">First chunks {preview ? `(${Math.min(5, preview.chunks.length)} of ${preview.chunkCount})` : ""}</h3>
              {previewError ? (
                <p className="text-xs text-deny">{previewError}</p>
              ) : preview === null ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : preview.chunks.length === 0 ? (
                <p className="text-xs text-fg-dim">No passages yet: the document has not been read (parsed).</p>
              ) : (
                <ol className="space-y-2">
                  {preview.chunks.map((ch) => (
                    <li key={ch.idx} className="rounded-md border border-line bg-bg p-3">
                      <div className="mb-1 flex items-center justify-between font-mono text-[11px] text-fg-dim">
                        <span>
                          chunk {ch.idx}
                          {ch.page ? ` · page ${ch.page}` : ""}
                        </span>
                        <span>~{ch.tokens} tokens</span>
                      </div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-fg">{ch.text}</pre>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={selected ? `Delete ${selected.title}` : ""}
        description="Removes the stored file and its passages (chunks). The evidence ledger keeps the file's fingerprint (hash) and a record of the deletion."
        confirmLabel="Delete document"
        danger
        warning={
          citedByCompleted > 0 ? (
            <div className="space-y-2">
              <p>
                This document is cited by {citedByCompleted} completed assessment{citedByCompleted === 1 ? "" : "s"}. Deleting it removes the ability to re-verify those findings against the source text; the findings themselves are kept.
              </p>
              <Checkbox checked={force} onCheckedChange={setForce} label="Delete anyway (force)" description="Required when a completed assessment cites the document." />
            </div>
          ) : undefined
        }
        onConfirm={async () => {
          if (!selected) return;
          const r = await deleteDocumentAction(selected.id, force);
          if (!r.ok) return r.error;
          toast.success(`${selected.title} deleted`);
          setSelected(null);
          setForce(false);
          router.refresh();
        }}
      />
    </>
  );
}
