"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createPolicyAction } from "@/server/actions/policies";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { POLICY_CATEGORIES, POLICY_TEMPLATES } from "./policy-templates";

export function NewPolicyDialog({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [key, setKey] = React.useState("");
  const [keyTouched, setKeyTouched] = React.useState(false);
  const [category, setCategory] = React.useState("authorization");
  const [template, setTemplate] = React.useState("empty");
  const [description, setDescription] = React.useState("");

  React.useEffect(() => {
    if (!keyTouched) setKey(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48));
  }, [name, keyTouched]);
  React.useEffect(() => {
    const t = POLICY_TEMPLATES.find((x) => x.id === template);
    if (t && t.id !== "empty") setCategory(t.category);
  }, [template]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = POLICY_TEMPLATES.find((x) => x.id === template)!;
    setPending(true);
    setError(null);
    const r = await createPolicyAction({ key, name, description, category, document: t.document, changeNote: `Initial draft from the ${t.name.toLowerCase()} template` });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`${name} created as draft v1`);
    setOpen(false);
    router.push(`/policies/${r.data.id}?tab=editor`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires policies:write">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New policy
        </Button>
      }
      title="New policy"
      description="Creates the policy with a draft version 1. Nothing is enforced until a version is reviewed and activated by a second person."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="new-policy-form" type="submit" variant="primary" loading={pending} disabled={name.trim().length < 2 || key.length < 2} disabledReason="Name and key are required">
            Create draft
          </Button>
        </>
      }
    >
      <form id="new-policy-form" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Name" htmlFor="policy-name">
          <Input id="policy-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} autoFocus />
        </Field>
        <Field label="Key" htmlFor="policy-key" hint="lowercase, digits, hyphens">
          <Input
            id="policy-key"
            value={key}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value);
            }}
            pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
            required
            className="font-mono"
          />
        </Field>
        <Field label="Description" htmlFor="policy-description" className="md:col-span-2">
          <Textarea id="policy-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="What this policy governs and why the thresholds are set as they are" />
        </Field>
        <Field label="Category" htmlFor="policy-category">
          <Select id="policy-category" value={category} onValueChange={setCategory} options={POLICY_CATEGORIES} />
        </Field>
        <Field label="Starting document" htmlFor="policy-template">
          <Select id="policy-template" value={template} onValueChange={setTemplate} options={POLICY_TEMPLATES.map((t) => ({ value: t.id, label: t.name }))} />
        </Field>
        <p className="text-xs text-fg-muted md:col-span-2">{POLICY_TEMPLATES.find((t) => t.id === template)?.description} Thresholds in templates are placeholders to edit, not recommendations.</p>
        <div className="md:col-span-2">
          <FormError error={error} />
        </div>
      </form>
    </Dialog>
  );
}
