"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createAssessmentAction, runAssessmentAction } from "@/server/actions/audit";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/switch";
import { Note } from "@/components/ui/note";

export interface FrameworkOption {
  id: string;
  name: string;
  version: string;
  controlCount: number;
}

export interface DocumentOption {
  id: string;
  title: string;
  chunkCount: number;
}

export function NewAssessmentDialog({ canWrite, frameworks, documents }: { canWrite: boolean; frameworks: FrameworkOption[]; documents: DocumentOption[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [phase, setPhase] = React.useState<"form" | "creating" | "running">("form");
  const [error, setError] = React.useState<string | null>(null);
  const [frameworkId, setFrameworkId] = React.useState(frameworks[0]?.id ?? "");
  const [name, setName] = React.useState("");
  const [scope, setScope] = React.useState("");
  const [docIds, setDocIds] = React.useState<string[]>(documents.map((d) => d.id));
  const framework = frameworks.find((f) => f.id === frameworkId);
  const canSubmit = !!frameworkId && name.trim().length >= 2 && phase === "form";
  const noDocs = documents.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setPhase("creating");
    const created = await createAssessmentAction({ frameworkId, name: name.trim(), scope: scope.trim(), documentIds: docIds });
    if (!created.ok) {
      setPhase("form");
      return setError(created.error);
    }
    setPhase("running");
    const run = await runAssessmentAction(created.data.id);
    if (!run.ok) {
      setPhase("form");
      setError(`${run.error} The draft assessment was kept; run it again from its page.`);
      router.refresh();
      return;
    }
    if (run.data.status === "completed") toast.success(`Assessment completed: ${run.data.coveragePercent ?? 0}% coverage`);
    else toast.error(`Assessment ${run.data.status}${run.data.error ? `: ${run.data.error}` : ""}`);
    setOpen(false);
    setPhase("form");
    router.push(`/audit/assessments/${created.data.id}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (phase !== "form") return;
        setOpen(o);
        if (!o) setError(null);
      }}
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires audit:write">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New assessment
        </Button>
      }
      title="New assessment"
      description="Checks the wording of the selected documents against every control in the framework (a lexical, text-matching assessment). It runs inside this deployment; no external AI provider is called."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={phase !== "form"}>
            Cancel
          </Button>
          <Button form="new-assessment-form" type="submit" variant="primary" loading={phase !== "form"} disabled={!canSubmit} disabledReason={!frameworkId ? "Choose a framework" : "Enter a name of at least 2 characters"}>
            {phase === "creating" ? "Creating" : phase === "running" ? `Running ${framework?.controlCount ?? ""} controls` : "Create and run"}
          </Button>
        </>
      }
    >
      <form id="new-assessment-form" onSubmit={submit} className="space-y-3">
        {phase === "running" ? <Note>Checking {docIds.length} document{docIds.length === 1 ? "" : "s"} against {framework?.controlCount ?? 0} controls. This usually takes a few seconds and at most three minutes.</Note> : null}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Framework" htmlFor="as-framework">
            <Select id="as-framework" value={frameworkId} onValueChange={setFrameworkId} disabled={phase !== "form"} options={frameworks.map((f) => ({ value: f.id, label: `${f.name}${f.version ? ` ${f.version}` : ""} (${f.controlCount} controls)` }))} placeholder="Select a framework" />
          </Field>
          <Field label="Name" htmlFor="as-name">
            <Input id="as-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder={framework ? `${framework.name} review ${new Date().getFullYear()}` : ""} disabled={phase !== "form"} autoFocus />
          </Field>
        </div>
        <Field label="Scope" htmlFor="as-scope" hint="optional statement of what is in and out of scope">
          <Textarea id="as-scope" value={scope} onChange={(e) => setScope(e.target.value)} maxLength={2000} disabled={phase !== "form"} />
        </Field>
        <fieldset>
          <legend className="mb-1 block text-xs font-medium text-fg-muted">
            Documents <span className="font-normal text-fg-dim">({docIds.length} of {documents.length} parsed documents selected)</span>
          </legend>
          {noDocs ? (
            <Note tone="warning">No documents have been uploaded and read yet. This assessment will rely only on the evidence AEGIS records automatically. Upload documents first if you want them covered.</Note>
          ) : (
            <div className="grid max-h-56 gap-0.5 overflow-y-auto rounded-md border border-line p-1">
              {documents.map((d) => (
                <Checkbox key={d.id} checked={docIds.includes(d.id)} disabled={phase !== "form"} onCheckedChange={(v) => setDocIds((prev) => (v ? [...prev, d.id] : prev.filter((x) => x !== d.id)))} label={d.title} description={`${d.chunkCount} passages (chunks)`} />
              ))}
            </div>
          )}
        </fieldset>
        <FormError error={error} />
      </form>
    </Dialog>
  );
}
