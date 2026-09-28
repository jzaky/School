"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithPasswordAction, signInWithProviderAction } from "@/server/shell/actions";

export function LoginForm({ providers, error }: { providers: { google: boolean; microsoft: boolean }; error?: string | null }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [state, action, pending] = useActionState(signInWithPasswordAction, { error: null });
  const message =
    state?.error === "invalid" ? t("invalid") : error === "NotProvisioned" ? t("notProvisioned") : error === "NoMembership" ? t("noMembership") : error ? t("invalid") : null;
  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" className="text-start" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("password")}</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" className="text-start" />
        </div>
        {message && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {message}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {pending ? t("signingIn") : t("signIn")}
        </Button>
      </form>
      {(providers.google || providers.microsoft) && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {t("orContinue")}
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {providers.google && (
              <Button variant="outline" onClick={() => signInWithProviderAction("google", locale)}>
                {t("google")}
              </Button>
            )}
            {providers.microsoft && (
              <Button variant="outline" onClick={() => signInWithProviderAction("microsoft-entra-id", locale)}>
                {t("microsoft")}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
