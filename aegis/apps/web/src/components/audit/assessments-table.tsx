"use client";
import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { StatusCell } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeAgo } from "@/components/ui/time";
import { findingTone } from "./format";
import { TONE_TEXT } from "@/lib/status";

export interface AssessmentRow {
  id: string;
  name: string;
  frameworkName: string;
  frameworkVersion: string;
  status: string;
  scope: string;
  documents: number;
  coveragePercent: number | null;
  counts: { covered: number; partial: number; ambiguous: number; missing: number } | null;
  startedBy: string | null;
  createdAt: string;
  completedAt: string | null;
}

const columns: ColumnDef<AssessmentRow, unknown>[] = [
  {
    id: "name",
    header: "Assessment",
    enableHiding: false,
    cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium text-fg">{row.original.name}</span>
        <span className="block truncate text-[11px] text-fg-dim">{row.original.scope || "no scope statement"}</span>
      </span>
    ),
    meta: { width: 300 },
  },
  { id: "framework", header: "Framework", cell: ({ row }) => <span>{row.original.frameworkName}{row.original.frameworkVersion ? <span className="ms-1 font-mono text-xs text-fg-muted">{row.original.frameworkVersion}</span> : null}</span> },
  { id: "status", header: "Status", cell: ({ row }) => <StatusCell status={row.original.status} label={row.original.status === "completed" ? "Completed" : undefined} />, meta: { width: 110 } },
  { id: "documents", header: "Documents", accessorKey: "documents", meta: { align: "end", width: 90 } },
  { id: "coverage", header: "Coverage", cell: ({ row }) => (row.original.coveragePercent === null ? <span className="text-fg-dim">n/a</span> : <span className={row.original.coveragePercent >= 70 ? "text-allow" : row.original.coveragePercent >= 40 ? "text-approval" : "text-deny"}>{row.original.coveragePercent}%</span>), meta: { align: "end", width: 90 } },
  {
    id: "counts",
    header: "Covered / partial / ambiguous / missing",
    cell: ({ row }) =>
      row.original.counts ? (
        <span className="tabular font-mono text-xs">
          <span className={TONE_TEXT[findingTone("covered")]}>{row.original.counts.covered}</span> / <span className={TONE_TEXT[findingTone("partial")]}>{row.original.counts.partial}</span> / <span className={TONE_TEXT[findingTone("ambiguous")]}>{row.original.counts.ambiguous}</span> / <span className={TONE_TEXT[findingTone("missing")]}>{row.original.counts.missing}</span>
        </span>
      ) : (
        <span className="text-fg-dim">not run</span>
      ),
    meta: { width: 260 },
  },
  { id: "startedBy", header: "Started by", cell: ({ row }) => row.original.startedBy ?? <span className="text-fg-dim">unknown</span> },
  { id: "completed", header: "Completed", cell: ({ row }) => <TimeAgo value={row.original.completedAt} />, meta: { width: 100 } },
];

export function AssessmentsTable({ rows, pagination }: { rows: AssessmentRow[]; pagination: { page: number; pageSize: number; total: number } }) {
  return <DataTable columns={columns} data={rows} getRowId={(r) => r.id} rowHref={(r) => `/audit/assessments/${r.id}`} pagination={pagination} storageKey="assessments" caption="Assessments" emptyState={<EmptyState icon={ClipboardList} title="No assessments" description="An assessment reads your uploaded documents and checks them against a framework, control by control. Create one to start." />} />;
}
