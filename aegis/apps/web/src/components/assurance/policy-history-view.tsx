"use client";
import * as React from "react";
import Link from "next/link";
import { History, X } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { DateTime, TimeAgo } from "@/components/ui/time";
import { statusLabel } from "@/lib/status";

export interface HistoryRow {
  id: string;
  policyId: string;
  policyKey: string;
  policyName: string;
  version: number | null;
  type: string;
  actor: string;
  note: string;
  createdAt: string;
}

const ALL = "__all__";
const TONE: Record<string, "allow" | "deny" | "approval" | "info" | "neutral"> = { created: "allow", activated: "allow", deactivated: "deny", rolled_back: "approval", submitted: "info", revised: "neutral" };

export function PolicyHistoryView({ rows }: { rows: HistoryRow[] }) {
  const [policy, setPolicy] = React.useState(ALL);
  const [type, setType] = React.useState(ALL);
  const policies = [...new Map(rows.map((r) => [r.policyId, r])).values()].sort((a, b) => a.policyName.localeCompare(b.policyName));
  const types = [...new Set(rows.map((r) => r.type))].sort();
  const visible = rows.filter((r) => (policy === ALL || r.policyId === policy) && (type === ALL || r.type === type));
  const filtered = policy !== ALL || type !== ALL;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Policy" value={policy} onValueChange={setPolicy} className="w-64" options={[{ value: ALL, label: "All policies" }, ...policies.map((p) => ({ value: p.policyId, label: p.policyName }))]} />
        <Select aria-label="Event type" value={type} onValueChange={setType} className="w-44" options={[{ value: ALL, label: "All event types" }, ...types.map((t) => ({ value: t, label: statusLabel(t) }))]} />
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPolicy(ALL);
              setType(ALL);
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </Button>
        ) : null}
        <span className="ms-auto text-xs text-fg-muted">
          {visible.length} of {rows.length} events
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="rounded-panel border border-line bg-bg-elev">
          <EmptyState icon={History} title="No policy events match" />
        </div>
      ) : (
        <SimpleTable caption="Policy history">
          <thead>
            <tr>
              <Th>Policy</Th>
              <Th>Version</Th>
              <Th>Event</Th>
              <Th>Actor</Th>
              <Th>Note</Th>
              <Th>When</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <Link href={`/policies/${r.policyId}?tab=history`} className="block min-w-0 hover:underline">
                    <span className="block truncate text-fg">{r.policyName}</span>
                    <span className="block font-mono text-[11px] text-fg-dim">{r.policyKey}</span>
                  </Link>
                </Td>
                <Td mono>{r.version !== null ? `v${r.version}` : ""}</Td>
                <Td>
                  <Badge tone={TONE[r.type] ?? "neutral"}>{statusLabel(r.type)}</Badge>
                </Td>
                <Td>{r.actor}</Td>
                <Td className="max-w-[360px] truncate text-xs text-fg-muted" title={r.note}>
                  {r.note || <span className="text-fg-dim">none</span>}
                </Td>
                <Td className="text-xs">
                  <TimeAgo value={r.createdAt} /> <span className="text-fg-dim">(<DateTime value={r.createdAt} />)</span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </SimpleTable>
      )}
    </div>
  );
}
