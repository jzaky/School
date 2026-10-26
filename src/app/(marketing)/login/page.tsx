import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, School } from "lucide-react";
import { MarketingLocaleToggle } from "@/components/marketing/locale-toggle";
import { AuthShell } from "@/components/sso/auth-shell";
import { SignInPanel } from "@/components/sso/sign-in-panel";
import { FindSchoolForm } from "@/components/sso/find-school";
import { signupEnabled } from "@/lib/signup";
import { generalSignInOptions } from "@/server/sso/options";
import { schoolBySlug } from "@/server/platform/sso-lookup";
import { SCHOOL_HINT_COOKIE } from "@/server/sso/web";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const t = await getTranslations("auth");
  const ts = await getTranslations("sso.signin");
  const tPilot = await getTranslations("onboarding.landing");
  const locale = await getLocale();
  const options = generalSignInOptions();
  // A school chosen before is offered first (its own page shows only that school's options).
  const hint = (await cookies()).get(SCHOOL_HINT_COOKIE)?.value;
  const remembered = hint ? await schoolBySlug(hint) : null;
  return (
    <AuthShell toggle={<MarketingLocaleToggle />}>
      <h1 className="text-2xl font-semibold tracking-tight">{t("signInTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{t("signInSubtitle")}</p>
      {remembered && (
        <Link href={`/login/${remembered.slug}`} className="mb-5 flex items-center gap-3 rounded-xl border bg-card p-3 text-sm shadow-xs transition hover:border-brand/40" data-testid="remembered-school">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
            <School className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{locale === "ar" ? remembered.nameAr : remembered.nameEn}</span>
            <span className="block text-xs text-muted-foreground">{ts("continueToSchool")}</span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
        </Link>
      )}
      <SignInPanel school={null} sso={options.sso} password={options.password} magicLink={options.magicLink} error={error ?? null} />
      <div className="mt-6 border-t pt-5">
        <FindSchoolForm />
      </div>
      {signupEnabled() && (
        <p className="mt-6 text-sm text-muted-foreground">
          {tPilot("newSchool")}{" "}
          <Link href="/signup" className="font-medium text-brand hover:underline" data-testid="login-signup">
            {tPilot("startPilot")}
          </Link>
        </p>
      )}
      <Link href="/demo" className="mt-6 flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
        {t("tryDemo")}
        <ArrowRight className="size-4 rtl:rotate-180" />
      </Link>
    </AuthShell>
  );
}
