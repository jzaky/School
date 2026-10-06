import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, CheckCircle2, Gift } from "lucide-react";
import { enabledOAuthProviders } from "@/auth";
import { signupEnabled } from "@/lib/signup";
import { catalogDb } from "@/server/platform/catalog-db";
import { normalizeReferralCode, resolveReferralCode } from "@/server/platform/referrals";
import { isLocale } from "@/i18n/routing";
import { SignupForm } from "@/components/onboarding/signup-form";
import { MarketingLocaleToggle } from "@/components/marketing/locale-toggle";
import { Logo } from "@/components/marketing/logo";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/** The school behind a referral code, when the code is valid. A bad code is simply ignored. */
async function referrerFor(raw: string | undefined) {
  const code = normalizeReferralCode(raw);
  const db = catalogDb();
  if (!code || !db) return null;
  try {
    const org = await resolveReferralCode(db, code);
    return org ? { code, nameEn: org.nameEn, nameAr: org.nameAr } : null;
  } catch {
    return null;
  }
}

export async function generateMetadata() {
  const t = await getTranslations("onboarding.signup");
  return { title: t("metaTitle") };
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string; ref?: string }> }) {
  const { error, ref } = await searchParams;
  const referrer = await referrerFor(ref);
  const t = await getTranslations("onboarding.signup");
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : "en";
  const enabled = signupEnabled();
  const tRef = await getTranslations("growth.referral");
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="flex min-w-0 flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between gap-3">
          <Link href="/">
            <Logo />
          </Link>
          <MarketingLocaleToggle />
        </div>
        <div className="mx-auto w-full max-w-xl flex-1 py-8 sm:py-12">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p>
          {referrer && (
            <p className="mt-4 flex items-center gap-2 rounded-lg border border-brand/20 bg-brand-soft/50 px-3 py-2 text-sm" data-testid="signup-referred">
              <Gift className="size-4 shrink-0 text-brand" />
              {tRef("referredBy", { school: locale === "ar" ? referrer.nameAr : referrer.nameEn })}
            </p>
          )}
          {enabled ? (
            <div className="mt-8">
              <SignupForm providers={enabledOAuthProviders()} locale={locale} initialError={error === "oauth" || error === "failed" ? error : null} referralCode={referrer?.code ?? null} />
            </div>
          ) : (
            <div className="mt-8 rounded-xl border bg-card p-6" data-testid="signup-closed">
              <p className="font-medium">{t("closedTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("closedBody")}</p>
              <Button asChild className="mt-4">
                <Link href="/demo">{t("closedDemo")}</Link>
              </Button>
            </div>
          )}
          <p className="mt-8 text-sm text-muted-foreground">
            {t("haveAccount")}{" "}
            <Link href="/login" className="font-medium text-brand hover:underline">
              {t("signIn")}
            </Link>
          </p>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-sidebar lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,oklch(0.45_0.12_252/.6),transparent_55%),radial-gradient(circle_at_80%_80%,oklch(0.7_0.12_85/.35),transparent_50%)]" />
        <div className="relative flex h-full flex-col justify-center gap-6 p-12 text-white">
          <p className="max-w-md text-2xl font-medium leading-snug">{t("asideTitle")}</p>
          <ul className="space-y-3 text-sm text-white/80">
            {(["a1", "a2", "a3", "a4"] as const).map((k) => (
              <li key={k} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-gold" />
                {t(`aside.${k}`)}
              </li>
            ))}
          </ul>
          <Link href="/demo" className="flex items-center gap-1.5 text-sm font-medium text-gold hover:underline">
            {t("seeDemo")}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </Link>
        </div>
      </div>
    </div>
  );
}
