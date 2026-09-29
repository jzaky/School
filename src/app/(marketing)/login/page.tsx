import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { enabledOAuthProviders } from "@/auth";
import { LoginForm } from "@/components/marketing/login-form";
import { MarketingLocaleToggle } from "@/components/marketing/locale-toggle";
import { Logo } from "@/components/marketing/logo";
import { signupEnabled } from "@/lib/signup";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const t = await getTranslations("auth");
  const tPilot = await getTranslations("onboarding.landing");
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/">
            <Logo />
          </Link>
          <MarketingLocaleToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight">{t("signInTitle")}</h1>
          <p className="mt-1 mb-8 text-sm text-muted-foreground">{t("signInSubtitle")}</p>
          <LoginForm providers={enabledOAuthProviders()} error={error ?? null} />
          {signupEnabled() && (
            <p className="mt-6 text-sm text-muted-foreground">
              {tPilot("newSchool")}{" "}
              <Link href="/signup" className="font-medium text-brand hover:underline" data-testid="login-signup">
                {tPilot("startPilot")}
              </Link>
            </p>
          )}
          <Link href="/demo" className="mt-8 flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
            {t("tryDemo")}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </Link>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-sidebar lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,oklch(0.45_0.12_252/.6),transparent_55%),radial-gradient(circle_at_80%_80%,oklch(0.7_0.12_85/.35),transparent_50%)]" />
        <div className="relative flex h-full flex-col justify-end p-12 text-white">
          <p className="max-w-md text-2xl font-medium leading-snug">{t("quote")}</p>
          <p className="mt-4 text-sm text-white/60">{t("quoteBy")}</p>
        </div>
      </div>
    </div>
  );
}
