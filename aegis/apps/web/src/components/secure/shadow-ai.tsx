"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Upload } from "lucide-react";
import { addCustomShadowAiAppAction, importDiscoveryFileAction, reviewShadowAiAppAction } from "@/server/actions/shadow-ai";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";

const FORMATS: { value: string; label: string }[] = [
  { value: "entra_signin_json", label: "Microsoft Entra ID sign-in logs (JSON export)" },
  { value: "okta_system_log_json", label: "Okta System Log (JSON export)" },
  { value: "dns_jsonl", label: "DNS logs (JSON lines, including Zeek dns.log)" },
  { value: "managed_browser_jsonl", label: "Managed browser telemetry (JSON lines)" },
  { value: "swg_jsonl", label: "Secure web gateway or proxy (JSON lines)" },
  { value: "endpoint_jsonl", label: "Endpoint process telemetry (JSON lines)" },
  { value: "saas_inventory_json", label: "SaaS application inventory (JSON)" },
];

export function ImportLogForm({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [format, setFormat] = React.useState(FORMATS[0]!.value);
  const [file, setFile] = React.useState<File | null>(null);
  const [label, setLabel] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      data-testid="shadow-import-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return;
        setPending(true);
        setError(null);
        setResult(null);
        const text = await file.text();
        const r = await importDiscoveryFileAction({ format, text, label: label || file.name });
        setPending(false);
        if (!r.ok) return setError(r.error);
        setResult(`${r.data.received} records read: ${r.data.matched} matched an AI app (${r.data.accepted} new, ${r.data.duplicates} already imported), ${r.data.unmatched} were not AI and were discarded, ${r.data.rejected} could not be read.`);
        toast.success("Log imported");
        router.refresh();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Source and format" htmlFor="si-format">
          <NativeSelect id="si-format" value={format} onChange={(e) => setFormat(e.target.value)}>
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Label" htmlFor="si-label" hint="optional, for example the export date range">
          <Input id="si-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
        </Field>
      </div>
      <Field label="Log export" htmlFor="si-file" hint="up to 20 MB and 50,000 records; the file itself is not kept">
        <Input id="si-file" type="file" accept=".json,.jsonl,.log,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <FormError error={error} />
      {result ? (
        <p className="text-sm text-fg-muted" data-testid="shadow-import-result" aria-live="polite">
          {result}
        </p>
      ) : null}
      <Button type="submit" variant="primary" loading={pending} disabled={!canWrite || !file} disabledReason={!canWrite ? "Needs the security:write permission" : "Choose a file"}>
        <Upload className="h-3.5 w-3.5" aria-hidden />
        Import
      </Button>
    </form>
  );
}

const STATUS_OPTIONS = [
  { value: "approved", label: "Approved: the organization has a contract and controls" },
  { value: "tolerated", label: "Tolerated: allowed for now, under review" },
  { value: "unapproved", label: "Unapproved: use is a policy violation" },
  { value: "unreviewed", label: "Not reviewed" },
];
const CONTROLS: { key: string; label: string }[] = [
  { key: "sso", label: "Sign-in through our single sign-on" },
  { key: "dpaSigned", label: "Data processing agreement signed" },
  { key: "dataRetentionAgreed", label: "Retention terms agreed (for example no training on our data)" },
  { key: "adminConsole", label: "We administer the workspace" },
];

export function ReviewAppButton({ app, canWrite }: { app: { key: string; name: string; status: string; note: string; controls: Record<string, unknown> }; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState(app.status);
  const [note, setNote] = React.useState(app.note);
  const [controls, setControls] = React.useState<Record<string, boolean>>(Object.fromEntries(CONTROLS.map((c) => [c.key, app.controls[c.key] === true])));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Review ${app.name}`}
      description="Your decision about this app. The controls are your own statements about your contract; AEGIS records them and does not verify them."
      trigger={
        <Button size="sm" variant="ghost" disabled={!canWrite} disabledReason="Needs the security:write permission" data-testid={`review-${app.key}`}>
          Review
        </Button>
      }
    >
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          const r = await reviewShadowAiAppAction({ key: app.key, status, note, controls });
          setPending(false);
          if (!r.ok) return setError(r.error);
          toast.success("Review saved");
          setOpen(false);
          router.refresh();
        }}
      >
        <Field label="Decision" htmlFor={`st-${app.key}`}>
          <NativeSelect id={`st-${app.key}`} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-medium text-fg-muted">Controls in place</legend>
          {CONTROLS.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={controls[c.key] ?? false} onChange={(e) => setControls((x) => ({ ...x, [c.key]: e.target.checked }))} />
              {c.label}
            </label>
          ))}
        </fieldset>
        <Field label="Note" htmlFor={`nt-${app.key}`}>
          <Textarea id={`nt-${app.key}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
        </Field>
        <FormError error={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={pending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function AddCustomAppButton({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ key: "", name: "", vendor: "", domains: "", processes: "" });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Add an AI application"
      description="For tools AEGIS does not know: an internal app calling an AI API, a niche vendor, a local runtime. Give the hostnames or process names to recognize it by."
      trigger={
        <Button variant="secondary" disabled={!canWrite} disabledReason="Needs the security:write permission">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add app
        </Button>
      }
    >
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          const r = await addCustomShadowAiAppAction({ key: form.key, name: form.name, vendor: form.vendor, domains: list(form.domains), processes: list(form.processes) });
          setPending(false);
          if (!r.ok) return setError(r.error);
          toast.success("App added");
          setOpen(false);
          router.refresh();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Key" htmlFor="ca-key" hint="lowercase, for example internal-summarizer">
            <Input id="ca-key" value={form.key} onChange={set("key")} required />
          </Field>
          <Field label="Name" htmlFor="ca-name">
            <Input id="ca-name" value={form.name} onChange={set("name")} required />
          </Field>
        </div>
        <Field label="Vendor" htmlFor="ca-vendor">
          <Input id="ca-vendor" value={form.vendor} onChange={set("vendor")} />
        </Field>
        <Field label="Hostnames" htmlFor="ca-domains" hint="comma separated; subdomains match too">
          <Input id="ca-domains" value={form.domains} onChange={set("domains")} />
        </Field>
        <Field label="Process names" htmlFor="ca-proc" hint="comma separated, as an endpoint sensor reports them">
          <Input id="ca-proc" value={form.processes} onChange={set("processes")} />
        </Field>
        <FormError error={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={pending}>
            Add app
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
