// Choosing a new password from an emailed link (/en/reset-password?token=...). Opening the page does not use the
// link up; saving a strong password does.
import NextLink from "next/link";
import { getTranslations } from "next-intl/server";
import { KeyRound, XCircle } from "lucide-react";
import { AuthShell } from "@/components/sso/auth-shell";
import { ResetPasswordForm } from "@/components/sso/recovery-forms";
import { Button } from "@/components/ui/button";
import { resetLinkValid } from "@/server/sso/password-reset";

export async function generateMetadata() {
  const t = await getTranslations("sso.reset");
  return { title: t("title") };
}

export default async function ResetPasswordPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const [{ locale }, { token }] = await Promise.all([params, searchParams]);
  const t = await getTranslations("sso.reset");
  const valid = token ? await resetLinkValid(token) : false;
  const other = locale === "ar" ? "en" : "ar";
  return (
    <AuthShell
      toggle={
        <NextLink href={`/${other}/reset-password${token ? `?token=${encodeURIComponent(token)}` : ""}`} className="text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="language-toggle">
          {t("otherLanguage")}
        </NextLink>
      }
    >
      {valid ? (
        <>
          <span className="mb-4 grid size-11 place-items-center rounded-xl bg-brand-soft text-brand">
            <KeyRound className="size-5" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">{t("subtitle")}</p>
          <ResetPasswordForm token={token!} />
        </>
      ) : (
        <div className="rounded-xl border bg-card p-6 text-center shadow-xs" data-testid="reset-invalid">
          <XCircle className="mx-auto size-10 text-danger" />
          <h1 className="mt-3 text-lg font-semibold">{t("invalidTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("invalidBody")}</p>
          <Button asChild className="mt-5">
            <NextLink href="/forgot-password">{t("again")}</NextLink>
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
