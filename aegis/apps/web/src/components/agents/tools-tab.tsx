"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plus, Wrench } from "lucide-react";
import { grantToolAction, revokeToolAction, setAgentToolEnabledAction } from "@/server/actions/agents";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { statusLabel, statusTone } from "@/lib/status";
import type { AgentCaps, AgentToolRow, CatalogTool } from "./types";
import { DateTime } from "@/components/ui/time";

export function ToolsTab({ agentId, tools, catalog, caps }: { agentId: string; tools: AgentToolRow[]; catalog: CatalogTool[]; caps: AgentCaps }) {
  const router = useRouter();
  const [toolToGrant, setToolToGrant] = React.useState<string | null>(null);
  const [granting, setGranting] = React.useState(false);
  const [revoking, setRevoking] = React.useState<AgentToolRow | null>(null);
  const granted = new Set(tools.filter((t) => !t.revokedAt).map((t) => t.toolId));
  const options = catalog.map((t) => ({ value: t.id, label: t.name, description: `${t.key} (${statusLabel(t.riskLevel)} risk${t.enabled ? "" : ", disabled org-wide"})`, disabled: granted.has(t.id) }));

  const columns: ColumnDef<AgentToolRow, unknown>[] = [
    { id: "tool", header: "Tool", enableHiding: false, cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium">{row.original.name}</span>
        <span className="block truncate font-mono text-[11px] text-fg-dim">{row.original.key}</span>
      </span>
    ) },
    { id: "integration", header: "Integration", cell: ({ row }) => row.original.integration ?? <span className="text-fg-dim">none</span> },
    { id: "risk", header: "Risk", cell: ({ row }) => <Badge tone={statusTone(row.original.riskLevel)}>{statusLabel(row.original.riskLevel)}</Badge> },
    { id: "state", header: "State", cell: ({ row }) => {
      const t = row.original;
      if (t.revokedAt) return <Tooltip content={<span>Revoked <DateTime value={t.revokedAt} />{t.revokedReason ? `: ${t.revokedReason}` : ""}</span>}><span><Badge tone="deny">Revoked</Badge></span></Tooltip>;
      if (!t.toolEnabled) return <Tooltip content="Disabled for the whole organization in Tool Security"><span><Badge tone="approval">Tool disabled</Badge></span></Tooltip>;
      return <Badge tone={t.enabled ? "allow" : "neutral"}>{t.enabled ? "Enabled" : "Disabled"}</Badge>;
    } },
    { id: "enabled", header: "Enabled", meta: { width: 80 }, cell: ({ row }) => {
      const t = row.original;
      const blocked = !!t.revokedAt || !caps.canWrite || !caps.editable;
      const reason = t.revokedAt ? "Revoked grants cannot be re-enabled. Grant the tool again." : !caps.canWrite ? "Requires agents:write" : !caps.editable ? `A ${caps.status} agent cannot be edited` : undefined;
      const sw = (
        <span data-no-row-click>
          <Switch aria-label={`${t.name} enabled`} checked={t.enabled && !t.revokedAt} disabled={blocked} onCheckedChange={async (v) => {
            const r = await setAgentToolEnabledAction(agentId, t.toolId, v);
            if (!r.ok) return toast.error(r.error);
            toast.success(`${t.name} ${v ? "enabled" : "disabled"}`);
            router.refresh();
          }} />
        </span>
      );
      return blocked && reason ? <Tooltip content={reason}>{sw}</Tooltip> : sw;
    } },
    { id: "granted", header: "Granted", cell: ({ row }) => <DateTime value={row.original.createdAt} /> },
    { id: "actions", header: "", enableHiding: false, meta: { align: "end" }, cell: ({ row }) => {
      const t = row.original;
      if (t.revokedAt) return null;
      return (
        <Button size="sm" variant="ghost" className="text-deny" disabled={!caps.canControl} disabledReason="Requires agents:control" onClick={() => setRevoking(t)}>
          Revoke
        </Button>
      );
    } },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-80">
          <label htmlFor="grant-tool" className="mb-1 block text-xs font-medium text-fg-muted">
            Grant a tool from the catalog
          </label>
          <Combobox id="grant-tool" value={toolToGrant} onChange={setToolToGrant} options={options} placeholder={catalog.length ? "Choose a tool" : "No tools in the catalog"} disabled={!caps.canWrite || !caps.editable || catalog.length === 0} />
        </div>
        <Button variant="primary" disabled={!toolToGrant || !caps.canWrite || !caps.editable} disabledReason={!caps.canWrite ? "Requires agents:write" : !caps.editable ? `A ${caps.status} agent cannot be edited` : "Choose a tool first"} loading={granting} onClick={async () => {
          if (!toolToGrant) return;
          setGranting(true);
          const r = await grantToolAction(agentId, toolToGrant);
          setGranting(false);
          if (!r.ok) return toast.error(r.error);
          toast.success("Tool granted");
          setToolToGrant(null);
          router.refresh();
        }}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Grant
        </Button>
      </div>
      <DataTable columns={columns} data={tools} getRowId={(t) => t.toolId} columnVisibilityMenu={false} caption="Agent tools" emptyState={<EmptyState icon={Wrench} title="No tools granted" description="This agent cannot call any tool through the gateway until one is granted." />} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={revoking ? `Revoke ${revoking.name}` : ""}
        description="Emergency control. Takes effect on the agent's next gateway call and is recorded in evidence."
        confirmLabel="Revoke tool"
        danger
        reason={{ required: true }}
        onConfirm={async ({ reason }) => {
          if (!revoking) return;
          const r = await revokeToolAction(agentId, revoking.toolId, reason);
          if (!r.ok) return r.error;
          toast.success(`${revoking.name} revoked`);
          router.refresh();
        }}
      />
    </div>
  );
}
