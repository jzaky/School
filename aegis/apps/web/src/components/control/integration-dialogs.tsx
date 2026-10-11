"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, KeyRound, Plus, Power, RefreshCw, Trash2 } from "lucide-react";
import { createIntegrationAction, revealWebhookSecretAction, revokeCredentialAction, rotateCredentialAction, setIntegrationStatusAction, storeCredentialAction } from "@/server/actions/integrations";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormError, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CodeBlock } from "@/components/ui/code-block";
import { Note } from "@/components/ui/note";
import { Badge } from "@/components/ui/badge";

const TYPES = ["banking", "support", "crm", "warehouse", "email", "http", "ticketing", "storage", "other"];

export function CreateIntegrationDialog({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [key, setKey] = React.useState("");
  const [keyTouched, setKeyTouched] = React.useState(false);
  const [type, setType] = React.useState("http");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [created, setCreated] = React.useState<{ id: string; key: string; webhookSecret: string } | null>(null);
  React.useEffect(() => {
    if (!keyTouched) setKey(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48));
  }, [name, keyTouched]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await createIntegrationAction({ key, name, type, description, baseUrl: baseUrl || undefined });
    setPending(false);
    if (!r.ok) return setError(r.error);
    setCreated(r.data);
    toast.success(`${name} registered`);
    router.refresh();
  }
  function close() {
    setOpen(false);
    setCreated(null);
    setError(null);
    setName("");
    setKey("");
    setKeyTouched(false);
    setBaseUrl("");
    setDescription("");
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires integrations:write">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New integration
        </Button>
      }
      title={created ? "Integration registered" : "New integration"}
      description={created ? "Copy the webhook secret now. It is shown once and stored encrypted; it can be revealed later only with integrations:write and an evidence entry." : "Registers a downstream system. Tools are attached to it and credentials are stored encrypted in the vault."}
      size="md"
      footer={
        created ? (
          <>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
            <Button variant="primary" onClick={() => router.push(`/integrations/${created.id}`)}>
              Open integration
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button form="new-integration-form" type="submit" variant="primary" loading={pending} disabled={name.trim().length < 2 || key.length < 2} disabledReason="Name and key are required">
              Register
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-3">
          <Note tone="warning">Shown once. Store it in the downstream system&apos;s webhook configuration.</Note>
          <CodeBlock label="Webhook secret" code={created.webhookSecret} wrap />
          <CodeBlock label="Webhook endpoint" code={`POST /v1/webhooks/${created.key}`} />
        </div>
      ) : (
        <form id="new-integration-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="int-name">
            <Input id="int-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} autoFocus />
          </Field>
          <Field label="Key" htmlFor="int-key" hint="lowercase, digits, hyphens">
            <Input
              id="int-key"
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
          <Field label="Type" htmlFor="int-type">
            <Select id="int-type" value={type} onValueChange={setType} options={TYPES.map((t) => ({ value: t, label: t }))} />
          </Field>
          <Field label="Base URL" htmlFor="int-url" hint="optional">
            <Input id="int-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com" className="font-mono" maxLength={300} />
          </Field>
          <Field label="Description" htmlFor="int-desc" className="sm:col-span-2">
            <Input id="int-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </Field>
          <div className="sm:col-span-2">
            <FormError error={error} />
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function IntegrationStatusButton({ integrationId, status, canWrite, canControl }: { integrationId: string; status: string; canWrite: boolean; canControl: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const disabling = status === "active";
  return (
    <>
      <Button variant={disabling ? "danger" : "primary"} onClick={() => setOpen(true)} disabled={disabling ? !canControl : !canWrite} disabledReason={disabling ? "Requires agents:control (emergency control)" : "Requires integrations:write"}>
        <Power className="h-3.5 w-3.5" aria-hidden />
        {disabling ? "Disable integration" : "Enable integration"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={disabling ? "Disable integration" : "Enable integration"}
        description={disabling ? "Emergency control: every tool behind this integration denies at the gateway and nothing executes downstream until it is enabled again." : "Tools behind this integration can execute again, subject to policy."}
        confirmLabel={disabling ? "Disable" : "Enable"}
        danger={disabling}
        reason={disabling ? { required: true } : { required: false, label: "Note" }}
        onConfirm={async ({ reason }) => {
          const r = await setIntegrationStatusAction(integrationId, disabling ? "disabled" : "active", reason);
          if (!r.ok) return r.error;
          toast.success(disabling ? "Integration disabled" : "Integration enabled");
          router.refresh();
        }}
      />
    </>
  );
}

export function StoreCredentialDialog({ integrationId, canWrite, existingNames }: { integrationId: string; canWrite: boolean; existingNames: string[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [days, setDays] = React.useState("90");
  const replaces = existingNames.includes(name);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await storeCredentialAction(integrationId, { name, secret, rotationDays: days });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(replaces ? `${name} rotated to version ${r.data.version}` : `${name} stored`);
    setOpen(false);
    setName("");
    setSecret("");
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
        <Button size="sm" disabled={!canWrite} disabledReason="Requires integrations:write">
          <KeyRound className="h-3.5 w-3.5" aria-hidden />
          Store credential
        </Button>
      }
      title="Store a credential"
      description="The secret is encrypted with the organization master key and never shown again. Storing under an existing name rotates it."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="store-credential-form" type="submit" variant="primary" loading={pending} disabled={name.length < 2 || secret.length < 8} disabledReason="Name (2+) and secret (8+ characters) are required">
            {replaces ? "Rotate" : "Store"}
          </Button>
        </>
      }
    >
      <form id="store-credential-form" onSubmit={submit} className="space-y-3">
        <Field label="Name" htmlFor="cred-name" hint="e.g. api-token">
          <Input id="cred-name" value={name} onChange={(e) => setName(e.target.value)} className="font-mono" pattern="^[a-zA-Z0-9_.-]+$" required autoFocus />
        </Field>
        {replaces ? <Badge tone="approval">Replaces the existing {name} (version increments)</Badge> : null}
        <Field label="Secret" htmlFor="cred-secret">
          <Input id="cred-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" required minLength={8} className="font-mono" />
        </Field>
        <Field label="Rotate every (days)" htmlFor="cred-days">
          <Input id="cred-days" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <FormError error={error} />
      </form>
    </Dialog>
  );
}

export function CredentialActions({ integrationId, credential, canWrite, canControl }: { integrationId: string; credential: { id: string; name: string; revoked: boolean }; canWrite: boolean; canControl: boolean }) {
  const router = useRouter();
  const [rotate, setRotate] = React.useState(false);
  const [revoke, setRevoke] = React.useState(false);
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={() => setRotate(true)} disabled={!canWrite || credential.revoked} disabledReason={credential.revoked ? "Revoked credentials are replaced by storing a new secret" : "Requires integrations:write"}>
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        Rotate
      </Button>
      <Button size="sm" variant="ghost" className="text-deny" onClick={() => setRevoke(true)} disabled={!canControl || credential.revoked} disabledReason={credential.revoked ? "Already revoked" : "Requires agents:control (emergency control)"}>
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        Revoke
      </Button>
      <ConfirmDialog
        open={rotate}
        onOpenChange={setRotate}
        title={`Rotate ${credential.name}`}
        description="Generates a fresh secret for the simulated system and bumps the version. Real systems supply their own secret through Store credential."
        confirmLabel="Rotate"
        onConfirm={async () => {
          const r = await rotateCredentialAction(integrationId, credential.id);
          if (!r.ok) return r.error;
          toast.success(`${credential.name} rotated to version ${r.data.version}`);
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={revoke}
        onOpenChange={setRevoke}
        title={`Revoke ${credential.name}`}
        description="Emergency control: execution through this integration fails closed until a new secret is stored."
        confirmLabel="Revoke"
        danger
        reason={{ required: true }}
        onConfirm={async ({ reason }) => {
          const r = await revokeCredentialAction(integrationId, credential.id, reason);
          if (!r.ok) return r.error;
          toast.success(`${credential.name} revoked`);
          router.refresh();
        }}
      />
    </div>
  );
}

export function RevealWebhookSecret({ integrationId, canWrite }: { integrationId: string; canWrite: boolean }) {
  const [confirm, setConfirm] = React.useState(false);
  const [secret, setSecret] = React.useState<string | null>(null);
  if (secret) {
    return (
      <div className="space-y-2">
        <CodeBlock label="Webhook secret" code={secret} wrap />
        <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
          Hide
        </Button>
      </div>
    );
  }
  return (
    <>
      <Button size="sm" onClick={() => setConfirm(true)} disabled={!canWrite} disabledReason="Requires integrations:write">
        <Eye className="h-3.5 w-3.5" aria-hidden />
        Reveal webhook secret
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Reveal the webhook secret"
        description="The view is recorded in the evidence ledger with your name and the time."
        confirmLabel="Reveal"
        onConfirm={async () => {
          const r = await revealWebhookSecretAction(integrationId);
          if (!r.ok) return r.error;
          setSecret(r.data.secret);
        }}
      />
    </>
  );
}
