"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createDestinationAction, replaceDestinationSecretAction, retryDeliveryAction, sendTestEventAction, updateDestinationAction } from "@/server/actions/destinations";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox, Switch } from "@/components/ui/switch";
import { Note } from "@/components/ui/note";
import { CodeBlock } from "@/components/ui/code-block";
import { KIND_LABEL } from "./format";

const SITES = ["datadoghq.com", "us3.datadoghq.com", "us5.datadoghq.com", "datadoghq.eu", "ap1.datadoghq.com", "ddog-gov.com"];
const ANY = "__any__";

export function AddDestinationDialog({ canWrite, categories, initialKind }: { canWrite: boolean; categories: { key: string; label: string }[]; initialKind?: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<{ id: string; signingSecret: string | null } | null>(null);
  const [kind, setKind] = React.useState(initialKind && KIND_LABEL[initialKind] ? initialKind : "slack");
  const [name, setName] = React.useState("");
  const [cats, setCats] = React.useState<string[]>(["security"]);
  const [minSeverity, setMinSeverity] = React.useState(ANY);
  const [f, setF] = React.useState({ url: "", webhookUrl: "", token: "", index: "", site: "datadoghq.com", apiKey: "", instanceUrl: "", username: "", password: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const fields: Record<string, unknown> =
    kind === "webhook" ? { url: f.url } : kind === "slack" || kind === "teams" ? { webhookUrl: f.webhookUrl } : kind === "splunk_hec" ? { url: f.url, token: f.token, index: f.index } : kind === "datadog_logs" ? { site: f.site, apiKey: f.apiKey } : { instanceUrl: f.instanceUrl, username: f.username, password: f.password };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await createDestinationAction({ kind, name, categories: cats, minSeverity: minSeverity === ANY ? null : minSeverity, ...fields });
    setPending(false);
    if (!r.ok) return setError(r.error);
    if (r.data.signingSecret) return setCreated(r.data);
    toast.success("Destination added");
    setOpen(false);
    router.push(`/integrations/destinations/${r.data.id}`);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && created) router.push(`/integrations/destinations/${created.id}`);
        if (!o) setCreated(null);
      }}
      size="lg"
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires integrations:write" data-testid="destination-add-open">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add destination
        </Button>
      }
      title="Add an event destination"
      description="AEGIS sends new governance events to it from now on. Credentials are encrypted and never shown again."
      footer={
        created ? (
          <Button variant="primary" onClick={() => setOpen(false)}>
            I have stored the secret
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button form="add-destination-form" type="submit" variant="primary" loading={pending} disabled={cats.length === 0} disabledReason="Choose at least one category" data-testid="destination-add-submit">
              Add
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-3" data-testid="destination-signing-secret">
          <Note tone="warning">Store this signing secret in the receiving system now. AEGIS will not show it again.</Note>
          <CodeBlock code={created.signingSecret ?? ""} />
          <p className="text-xs text-fg-muted">Verify each request: HMAC-SHA-256 of the timestamp header, a dot and the raw body, compared with X-AEGIS-Signature. See docs/INTEGRATIONS.md.</p>
        </div>
      ) : (
        <form id="add-destination-form" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
          <Field label="Kind" htmlFor="ds-kind">
            <Select id="ds-kind" value={kind} onValueChange={setKind} options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Name" htmlFor="ds-name">
            <Input id="ds-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="#ai-governance alerts" />
          </Field>
          {kind === "webhook" ? (
            <Field label="Endpoint URL" htmlFor="ds-url" hint="HTTPS" className="md:col-span-2">
              <Input id="ds-url" value={f.url} onChange={set("url")} className="font-mono" />
            </Field>
          ) : null}
          {kind === "slack" || kind === "teams" ? (
            <Field label="Webhook URL" htmlFor="ds-webhook" hint="treated as a secret" className="md:col-span-2">
              <Input id="ds-webhook" value={f.webhookUrl} onChange={set("webhookUrl")} className="font-mono" autoComplete="off" />
            </Field>
          ) : null}
          {kind === "splunk_hec" ? (
            <>
              <Field label="HEC base URL" htmlFor="ds-hec" hint="for example https://splunk.example.com:8088" className="md:col-span-2">
                <Input id="ds-hec" value={f.url} onChange={set("url")} className="font-mono" />
              </Field>
              <Field label="HEC token" htmlFor="ds-token">
                <Input id="ds-token" type="password" value={f.token} onChange={set("token")} autoComplete="off" />
              </Field>
              <Field label="Index" htmlFor="ds-index" hint="optional">
                <Input id="ds-index" value={f.index} onChange={set("index")} />
              </Field>
            </>
          ) : null}
          {kind === "datadog_logs" ? (
            <>
              <Field label="Site" htmlFor="ds-site">
                <Select id="ds-site" value={f.site} onValueChange={(v) => setF({ ...f, site: v })} options={SITES.map((s) => ({ value: s, label: s }))} />
              </Field>
              <Field label="API key" htmlFor="ds-ddkey">
                <Input id="ds-ddkey" type="password" value={f.apiKey} onChange={set("apiKey")} autoComplete="off" />
              </Field>
            </>
          ) : null}
          {kind === "servicenow" ? (
            <>
              <Field label="Instance URL" htmlFor="ds-sn" hint="https://your-instance.service-now.com" className="md:col-span-2">
                <Input id="ds-sn" value={f.instanceUrl} onChange={set("instanceUrl")} className="font-mono" />
              </Field>
              <Field label="Integration user" htmlFor="ds-snuser">
                <Input id="ds-snuser" value={f.username} onChange={set("username")} autoComplete="off" />
              </Field>
              <Field label="Password" htmlFor="ds-snpw">
                <Input id="ds-snpw" type="password" value={f.password} onChange={set("password")} autoComplete="off" />
              </Field>
            </>
          ) : null}
          <div className="md:col-span-2">
            <span className="mb-1 block text-xs text-fg-muted">Events to send</span>
            <div className="grid gap-x-2 sm:grid-cols-2">
              {categories.map((c) => (
                <Checkbox key={c.key} label={c.label} checked={cats.includes(c.key)} onCheckedChange={(v) => setCats(v ? [...cats, c.key] : cats.filter((x) => x !== c.key))} />
              ))}
            </div>
          </div>
          <Field label="Security events: lowest severity" htmlFor="ds-sev">
            <Select id="ds-sev" value={minSeverity} onValueChange={setMinSeverity} options={[{ value: ANY, label: "Every severity" }, ...["medium", "high", "critical"].map((s) => ({ value: s, label: `${s} and above` }))]} />
          </Field>
          <div className="md:col-span-2">
            <FormError error={error} />
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function DestinationControls({ id, kind, enabled, canWrite }: { id: string; kind: string; enabled: boolean; canWrite: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [secret, setSecret] = React.useState("");
  const [newSigning, setNewSigning] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ ok: boolean; status: number | null; error: string | null } | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            aria-label="Enabled"
            checked={enabled}
            disabled={!canWrite || pending === "toggle"}
            onCheckedChange={async (v) => {
              setPending("toggle");
              const r = await updateDestinationAction(id, { enabled: v });
              setPending(null);
              if (!r.ok) return toast.error(r.error);
              router.refresh();
            }}
          />
          {enabled ? "Sending events" : "Paused"}
        </label>
        <Button
          size="sm"
          variant="primary"
          loading={pending === "test"}
          disabled={!canWrite}
          disabledReason="Requires integrations:write"
          data-testid="destination-test"
          onClick={async () => {
            setPending("test");
            const r = await sendTestEventAction(id);
            setPending(null);
            if (!r.ok) return toast.error(r.error);
            setResult(r.data);
            router.refresh();
          }}
        >
          Send a test event
        </Button>
      </div>
      {result ? (
        <div data-testid="destination-test-result">
          <Note tone={result.ok ? "info" : "warning"}>{result.ok ? `Delivered (HTTP ${result.status}). The destination is now marked verified.` : `Not delivered: ${result.error ?? "unknown error"}`}</Note>
        </div>
      ) : null}
      <div className="border-t border-line pt-4">
        {kind === "webhook" ? (
          <div className="space-y-2">
            <Button
              size="sm"
              loading={pending === "secret"}
              disabled={!canWrite}
              disabledReason="Requires integrations:write"
              onClick={async () => {
                setPending("secret");
                const r = await replaceDestinationSecretAction(id, null);
                setPending(null);
                if (!r.ok) return toast.error(r.error);
                setNewSigning(r.data.signingSecret);
                router.refresh();
              }}
            >
              Rotate signing secret
            </Button>
            {newSigning ? <CodeBlock code={newSigning} /> : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Field label={kind === "slack" || kind === "teams" ? "New webhook URL" : kind === "servicenow" ? "New password" : "New token or key"} htmlFor="ds-new-secret" className="min-w-0 flex-1">
              <Input id="ds-new-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" disabled={!canWrite} />
            </Field>
            <Button
              size="sm"
              loading={pending === "secret"}
              disabled={!canWrite || secret.trim().length < 8}
              disabledReason={!canWrite ? "Requires integrations:write" : "Enter the new credential"}
              onClick={async () => {
                setPending("secret");
                const r = await replaceDestinationSecretAction(id, secret);
                setPending(null);
                if (!r.ok) return toast.error(r.error);
                setSecret("");
                toast.success("Credential replaced; send a test event to verify it");
                router.refresh();
              }}
            >
              Replace credential
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function RetryDeliveryButton({ destinationId, deliveryId, canWrite }: { destinationId: string; deliveryId: string; canWrite: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      size="sm"
      loading={pending}
      disabled={!canWrite}
      disabledReason="Requires integrations:write"
      onClick={async () => {
        setPending(true);
        const r = await retryDeliveryAction(destinationId, deliveryId);
        setPending(false);
        if (!r.ok) return toast.error(r.error);
        toast.success("Queued for the next dispatch, within a minute");
        router.refresh();
      }}
    >
      Retry
    </Button>
  );
}
