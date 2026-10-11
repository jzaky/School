"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileText } from "lucide-react";
import { generateReportAction } from "@/server/actions/audit";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/code-block";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { TimeAgo } from "@/components/ui/time";
import { formatBytes, REPORT_KIND_DESCRIPTIONS, REPORT_KIND_LABELS } from "./format";

export interface ExportRow {
  id: string;
  kind: string;
  format: string;
  size: number;
  sha256: string;
  createdBy: string | null;
  createdAt: string;
  assessmentId: string | null;
  assessmentName: string | null;
  frameworkName: string | null;
}

export interface AssessmentOption {
  id: string;
  name: string;
  frameworkName: string;
}

const KINDS = Object.keys(REPORT_KIND_LABELS);

export function GenerateReportForm({ assessments, fixedAssessmentId, canGenerate, compact }: { assessments: AssessmentOption[]; fixedAssessmentId?: string; canGenerate: boolean; compact?: boolean }) {
  const router = useRouter();
  const [assessmentId, setAssessmentId] = React.useState(fixedAssessmentId ?? assessments[0]?.id ?? "");
  const [kind, setKind] = React.useState("executive_summary");
  const [format, setFormat] = React.useState("pdf");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const reason = !canGenerate ? "Requires audit:write" : !assessmentId ? "No completed assessment to report on" : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await generateReportAction({ assessmentId, kind, format });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`${REPORT_KIND_LABELS[r.data.kind] ?? r.data.kind} generated (${formatBytes(r.data.bytes)})`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className={compact ? "flex flex-wrap items-end gap-3" : "grid gap-3 md:grid-cols-4"} data-testid="generate-report-form">
      {!fixedAssessmentId ? (
        <Field label="Assessment" htmlFor="rep-assessment" className={compact ? "min-w-[260px]" : "md:col-span-2"}>
          <Select id="rep-assessment" value={assessmentId} onValueChange={setAssessmentId} options={assessments.map((a) => ({ value: a.id, label: `${a.name} (${a.frameworkName})` }))} placeholder="Select a completed assessment" />
        </Field>
      ) : null}
      <Field label="Report kind" htmlFor="rep-kind" className={compact ? "min-w-[220px]" : undefined}>
        <Select id="rep-kind" value={kind} onValueChange={setKind} options={KINDS.map((k) => ({ value: k, label: REPORT_KIND_LABELS[k] ?? k }))} />
      </Field>
      <Field label="Format" htmlFor="rep-format" className={compact ? "w-28" : undefined}>
        <Select id="rep-format" value={format} onValueChange={setFormat} options={[{ value: "pdf", label: "PDF" }, { value: "json", label: "JSON" }]} />
      </Field>
      <div className={compact ? undefined : "md:col-span-4 flex items-center gap-3"}>
        <Button type="submit" variant="primary" loading={pending} disabled={!!reason} disabledReason={reason}>
          <FileText className="h-3.5 w-3.5" aria-hidden />
          Generate report
        </Button>
        {!compact ? <FormError error={error} /> : null}
      </div>
      {compact ? <FormError error={error} /> : null}
    </form>
  );
}

export function ExportsTable({ rows, showAssessment = true, canDownload }: { rows: ExportRow[]; showAssessment?: boolean; canDownload: boolean }) {
  return (
    <SimpleTable caption="Report exports">
      <thead>
        <tr>
          <Th>Report</Th>
          <Th>Format</Th>
          {showAssessment ? <Th>Assessment</Th> : null}
          <Th align="end">Size</Th>
          <Th>SHA-256</Th>
          <Th>Created</Th>
          <Th align="end">
            <span className="sr-only">Download</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={showAssessment ? 7 : 6} className="px-3 py-8 text-center text-xs text-fg-dim">
              No reports generated yet.
            </td>
          </tr>
        ) : null}
        {rows.map((r) => (
          <Tr key={r.id} data-export={r.id}>
            <Td className="font-medium">{REPORT_KIND_LABELS[r.kind] ?? r.kind}</Td>
            <Td>
              <Badge mono>{r.format.toUpperCase()}</Badge>
            </Td>
            {showAssessment ? (
              <Td className="max-w-[280px] truncate">
                {r.assessmentId ? (
                  <Link href={`/audit/assessments/${r.assessmentId}`} className="text-accent hover:underline">
                    {r.assessmentName ?? "Assessment"}
                  </Link>
                ) : (
                  <span className="text-fg-dim">unknown</span>
                )}
                {r.frameworkName ? <span className="ms-1 text-xs text-fg-muted">({r.frameworkName})</span> : null}
              </Td>
            ) : null}
            <Td align="end">{formatBytes(r.size)}</Td>
            <Td>
              <span className="inline-flex items-center gap-1">
                <span className="font-mono text-xs text-fg-muted" title={r.sha256}>
                  {r.sha256.slice(0, 12)}
                </span>
                <CopyButton value={r.sha256} label="Copy SHA-256" />
              </span>
            </Td>
            <Td>
              <TimeAgo value={r.createdAt} />
              {r.createdBy ? <span className="text-fg-muted"> by {r.createdBy}</span> : null}
            </Td>
            <Td align="end">
              {canDownload ? (
                <a href={`/audit/reports/download/${r.id}`} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong bg-bg-elev px-2.5 text-xs font-medium text-fg hover:bg-bg-elev-2" download>
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Download
                </a>
              ) : (
                <Button size="sm" disabled disabledReason="Requires reports:read">
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Download
                </Button>
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </SimpleTable>
  );
}

export function ReportKindList() {
  return (
    <dl className="grid gap-2 text-xs md:grid-cols-2">
      {KINDS.map((k) => (
        <div key={k} className="rounded-md border border-line bg-bg p-3">
          <dt className="font-medium text-fg">{REPORT_KIND_LABELS[k]}</dt>
          <dd className="mt-0.5 text-fg-muted">{REPORT_KIND_DESCRIPTIONS[k]}</dd>
        </div>
      ))}
    </dl>
  );
}
