"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Siren } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { StatusCell } from "@/components/ui/status";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeAgo } from "@/components/ui/time";
import { statusLabel } from "@/lib/status";
import { severityTone } from "./format";

export interface IncidentRow {
  id: string;
  number: number;
  title: string;
  severity: string;
  status: string;
  assignee: string | null;
  agents: string[];
  linkedEvents: number;
  createdAt: string;
  resolvedAt: string | null;
}

const columns: ColumnDef<IncidentRow, unknown>[] = [
  { id: "number", header: "#", cell: ({ row }) => <span className="font-mono text-xs text-fg-muted">#{row.original.number}</span>, meta: { width: 60 } },
  { id: "title", header: "Title", enableHiding: false, cell: ({ row }) => <span className="block truncate font-medium text-fg">{row.original.title}</span> },
  { id: "severity", header: "Severity", cell: ({ row }) => <Badge tone={severityTone(row.original.severity)}>{statusLabel(row.original.severity)}</Badge>, meta: { width: 90 } },
  { id: "status", header: "Status", cell: ({ row }) => <StatusCell status={row.original.status} />, meta: { width: 120 } },
  { id: "assignee", header: "Assignee", cell: ({ row }) => row.original.assignee ?? <span className="text-fg-dim">unassigned</span> },
  { id: "agents", header: "Agents", cell: ({ row }) => (row.original.agents.length ? <span className="truncate" title={row.original.agents.join(", ")}>{row.original.agents.join(", ")}</span> : <span className="text-fg-dim">none</span>) },
  { id: "events", header: "Events", accessorKey: "linkedEvents", meta: { align: "end", width: 70 } },
  { id: "opened", header: "Opened", cell: ({ row }) => <TimeAgo value={row.original.createdAt} />, meta: { width: 90 } },
  { id: "resolved", header: "Resolved", cell: ({ row }) => <TimeAgo value={row.original.resolvedAt} />, meta: { width: 90 } },
];

const TABS = ["all", "open", "investigating", "contained", "resolved"] as const;

export function IncidentsTable({ rows, pagination, status, counts }: { rows: IncidentRow[]; pagination: { page: number; pageSize: number; total: number }; status: string; counts: Record<string, number> }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = TABS.includes(status as (typeof TABS)[number]) ? status : "all";
  function setStatus(v: string) {
    const next = new URLSearchParams(sp.toString());
    if (v === "all") next.delete("status");
    else next.set("status", v);
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div>
      <Tabs value={current} onValueChange={setStatus}>
        <TabsList aria-label="Incident status">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t} count={t === "all" ? total : (counts[t] ?? 0)}>
              {t === "all" ? "All" : statusLabel(t)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable columns={columns} data={rows} getRowId={(r) => r.id} rowHref={(r) => `/security/incidents/${r.id}`} pagination={pagination} storageKey="incidents" caption="Incidents" emptyState={<EmptyState icon={Siren} title={current === "all" ? "No incidents" : `No ${statusLabel(current).toLowerCase()} incidents`} description="Incidents are opened by analysts or automatically from critical security events." />} />
    </div>
  );
}
