import { getTranslations } from "next-intl/server";
import { KeyRound } from "lucide-react";
import { MarketingLocaleToggle } from "@/components/marketing/locale-toggle";
import { AuthShell } from "@/components/sso/auth-shell";
import { ForgotPasswordForm } from "@/components/sso/recovery-forms";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("sso.forgot");
  return { title: t("title") };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("sso.forgot");
  return (
    <AuthShell toggle={<MarketingLocaleToggle />}>
      <span className="mb-4 grid size-11 place-items-center rounded-xl bg-brand-soft text-brand">
        <KeyRound className="size-5" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{t("subtitle")}</p>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
