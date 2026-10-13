"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Scale, X } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { StatusCell } from "@/components/ui/status";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeAgo } from "@/components/ui/time";
import { statusLabel } from "@/lib/status";
import { POLICY_CATEGORIES } from "./policy-templates";

export interface PolicyRow {
  id: string;
  name: string;
  key: string;
  description: string;
  category: string;
  activeVersion: number | null;
  latestVersion: number | null;
  latestState: string | null;
  assignments: number;
  decisions: number;
  versions: number;
  updatedAt: string;
}

const ALL = "__all__";

const columns: ColumnDef<PolicyRow, unknown>[] = [
  {
    id: "name",
    header: "Policy",
    enableHiding: false,
    cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium text-fg">{row.original.name}</span>
        <span className="block truncate font-mono text-[11px] text-fg-dim">{row.original.key}</span>
      </span>
    ),
    meta: { width: 280 },
  },
  { id: "category", header: "Category", cell: ({ row }) => statusLabel(row.original.category) },
  { id: "active", header: "Active version", cell: ({ row }) => (row.original.activeVersion ? <Badge tone="allow">v{row.original.activeVersion}</Badge> : <Badge>None</Badge>) },
  { id: "latest", header: "Latest version", cell: ({ row }) => (row.original.latestVersion ? <span className="inline-flex items-center gap-2"><span className="font-mono text-xs">v{row.original.latestVersion}</span><StatusCell status={row.original.latestState} /></span> : <span className="text-fg-dim">none</span>) },
  { id: "assignments", header: "Assignments", accessorKey: "assignments", meta: { align: "end", width: 110 } },
  { id: "decisions", header: "Decisions", accessorKey: "decisions", meta: { align: "end", width: 100 } },
  { id: "versions", header: "Versions", accessorKey: "versions", meta: { align: "end", width: 90 } },
  { id: "updated", header: "Updated", cell: ({ row }) => <TimeAgo value={row.original.updatedAt} /> },
];

export function PoliciesTable({ rows, filters }: { rows: PolicyRow[]; filters: { category: string; state: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`);
  }
  const hasFilters = Boolean(filters.category || filters.state);
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      rowHref={(r) => `/policies/${r.id}`}
      storageKey="policies"
      caption="Policies"
      emptyState={<EmptyState icon={Scale} title={hasFilters ? "No policies match these filters" : "No policies yet"} description={hasFilters ? "Try clearing the filters." : "A policy sets what agents may do on their own, what needs a person to approve, and what is refused. Create the first one here."} action={hasFilters ? <Button size="sm" onClick={() => router.push(pathname)}>Clear filters</Button> : undefined} />}
      toolbar={
        <>
          <Select aria-label="Category" value={filters.category || ALL} onValueChange={(v) => apply({ category: v })} className="w-44" options={[{ value: ALL, label: "All categories" }, ...POLICY_CATEGORIES]} />
          <Select aria-label="Latest version state" value={filters.state || ALL} onValueChange={(v) => apply({ state: v })} className="w-44" options={[{ value: ALL, label: "All states" }, ...["draft", "review", "active", "retired"].map((s) => ({ value: s, label: statusLabel(s) }))]} />
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={() => router.push(pathname)}>
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear
            </Button>
          ) : null}
        </>
      }
    />
  );
}
