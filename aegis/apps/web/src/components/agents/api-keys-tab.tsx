"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { AlertTriangle, KeyRound, Plus } from "lucide-react";
import { issueAgentKeyAction, revokeAgentKeyAction } from "@/server/actions/agents";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CodeBlock } from "@/components/ui/code-block";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import type { AgentCaps, AgentKeyRow } from "./types";
import { DateTime, TimeAgo } from "@/components/ui/time";

export function ApiKeysTab({ agentId, keys, caps }: { agentId: string; keys: AgentKeyRow[]; caps: AgentCaps }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [expiry, setExpiry] = React.useState("90");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<{ key: string; prefix: string } | null>(null);
  const [revoking, setRevoking] = React.useState<AgentKeyRow | null>(null);
  const blockedReason = !caps.canWrite ? "Requires agents:write" : !caps.editable ? `Keys cannot be issued for a ${caps.status} agent` : undefined;

  const columns: ColumnDef<AgentKeyRow, unknown>[] = [
    { id: "name", header: "Name", enableHiding: false, cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: "prefix", header: "Prefix", cell: ({ row }) => <span className="font-mono text-xs">aegis_ak_{row.original.prefix}_…</span> },
    { id: "state", header: "State", cell: ({ row }) => {
      const k = row.original;
      if (k.revokedAt) return <Badge tone="deny">Revoked <TimeAgo value={k.revokedAt} /></Badge>;
      if (k.expiresAt && new Date(k.expiresAt) < new Date()) return <Badge tone="neutral">Expired</Badge>;
      return <Badge tone="allow">Active</Badge>;
    } },
    { id: "created", header: "Created", cell: ({ row }) => <DateTime value={row.original.createdAt} /> },
    { id: "lastUsed", header: "Last used", cell: ({ row }) => (row.original.lastUsedAt ? <TimeAgo value={row.original.lastUsedAt} /> : <span className="text-fg-dim">never</span>) },
    { id: "expires", header: "Expires", cell: ({ row }) => (row.original.expiresAt ? <DateTime value={row.original.expiresAt} /> : <span className="text-fg-dim">never</span>) },
    { id: "actions", header: "", enableHiding: false, meta: { align: "end" }, cell: ({ row }) => row.original.revokedAt ? null : (
      <Button size="sm" variant="ghost" className="text-deny" disabled={!caps.canWrite && !caps.canControl} disabledReason="Requires agents:write" onClick={() => setRevoking(row.original)}>
        Revoke
      </Button>
    ) },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" disabled={!!blockedReason} disabledReason={blockedReason} onClick={() => { setIssued(null); setError(null); setName(""); setOpen(true); }}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Issue key
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setIssued(null);
        }}
        title={issued ? "Copy your new API key" : "Issue an API key"}
        description={issued ? "This is the only time the full key is shown. AEGIS stores a hash." : "The key authenticates this agent at the Action Gateway. It is scoped to the agent and can be revoked at any time."}
        footer={
          issued ? (
            <Button variant="primary" onClick={() => setOpen(false)}>
              I have stored the key
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button form="issue-key-form" type="submit" variant="primary" loading={pending} disabled={name.trim().length < 2}>
                Issue key
              </Button>
            </>
          )
        }
      >
        {issued ? (
          <div className="space-y-3">
            <div className="flex gap-2 rounded-md border border-approval/30 bg-approval/10 px-3 py-2 text-xs text-fg">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-approval" aria-hidden />
              <span>Store it in your secrets manager now. If it is lost, revoke it and issue a new one.</span>
            </div>
            <CodeBlock code={issued.key} wrap label={`Key prefix ${issued.prefix}`} />
          </div>
        ) : (
          <form
            id="issue-key-form"
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError(null);
              const r = await issueAgentKeyAction(agentId, { name, expiresInDays: Number(expiry) });
              setPending(false);
              if (!r.ok) return setError(r.error);
              setIssued({ key: r.data.key, prefix: r.data.prefix });
              router.refresh();
            }}
          >
            <Field label="Key name" htmlFor="key-name">
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="production gateway key" maxLength={120} autoFocus />
            </Field>
            <Field label="Expires" htmlFor="key-expiry">
              <Select id="key-expiry" value={expiry} onValueChange={setExpiry} options={[{ value: "30", label: "In 30 days" }, { value: "90", label: "In 90 days" }, { value: "365", label: "In 1 year" }, { value: "0", label: "Never" }]} />
            </Field>
            <FormError error={error} />
          </form>
        )}
      </Dialog>
      <DataTable columns={columns} data={keys} getRowId={(k) => k.id} columnVisibilityMenu={false} caption="API keys" emptyState={<EmptyState icon={KeyRound} title="No API keys" description="Issue a key so the agent can authenticate at the gateway." />} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={revoking ? `Revoke key ${revoking.name}` : ""}
        description="Requests signed with this key are rejected immediately."
        confirmLabel="Revoke key"
        danger
        reason={{ required: true }}
        onConfirm={async ({ reason }) => {
          if (!revoking) return;
          const r = await revokeAgentKeyAction(agentId, revoking.id, reason);
          if (!r.ok) return r.error;
          toast.success("API key revoked");
          router.refresh();
        }}
      />
    </div>
  );
}
