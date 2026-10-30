"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Plus, ScanSearch } from "lucide-react";
import { createAiProviderAction, issuePersonalAiKeyAction, previewAiDecisionAction, revokePersonalAiKeyAction, setAiGatewayModeAction, setAiProviderApprovalAction } from "@/server/actions/ai-gateway";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/code-block";
import { Note } from "@/components/ui/note";
import { DECISION_LABEL, decisionTone } from "./format";


// ---------- personal key ----------

type KeyRow = { id: string; name: string; prefix: string; expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null };

export function PersonalKeyPanel({ apiBase, keys: serverKeys }: { apiBase: string; keys: KeyRow[] }) {
  const router = useRouter();
  // Local copy so a new or revoked key shows at once, before the page data refreshes.
  const [keys, setKeys] = React.useState(serverKeys);
  React.useEffect(() => setKeys(serverKeys), [serverKeys]);
  const [name, setName] = React.useState("My laptop");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<string | null>(null);
  const snippet = `curl ${apiBase}/v1/ai/chat/completions \\\n  -H "Authorization: Bearer ${issued ?? "<your AEGIS key>"}" \\\n  -H "content-type: application/json" \\\n  -d '{"model":"<approved model>","messages":[{"role":"user","content":"Hello"}]}'`;
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          const r = await issuePersonalAiKeyAction({ name });
          setPending(false);
          if (!r.ok) return setError(r.error);
          setIssued(r.data.key);
          setKeys((ks) => [{ id: r.data.id, name: r.data.name, prefix: r.data.prefix, expiresAt: r.data.expiresAt, revokedAt: null, lastUsedAt: null }, ...ks.filter((k) => k.id !== r.data.id)]);
          router.refresh();
        }}
      >
        <Field label="Key name" htmlFor="ai-key-name" className="min-w-[220px]">
          <Input id="ai-key-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Button type="submit" variant="primary" loading={pending} data-testid="issue-ai-key">
          <KeyRound className="h-3.5 w-3.5" aria-hidden />
          Issue a personal key
        </Button>
      </form>
      <FormError error={error} />
      {issued ? (
        <div className="space-y-2" data-testid="issued-ai-key">
          <Note>This key is shown once. It acts as you, can only send chat requests through the AI gateway and expires in 90 days.</Note>
          <CodeBlock code={issued} label="Your new key" />
        </div>
      ) : null}
      <CodeBlock code={snippet} label="Use it with any OpenAI-compatible client by pointing the base URL at AEGIS" wrap />
      {keys.length ? (
        <ul className="divide-y divide-line rounded-md border border-line text-sm" data-testid="ai-key-list">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                <span className="text-fg">{k.name}</span> <span className="font-mono text-xs text-fg-muted">aegis_ak_{k.prefix}_...</span>
              </span>
              <span className="flex items-center gap-2 text-xs text-fg-muted">
                {k.revokedAt ? <Badge tone="deny">Revoked</Badge> : k.expiresAt && new Date(k.expiresAt) < new Date() ? <Badge>Expired</Badge> : <Badge tone="allow">Active</Badge>}
                {!k.revokedAt ? (
                  <Button size="sm" variant="ghost" onClick={() => setRevoking(k.id)}>
                    Revoke
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke this key?"
        description="Anything using it stops working at once. You can issue a new key afterwards."
        confirmLabel="Revoke key"
        danger
        onConfirm={async () => {
          const r = await revokePersonalAiKeyAction({ id: revoking });
          if (!r.ok) return r.error;
          toast.success("Key revoked");
          setKeys((ks) => ks.map((k) => (k.id === revoking ? { ...k, revokedAt: new Date().toISOString() } : k)));
          setRevoking(null);
          router.refresh();
        }}
      />
    </div>
  );
}

// ---------- providers ----------

export function AddProviderButton({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ key: "", name: "", baseUrl: "https://", models: "", apiKey: "", declaredRegion: "", retentionNote: "" });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Approve a model provider"
      description="Any OpenAI-compatible endpoint. The API key goes to the credential vault and is never shown again. Region and retention are your statements about the provider; AEGIS records them but cannot verify them."
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Needs the integrations:write permission">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add provider
        </Button>
      }
    >
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          const r = await createAiProviderAction({ ...form, models: form.models.split(",").map((s) => s.trim()).filter(Boolean), apiKey: form.apiKey || undefined });
          setPending(false);
          if (!r.ok) return setError(r.error);
          toast.success("Provider added");
          setOpen(false);
          router.refresh();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Key" htmlFor="p-key" hint="lowercase, for example azure-openai">
            <Input id="p-key" value={form.key} onChange={set("key")} required />
          </Field>
          <Field label="Name" htmlFor="p-name">
            <Input id="p-name" value={form.name} onChange={set("name")} required />
          </Field>
        </div>
        <Field label="Base URL" htmlFor="p-url" hint="HTTPS, up to and including /v1">
          <Input id="p-url" value={form.baseUrl} onChange={set("baseUrl")} required />
        </Field>
        <Field label="Approved models" htmlFor="p-models" hint="comma separated, exactly as the provider names them">
          <Input id="p-models" value={form.models} onChange={set("models")} required />
        </Field>
        <Field label="Provider API key" htmlFor="p-apikey" hint="optional now; requests are refused until a key is stored">
          <Input id="p-apikey" type="password" value={form.apiKey} onChange={set("apiKey")} autoComplete="off" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Declared processing region" htmlFor="p-region">
            <Input id="p-region" value={form.declaredRegion} onChange={set("declaredRegion")} maxLength={80} />
          </Field>
          <Field label="Retention terms" htmlFor="p-retention">
            <Input id="p-retention" value={form.retentionNote} onChange={set("retentionNote")} maxLength={500} />
          </Field>
        </div>
        <FormError error={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={pending}>
            Add provider
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ProviderApprovalButton({ id, approved, canAct }: { id: string; approved: boolean; canAct: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant={approved ? "ghost" : "secondary"} disabled={!canAct} disabledReason={approved ? "Blocking a provider needs the agents:control permission" : "Approving a provider needs the integrations:write permission"} onClick={() => setOpen(true)}>
        {approved ? "Block" : "Approve"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={approved ? "Block this provider?" : "Approve this provider?"}
        description={approved ? "Every request to its models is refused from the next request. Nothing already sent can be recalled." : "Requests to its approved models will be forwarded, subject to data protection and your AI usage policy."}
        confirmLabel={approved ? "Block provider" : "Approve provider"}
        danger={approved}
        reason={{ label: "Reason", required: true }}
        onConfirm={async ({ reason }) => {
          const r = await setAiProviderApprovalAction({ id, approved: !approved, reason });
          if (!r.ok) return r.error;
          toast.success(approved ? "Provider blocked" : "Provider approved");
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}

// ---------- mode ----------

export function AiGatewayModeControl({ mode, canWrite }: { mode: "enforce" | "monitor"; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const next = mode === "enforce" ? "monitor" : "enforce";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3" data-testid="ai-gateway-mode" data-mode={mode}>
      <span className="flex items-center gap-2 text-sm">
        {mode === "enforce" ? <Badge tone="allow">Enforcing</Badge> : <Badge tone="approval">Monitor only: nothing is blocked</Badge>}
      </span>
      <Button size="sm" variant="secondary" disabled={!canWrite} disabledReason="Needs the security:write permission" onClick={() => setOpen(true)}>
        {mode === "enforce" ? "Switch to monitor only" : "Start enforcing"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={next === "monitor" ? "Stop blocking and only monitor?" : "Start enforcing?"}
        description={next === "monitor" ? "Requests the policy would block will be sent to the provider. Each one is recorded as not blocked and raises a security event." : "Requests the policy blocks will no longer be sent."}
        confirmLabel={next === "monitor" ? "Monitor only" : "Enforce"}
        danger={next === "monitor"}
        reason={{ label: "Reason", required: true }}
        onConfirm={async ({ reason }) => {
          const r = await setAiGatewayModeAction({ mode: next, reason });
          if (!r.ok) return r.error;
          toast.success(next === "monitor" ? "Monitor only" : "Enforcing");
          setOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

// ---------- dry run ----------

type Preview = { decision: string; basis: string; reasons: string[]; classes: { dataClass: string; count: number; action: string }[]; rewritten: string | null; provider: { key: string; approved: boolean } | null };

export function AiPreviewPanel({ models }: { models: string[] }) {
  const [model, setModel] = React.useState(models[0] ?? "");
  const [text, setText] = React.useState("Summarize this complaint from amira.saleh@example.com about card 4111 1111 1111 1111.");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Preview | null>(null);
  return (
    <div className="space-y-3">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          const r = await previewAiDecisionAction({ model, text });
          setPending(false);
          if (!r.ok) return setError(r.error);
          setResult(r.data);
        }}
      >
        <Field label="Model" htmlFor="pv-model" hint="a model name as an employee's tool would send it">
          <Input id="pv-model" value={model} onChange={(e) => setModel(e.target.value)} required maxLength={120} />
        </Field>
        <Field label="Prompt" htmlFor="pv-text">
          <Textarea id="pv-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={20_000} mono />
        </Field>
        <Button type="submit" variant="primary" loading={pending} disabled={!model || !text.trim()} disabledReason="Enter a model and a prompt" data-testid="ai-preview-run">
          <ScanSearch className="h-3.5 w-3.5" aria-hidden />
          Check without sending
        </Button>
        <FormError error={error} />
      </form>
      {result ? (
        <div className="space-y-2 text-sm" aria-live="polite" data-testid="ai-preview-result" data-decision={result.decision}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={decisionTone(result.decision)}>{DECISION_LABEL[result.decision] ?? result.decision}</Badge>
            <span className="text-xs text-fg-muted">{result.basis === "policy" ? "Decided by your AI usage policy" : "Decided by data protection alone (no AI usage policy is active)"}</span>
          </div>
          <ul className="list-disc ps-5 text-fg-muted">
            {result.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {result.classes.length ? <p className="text-xs text-fg-muted">Found: {result.classes.map((c) => `${c.dataClass} (${c.count})`).join(", ")}</p> : null}
          {result.rewritten !== null ? <CodeBlock code={result.rewritten} label="What the provider would receive" wrap copy={false} /> : <p className="text-xs text-fg-muted">Nothing would be sent to the provider.</p>}
        </div>
      ) : null}
    </div>
  );
}
