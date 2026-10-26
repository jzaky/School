"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, CircleDashed, Loader2, PlugZap, Save, ServerCog, Unlink } from "lucide-react";
import { useRouter, Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Pill } from "@/components/app/badges";
import { CopyValue } from "@/components/integrations/api-keys";
import { saveSignInSettingsAction, testOidcAction, unlinkIdentityAction, type SettingsInput } from "@/server/sso/actions";
import { MethodMark } from "./brand";
import { cn } from "@/lib/utils";

export type MethodStatus = { state: "ready" | "server" | "tenant" | "provider"; missing: string[] };
type Value = Required<SettingsInput>;
type Urls = { classlinkCallback: string; classlinkLaunch: string; cleverCallback: string; uaepassCallback: string; oidcCallback: string; googleCallback: string; microsoftCallback: string; origin: string };

const METHODS = ["classlink", "clever", "microsoft", "google", "oidc", "uaepass", "magic_link", "password"] as const;
const MATCH = ["EMAIL_OR_EXTERNAL_ID", "EMAIL", "EXTERNAL_ID"] as const;

function Section({ title, body, children, id }: { title: string; body?: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-xs" id={id}>
      <div className="border-b px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {body && <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>}
      </div>
      <div className="divide-y">{children}</div>
    </section>
  );
}

function Field({ label, help, children, htmlFor }: { label: string; help?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5 px-4 py-4 sm:px-5">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </Label>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      {children}
    </div>
  );
}

function ToggleRow({ id, title, body, checked, onChange, disabled, lock, testId, children }: { id: string; title: React.ReactNode; body: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; lock?: string | null; testId: string; children?: React.ReactNode }) {
  const sw = <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} data-testid={testId} />;
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {title}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
        {children}
      </div>
      {lock ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>{sw}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{lock}</TooltipContent>
        </Tooltip>
      ) : (
        sw
      )}
    </div>
  );
}

const splitDomains = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

