"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { KeyRound, Plus } from "lucide-react";
import { grantPermissionAction, revokePermissionAction } from "@/server/actions/agents";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { Input, Field } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { statusLabel, statusTone } from "@/lib/status";
import type { AgentCaps, AgentPermissionRow, CatalogResource } from "./types";
import { DateTime } from "@/components/ui/time";

const CLASS_ORDER = ["public", "internal", "confidential", "restricted"];

export function PermissionsTab({ agentId, permissions, resources, classificationLimit, caps }: { agentId: string; permissions: AgentPermissionRow[]; resources: CatalogResource[]; classificationLimit: string; caps: AgentCaps }) {
  const router = useRouter();
  const [resourceId, setResourceId] = React.useState<string | null>(null);
  const [actions, setActions] = React.useState("read");
  const [granting, setGranting] = React.useState(false);
  const [revoking, setRevoking] = React.useState<AgentPermissionRow | null>(null);
  const limitIdx = CLASS_ORDER.indexOf(classificationLimit);
  const options = resources.map((r) => {
    const over = CLASS_ORDER.indexOf(r.classification) > limitIdx;
    return { value: r.id, label: r.name, description: `${r.key}, ${statusLabel(r.classification)}${over ? " (above the agent's classification limit)" : ""}`, disabled: over };
  });
  const parsedActions = actions.split(",").map((a) => a.trim()).filter(Boolean);

  const columns: ColumnDef<AgentPermissionRow, unknown>[] = [
    { id: "resource", header: "Resource", enableHiding: false, cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium">{row.original.resourceName}</span>
        <span className="block truncate font-mono text-[11px] text-fg-dim">{row.original.resourceKey}</span>
      </span>
    ) },
    { id: "classification", header: "Classification", cell: ({ row }) => <Badge tone={statusTone(row.original.classification)}>{statusLabel(row.original.classification)}</Badge> },
    { id: "actions", header: "Actions", cell: ({ row }) => <span className="flex flex-wrap gap-1">{row.original.actions.map((a) => <Badge key={a} mono>{a}</Badge>)}</span> },
    { id: "state", header: "State", cell: ({ row }) => {
      const p = row.original;
      if (p.revokedAt) return <Tooltip content={<span>Revoked <DateTime value={p.revokedAt} /></span>}><span><Badge tone="deny">Revoked</Badge></span></Tooltip>;
      if (p.expiresAt && new Date(p.expiresAt) < new Date()) return <Badge tone="neutral">Expired</Badge>;
      return <Badge tone="allow">Active</Badge>;
    } },
    { id: "expires", header: "Expires", cell: ({ row }) => (row.original.expiresAt ? <DateTime value={row.original.expiresAt} /> : <span className="text-fg-dim">never</span>) },
    { id: "granted", header: "Granted", cell: ({ row }) => <DateTime value={row.original.createdAt} /> },
    { id: "row-actions", header: "", enableHiding: false, meta: { align: "end" }, cell: ({ row }) => row.original.revokedAt ? null : (
      <Button size="sm" variant="ghost" className="text-deny" disabled={!caps.canWrite} disabledReason="Requires agents:write" onClick={() => setRevoking(row.original)}>
        Revoke
      </Button>
    ) },
  ];

  const blockedReason = !caps.canWrite ? "Requires agents:write" : !caps.editable ? `A ${caps.status} agent cannot be edited` : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Resource" htmlFor="grant-resource" className="w-80" hint={`this agent may use data classified up to: ${statusLabel(classificationLimit)}`}>
          <Combobox id="grant-resource" value={resourceId} onChange={setResourceId} options={options} placeholder={resources.length ? "Choose a resource" : "No resources in the catalog"} disabled={!!blockedReason || resources.length === 0} />
        </Field>
        <Field label="Actions" htmlFor="grant-actions" className="w-56" hint="separate several actions with commas, for example read, write">
          <Input id="grant-actions" value={actions} onChange={(e) => setActions(e.target.value)} placeholder="read, write" disabled={!!blockedReason} className="font-mono" />
        </Field>
        <Button variant="primary" disabled={!!blockedReason || !resourceId || parsedActions.length === 0} disabledReason={blockedReason ?? "Choose a resource and at least one action"} loading={granting} onClick={async () => {
          if (!resourceId) return;
          setGranting(true);
          const r = await grantPermissionAction(agentId, { resourceId, actions: parsedActions, expiresAt: null });
          setGranting(false);
          if (!r.ok) return toast.error(r.error);
          toast.success("Permission granted");
          setResourceId(null);
          router.refresh();
        }}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Grant
        </Button>
      </div>
      <DataTable columns={columns} data={permissions} getRowId={(p) => p.id} columnVisibilityMenu={false} caption="Resource permissions" emptyState={<EmptyState icon={KeyRound} title="No resource permissions" description="Until a resource is granted here, the agent cannot act on it. Grant one and your policies will decide each action the agent tries on it." />} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={revoking ? `Revoke access to ${revoking.resourceName}` : ""}
        description="The agent loses this access. The permission is marked revoked and the change is kept in the evidence record."
        confirmLabel="Revoke permission"
        danger
        reason={{ required: true }}
        onConfirm={async ({ reason }) => {
          if (!revoking) return;
          const r = await revokePermissionAction(agentId, revoking.id, reason);
          if (!r.ok) return r.error;
          toast.success("Permission revoked");
          router.refresh();
        }}
      />
    </div>
  );
}
