"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Upload } from "lucide-react";
import { addCustomShadowAiAppAction, connectEntraAction, disconnectEntraAction, importDiscoveryFileAction, reviewShadowAiAppAction, syncEntraAction, testEntraAction } from "@/server/actions/shadow-ai";
import { Note } from "@/components/ui/note";
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

// ---------- Microsoft Entra ID ----------

type EntraStatusView = { active: boolean; tenantId: string; clientId: string; lastRunAt: string | null; lastSuccessAt: string | null; lastError: string | null; lastResult: { signIns: number; consents: number; matched: number; caughtUp: boolean } | null; secret: string; cursorSignIns: string | null } | null;

export function EntraPanel({ status, canWrite }: { status: EntraStatusView; canWrite: boolean }) {
  const router = useRouter();
  const [form, setForm] = React.useState({ tenantId: status?.tenantId ?? "", clientId: status?.clientId ?? "", clientSecret: "" });
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const runAction = async (label: string, fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, describe: (d: never) => string) => {
    setPending(label);
    setError(null);
    setNote(null);
    const r = await fn();
    setPending(null);
    if (!r.ok) return setError(r.error);
    setNote(describe(r.data as never));
    router.refresh();
  };
  return (
    <div className="space-y-3" data-testid="entra-panel" data-connected={status?.active ? "yes" : "no"}>
      {status?.active ? (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          <dt className="text-fg-muted">Tenant</dt>
          <dd className="font-mono text-xs">{status.tenantId}</dd>
          <dt className="text-fg-muted">Client secret</dt>
          <dd>{status.secret === "stored" ? "In the vault" : status.secret}</dd>
          <dt className="text-fg-muted">Last successful sync</dt>
          <dd>{status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString() : "Never"}</dd>
          <dt className="text-fg-muted">Read up to</dt>
          <dd>{status.cursorSignIns ? new Date(status.cursorSignIns).toLocaleString() : "Not yet"}</dd>
          {status.lastResult ? (
            <>
              <dt className="text-fg-muted">Last run</dt>
              <dd>
                {status.lastResult.signIns} sign-ins, {status.lastResult.consents} consents read, {status.lastResult.matched} AI matches kept{status.lastResult.caughtUp ? "" : ", more to read next run"}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {status?.lastError ? <Note tone="warning">{status.lastError}</Note> : null}
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          void runAction("connect", () => connectEntraAction({ ...form, backfillDays: 7 }) as never, () => "Connected. Test the connection, then sync.");
        }}
      >
        <Field label="Directory (tenant) ID" htmlFor="en-tenant">
          <Input id="en-tenant" value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} required disabled={!canWrite} />
        </Field>
        <Field label="Application (client) ID" htmlFor="en-client">
          <Input id="en-client" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} required disabled={!canWrite} />
        </Field>
        <Field label="Client secret" htmlFor="en-secret" hint="stored in the vault, never shown again">
          <Input id="en-secret" type="password" autoComplete="off" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} required disabled={!canWrite} />
        </Field>
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          <Button type="submit" variant="primary" loading={pending === "connect"} disabled={!canWrite} disabledReason="Needs the integrations:write permission">
            {status?.active ? "Update connection" : "Connect"}
          </Button>
          <Button type="button" variant="secondary" loading={pending === "test"} disabled={!status?.active} disabledReason="Connect first" onClick={() => runAction("test", () => testEntraAction() as never, (d: { detail: string }) => d.detail)}>
            Test connection
          </Button>
          <Button type="button" variant="secondary" loading={pending === "sync"} disabled={!status?.active || !canWrite} disabledReason={!status?.active ? "Connect first" : "Needs the integrations:write permission"} onClick={() => runAction("sync", () => syncEntraAction() as never, (d: { signIns: number; consents: number; matched: number }) => `Read ${d.signIns} sign-ins and ${d.consents} consents; kept ${d.matched} AI matches.`)}>
            Sync now
          </Button>
          <Button type="button" variant="ghost" loading={pending === "disconnect"} disabled={!status?.active || !canWrite} disabledReason={!status?.active ? "Not connected" : "Needs the integrations:write permission"} onClick={() => runAction("disconnect", () => disconnectEntraAction({ reason: "Disconnected from the console" }) as never, () => "Disconnected; the secret is revoked.")}>
            Disconnect
          </Button>
        </div>
      </form>
      <FormError error={error} />
      {note ? (
        <p className="text-sm text-fg-muted" aria-live="polite" data-testid="entra-note">
          {note}
        </p>
      ) : null}
    </div>
  );
}
