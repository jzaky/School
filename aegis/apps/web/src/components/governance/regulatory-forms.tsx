"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { addRegulatoryActionAction, assessRegulatoryChangeAction, createRegulatoryChangeAction, markRegulatoryImplementedAction } from "@/server/actions/governance-registry";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/switch";

const NONE = "__none__";

export function CreateRegulatoryChangeDialog({ canWrite, frameworks }: { canWrite: boolean; frameworks: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [f, setF] = React.useState({ title: "", source: "", reference: "", jurisdiction: "", frameworkId: NONE, publishedAt: "", effectiveAt: "", summary: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await createRegulatoryChangeAction({ ...f, frameworkId: f.frameworkId === NONE ? null : f.frameworkId, publishedAt: f.publishedAt || null, effectiveAt: f.effectiveAt || null });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success("Change recorded");
    setOpen(false);
    router.push(`/governance/regulatory/${r.data.id}`);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="lg"
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires audit:write" data-testid="regulatory-create-open">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Record a change
        </Button>
      }
      title="Record a regulatory change"
      description="A new law, guidance or standard revision your organization needs to assess. AEGIS does not monitor regulators; you enter what you learn."
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="create-reg-form" type="submit" variant="primary" loading={pending} data-testid="regulatory-create-submit">
            Record
          </Button>
        </>
      }
    >
      <form id="create-reg-form" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Title" htmlFor="r-title" className="md:col-span-2">
          <Input id="r-title" value={f.title} onChange={set("title")} maxLength={200} />
        </Field>
        <Field label="Source" htmlFor="r-source" hint="publisher or regulator">
          <Input id="r-source" value={f.source} onChange={set("source")} maxLength={200} />
        </Field>
        <Field label="Jurisdiction" htmlFor="r-jur">
          <Input id="r-jur" value={f.jurisdiction} onChange={set("jurisdiction")} maxLength={80} />
        </Field>
        <Field label="Reference" htmlFor="r-ref" hint="citation or link" className="md:col-span-2">
          <Input id="r-ref" value={f.reference} onChange={set("reference")} maxLength={500} />
        </Field>
        <Field label="Framework" htmlFor="r-fw">
          <Select id="r-fw" value={f.frameworkId} onValueChange={(v) => setF({ ...f, frameworkId: v })} options={[{ value: NONE, label: "None" }, ...frameworks.map((x) => ({ value: x.id, label: x.name }))]} />
        </Field>
        <Field label="Effective date" htmlFor="r-eff">
          <Input id="r-eff" type="date" value={f.effectiveAt} onChange={set("effectiveAt")} />
        </Field>
        <Field label="Summary" htmlFor="r-summary" className="md:col-span-2">
          <Textarea id="r-summary" value={f.summary} onChange={set("summary")} maxLength={5000} />
        </Field>
        <div className="md:col-span-2">
          <FormError error={error} />
        </div>
      </form>
    </Dialog>
  );
}

type Item = { id: string; label: string };
type Groups = { controls: Item[]; policies: Item[]; agents: Item[]; models: Item[]; datasets: Item[] };
const GROUP_LABELS: Record<keyof Groups, string> = { controls: "Controls", policies: "Policies", agents: "Agents", models: "Models", datasets: "Datasets" };

export function AssessmentForm({ id, options, selected, initialNotes, canWrite, closed }: { id: string; options: Groups; selected: Record<keyof Groups, string[]>; initialNotes: string; canWrite: boolean; closed: boolean }) {
  const router = useRouter();
  const [sel, setSel] = React.useState(selected);
  const [status, setStatus] = React.useState("action_required");
  const [notes, setNotes] = React.useState(initialNotes);
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toggle = (g: keyof Groups, itemId: string, on: boolean) => setSel({ ...sel, [g]: on ? [...sel[g], itemId] : sel[g].filter((x) => x !== itemId) });
  return (
    <form
      className="space-y-3"
      data-testid="assessment-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await assessRegulatoryChangeAction(id, { status, impact: { ...sel, notes }, note });
        setPending(false);
        if (!r.ok) return setError(r.error);
        toast.success("Assessment saved");
        setNote("");
        router.refresh();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        {(Object.keys(GROUP_LABELS) as (keyof Groups)[]).map((g) =>
          options[g].length ? (
            <fieldset key={g} className="rounded-md border border-line p-2">
              <legend className="px-1 text-xs text-fg-muted">{GROUP_LABELS[g]}</legend>
              {options[g].map((it) => (
                <Checkbox key={it.id} label={it.label} checked={sel[g].includes(it.id)} onCheckedChange={(v) => toggle(g, it.id, v)} disabled={!canWrite || closed} />
              ))}
            </fieldset>
          ) : null,
        )}
      </div>
      <Field label="Impact notes" htmlFor="as-notes">
        <Textarea id="as-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} disabled={!canWrite || closed} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Outcome" htmlFor="as-status">
          <Select id="as-status" value={status} onValueChange={setStatus} disabled={!canWrite || closed} options={[{ value: "action_required", label: "Action required" }, { value: "assessing", label: "Still assessing" }, { value: "not_applicable", label: "Not applicable" }]} />
        </Field>
        <Field label="Why" htmlFor="as-note">
          <Input id="as-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} disabled={!canWrite || closed} />
        </Field>
      </div>
      <FormError error={error} />
      <Button type="submit" size="sm" variant="primary" loading={pending} disabled={!canWrite || closed || note.trim().length < 5} disabledReason={!canWrite ? "Requires audit:write" : closed ? "The change is implemented" : "Explain the assessment in at least 5 characters"} data-testid="assessment-save">
        Save assessment
      </Button>
    </form>
  );
}

export function RegulatoryActionForm({ id, canWrite, closed }: { id: string; canWrite: boolean; closed: boolean }) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [pending, setPending] = React.useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      data-testid="regulatory-action-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const r = await addRegulatoryActionAction(id, { title });
        setPending(false);
        if (!r.ok) return toast.error(r.error);
        toast.success("Remediation task created");
        setTitle("");
        router.refresh();
      }}
    >
      <Field label="New action" htmlFor="ra-title" className="min-w-0 flex-1">
        <Input id="ra-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="What needs to change" disabled={!canWrite || closed} />
      </Field>
      <Button type="submit" size="sm" loading={pending} disabled={!canWrite || closed || title.trim().length < 3} disabledReason={!canWrite ? "Requires audit:write" : closed ? "The change is closed" : "Describe the action"}>
        Add as a remediation task
      </Button>
    </form>
  );
}

export function MarkImplementedForm({ id, canWrite, blocker }: { id: string; canWrite: boolean; blocker: string | null }) {
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const why = !canWrite ? "Requires audit:write" : blocker ?? (note.trim().length < 5 ? "Describe how it was implemented" : undefined);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="How it was implemented" htmlFor="ri-note" className="min-w-0 flex-1">
        <Input id="ri-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} disabled={!canWrite || !!blocker} />
      </Field>
      <Button
        size="sm"
        variant="primary"
        loading={pending}
        disabled={!!why}
        disabledReason={why}
        onClick={async () => {
          setPending(true);
          const r = await markRegulatoryImplementedAction(id, note);
          setPending(false);
          if (!r.ok) return toast.error(r.error);
          toast.success("Marked implemented");
          router.refresh();
        }}
      >
        Mark implemented
      </Button>
    </div>
  );
}
