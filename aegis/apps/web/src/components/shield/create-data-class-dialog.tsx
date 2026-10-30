"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { compilePatternAction, createDataClassAction } from "@/server/actions/shield";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { statusLabel } from "@/lib/status";
import { DATA_ACTION_LABELS, severityTone } from "./format";

export function CreateDataClassDialog({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [key, setKey] = React.useState("");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [pattern, setPattern] = React.useState("");
  const [action, setAction] = React.useState("mask");
  const [severity, setSeverity] = React.useState("medium");
  const [compile, setCompile] = React.useState<{ state: "idle" | "checking" | "ok" | "error"; message?: string }>({ state: "idle" });

  React.useEffect(() => {
    if (!pattern.trim()) {
      setCompile({ state: "idle" });
      return;
    }
    setCompile({ state: "checking" });
    const handle = setTimeout(async () => {
      const r = await compilePatternAction(pattern);
      setCompile(r.ok ? { state: "ok", message: `compiles with flags ${r.flags}` } : { state: "error", message: r.error });
    }, 350);
    return () => clearTimeout(handle);
  }, [pattern]);

  const keyOk = /^[a-z][a-z0-9_-]*$/.test(key) && key.length >= 2;
  const canSubmit = keyOk && name.trim().length >= 2 && compile.state === "ok" && !pending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await createDataClassAction({ key, name: name.trim(), description: description.trim(), pattern, action, severity, enabled: true });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`Custom class ${r.data.key} created`);
    setOpen(false);
    setKey("");
    setName("");
    setDescription("");
    setPattern("");
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires security:write">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Custom class
        </Button>
      }
      title="Create a custom data class"
      description="A regular expression evaluated over every string parameter. Backreferences and nested quantifiers are rejected to keep matching bounded."
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="create-class-form" type="submit" variant="primary" loading={pending} disabled={!canSubmit} disabledReason={!keyOk ? "Key: lowercase letters, digits, underscore and hyphen" : name.trim().length < 2 ? "Name needs at least 2 characters" : compile.state !== "ok" ? "Pattern must compile" : undefined}>
            Create class
          </Button>
        </>
      }
    >
      <form id="create-class-form" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Key" htmlFor="dc-key" hint="lowercase, stable">
          <Input id="dc-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="employee_id" className="font-mono" maxLength={48} autoFocus />
        </Field>
        <Field label="Name" htmlFor="dc-name">
          <Input id="dc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Employee id" maxLength={80} />
        </Field>
        <Field label="Description" htmlFor="dc-desc" className="md:col-span-2">
          <Textarea id="dc-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="What this class identifies and why it matters" />
        </Field>
        <Field label="Pattern" htmlFor="dc-pattern" hint="prefix (?i) for case-insensitive" className="md:col-span-2" error={compile.state === "error" ? compile.message : undefined}>
          <Input id="dc-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="EMP-[0-9]{6}" className="font-mono" maxLength={500} spellCheck={false} />
          <p className="mt-1 text-xs text-fg-muted" aria-live="polite">
            {compile.state === "idle" ? "Compile check runs as you type." : compile.state === "checking" ? "Checking..." : compile.state === "ok" ? <span className="text-allow">Pattern {compile.message}.</span> : null}
          </p>
        </Field>
        <Field label="Action" htmlFor="dc-action">
          <Select id="dc-action" value={action} onValueChange={setAction} options={Object.entries(DATA_ACTION_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
        </Field>
        <Field label="Severity" htmlFor="dc-severity">
          <Select id="dc-severity" value={severity} onValueChange={setSeverity} options={["low", "medium", "high", "critical"].map((s) => ({ value: s, label: <Badge tone={severityTone(s)}>{statusLabel(s)}</Badge> }))} />
        </Field>
        <div className="md:col-span-2">
          <FormError error={error} />
        </div>
      </form>
    </Dialog>
  );
}
