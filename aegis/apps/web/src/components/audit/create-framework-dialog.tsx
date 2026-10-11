"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createFrameworkAction } from "@/server/actions/audit";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";

export function CreateFrameworkDialog({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [key, setKey] = React.useState("");
  const [name, setName] = React.useState("");
  const [keyTouched, setKeyTouched] = React.useState(false);

  React.useEffect(() => {
    if (!keyTouched) setKey(name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48));
  }, [name, keyTouched]);

  const keyOk = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(key);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const r = await createFrameworkAction({ key, name: name.trim(), version: String(fd.get("version") ?? ""), publisher: String(fd.get("publisher") ?? ""), description: String(fd.get("description") ?? "") });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`${name} created. Add controls or import a CSV.`);
    setOpen(false);
    router.push(`/audit/standards/${r.data.id}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires audit:write">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Custom framework
        </Button>
      }
      title="Create a custom framework"
      description="Your own control set, for internal standards or regulator checklists. Controls are added one by one or imported from CSV."
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="create-framework-form" type="submit" variant="primary" loading={pending} disabled={!keyOk || name.trim().length < 2} disabledReason={!keyOk ? "Key: lowercase letters, digits, dots and hyphens" : "Name needs at least 2 characters"}>
            Create framework
          </Button>
        </>
      }
    >
      <form id="create-framework-form" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Name" htmlFor="fw-name">
          <Input id="fw-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
        </Field>
        <Field label="Key" htmlFor="fw-key" hint="stable identifier">
          <Input
            id="fw-key"
            value={key}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value);
            }}
            className="font-mono"
            maxLength={48}
          />
        </Field>
        <Field label="Version" htmlFor="fw-version">
          <Input id="fw-version" name="version" maxLength={40} placeholder="2026.1" />
        </Field>
        <Field label="Publisher" htmlFor="fw-publisher">
          <Input id="fw-publisher" name="publisher" maxLength={120} placeholder="Internal Audit" />
        </Field>
        <Field label="Description" htmlFor="fw-desc" className="md:col-span-2">
          <Textarea id="fw-desc" name="description" maxLength={2000} />
        </Field>
        <div className="md:col-span-2">
          <FormError error={error} />
        </div>
      </form>
    </Dialog>
  );
}
