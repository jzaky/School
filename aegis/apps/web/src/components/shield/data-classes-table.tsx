"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { deleteDataClassAction, updateDataClassAction } from "@/server/actions/shield";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { statusLabel } from "@/lib/status";
import { DATA_ACTION_LABELS, severityTone } from "./format";

export interface DataClassRow {
  id: string;
  key: string;
  name: string;
  description: string;
  detector: string;
  pattern: string | null;
  patternValid: boolean;
  action: string;
  severity: string;
  enabled: boolean;
  isSystem: boolean;
}

const ACTIONS = ["allow", "mask", "redact", "block", "require_approval"];
const SEVERITIES = ["low", "medium", "high", "critical"];

export function DataClassesTable({ rows, canWrite }: { rows: DataClassRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [toDelete, setToDelete] = React.useState<DataClassRow | null>(null);
  const reason = canWrite ? undefined : "Requires security:write";

  async function patch(row: DataClassRow, p: Record<string, unknown>, label: string) {
    setBusy(row.id);
    const r = await updateDataClassAction(row.id, p);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(`${row.name}: ${label}`);
    router.refresh();
  }

  return (
    <>
      <SimpleTable caption="Data classes">
        <thead>
          <tr>
            <Th>Class</Th>
            <Th>Detector</Th>
            <Th>Action</Th>
            <Th>Severity</Th>
            <Th>Enabled</Th>
            <Th>Origin</Th>
            <Th align="end">
              <span className="sr-only">Remove</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Tr key={row.id} className={busy === row.id ? "opacity-60" : undefined}>
              <Td className="max-w-[360px]">
                <span className="block truncate font-medium text-fg">{row.name}</span>
                <span className="block truncate font-mono text-[11px] text-fg-dim">{row.key}</span>
                {row.description ? <span className="block truncate text-xs text-fg-muted">{row.description}</span> : null}
              </Td>
              <Td>
                <span className="font-mono text-xs text-fg-muted">{row.detector}</span>
                {row.detector === "custom_regex" ? (
                  <Tooltip content={row.pattern ?? ""}>
                    <span className="ms-2">
                      <Badge tone={row.patternValid ? "neutral" : "deny"} mono>
                        {row.patternValid ? "pattern ok" : "pattern invalid"}
                      </Badge>
                    </span>
                  </Tooltip>
                ) : null}
              </Td>
              <Td>
                <Select aria-label={`Action for ${row.name}`} size="sm" className="w-40" value={row.action} disabled={!canWrite || busy === row.id} onValueChange={(v) => patch(row, { action: v }, `action set to ${DATA_ACTION_LABELS[v] ?? v}`)} options={ACTIONS.map((a) => ({ value: a, label: DATA_ACTION_LABELS[a] ?? a }))} />
              </Td>
              <Td>
                <Select aria-label={`Severity for ${row.name}`} size="sm" className="w-28" value={row.severity} disabled={!canWrite || busy === row.id} onValueChange={(v) => patch(row, { severity: v }, `severity set to ${statusLabel(v)}`)} options={SEVERITIES.map((s) => ({ value: s, label: <Badge tone={severityTone(s)}>{statusLabel(s)}</Badge> }))} />
              </Td>
              <Td>
                {canWrite ? (
                  <Switch aria-label={`${row.name} enabled`} checked={row.enabled} disabled={busy === row.id} onCheckedChange={(v) => patch(row, { enabled: v }, v ? "enabled" : "disabled")} />
                ) : (
                  <Tooltip content={reason}>
                    <span className="inline-flex" tabIndex={0}>
                      <Switch aria-label={`${row.name} enabled`} checked={row.enabled} disabled />
                    </span>
                  </Tooltip>
                )}
              </Td>
              <Td>{row.isSystem ? <Badge tone="info">System</Badge> : <Badge tone="neutral">Custom</Badge>}</Td>
              <Td align="end">
                {row.isSystem ? (
                  <IconButton label="Remove class" size="sm" disabled disabledReason="System classes cannot be deleted. Disable the class instead.">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </IconButton>
                ) : (
                  <IconButton label={`Remove ${row.name}`} size="sm" disabled={!canWrite} disabledReason={reason} onClick={() => setToDelete(row)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </IconButton>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </SimpleTable>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={toDelete ? `Remove ${toDelete.name}` : ""}
        description="The class stops being detected immediately. Past findings and evidence are kept."
        confirmLabel="Remove class"
        danger
        typed={toDelete?.key}
        onConfirm={async () => {
          if (!toDelete) return;
          const r = await deleteDataClassAction(toDelete.id);
          if (!r.ok) return r.error;
          toast.success(`${toDelete.name} removed`);
          router.refresh();
        }}
      />
    </>
  );
}
