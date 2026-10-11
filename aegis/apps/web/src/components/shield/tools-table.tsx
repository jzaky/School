"use client";
import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Wrench } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, StatusCell } from "@/components/ui/status";
import { Sheet } from "@/components/ui/sheet";
import { KeyValue } from "@/components/ui/key-value";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeAgo } from "@/components/ui/time";
import { statusLabel, statusTone } from "@/lib/status";
import { eventStatusLabel, eventStatusTone, severityTone } from "./format";

export interface ToolRow {
  id: string;
  key: string;
  name: string;
  riskLevel: string;
  enabled: boolean;
  integration: { key: string; status: string } | null;
  agentsGranted: number;
  grantedAgents: { id: string; slug: string; name: string; status: string }[];
  allowedDomains: string[];
  allowedResourceKeys: string[];
  hasParameterSchema: boolean;
  deniedCount7d: number;
  requestCount7d: number;
  recentSecurityEvents: { id: string; type: string; severity: string; title: string; status: string; createdAt: string }[];
}

function ListCell({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <span className="text-fg-dim">{empty}</span>;
  return (
    <span className="font-mono text-xs" title={items.join(", ")}>
      {items.slice(0, 2).join(", ")}
      {items.length > 2 ? <span className="text-fg-dim"> +{items.length - 2}</span> : null}
    </span>
  );
}

const columns: ColumnDef<ToolRow, unknown>[] = [
  {
    id: "tool",
    header: "Tool",
    enableHiding: false,
    cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium text-fg">{row.original.name}</span>
        <span className="block truncate font-mono text-[11px] text-fg-dim">{row.original.key}</span>
      </span>
    ),
    meta: { width: 240 },
  },
  { id: "risk", header: "Risk", cell: ({ row }) => <Badge tone={statusTone(row.original.riskLevel)}>{statusLabel(row.original.riskLevel)}</Badge>, meta: { width: 90 } },
  { id: "state", header: "State", cell: ({ row }) => <StatusCell status={row.original.enabled ? "enabled" : "disabled"} />, meta: { width: 100 } },
  { id: "integration", header: "Integration", cell: ({ row }) => (row.original.integration ? <span className="inline-flex items-center gap-2 font-mono text-xs">{row.original.integration.key} <StatusBadge status={row.original.integration.status} /></span> : <span className="text-fg-dim">none</span>) },
  { id: "agents", header: "Agents", accessorKey: "agentsGranted", meta: { align: "end", width: 80 } },
  { id: "domains", header: "Allowed domains", cell: ({ row }) => <ListCell items={row.original.allowedDomains} empty="any (not restricted)" /> },
  { id: "resources", header: "Allowed resources", cell: ({ row }) => <ListCell items={row.original.allowedResourceKeys} empty="any granted" /> },
  { id: "denied", header: "Denied 7d", cell: ({ row }) => <span className={row.original.deniedCount7d > 0 ? "text-deny" : undefined}>{row.original.deniedCount7d}</span>, meta: { align: "end", width: 90 } },
  { id: "requests", header: "Requests 7d", accessorKey: "requestCount7d", meta: { align: "end", width: 100 } },
  { id: "events", header: "Recent events", cell: ({ row }) => (row.original.recentSecurityEvents.length ? <span className="inline-flex items-center gap-1">{row.original.recentSecurityEvents.slice(0, 3).map((e) => <Badge key={e.id} tone={severityTone(e.severity)}>{statusLabel(e.severity)}</Badge>)}</span> : <span className="text-fg-dim">none</span>) },
];

export function ToolsTable({ rows }: { rows: ToolRow[] }) {
  const [selected, setSelected] = React.useState<ToolRow | null>(null);
  return (
    <>
      <DataTable columns={columns} data={rows} getRowId={(r) => r.id} onRowClick={setSelected} storageKey="tool-security" caption="Tool security overview" emptyState={<EmptyState icon={Wrench} title="No tools registered" description="Tools are registered with integrations and granted to agents." />} />
      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)} title={selected?.name ?? ""} description={selected ? <span className="font-mono">{selected.key}</span> : undefined} width="lg">
        {selected ? (
          <div className="space-y-5">
            <KeyValue
              columns={2}
              items={[
                { label: "Risk level", value: <Badge tone={statusTone(selected.riskLevel)}>{statusLabel(selected.riskLevel)}</Badge> },
                { label: "State", value: <StatusBadge status={selected.enabled ? "enabled" : "disabled"} /> },
                { label: "Integration", value: selected.integration ? `${selected.integration.key} (${statusLabel(selected.integration.status)})` : null, mono: true },
                { label: "Parameter schema", value: selected.hasParameterSchema ? "Declared: parameters are validated" : "None: parameters are not validated" },
                { label: "Requests, last 7 days", value: selected.requestCount7d },
                { label: "Denied, last 7 days", value: selected.deniedCount7d },
              ]}
            />
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Destination allowlist</h3>
              {selected.allowedDomains.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {selected.allowedDomains.map((d) => (
                    <li key={d}>
                      <Badge mono>{d}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-fg-dim">No domain restriction. Requests with an external destination pass the destination check for this tool.</p>
              )}
            </section>
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Allowed resources</h3>
              {selected.allowedResourceKeys.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {selected.allowedResourceKeys.map((d) => (
                    <li key={d}>
                      <Badge mono>{d}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-fg-dim">Any resource the agent holds a permission for.</p>
              )}
            </section>
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Agents granted ({selected.agentsGranted})</h3>
              {selected.grantedAgents.length ? (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {selected.grantedAgents.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <Link href={`/agents/${a.id}`} className="text-accent hover:underline">
                        {a.name}
                      </Link>
                      <StatusBadge status={a.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-fg-dim">No agent holds an active grant for this tool.</p>
              )}
            </section>
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Recent security events</h3>
              {selected.recentSecurityEvents.length ? (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {selected.recentSecurityEvents.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <Link href={`/security/events/${e.id}`} className="block truncate text-accent hover:underline">
                          {e.title}
                        </Link>
                        <span className="block font-mono text-[11px] text-fg-dim">
                          {e.type} · {eventStatusLabel(e.status)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge tone={severityTone(e.severity)}>{statusLabel(e.severity)}</Badge>
                        <Badge tone={eventStatusTone(e.status)}>{eventStatusLabel(e.status)}</Badge>
                        <TimeAgo value={e.createdAt} className="text-xs text-fg-dim" />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-fg-dim">No security events mention this tool.</p>
              )}
            </section>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
