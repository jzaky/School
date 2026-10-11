"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { addControlAction, deleteControlAction, updateControlAction } from "@/server/actions/audit";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export interface ControlRow {
  id: string;
  code: string;
  title: string;
  summary: string;
  category: string;
  keywords: string[];
  automatedEvidenceType: string | null;
}

const NONE = "__none__";

function ControlDialog({ open, onOpenChange, frameworkId, control, evidenceTypes }: { open: boolean; onOpenChange: (o: boolean) => void; frameworkId: string; control: ControlRow | null; evidenceTypes: readonly string[] }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [keywords, setKeywords] = React.useState("");
  const [evidence, setEvidence] = React.useState(NONE);

  React.useEffect(() => {
    if (!open) return;
    setCode(control?.code ?? "");
    setTitle(control?.title ?? "");
    setSummary(control?.summary ?? "");
    setCategory(control?.category ?? "");
    setKeywords(control?.keywords.join(", ") ?? "");
    setEvidence(control?.automatedEvidenceType ?? NONE);
    setError(null);
  }, [open, control]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const input = { code: code.trim(), title: title.trim(), summary: summary.trim(), category: category.trim(), keywords: keywords.split(/[,;|]/).map((k) => k.trim()).filter(Boolean), automatedEvidenceType: evidence === NONE ? null : evidence };
    const r = control ? await updateControlAction(frameworkId, control.id, input) : await addControlAction(frameworkId, input);
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(control ? `Control ${input.code} updated` : `Control ${input.code} added`);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={control ? `Edit control ${control.code}` : "Add control"}
      description="Keywords drive lexical retrieval; the automated evidence type lets the engine corroborate the control with AEGIS records."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="control-form" type="submit" variant="primary" loading={pending} disabled={!code.trim() || !title.trim()} disabledReason="Code and title are required">
            {control ? "Save changes" : "Add control"}
          </Button>
        </>
      }
    >
      <form id="control-form" onSubmit={submit} className="grid gap-3 md:grid-cols-3">
        <Field label="Code" htmlFor="ctl-code">
          <Input id="ctl-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} className="font-mono" autoFocus />
        </Field>
        <Field label="Title" htmlFor="ctl-title" className="md:col-span-2">
          <Input id="ctl-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Category" htmlFor="ctl-category">
          <Input id="ctl-category" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={120} placeholder="Governance" />
        </Field>
        <Field label="Automated evidence" htmlFor="ctl-evidence" hint="optional" className="md:col-span-2">
          <Select id="ctl-evidence" value={evidence} onValueChange={setEvidence} options={[{ value: NONE, label: "None: documents only" }, ...evidenceTypes.map((t) => ({ value: t, label: <span className="font-mono text-xs">{t}</span> }))]} />
        </Field>
        <Field label="Summary" htmlFor="ctl-summary" hint="one sentence, your own words" className="md:col-span-3">
          <Textarea id="ctl-summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={1000} />
        </Field>
        <Field label="Keywords" htmlFor="ctl-keywords" hint="comma separated, up to 30" className="md:col-span-3">
          <Input id="ctl-keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="risk assessment, impact, review" />
        </Field>
        <div className="md:col-span-3">
          <FormError error={error} />
        </div>
      </form>
    </Dialog>
  );
}

export function ControlsTable({ frameworkId, controls, categories, custom, canWrite, evidenceTypes }: { frameworkId: string; controls: ControlRow[]; categories: string[]; custom: boolean; canWrite: boolean; evidenceTypes: readonly string[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<ControlRow | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [deleting, setDeleting] = React.useState<ControlRow | null>(null);
  const editable = custom && canWrite;
  const reason = !custom ? "Shared catalog frameworks are read-only" : !canWrite ? "Requires audit:write" : undefined;
  const groups = categories.length ? categories : ["General"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">
          {controls.length} controls in {groups.length} categor{groups.length === 1 ? "y" : "ies"}
        </p>
        <Button size="sm" variant="primary" disabled={!editable} disabledReason={reason} onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add control
        </Button>
      </div>
      {groups.map((cat) => {
        const list = controls.filter((ctl) => (ctl.category || "General") === cat || (categories.length === 0 && cat === "General"));
        if (list.length === 0) return null;
        return (
          <section key={cat}>
            <h2 className="mb-2 text-sm font-semibold text-fg">
              {cat} <span className="text-xs font-normal text-fg-muted">({list.length})</span>
            </h2>
            <SimpleTable caption={`Controls in ${cat}`}>
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Title</Th>
                  <Th>Summary</Th>
                  <Th>Keywords</Th>
                  <Th>Automated evidence</Th>
                  {editable ? (
                    <Th align="end">
                      <span className="sr-only">Actions</span>
                    </Th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {list.map((ctl) => (
                  <Tr key={ctl.id}>
                    <Td mono className="whitespace-nowrap align-top">
                      {ctl.code}
                    </Td>
                    <Td className="max-w-[260px] align-top font-medium">{ctl.title}</Td>
                    <Td className="max-w-[460px] whitespace-normal align-top text-xs text-fg-muted">{ctl.summary || <span className="text-fg-dim">none</span>}</Td>
                    <Td className="max-w-[260px] align-top">
                      {ctl.keywords.length ? (
                        <span className="flex flex-wrap gap-1">
                          {ctl.keywords.slice(0, 6).map((k) => (
                            <Badge key={k}>{k}</Badge>
                          ))}
                          {ctl.keywords.length > 6 ? <span className="text-xs text-fg-dim">+{ctl.keywords.length - 6}</span> : null}
                        </span>
                      ) : (
                        <span className="text-fg-dim">none</span>
                      )}
                    </Td>
                    <Td className="align-top">{ctl.automatedEvidenceType ? <Badge tone="info" mono>{ctl.automatedEvidenceType}</Badge> : <span className="text-fg-dim">documents only</span>}</Td>
                    {editable ? (
                      <Td align="end" className="whitespace-nowrap align-top">
                        <IconButton label={`Edit ${ctl.code}`} size="sm" onClick={() => setEditing(ctl)}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </IconButton>
                        <IconButton label={`Delete ${ctl.code}`} size="sm" onClick={() => setDeleting(ctl)}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </IconButton>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </SimpleTable>
          </section>
        );
      })}
      {controls.length === 0 ? <p className="rounded-panel border border-line bg-bg-elev px-4 py-8 text-center text-xs text-fg-dim">No controls yet. Add them one by one or import a CSV.</p> : null}
      <ControlDialog open={adding || editing !== null} onOpenChange={(o) => { if (!o) { setAdding(false); setEditing(null); } }} frameworkId={frameworkId} control={editing} evidenceTypes={evidenceTypes} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `Delete control ${deleting.code}` : ""}
        description="Controls that have findings in existing assessments cannot be deleted."
        confirmLabel="Delete control"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          const r = await deleteControlAction(frameworkId, deleting.id);
          if (!r.ok) return r.error;
          toast.success(`Control ${deleting.code} deleted`);
          router.refresh();
        }}
      />
    </div>
  );
}
