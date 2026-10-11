"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { DateTime } from "@/components/ui/time";

export interface PlatformEventRow {
  id: string;
  type: string;
  actorId: string | null;
  org: string | null;
  detail: string;
  createdAt: string;
}

const columns: ColumnDef<PlatformEventRow, unknown>[] = [
  { id: "time", header: "Time", enableHiding: false, cell: ({ row }) => <span className="whitespace-nowrap"><DateTime value={row.original.createdAt} /></span>, meta: { width: 160 } },
  { id: "type", header: "Type", cell: ({ row }) => <span className="font-mono text-xs">{row.original.type}</span> },
  { id: "org", header: "Organization", cell: ({ row }) => row.original.org ?? <span className="text-fg-dim">platform</span> },
  { id: "actor", header: "Actor", cell: ({ row }) => <span className="font-mono text-[11px] text-fg-dim">{row.original.actorId ? row.original.actorId.slice(0, 8) : "system"}</span> },
  { id: "detail", header: "Detail", cell: ({ row }) => <span className="font-mono text-[11px] text-fg-muted">{row.original.detail}</span> },
];

export function PlatformEventsTable({ rows, pagination }: { rows: PlatformEventRow[]; pagination: { page: number; pageSize: number; total: number } }) {
  return <DataTable columns={columns} data={rows} getRowId={(r) => r.id} pagination={pagination} caption="Platform events" emptyState={<EmptyState title="No platform events" />} />;
}
