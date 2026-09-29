"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CURRICULA, EMIRATES, passwordIssues, passwordScore } from "@/lib/signup";
import { signUpAction, startOAuthSignupAction, type SignupState } from "@/server/onboarding/signup-actions";

const emirateKey = (e: string) => e.replace(/\s+/g, "");

export function SignupForm({ providers, locale, initialError }: { providers: { google: boolean; microsoft: boolean }; locale: "en" | "ar"; initialError: "oauth" | "failed" | null }) {
  const t = useTranslations("onboarding.signup");
  const tc = useTranslations("onboarding.curricula");
  const te = useTranslations("onboarding.emirates");
  const [state, action, pending] = useActionState<SignupState, FormData>(signUpAction, { error: null });
  const [oState, oAction, oPending] = useActionState<SignupState, FormData>(startOAuthSignupAction, { error: null });
  const [v, setV] = useState({ schoolNameEn: "", schoolNameAr: "", emirate: "Dubai", adminName: "", email: "", password: "", isPrincipal: false });
  const [curricula, setCurricula] = useState<string[]>([]);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((p) => ({ ...p, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const current = oState.error ? oState : state;
  const busy = pending || oPending;
  const score = passwordScore(v.password, v.email);
  const issues = v.password ? passwordIssues(v.password, v.email) : [];
  const fieldError = (f: string) => current.error === "invalid" && current.field === f;
  const message =
    current.error === "rate"
      ? t("errors.rate")
      : current.error === "credentials"
        ? t("errors.credentials")
        : current.error === "failed" || initialError === "failed"
          ? t("errors.failed")
          : current.error === "disabled"
            ? t("closedBody")
            : current.error === "invalid"
              ? current.field
                ? t(`errors.field.${current.field}`)
                : t("errors.invalid")
              : initialError === "oauth"
                ? t("errors.oauth")
                : null;
  const oauth = providers.google || providers.microsoft;
  const formRef = useRef<HTMLFormElement>(null);
  // Submit through the action without React's automatic form reset, so a rejected form keeps what was typed.
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
  const oauthWith = (provider: "google" | "microsoft-entra-id") => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    fd.set("provider", provider);
    startTransition(() => oAction(fd));
  };

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-6" data-testid="signup-form">
      <input type="hidden" name="locale" value={locale} />
      {/* Honeypot: hidden from people and assistive technology. */}
      <div aria-hidden="true" className="pointer-events-none absolute -z-10 size-px overflow-hidden opacity-0">
        <label htmlFor="website">{t("honeypot")}</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-semibold">{t("schoolSection")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="schoolNameEn">{t("schoolNameEn")}</Label>
            <Input id="schoolNameEn" name="schoolNameEn" required minLength={3} maxLength={120} dir="ltr" className="text-start" value={v.schoolNameEn} onChange={set("schoolNameEn")} aria-invalid={fieldError("schoolNameEn")} placeholder={t("schoolNameEnPh")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="schoolNameAr">{t("schoolNameAr")}</Label>
            <Input id="schoolNameAr" name="schoolNameAr" required minLength={3} maxLength={120} dir="rtl" className="text-start" value={v.schoolNameAr} onChange={set("schoolNameAr")} aria-invalid={fieldError("schoolNameAr")} placeholder={t("schoolNameArPh")} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="emirate">{t("emirate")}</Label>
          <select id="emirate" name="emirate" value={v.emirate} onChange={set("emirate")} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
            {EMIRATES.map((e) => (
              <option key={e} value={e}>
                {te(emirateKey(e))}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium" id="curricula-label">
            {t("curricula")}
          </p>
          <p className="text-xs text-muted-foreground">{t("curriculaHint")}</p>
          <div role="group" aria-labelledby="curricula-label" className="flex flex-wrap gap-2" data-testid="curricula">
            {CURRICULA.map((c) => {
              const on = curricula.includes(c);
              return (
                <label key={c} data-testid={`curriculum-${c}`} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50", on ? "border-brand bg-brand-soft text-brand" : "hover:bg-muted", fieldError("curricula") && !on && "border-destructive/50")}>
                  <input type="checkbox" name="curricula" value={c} checked={on} onChange={() => setCurricula((p) => (on ? p.filter((x) => x !== c) : [...p, c]))} className="sr-only" />
                  {on && <Check className="size-3.5" />}
                  {tc(c)}
                </label>
              );
            })}
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-semibold">{t("adminSection")}</legend>
        <div className="space-y-1.5">
          <Label htmlFor="adminName">{t("adminName")}</Label>
          <Input id="adminName" name="adminName" required minLength={2} maxLength={120} autoComplete="name" value={v.adminName} onChange={set("adminName")} aria-invalid={fieldError("adminName")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" dir="ltr" className="text-start" value={v.email} onChange={set("email")} aria-invalid={fieldError("email")} />
          <p className="text-xs text-muted-foreground">{t("emailHint")}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("password")}</Label>
          <Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" dir="ltr" className="text-start" value={v.password} onChange={set("password")} aria-invalid={fieldError("password")} aria-describedby="password-help" />
          <div id="password-help" className="space-y-1">
            <div className="flex gap-1" aria-hidden="true">
              {[1, 2, 3].map((i) => (
                <span key={i} className={cn("h-1 flex-1 rounded-full bg-muted", score >= i && (score === 1 ? "bg-danger" : score === 2 ? "bg-warning" : "bg-success"))} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground" data-testid="password-strength">
              {v.password ? t(`strength.s${score}`) : t("passwordHint")}
              {issues.length > 0 && ` ${issues.map((i) => t(`issues.${i}`)).join(" ")}`}
            </p>
          </div>
        </div>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="isPrincipal" checked={v.isPrincipal} onChange={set("isPrincipal")} className="mt-0.5 size-4 accent-[var(--brand)]" data-testid="is-principal" />
          <span>
            <span className="font-medium">{t("isPrincipal")}</span>
            <span className="block text-xs text-muted-foreground">{t("isPrincipalHint")}</span>
          </span>
        </label>
      </fieldset>

      {message && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" data-testid="signup-error">
          {message}
        </p>
      )}

      <div className="space-y-3">
        <Button type="submit" size="lg" className="w-full" disabled={busy} data-testid="signup-submit">
          {pending && <Loader2 className="size-4 animate-spin" />}
          {pending ? t("creating") : t("submit")}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{t("terms")}</p>
      </div>

      {oauth && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {t("orOAuth")}
            <span className="h-px flex-1 bg-border" />
          </div>
          <p className="text-xs text-muted-foreground">{t("oauthHint")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {providers.google && (
              <Button type="button" variant="outline" onClick={() => oauthWith("google")} disabled={busy}>
                {t("google")}
              </Button>
            )}
            {providers.microsoft && (
              <Button type="button" variant="outline" onClick={() => oauthWith("microsoft-entra-id")} disabled={busy}>
                {t("microsoft")}
              </Button>
            )}
          </div>
        </div>
      )}
    </form>
  );
}