export function SignInSettingsForm({ tab, slug, status, urls, uaePassEnv, initial, hasOidcSecret }: { tab: "options" | "providers"; slug: string; status: Record<string, MethodStatus>; urls: Urls; uaePassEnv: "staging" | "production"; initial: Value; hasOidcSecret: boolean }) {
  const t = useTranslations("sso.admin");
  const router = useRouter();
  const [v, setV] = useState<Value>(initial);
  const [allowed, setAllowed] = useState(initial.allowedDomains.join(", "));
  const [selfJoin, setSelfJoin] = useState(initial.selfJoinDomains.join(", "));
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();
  const [oidcTest, setOidcTest] = useState<string | null>(null);
  const set = (patch: Partial<Value>) => setV((cur) => ({ ...cur, ...patch }));
  const on = (m: string) => v.methods.includes(m);
  const toggle = (m: string, c: boolean) => set({ methods: c ? [...v.methods, m] : v.methods.filter((x) => x !== m) });

  const save = () =>
    start(async () => {
      const res = await saveSignInSettingsAction({ ...v, allowedDomains: splitDomains(allowed), selfJoinDomains: splitDomains(selfJoin) });
      if (!res.ok) return void toast.error(t.has(`errors.${res.error}`) ? t(`errors.${res.error}`) : t("errors.generic"));
      setV((cur) => ({ ...cur, oidcSecret: "" }));
      toast.success(t("saved"));
      router.refresh();
    });

  const testOidc = () =>
    startTest(async () => {
      const res = await testOidcAction(v.oidcIssuer);
      setOidcTest(res.ok ? t("oidc.testOk", { issuer: res.issuer }) + (res.pkce ? ` ${t("oidc.testPkce")}` : "") : t.has(`errors.${res.error}`) ? t(`errors.${res.error}`) : t("errors.DISCOVERY"));
    });

  const statusPill = (m: string) => {
    const s = status[m];
    if (!s) return null;
    if (s.state === "ready") return <Pill tone="success" dot>{t("status.ready")}</Pill>;
    if (s.state === "server") return <Pill tone="neutral">{t("status.server")}</Pill>;
    return (
      <Link href="/admin/sign-in?tab=providers" className="inline-flex">
        <Pill tone="warning">{t(s.state === "tenant" ? "status.tenant" : "status.provider")}</Pill>
      </Link>
    );
  };

  const lockFor = (m: string) => {
    const s = status[m];
    if (m === "password" || !s || s.state === "ready") return null;
    if (s.state === "server") return t("lockServer", { names: s.missing.join(", ") });
    return t(s.state === "tenant" ? "lockTenant" : "lockProvider");
  };

  return (
    <div className="space-y-4">
      {tab === "options" && (
        <>
          <Section title={t("optionsTitle")} body={t("optionsBody")}>
            {METHODS.map((m) => {
              const lock = lockFor(m);
              return (
                <ToggleRow
                  key={m}
                  id={`method-${m}`}
                  testId={`method-${m}`}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <MethodMark method={m} className="size-5" />
                      {m === "oidc" && v.oidcName ? v.oidcName : t(`methods.${m}.name`)}
                      {statusPill(m)}
                    </span>
                  }
                  body={t(`methods.${m}.body`)}
                  checked={on(m) && (m === "password" || status[m]?.state !== "server")}
                  onChange={(c) => toggle(m, c)}
                  disabled={!!lock && !on(m)}
                  lock={lock && !on(m) ? lock : null}
                />
              );
            })}
          </Section>
          <Section title={t("rulesTitle")} body={t("rulesBody")}>
            <ToggleRow id="staff-sso" testId="staff-sso" title={t("staffSso")} body={t("staffSsoBody")} checked={v.staffSsoRequired} onChange={(c) => set({ staffSsoRequired: c })} />
            <Field label={t("allowedDomains")} help={t("allowedDomainsBody")} htmlFor="allowed-domains">
              <Input id="allowed-domains" dir="ltr" className="text-start" value={allowed} onChange={(e) => setAllowed(e.target.value)} placeholder={t("domainsPlaceholder")} data-testid="allowed-domains" />
            </Field>
            <Field label={t("matchBy")} help={t("matchByBody")}>
              <Select value={v.matchBy} onValueChange={(x) => set({ matchBy: x })}>
                <SelectTrigger className="w-full sm:w-96" data-testid="match-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATCH.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`match.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("selfJoin")} help={t("selfJoinBody")} htmlFor="self-join">
              <Input id="self-join" dir="ltr" className="text-start" value={selfJoin} onChange={(e) => setSelfJoin(e.target.value)} placeholder={t("domainsPlaceholder")} data-testid="self-join-domains" />
            </Field>
            <ToggleRow id="self-join-approval" testId="self-join-approval" title={t("selfJoinApproval")} body={t("selfJoinApprovalBody")} checked={v.selfJoinApproval} onChange={(c) => set({ selfJoinApproval: c })} />
          </Section>
        </>
      )}

      {tab === "providers" && (
        <>
          <Section title={t("classlink.title")} body={t("classlink.body")} id="classlink">
            <Field label={t("classlink.tenant")} help={t("classlink.tenantHelp")} htmlFor="cl-tenant">
              <Input id="cl-tenant" dir="ltr" className="text-start sm:max-w-xs" value={v.classlinkTenantId} onChange={(e) => set({ classlinkTenantId: e.target.value })} data-testid="classlink-tenant" />
            </Field>
            <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-5">
              <div className="min-w-0 space-y-1">
                <div className="text-xs text-muted-foreground">{t("redirectUri")}</div>
                <CopyValue value={urls.classlinkCallback} testId="classlink-redirect" />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="text-xs text-muted-foreground">{t("classlink.launch")}</div>
                <CopyValue value={urls.classlinkLaunch} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-muted-foreground sm:px-5">
              {status.classlink?.state === "server" ? <span>{t("serverMissing", { names: status.classlink.missing.join(", ") })}</span> : <span>{t("classlink.ready")}</span>}
              <Link href="/admin/rostering" className="font-medium text-brand hover:underline">
                {t("classlink.rosters")}
              </Link>
            </div>
          </Section>

          <Section title={t("clever.title")} body={t("clever.body")}>
            <Field label={t("clever.district")} help={t("clever.districtHelp")} htmlFor="clever-district">
              <Input id="clever-district" dir="ltr" className="text-start sm:max-w-xs" value={v.cleverDistrictId} onChange={(e) => set({ cleverDistrictId: e.target.value })} />
            </Field>
            <div className="space-y-1 px-4 py-4 sm:px-5">
              <div className="text-xs text-muted-foreground">{t("redirectUri")}</div>
              <CopyValue value={urls.cleverCallback} />
            </div>
          </Section>

          <Section title={t("microsoft.title")} body={t("microsoft.body")}>
            <Field label={t("microsoft.tenant")} help={t("microsoft.tenantHelp")} htmlFor="ms-tenant">
              <Input id="ms-tenant" dir="ltr" className="text-start sm:max-w-sm" value={v.microsoftTenantId} onChange={(e) => set({ microsoftTenantId: e.target.value })} placeholder="00000000-0000-0000-0000-000000000000" />
            </Field>
            <div className="space-y-1 px-4 py-4 sm:px-5">
              <div className="text-xs text-muted-foreground">{t("redirectUri")}</div>
              <CopyValue value={urls.microsoftCallback} />
            </div>
          </Section>

          <Section title={t("google.title")} body={t("google.body")}>
            <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-5">
              <div className="min-w-0 space-y-1">
                <div className="text-xs text-muted-foreground">{t("redirectUri")}</div>
                <CopyValue value={urls.googleCallback} />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="text-xs text-muted-foreground">{t("google.origin")}</div>
                <CopyValue value={urls.origin} />
              </div>
            </div>
          </Section>

          <Section title={t("uaepass.title")} body={t("uaepass.body")}>
            <div className="flex flex-wrap items-center gap-2 px-4 py-4 text-sm sm:px-5">
              <ServerCog className="size-4 text-muted-foreground" />
              <span>{t("uaepass.environment")}</span>
              <Pill tone={uaePassEnv === "production" ? "success" : "info"}>{t(`uaepass.env.${uaePassEnv}`)}</Pill>
              {status.uaepass?.state === "server" && <span className="text-xs text-muted-foreground">{t("serverMissing", { names: status.uaepass.missing.join(", ") })}</span>}
            </div>
            <ToggleRow id="uaepass-eid" testId="uaepass-eid" title={t("uaepass.eid")} body={t("uaepass.eidBody")} checked={v.uaePassEidMatch} onChange={(c) => set({ uaePassEidMatch: c })} />
            <div className="space-y-1 px-4 py-4 sm:px-5">
              <div className="text-xs text-muted-foreground">{t("redirectUri")}</div>
              <CopyValue value={urls.uaepassCallback} />
            </div>
          </Section>

          <Section title={t("oidc.title")} body={t("oidc.body")}>
            <div className="grid gap-0 sm:grid-cols-2">
              <Field label={t("oidc.name")} help={t("oidc.nameHelp")} htmlFor="oidc-name">
                <Input id="oidc-name" value={v.oidcName} onChange={(e) => set({ oidcName: e.target.value })} placeholder={t("oidc.namePlaceholder")} />
              </Field>
              <Field label={t("oidc.issuer")} help={t("oidc.issuerHelp")} htmlFor="oidc-issuer">
                <div className="flex gap-2">
                  <Input id="oidc-issuer" dir="ltr" className="min-w-0 text-start" value={v.oidcIssuer} onChange={(e) => set({ oidcIssuer: e.target.value })} placeholder="https://login.example.org" data-testid="oidc-issuer" />
                  <Button type="button" variant="outline" onClick={testOidc} disabled={!v.oidcIssuer || testing} data-testid="oidc-test">
                    {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                    {t("oidc.test")}
                  </Button>
                </div>
                {oidcTest && (
                  <p className="text-xs text-muted-foreground" role="status" data-testid="oidc-test-result">
                    {oidcTest}
                  </p>
                )}
              </Field>
              <Field label={t("oidc.clientId")} htmlFor="oidc-client">
                <Input id="oidc-client" dir="ltr" className="text-start" value={v.oidcClientId} onChange={(e) => set({ oidcClientId: e.target.value })} />
              </Field>
              <Field label={t("oidc.secret")} help={hasOidcSecret ? t("oidc.secretSaved") : t("oidc.secretHelp")} htmlFor="oidc-secret">
                <Input id="oidc-secret" type="password" dir="ltr" className="text-start" autoComplete="off" value={v.oidcSecret} onChange={(e) => set({ oidcSecret: e.target.value })} placeholder={hasOidcSecret ? "••••••••" : ""} />
              </Field>
              <Field label={t("oidc.scopes")} htmlFor="oidc-scopes">
                <Input id="oidc-scopes" dir="ltr" className="text-start" value={v.oidcScopes} onChange={(e) => set({ oidcScopes: e.target.value })} />
              </Field>
              <Field label={t("oidc.claims")} help={t("oidc.claimsHelp")}>
                <div className="grid grid-cols-3 gap-2">
                  <Input aria-label={t("oidc.emailClaim")} dir="ltr" className="text-start" value={v.oidcEmailClaim} onChange={(e) => set({ oidcEmailClaim: e.target.value })} title={t("oidc.emailClaim")} />
                  <Input aria-label={t("oidc.idClaim")} dir="ltr" className="text-start" value={v.oidcIdClaim} onChange={(e) => set({ oidcIdClaim: e.target.value })} title={t("oidc.idClaim")} />
                  <Input aria-label={t("oidc.nameClaim")} dir="ltr" className="text-start" value={v.oidcNameClaim} onChange={(e) => set({ oidcNameClaim: e.target.value })} title={t("oidc.nameClaim")} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                  <span>{t("oidc.emailClaim")}</span>
                  <span>{t("oidc.idClaim")}</span>
                  <span>{t("oidc.nameClaim")}</span>
                </div>
              </Field>
            </div>
            <ToggleRow id="oidc-trust" testId="oidc-trust" title={t("oidc.trust")} body={t("oidc.trustBody")} checked={v.oidcTrustEmail} onChange={(c) => set({ oidcTrustEmail: c })} />
            <div className="space-y-1 px-4 py-4 sm:px-5">
              <div className="text-xs text-muted-foreground">{t("redirectUri")}</div>
              <CopyValue value={urls.oidcCallback} />
            </div>
          </Section>

          <Section title={t("magic.title")} body={t("magic.body")}>
            <div className="flex items-center gap-2 px-4 py-4 text-sm sm:px-5">
              {status.magic_link?.state === "ready" ? <CheckCircle2 className="size-4 text-success" /> : <CircleDashed className="size-4 text-muted-foreground" />}
              <span>{status.magic_link?.state === "ready" ? t("magic.ready") : t("serverMissing", { names: status.magic_link?.missing.join(", ") ?? "" })}</span>
            </div>
          </Section>
        </>
      )}

      {/* Save sits at the start, clear of the demo guide button at the bottom end. */}
      <div className={cn("sticky bottom-0 z-10 -mx-4 flex items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border")}>
        <Button onClick={save} disabled={pending} data-testid="signin-save" className="shrink-0">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("save")}
        </Button>
        <p className="min-w-0 text-xs text-muted-foreground">{t("saveHint", { slug })}</p>
      </div>
    </div>
  );
}

export function UnlinkButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("sso.admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 shrink-0"
      aria-label={t("linked.unlink", { name })}
      title={t("linked.unlink", { name })}
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (!window.confirm(t("linked.confirm", { name }))) return;
          const res = await unlinkIdentityAction(id);
          if (!res.ok) return void toast.error(t("errors.generic"));
          toast.success(t("linked.done"));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Unlink className="size-3.5" />}
    </Button>
  );
}
