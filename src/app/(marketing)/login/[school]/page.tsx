// A school's own sign-in page (/login/<school address>): its name and only the options it offers.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { MarketingLocaleToggle } from "@/components/marketing/locale-toggle";
import { AuthShell } from "@/components/sso/auth-shell";
import { SignInPanel } from "@/components/sso/sign-in-panel";
import { RememberSchool } from "@/components/sso/remember-school";
import { schoolBySlug } from "@/server/platform/sso-lookup";
import { schoolSignInOptions } from "@/server/sso/options";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ school: string }> }) {
  const { school } = await params;
  const s = await schoolBySlug(school);
  const t = await getTranslations("sso.signin");
  const locale = await getLocale();
  return { title: s ? t("metaTitle", { school: locale === "ar" ? s.nameAr : s.nameEn }) : t("metaTitleGeneric") };
}

export default async function SchoolLoginPage({ params, searchParams }: { params: Promise<{ school: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ school: slug }, { error }] = await Promise.all([params, searchParams]);
  const school = await schoolBySlug(slug);
  if (!school) notFound();
  const t = await getTranslations("sso.signin");
  const locale = await getLocale();
  const name = locale === "ar" ? school.nameAr : school.nameEn;
  const options = await schoolSignInOptions(school.id);
  const nothing = options.sso.length === 0 && !options.password && !options.magicLink;
  return (
    <AuthShell
      toggle={<MarketingLocaleToggle />}
      aside={
        <>
          <ShieldCheck className="mb-4 size-8 text-[#E9C46A]" />
          <p className="max-w-md text-2xl font-medium leading-snug">{t("asideTitle", { school: name })}</p>
          <p className="mt-4 max-w-md text-sm text-white/70">{t("asideBody")}</p>
        </>
      }
    >
      <RememberSchool slug={school.slug} />
      <div className="mb-6 flex items-center gap-3">
        {school.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={school.logoUrl} alt="" className="size-12 shrink-0 rounded-xl border object-contain" />
        ) : (
          <span className="grid size-12 shrink-0 place-items-center rounded-xl text-lg font-semibold text-white" style={{ background: school.primaryColor }}>
            {school.slug.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("eyebrow")}</p>
          <h1 className="text-xl font-semibold tracking-tight text-balance" data-testid="school-name">
            {name}
          </h1>
        </div>
      </div>
      {nothing ? (
        <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">{t("noOptions")}</p>
      ) : (
        <SignInPanel school={{ slug: school.slug, name }} sso={options.sso} password={options.password} magicLink={options.magicLink} error={error ?? null} />
      )}
      {!options.password && (
        <p className="mt-6 text-xs text-muted-foreground">
          {t("adminBreakGlass")}{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            {t("adminBreakGlassLink")}
          </Link>
        </p>
      )}
      <Link href="/login" className="mt-8 flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="other-school">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("otherSchool")}
      </Link>
    </AuthShell>
  );
}
