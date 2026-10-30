"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createTaskAction } from "@/server/actions/audit";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";

export interface OwnerOption {
  userId: string;
  name: string;
  roleName: string;
}

export interface FindingOption {
  id: string;
  code: string;
  title: string;
  assessmentName: string;
}

export interface TaskPrefill {
  findingId?: string;
  title?: string;
  description?: string;
}

export function CreateTaskDialog({ canWrite, owners, findings, prefill, trigger, open: openProp, onOpenChange, onCreated }: { canWrite: boolean; owners: OwnerOption[]; findings: FindingOption[]; prefill?: TaskPrefill; trigger?: React.ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void; onCreated?: (id: string) => void }) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (o: boolean) => {
    setInternalOpen(o);
    onOpenChange?.(o);
  };
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState(prefill?.title ?? "");
  const [description, setDescription] = React.useState(prefill?.description ?? "");
  const [ownerId, setOwnerId] = React.useState<string | null>(null);
  const [findingId, setFindingId] = React.useState<string | null>(prefill?.findingId ?? null);
  const [dueAt, setDueAt] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setTitle(prefill?.title ?? "");
      setDescription(prefill?.description ?? "");
      setFindingId(prefill?.findingId ?? null);
      setError(null);
    }
  }, [open, prefill?.title, prefill?.description, prefill?.findingId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await createTaskAction({ title: title.trim(), description: description.trim(), ownerId: ownerId ?? undefined, findingId: findingId ?? undefined, dueAt: dueAt ? new Date(`${dueAt}T12:00:00Z`).toISOString() : undefined });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success("Remediation task created");
    setOpen(false);
    setTitle("");
    setDescription("");
    setOwnerId(null);
    setDueAt("");
    onCreated?.(r.data.id);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        trigger === undefined ? (
          <Button variant="primary" disabled={!canWrite} disabledReason="Requires audit:write">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New task
          </Button>
        ) : (
          trigger
        )
      }
      title="Create remediation task"
      description="A piece of work that fixes a gap found in an assessment. The owner is notified, and every change is kept in the task history and in the evidence record (the ledger)."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="create-task-form" type="submit" variant="primary" loading={pending} disabled={title.trim().length < 3} disabledReason="Enter a title of at least 3 characters">
            Create task
          </Button>
        </>
      }
    >
      <form id="create-task-form" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Title" htmlFor="task-title" className="md:col-span-2">
          <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
        </Field>
        <Field label="Description" htmlFor="task-desc" className="md:col-span-2">
          <Textarea id="task-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={4} />
        </Field>
        <Field label="Owner" htmlFor="task-owner" hint="people who can edit audit work (audit:write)">
          <Combobox id="task-owner" value={ownerId} onChange={setOwnerId} options={owners.map((o) => ({ value: o.userId, label: o.name, description: o.roleName }))} placeholder="Unassigned" allowClear searchPlaceholder="Search members" />
        </Field>
        <Field label="Due date" htmlFor="task-due" hint="optional">
          <Input id="task-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </Field>
        <Field label="Finding" htmlFor="task-finding" hint="optional" className="md:col-span-2">
          <Combobox id="task-finding" value={findingId} onChange={setFindingId} options={findings.map((f) => ({ value: f.id, label: `${f.code} ${f.title}`, description: f.assessmentName }))} placeholder="Not linked to a finding" allowClear searchPlaceholder="Search controls" emptyText="No matching finding" />
        </Field>
        <div className="md:col-span-2">
          <FormError error={error} />
        </div>
      </form>
    </Dialog>
  );
}
