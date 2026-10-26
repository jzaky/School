"use client";

// Forgotten password: ask for a link (same answer whatever the address), then choose a new password with the
// sign-up rules and a strength hint.
import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import NextLink from "next/link";
import { CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwordIssues, passwordScore } from "@/lib/signup";
import { requestPasswordResetAction, resetPasswordAction } from "@/server/sso/actions";

export function ForgotPasswordForm() {
  const t = useTranslations("sso.forgot");
  const locale = useLocale();
  const [state, action, pending] = useActionState(requestPasswordResetAction, { done: false, error: null });
  if (state.done) {
    return (
      <div className="flex items-start gap-3 rounded-lg border bg-success-soft/50 p-4 text-sm" role="status" data-testid="forgot-sent">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-success" />
        <div>
          <p className="font-medium">{t("sentTitle")}</p>
          <p className="mt-0.5 text-muted-foreground">{t("sentBody")}</p>
          <NextLink href="/login" className="mt-3 inline-block font-medium text-brand hover:underline">
            {t("backToSignIn")}
          </NextLink>
        </div>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4" data-testid="forgot-form">
      <input type="hidden" name="locale" value={locale} />
      <div className="space-y-1.5">
        <Label htmlFor="fp-email">{t("email")}</Label>
        <Input id="fp-email" name="email" type="email" autoComplete="email" required dir="ltr" className="text-start" />
      </div>
      {state.error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {t("invalidEmail")}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {t("send")}
      </Button>
      <NextLink href="/login" className="block text-center text-sm font-medium text-muted-foreground hover:text-foreground">
        {t("backToSignIn")}
      </NextLink>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("sso.reset");
  const tp = useTranslations("onboarding.signup");
  const locale = useLocale();
  const [password, setPassword] = useState("");
  const [state, action, pending] = useActionState(resetPasswordAction, { done: false, error: null });
  const score = passwordScore(password);
  const issues = password ? passwordIssues(password) : [];
  if (state.done) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center shadow-xs" data-testid="reset-done">
        <CheckCircle2 className="mx-auto size-10 text-success" />
        <h2 className="mt-3 text-lg font-semibold">{t("doneTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("doneBody")}</p>
        <Button asChild className="mt-5">
          <NextLink href="/login">{t("signIn")}</NextLink>
        </Button>
      </div>
    );
  }
  const message = state.error === "WEAK" ? (state.issues ?? []).map((i) => tp(`issues.${i}`)).join(" ") || tp("passwordHint") : state.error ? t(`errors.${state.error}`) : null;
  return (
    <form action={action} className="space-y-4" data-testid="reset-form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />
      <div className="space-y-1.5">
        <Label htmlFor="new-password">{t("newPassword")}</Label>
        <Input id="new-password" name="password" type="password" autoComplete="new-password" required dir="ltr" className="text-start" value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="text-xs text-muted-foreground" data-testid="reset-strength">
          {password ? tp(`strength.s${score}`) : tp("passwordHint")}
          {issues.length > 0 && ` ${issues.map((i) => tp(`issues.${i}`)).join(" ")}`}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">{t("confirm")}</Label>
        <Input id="confirm-password" name="confirm" type="password" autoComplete="new-password" required dir="ltr" className="text-start" />
      </div>
      {message && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" data-testid="reset-error">
          {message}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {t("save")}
      </Button>
    </form>
  );
}
