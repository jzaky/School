"use client";

// The sign-in options: single sign-on buttons first (only those the school offers and the server has
// configured), then the email forms (password or an emailed link). Used by /login and /login/[school].
import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import NextLink from "next/link";
import { ArrowRight, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithPasswordAction, signInWithProviderAction } from "@/server/shell/actions";
import { requestMagicLinkAction } from "@/server/sso/actions";
import { MethodMark } from "./brand";
import { cn } from "@/lib/utils";

export type SsoButton = { method: "classlink" | "clever" | "uaepass" | "oidc" | "google" | "microsoft"; label?: string | null };

const KNOWN_ERRORS = [
  "NotProvisioned",
  "NoMembership",
  "ProviderDisabled",
  "METHOD_OFF",
  "WRONG_TENANT",
  "NO_EMAIL",
  "EMAIL_UNVERIFIED",
  "LOW_ASSURANCE",
  "DOMAIN_NOT_ALLOWED",
  "NOT_PROVISIONED",
  "SUSPENDED",
  "IDENTITY_TAKEN",
  "LINK_CONFLICT",
  "NO_SCHOOL",
  "SSO_NO_SCHOOL",
  "RATE_LIMITED",
  "SSO_STATE_MISSING",
  "SSO_STATE_MISMATCH",
  "SSO_PROVIDER_DENIED",
  "SSO_NOT_CONFIGURED",
] as const;

export function errorKey(code: string | null | undefined): string | null {
  if (!code) return null;
  if ((KNOWN_ERRORS as readonly string[]).includes(code)) return code;
  if (code === "CredentialsSignin") return "invalid";
  if (code.startsWith("SSO_")) return "SSO_GENERIC";
  return "generic";
}

export function SignInPanel({ school, sso, password, magicLink, error }: { school: { slug: string; name: string } | null; sso: SsoButton[]; password: boolean; magicLink: boolean; error: string | null }) {
  const t = useTranslations("sso.signin");
  const locale = useLocale();
  const [mode, setMode] = useState<"password" | "link">(password ? "password" : "link");
  const [pwState, pwAction, pwPending] = useActionState(signInWithPasswordAction, { error: null });
  const [mlState, mlAction, mlPending] = useActionState(requestMagicLinkAction, { done: false, error: null });
  const errKey = errorKey(error);
  const pwMessage = pwState?.error === "sso_required" ? t("errors.SSO_REQUIRED") : pwState?.error ? t("errors.invalid") : null;
  const startHref = (m: string) => `/api/sso/${m}/start?${new URLSearchParams({ ...(school ? { school: school.slug } : {}), locale }).toString()}`;
  const hasForms = password || magicLink;

  return (
    <div className="space-y-5" data-testid="sign-in-panel">
      {errKey && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" data-testid="sign-in-error">
          {t(`errors.${errKey}`)}
        </p>
      )}
      {sso.length > 0 && (
        <div className="grid gap-2.5" data-testid="sso-buttons">
          {sso.map((b) => {
            const text = b.method === "oidc" ? t("continueWithSchool", { name: b.label || t("schoolAccount") }) : t(`continueWith.${b.method}`);
            const cls = cn(
              "h-11 w-full justify-start gap-3 px-4 text-sm font-medium",
              b.method === "uaepass" && "border-[#1D1D1B] bg-[#1D1D1B] text-white hover:bg-[#333] hover:text-white",
            );
            if (b.method === "google" || b.method === "microsoft") {
              return (
                <Button key={b.method} type="button" variant="outline" className={cls} onClick={() => signInWithProviderAction(b.method === "google" ? "google" : "microsoft-entra-id", locale, school?.slug ?? null)} data-testid={`sso-${b.method}`}>
                  <MethodMark method={b.method} className="size-5 shrink-0" />
                  <span className="truncate">{text}</span>
                </Button>
              );
            }
            return (
              <Button key={b.method} asChild variant="outline" className={cls}>
                <a href={startHref(b.method)} data-testid={`sso-${b.method}`}>
                  <MethodMark method={b.method} className="size-5 shrink-0" />
                  <span className="truncate">{text}</span>
                </a>
              </Button>
            );
          })}
        </div>
      )}
      {sso.length > 0 && hasForms && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          {t("orEmail")}
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      {password && magicLink && (
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm" role="tablist" aria-label={t("emailOptions")}>
          {(["password", "link"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn("rounded-md px-3 py-1.5 font-medium transition", mode === m ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
              data-testid={`mode-${m}`}
            >
              {m === "password" ? t("usePassword") : t("useLink")}
            </button>
          ))}
        </div>
      )}
      {password && mode === "password" && (
        <form action={pwAction} className="space-y-4" data-testid="password-form">
          <input type="hidden" name="locale" value={locale} />
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" className="text-start" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="password">{t("password")}</Label>
              <NextLink href="/forgot-password" className="text-xs font-medium text-brand hover:underline" data-testid="forgot-password">
                {t("forgot")}
              </NextLink>
            </div>
            <Input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" className="text-start" />
          </div>
          {pwMessage && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {pwMessage}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pwPending}>
            {pwPending && <Loader2 className="size-4 animate-spin" />}
            {pwPending ? t("signingIn") : t("signIn")}
          </Button>
        </form>
      )}
      {magicLink && (mode === "link" || !password) && (
        mlState.done ? (
          <div className="flex items-start gap-3 rounded-lg border bg-success-soft/50 p-4 text-sm" role="status" data-testid="magic-sent">
            <MailCheck className="mt-0.5 size-5 shrink-0 text-success" />
            <div>
              <p className="font-medium">{t("linkSentTitle")}</p>
              <p className="mt-0.5 text-muted-foreground">{t("linkSentBody")}</p>
            </div>
          </div>
        ) : (
          <form action={mlAction} className="space-y-4" data-testid="magic-form">
            <input type="hidden" name="locale" value={locale} />
            {school && <input type="hidden" name="school" value={school.slug} />}
            <div className="space-y-1.5">
              <Label htmlFor="magic-email">{t("email")}</Label>
              <Input id="magic-email" name="email" type="email" autoComplete="email" required dir="ltr" className="text-start" />
              <p className="text-xs text-muted-foreground">{t("linkHelp")}</p>
            </div>
            {mlState.error && (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {t("errors.email")}
              </p>
            )}
            <Button type="submit" variant={password ? "outline" : "default"} className="w-full" disabled={mlPending}>
              {mlPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4 rtl:rotate-180" />}
              {t("sendLink")}
            </Button>
          </form>
        )
      )}
    </div>
  );
}
