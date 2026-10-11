"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { assignPolicyAction, unassignPolicyAction } from "@/server/actions/policies";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormError, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { EmptyState } from "@/components/ui/empty-state";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { DateTime } from "@/components/ui/time";

export interface AssignmentRow {
  id: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string;
  priority: number;
  createdAt: string;
}
export interface PickOption {
  value: string;
  label: string;
  description?: string;
}

export function AssignPolicyDialog({ policyId, agents, teams, canActivate, hasActive }: { policyId: string; agents: PickOption[]; teams: PickOption[]; canActivate: boolean; hasActive: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [targetType, setTargetType] = React.useState("agent");
  const [targetId, setTargetId] = React.useState<string | null>(null);
  const [priority, setPriority] = React.useState("100");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await assignPolicyAction(policyId, { targetType, targetId: targetType === "org" ? null : targetId, priority: Number(priority) });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success("Policy assigned");
    setOpen(false);
    router.refresh();
  }
  const needsTarget = targetType !== "org";
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
      trigger={
        <Button disabled={!canActivate} disabledReason="Requires policies:activate">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Assign
        </Button>
      }
      title="Assign policy"
      description={hasActive ? "The active version applies to the target on its next request." : "This policy has no active version yet; the assignment takes effect once a version is activated."}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="assign-form" type="submit" variant="primary" loading={pending} disabled={needsTarget && !targetId} disabledReason="Choose a target">
            Assign
          </Button>
        </>
      }
    >
      <form id="assign-form" onSubmit={submit} className="space-y-3">
        <Field label="Target type" htmlFor="as-type">
          <Select
            id="as-type"
            value={targetType}
            onValueChange={(v) => {
              setTargetType(v);
              setTargetId(null);
            }}
            options={[{ value: "org", label: "Whole organization" }, { value: "team", label: "Team" }, { value: "agent", label: "Agent" }]}
          />
        </Field>
        {targetType === "agent" ? (
          <Field label="Agent" htmlFor="as-agent">
            <Combobox id="as-agent" value={targetId} onChange={setTargetId} options={agents} placeholder="Select an agent" />
          </Field>
        ) : targetType === "team" ? (
          <Field label="Team" htmlFor="as-team">
            <Combobox id="as-team" value={targetId} onChange={setTargetId} options={teams} placeholder="Select a team" />
          </Field>
        ) : null}
        <Field label="Priority" htmlFor="as-priority" hint="lower runs first when the same policy is assigned twice">
          <Input id="as-priority" type="number" min={1} max={1000} value={priority} onChange={(e) => setPriority(e.target.value)} />
        </Field>
        <FormError error={error} />
      </form>
    </Dialog>
  );
}

export function AssignmentsTable({ policyId, rows, canActivate }: { policyId: string; rows: AssignmentRow[]; canActivate: boolean }) {
  const router = useRouter();
  const [removing, setRemoving] = React.useState<AssignmentRow | null>(null);
  if (rows.length === 0) return <EmptyState title="Not assigned" description="Assign this policy to the organization, a team or an agent for it to be evaluated." />;
  return (
    <>
      <SimpleTable caption="Policy assignments">
        <thead>
          <tr>
            <Th>Scope</Th>
            <Th>Target</Th>
            <Th align="end">Priority</Th>
            <Th>Assigned</Th>
            <Th align="end">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <Tr key={a.id}>
              <Td>{a.targetType === "org" ? "Organization" : a.targetType === "team" ? "Team" : "Agent"}</Td>
              <Td>{a.targetType === "agent" && a.targetId ? <Link href={`/agents/${a.targetId}`} className="text-accent hover:underline">{a.targetLabel}</Link> : a.targetLabel}</Td>
              <Td align="end">{a.priority}</Td>
              <Td>
                <DateTime value={a.createdAt} />
              </Td>
              <Td align="end">
                <Button size="sm" variant="ghost" onClick={() => setRemoving(a)} disabled={!canActivate} disabledReason="Requires policies:activate">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Unassign
                </Button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </SimpleTable>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Unassign policy"
        description={removing ? `The policy stops applying to ${removing.targetLabel} on the next request. The removal is recorded in evidence.` : undefined}
        confirmLabel="Unassign"
        danger
        onConfirm={async () => {
          if (!removing) return;
          const r = await unassignPolicyAction(policyId, removing.id);
          if (!r.ok) return r.error;
          toast.success("Assignment removed");
          router.refresh();
        }}
      />
    </>
  );
}
