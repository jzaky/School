"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { GitBranch, Search, X } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { StatusCell } from "@/components/ui/status";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeAgo } from "@/components/ui/time";
import { formatMoney } from "@/lib/utils";
import { statusLabel } from "@/lib/status";

export interface RequestRow {
  id: string;
  createdAt: string;
  agentName: string;
  agentSlug: string;
  toolKey: string;
  action: string;
  resourceKey: string | null;
  amount: number | null;
  currency: string | null;
  status: string;
  decision: string | null;
  matchedRules: string[];
  latencyMs: number | null;
  receiptRef: string | null;
  receiptStatus: string | null;
}

const ALL = "__all__";
const STATUSES = ["evaluating", "allowed", "denied", "pending_approval", "approved", "rejected", "expired", "executing", "executed", "failed", "unknown"];

const columns: ColumnDef<RequestRow, unknown>[] = [
  { id: "time", header: "Time", enableHiding: false, cell: ({ row }) => <TimeAgo value={row.original.createdAt} />, meta: { width: 90 } },
  {
    id: "agent",
    header: "Agent",
    cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="block truncate text-fg">{row.original.agentName}</span>
        <span className="block truncate font-mono text-[11px] text-fg-dim">{row.original.agentSlug}</span>
      </span>
    ),
  },
  {
    id: "tool",
    header: "Tool / action",
    cell: ({ row }) => (
      <span className="font-mono text-xs">
        {row.original.toolKey}
        <span className="text-fg-dim"> / {row.original.action}</span>
      </span>
    ),
  },
  { id: "resource", header: "Resource", cell: ({ row }) => (row.original.resourceKey ? <span className="font-mono text-xs">{row.original.resourceKey}</span> : <span className="text-fg-dim">none</span>) },
  { id: "amount", header: "Amount", cell: ({ row }) => (row.original.amount !== null ? formatMoney(row.original.amount, row.original.currency ?? "AED") : <span className="text-fg-dim">n/a</span>), meta: { align: "end", width: 130 } },
  { id: "status", header: "Status", cell: ({ row }) => <StatusCell status={row.original.status} /> },
  { id: "decision", header: "Decision", cell: ({ row }) => (row.original.decision ? <StatusCell status={row.original.decision} /> : <span className="text-fg-dim">none</span>) },
  {
    id: "rules",
    header: "Matched rules",
    cell: ({ row }) =>
      row.original.matchedRules.length ? (
        <span className="flex flex-wrap gap-1">
          {row.original.matchedRules.slice(0, 2).map((r) => (
            <Badge key={r} mono>
              {r.split("/").pop()}
            </Badge>
          ))}
          {row.original.matchedRules.length > 2 ? <Badge>+{row.original.matchedRules.length - 2}</Badge> : null}
        </span>
      ) : (
        <span className="text-fg-dim">none</span>
      ),
  },
  { id: "latency", header: "Latency", cell: ({ row }) => (row.original.latencyMs !== null ? `${row.original.latencyMs} ms` : ""), meta: { align: "end", width: 90 } },
  { id: "receipt", header: "Receipt", cell: ({ row }) => (row.original.receiptRef ? <span className="font-mono text-xs">{row.original.receiptRef}</span> : row.original.receiptStatus ? <StatusCell status={row.original.receiptStatus} /> : <span className="text-fg-dim">none</span>) },
];

export function GatewayTable({ rows, pagination, filters, agents, tools }: { rows: RequestRow[]; pagination: { page: number; pageSize: number; total: number }; filters: { status: string; agentId: string; tool: string; q: string; since: string }; agents: { id: string; name: string }[]; tools: string[] }) {
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
  const hasFilters = Boolean(filters.status || filters.agentId || filters.tool || filters.q || filters.since);
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      rowHref={(r) => `/gateway/${r.id}`}
      pagination={pagination}
      storageKey="gateway"
      caption="Action requests"
      emptyState={<EmptyState icon={GitBranch} title={hasFilters ? "No requests match these filters" : "No action requests yet"} description={hasFilters ? "Try clearing the filters." : "Every request an agent sends through the Action Gateway appears here as it happens."} action={hasFilters ? <Button size="sm" onClick={() => router.push(pathname)}>Clear filters</Button> : undefined} />}
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
            <Input aria-label="Search requests" placeholder="Correlation id, tool, justification" value={q} onChange={(e) => setQ(e.target.value)} className="w-64 ps-8" />
          </form>
          <Select aria-label="Status" value={filters.status || ALL} onValueChange={(v) => apply({ status: v })} className="w-44" options={[{ value: ALL, label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))]} />
          <Select aria-label="Agent" value={filters.agentId || ALL} onValueChange={(v) => apply({ agentId: v })} className="w-52" options={[{ value: ALL, label: "All agents" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
          <Select aria-label="Tool" value={filters.tool || ALL} onValueChange={(v) => apply({ tool: v })} className="w-48" options={[{ value: ALL, label: "All tools" }, ...tools.map((t) => ({ value: t, label: t }))]} />
          <label className="flex items-center gap-1.5 text-xs text-fg-muted">
            Since
            <Input type="date" aria-label="Since date" value={filters.since} onChange={(e) => apply({ since: e.target.value })} className="w-40" />
          </label>
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
