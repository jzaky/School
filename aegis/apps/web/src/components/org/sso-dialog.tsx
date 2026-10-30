"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSsoConnectionAction } from "@/server/actions/org";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export interface SsoInitial {
  protocol: "oidc" | "saml";
  issuer: string;
  clientId: string;
  emailDomains: string[];
  enabled: boolean;
  samlEntryPoint: string;
  hasSecret: boolean;
  hasCert: boolean;
}

/** Single sign-on settings. Secrets and certificates are write-only: they are never shown again. */
export function SsoDialog({ initial, canAdmin, spEntityId, acsUrl, oidcRedirectUri }: { initial: SsoInitial | null; canAdmin: boolean; spEntityId: string; acsUrl: string; oidcRedirectUri: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [protocol, setProtocol] = React.useState<"oidc" | "saml">(initial?.protocol ?? "oidc");
  const [issuer, setIssuer] = React.useState(initial?.issuer ?? "");
  const [clientId, setClientId] = React.useState(initial?.clientId ?? "");
  const [clientSecret, setClientSecret] = React.useState("");
  const [entryPoint, setEntryPoint] = React.useState(initial?.samlEntryPoint ?? "");
  const [cert, setCert] = React.useState("");
  const [domains, setDomains] = React.useState((initial?.emailDomains ?? []).join(", "));
  const [enabled, setEnabled] = React.useState(initial?.enabled ?? false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await saveSsoConnectionAction({
      protocol,
      issuer,
      clientId: protocol === "oidc" ? clientId : clientId || "saml",
      ...(clientSecret ? { clientSecret } : {}),
      emailDomains: domains.split(/[,\s]+/).map((d) => d.trim().toLowerCase()).filter(Boolean),
      enabled,
      ...(protocol === "saml" ? { samlEntryPoint: entryPoint, ...(cert ? { samlIdpCert: cert } : {}) } : {}),
    });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success("Single sign-on saved");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button disabled={!canAdmin} disabledReason="Requires org:admin" data-testid="configure-sso">
          Configure single sign-on
        </Button>
      }
      title="Single sign-on"
      description="People from the email domains you list sign in through your identity provider. New people join as viewers. An existing AEGIS account from another organization is never taken over: invite it first."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="sso-form" loading={pending}>
            Save
          </Button>
        </>
      }
    >
      <form id="sso-form" onSubmit={save} className="space-y-3">
        <Field label="Protocol" htmlFor="sso-protocol">
          <Select id="sso-protocol" value={protocol} onValueChange={(v) => setProtocol(v as "oidc" | "saml")} options={[{ value: "oidc", label: "OpenID Connect" }, { value: "saml", label: "SAML 2.0" }]} />
        </Field>
        <Field label={protocol === "oidc" ? "Issuer" : "Identity provider entity id"} htmlFor="sso-issuer" hint={protocol === "oidc" ? "public https address, for example https://login.microsoftonline.com/<tenant>/v2.0" : "the entity id your identity provider shows in its metadata"}>
          <Input id="sso-issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} required />
        </Field>
        {protocol === "oidc" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Client id" htmlFor="sso-client">
              <Input id="sso-client" value={clientId} onChange={(e) => setClientId(e.target.value)} required />
            </Field>
            <Field label="Client secret" htmlFor="sso-secret" hint={initial?.hasSecret ? "stored; leave empty to keep it" : "stored encrypted"}>
              <Input id="sso-secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} required={!initial?.hasSecret} autoComplete="off" />
            </Field>
            <p className="text-xs text-fg-muted md:col-span-2">
              Redirect address to register with your provider: <span className="font-mono">{oidcRedirectUri}</span>
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Sign-on URL" htmlFor="sso-entry" hint="where AEGIS sends people to sign in (HTTP-Redirect binding)">
              <Input id="sso-entry" value={entryPoint} onChange={(e) => setEntryPoint(e.target.value)} required />
            </Field>
            <Field label="Signing certificate" htmlFor="sso-cert" hint={initial?.hasCert ? "stored; paste a new one to replace it" : "the identity provider's X.509 certificate, PEM"}>
              <Textarea id="sso-cert" mono rows={4} value={cert} onChange={(e) => setCert(e.target.value)} required={!initial?.hasCert} />
            </Field>
            <p className="text-xs text-fg-muted">
              Give your identity provider this entity id <span className="font-mono">{spEntityId}</span> and this reply address <span className="font-mono">{acsUrl}</span>. Assertions must be signed.
            </p>
          </div>
        )}
        <Field label="Email domains" htmlFor="sso-domains" hint="comma separated, for example meridian-demo.example">
          <Input id="sso-domains" value={domains} onChange={(e) => setDomains(e.target.value)} required />
        </Field>
        <label className="flex items-center gap-2 text-sm" htmlFor="sso-enabled">
          <input id="sso-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Turn single sign-on on
        </label>
        <FormError error={error} />
      </form>
    </Dialog>
  );
}
