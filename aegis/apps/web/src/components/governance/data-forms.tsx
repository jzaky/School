"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { completeDeletionAction, decideDeletionAction, registerDatasetAction, requestDeletionAction } from "@/server/actions/governance-registry";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/switch";

const CATEGORIES = ["personal", "financial", "health", "biometric", "children", "credentials", "location", "employment", "public"];
const NO_RESOURCE = "__none__";

export function RegisterDatasetDialog({ canWrite, resources }: { canWrite: boolean; resources: { id: string; key: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [f, setF] = React.useState({ key: "", name: "", description: "", classification: "confidential", storageLocation: "", region: "", retentionDays: "", lawfulBasis: "", resourceId: NO_RESOURCE });
  const [cats, setCats] = React.useState<string[]>([]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await registerDatasetAction({ ...f, categories: cats, resourceId: f.resourceId === NO_RESOURCE ? null : f.resourceId, retentionDays: f.retentionDays.trim() ? Number(f.retentionDays) : null });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success("Dataset registered");
    setOpen(false);
    router.push(`/governance/data/${r.data.id}`);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="lg"
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires security:write" data-testid="dataset-register-open">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Register dataset
        </Button>
      }
      title="Register a dataset"
      description="Tie it to the gateway resource that fronts it so agent access can be audited."
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="register-dataset-form" type="submit" variant="primary" loading={pending}>
            Register
          </Button>
        </>
      }
    >
      <form id="register-dataset-form" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Key" htmlFor="d-key" hint="lowercase, stable">
          <Input id="d-key" value={f.key} onChange={set("key")} className="font-mono" maxLength={48} />
        </Field>
        <Field label="Name" htmlFor="d-name">
          <Input id="d-name" value={f.name} onChange={set("name")} maxLength={120} />
        </Field>
        <Field label="Description" htmlFor="d-desc" className="md:col-span-2">
          <Textarea id="d-desc" value={f.description} onChange={set("description")} maxLength={2000} />
        </Field>
        <Field label="Classification" htmlFor="d-class">
          <Select id="d-class" value={f.classification} onValueChange={(v) => setF({ ...f, classification: v })} options={["public", "internal", "confidential", "restricted"].map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label="Gateway resource" htmlFor="d-resource">
          <Select id="d-resource" value={f.resourceId} onValueChange={(v) => setF({ ...f, resourceId: v })} options={[{ value: NO_RESOURCE, label: "None" }, ...resources.map((r) => ({ value: r.id, label: `${r.name} (${r.key})` }))]} />
        </Field>
        <Field label="Storage location" htmlFor="d-store" hint="declared">
          <Input id="d-store" value={f.storageLocation} onChange={set("storageLocation")} maxLength={200} />
        </Field>
        <Field label="Region" htmlFor="d-region" hint="declared, not verified">
          <Input id="d-region" value={f.region} onChange={set("region")} maxLength={80} />
        </Field>
        <Field label="Retention (days)" htmlFor="d-retention">
          <Input id="d-retention" type="number" min={1} value={f.retentionDays} onChange={set("retentionDays")} />
        </Field>
        <Field label="Lawful basis" htmlFor="d-basis">
          <Input id="d-basis" value={f.lawfulBasis} onChange={set("lawfulBasis")} maxLength={500} />
        </Field>
        <div className="md:col-span-2">
          <span className="mb-1 block text-xs text-fg-muted">Data categories</span>
          <div className="grid grid-cols-2 gap-x-2 sm:grid-cols-3">
            {CATEGORIES.map((c) => (
              <Checkbox key={c} label={c} checked={cats.includes(c)} onCheckedChange={(v) => setCats(v ? [...cats, c] : cats.filter((x) => x !== c))} />
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <FormError error={error} />
        </div>
      </form>
    </Dialog>
  );
}

export function DeletionRequestForm({ datasetId, canWrite }: { datasetId: string; canWrite: boolean }) {
  const router = useRouter();
  const [subjectRef, setSubjectRef] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      data-testid="deletion-request-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await requestDeletionAction({ datasetId, subjectRef, reason, dueInDays: 30 });
        setPending(false);
        if (!r.ok) return setError(r.error);
        toast.success("Deletion requested; a second person must approve it");
        setSubjectRef("");
        setReason("");
        router.refresh();
      }}
    >
      <Field label="Subject reference" htmlFor="del-subject" hint="hashed on arrival; only the last 4 characters are kept">
        <Input id="del-subject" value={subjectRef} onChange={(e) => setSubjectRef(e.target.value)} autoComplete="off" maxLength={200} disabled={!canWrite} />
      </Field>
      <Field label="Reason" htmlFor="del-reason">
        <Textarea id="del-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} disabled={!canWrite} />
      </Field>
      <FormError error={error} />
      <Button type="submit" size="sm" loading={pending} disabled={!canWrite || subjectRef.trim().length < 4 || reason.trim().length < 5} disabledReason={!canWrite ? "Requires security:write" : "Give a subject reference and a reason"}>
        Request deletion
      </Button>
    </form>
  );
}

export function DeletionRequestActions({ id, datasetId, status, canWrite, isRequester }: { id: string; datasetId: string; status: string; canWrite: boolean; isRequester: boolean }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [pending, setPending] = React.useState<string | null>(null);
  const go = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setPending(key);
    const r = await fn();
    setPending(null);
    if (!r.ok) return toast.error(r.error ?? "Failed");
    toast.success(done);
    setText("");
    router.refresh();
  };
  if (status === "requested") {
    const why = !canWrite ? "Requires security:write" : isRequester ? "The requester cannot decide their own request" : text.trim().length < 3 ? "Write a note" : undefined;
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="deletion-decide">
        <Input aria-label="Decision note" value={text} onChange={(e) => setText(e.target.value)} placeholder="Decision note" className="h-7 max-w-xs text-xs" />
        <Button size="sm" variant="primary" loading={pending === "approve"} disabled={!!why} disabledReason={why} onClick={() => go("approve", () => decideDeletionAction(id, datasetId, { approve: true, note: text }), "Approved")}>
          Approve
        </Button>
        <Button size="sm" loading={pending === "reject"} disabled={!!why} disabledReason={why} onClick={() => go("reject", () => decideDeletionAction(id, datasetId, { approve: false, note: text }), "Rejected")}>
          Reject
        </Button>
      </div>
    );
  }
  if (status === "approved") {
    const why = !canWrite ? "Requires security:write" : text.trim().length < 3 ? "Give the reference of the deletion in your system" : undefined;
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="deletion-complete">
        <Input aria-label="Deletion reference in your system" value={text} onChange={(e) => setText(e.target.value)} placeholder="Reference in your system" className="h-7 max-w-xs text-xs" />
        <Button size="sm" variant="primary" loading={pending === "complete"} disabled={!!why} disabledReason={why} onClick={() => go("complete", () => completeDeletionAction(id, datasetId, { reference: text }), "Recorded as completed")}>
          Record completion
        </Button>
      </div>
    );
  }
  return null;
}
