"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ShieldAlert, X } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeAgo } from "@/components/ui/time";
import { statusLabel } from "@/lib/status";
import { eventStatusLabel, eventStatusTone, severityTone } from "./format";

export interface EventRow {
  id: string;
  createdAt: string;
  severity: string;
  type: string;
  title: string;
  agentId: string | null;
  agentName: string | null;
  actionRequestId: string | null;
  status: string;
  incidentNumber: number | null;
  incidentId: string | null;
}

export interface EventFilters {
  severity: string;
  status: string;
  type: string;
  agentId: string;
  since: string;
}

const ALL = "__all__";

const columns: ColumnDef<EventRow, unknown>[] = [
  { id: "time", header: "Time", cell: ({ row }) => <TimeAgo value={row.original.createdAt} />, meta: { width: 90 } },
  { id: "severity", header: "Severity", cell: ({ row }) => <Badge tone={severityTone(row.original.severity)}>{statusLabel(row.original.severity)}</Badge>, meta: { width: 90 } },
  { id: "type", header: "Type", cell: ({ row }) => <span className="font-mono text-xs text-fg-muted">{row.original.type}</span>, meta: { width: 220 } },
  { id: "title", header: "Title", enableHiding: false, cell: ({ row }) => <span className="block truncate font-medium text-fg">{row.original.title}</span> },
  {
    id: "agent",
    header: "Agent",
    cell: ({ row }) =>
      row.original.agentId ? (
        <Link href={`/agents/${row.original.agentId}`} className="text-accent hover:underline" data-no-row-click>
          {row.original.agentName ?? "Agent"}
        </Link>
      ) : (
        <span className="text-fg-dim">none</span>
      ),
  },
  {
    id: "request",
    header: "Request",
    cell: ({ row }) =>
      row.original.actionRequestId ? (
        <Link href={`/gateway/${row.original.actionRequestId}`} className="font-mono text-xs text-accent hover:underline" data-no-row-click>
          {row.original.actionRequestId.slice(0, 8)}
        </Link>
      ) : (
        <span className="text-fg-dim">none</span>
      ),
    meta: { width: 100 },
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-2">
        <StatusDot tone={eventStatusTone(row.original.status)} />
        <span>{eventStatusLabel(row.original.status)}</span>
        {row.original.incidentId ? (
          <Link href={`/security/incidents/${row.original.incidentId}`} className="font-mono text-xs text-accent hover:underline" data-no-row-click>
            #{row.original.incidentNumber}
          </Link>
        ) : null}
      </span>
    ),
    meta: { width: 170 },
  },
];

export function EventsTable({ rows, pagination, filters, types, agents }: { rows: EventRow[]; pagination: { page: number; pageSize: number; total: number }; filters: EventFilters; types: string[]; agents: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }
  const hasFilters = Object.values(filters).some(Boolean);
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      rowHref={(r) => `/security/events/${r.id}`}
      pagination={pagination}
      storageKey="security-events"
      caption="Security events"
      emptyState={<EmptyState icon={ShieldAlert} title={hasFilters ? "No events match these filters" : "No security events"} description={hasFilters ? "Try clearing the filters." : "Events appear when the gateway, Shield or monitoring flag something for an analyst."} action={hasFilters ? <Button size="sm" onClick={() => router.push(pathname)}>Clear filters</Button> : undefined} />}
      toolbar={
        <>
          <Select aria-label="Severity" value={filters.severity || ALL} onValueChange={(v) => apply({ severity: v })} className="w-36" options={[{ value: ALL, label: "All severities" }, ...["critical", "high", "medium", "low"].map((s) => ({ value: s, label: statusLabel(s) }))]} />
          <Select aria-label="Status" value={filters.status || ALL} onValueChange={(v) => apply({ status: v })} className="w-44" options={[{ value: ALL, label: "All statuses" }, ...["open", "triaged", "dismissed", "linked"].map((s) => ({ value: s, label: eventStatusLabel(s) }))]} />
          <Select aria-label="Type" value={filters.type || ALL} onValueChange={(v) => apply({ type: v })} className="w-56" options={[{ value: ALL, label: "All types" }, ...types.map((t) => ({ value: t, label: <span className="font-mono text-xs">{t}</span> }))]} />
          <Select aria-label="Agent" value={filters.agentId || ALL} onValueChange={(v) => apply({ agentId: v })} className="w-48" options={[{ value: ALL, label: "All agents" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
          <label className="flex items-center gap-1.5 text-xs text-fg-muted">
            Since
            <Input aria-label="Since" type="date" value={filters.since} onChange={(e) => apply({ since: e.target.value })} className="w-40" />
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
