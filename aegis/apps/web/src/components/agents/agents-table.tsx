"use client";
import * as React from "react";
import { AUTONOMY_LEVEL_INFO, type AutonomyLevel } from "@aegis/core/autonomy/levels";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Search, X } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { StatusCell } from "@/components/ui/status";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Bot } from "lucide-react";
import { TimeAgo } from "@/components/ui/time";
import { statusLabel, statusTone } from "@/lib/status";

export interface AgentRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  posture: string;
  postureSentence: string;
  autonomyLevel: number;
  environment: string;
  riskTier: string;
  modelProvider: string;
  modelId: string;
  toolsCount: number;
  owner: string;
  lastActivityAt: string | null;
  requests: number;
}

const ALL = "__all__";

const columns: ColumnDef<AgentRow, unknown>[] = [
  {
    id: "name",
    header: "Name",
    enableHiding: false,
    cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium text-fg">{row.original.name}</span>
        <span className="block truncate font-mono text-[11px] text-fg-dim">{row.original.slug}</span>
      </span>
    ),
    meta: { width: 260 },
  },
  { id: "status", header: "Status", cell: ({ row }) => <StatusCell status={row.original.status} /> },
  {
    id: "posture",
    header: "Posture",
    cell: ({ row }) => (
      <span title={row.original.postureSentence} data-testid="agent-posture" data-posture={row.original.posture}>
        <Badge tone={statusTone(row.original.posture)}>{statusLabel(row.original.posture)}</Badge>
      </span>
    ),
  },
  {
    id: "autonomy",
    header: "Autonomy",
    cell: ({ row }) => {
      const l = row.original.autonomyLevel as AutonomyLevel;
      return (
        <span title={`Level ${l}: ${AUTONOMY_LEVEL_INFO[l]?.name ?? ""}. ${AUTONOMY_LEVEL_INFO[l]?.enforces ?? ""}`} data-testid="agent-autonomy" data-level={l}>
          <Badge tone={l >= 3 ? "allow" : l >= 1 ? "approval" : "deny"}>{`Level ${l}`}</Badge>
        </span>
      );
    },
  },
  { id: "environment", header: "Environment", cell: ({ row }) => statusLabel(row.original.environment) },
  { id: "riskTier", header: "Risk tier", cell: ({ row }) => <Badge tone={statusTone(row.original.riskTier)}>{statusLabel(row.original.riskTier)}</Badge> },
  {
    id: "model",
    header: "Model",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-fg-muted">
        {row.original.modelProvider ? `${row.original.modelProvider}/` : ""}
        {row.original.modelId || "unspecified"}
      </span>
    ),
  },
  { id: "tools", header: "Tools", accessorKey: "toolsCount", meta: { align: "end", width: 70 } },
  { id: "owner", header: "Owner", cell: ({ row }) => row.original.owner || <span className="text-fg-dim">unassigned</span> },
  { id: "lastActivity", header: "Last activity", cell: ({ row }) => <TimeAgo value={row.original.lastActivityAt} /> },
  { id: "requests", header: "Requests", accessorKey: "requests", meta: { align: "end", width: 90 } },
];

export function AgentsTable({ rows, pagination, filters }: { rows: AgentRow[]; pagination: { page: number; pageSize: number; total: number }; filters: { q: string; status: string; environment: string; riskTier: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = React.useState(filters.q);
  React.useEffect(() => setQ(filters.q), [filters.q]);

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }
  const hasFilters = Boolean(filters.q || filters.status || filters.environment || filters.riskTier);

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      rowHref={(r) => `/agents/${r.id}`}
      pagination={pagination}
      storageKey="agents"
      caption="AI agents"
      emptyState={<EmptyState icon={Bot} title={hasFilters ? "No agents match these filters" : "No agents registered"} description={hasFilters ? "Try clearing the filters." : "Register the first agent and assign its owner to start governing its actions. The Getting started checklist walks you through it."} action={hasFilters ? <Button size="sm" onClick={() => router.push(pathname)}>Clear filters</Button> : <Button size="sm" onClick={() => router.push("/getting-started")}>Open Getting started</Button>} />}
      toolbar={
        <>
          <form
            role="search"
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              apply({ q });
            }}
          >
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-dim" aria-hidden />
            <Input aria-label="Search agents" placeholder="Search name or slug" value={q} onChange={(e) => setQ(e.target.value)} className="w-56 ps-8" />
          </form>
          <Select aria-label="Status" value={filters.status || ALL} onValueChange={(v) => apply({ status: v })} className="w-40" options={[{ value: ALL, label: "All statuses" }, ...["draft", "registered", "active", "suspended", "revoked", "archived"].map((s) => ({ value: s, label: statusLabel(s) }))]} />
          <Select aria-label="Environment" value={filters.environment || ALL} onValueChange={(v) => apply({ environment: v })} className="w-40" options={[{ value: ALL, label: "All environments" }, ...["development", "staging", "production"].map((s) => ({ value: s, label: statusLabel(s) }))]} />
          <Select aria-label="Risk tier" value={filters.riskTier || ALL} onValueChange={(v) => apply({ riskTier: v })} className="w-36" options={[{ value: ALL, label: "All risk tiers" }, ...["low", "medium", "high", "critical"].map((s) => ({ value: s, label: statusLabel(s) }))]} />
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
