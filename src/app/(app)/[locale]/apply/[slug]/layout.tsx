import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { pick } from "@/lib/i18n-data";
import { applySchoolBySlug } from "@/server/admissions/public-school";
import { currentApplicant } from "@/server/admissions/applicant";
import { JoinLocaleToggle } from "@/components/access/join-frame";
import { ApplySignOut } from "@/components/admissions/apply-account";
import { BrandStyle } from "@/components/onboarding/brand-style";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; locale: string }> }) {
  const { slug, locale } = await params;
  const school = await applySchoolBySlug(slug);
  const t = await getTranslations("admissions.apply");
  return { title: school ? t("metaTitle", { school: pick(locale, school.nameEn, school.nameAr) }) : t("metaTitleGeneric") };
}

/** School-branded frame for the public application pages (no school sign-in needed). */
export default async function ApplyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string; locale: string }> }) {
  const { slug, locale } = await params;
  const school = await applySchoolBySlug(slug);
  if (!school) notFound();
  const applicant = await currentApplicant(school?.id);
  const name = pick(locale, school.nameEn, school.nameAr);
  const color = /^#[0-9a-f]{6}$/i.test(school.primaryColor) ? school.primaryColor : "#0F4C81";
  return (
    <div className="min-h-dvh bg-muted/30">
      <BrandStyle primaryColor={school.primaryColor} accentColor="#C8A24A" />
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {school.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/admissions/apply/${school.slug}/logo`} alt="" className="size-10 shrink-0 rounded-lg border bg-white object-contain p-0.5" />
            ) : (
              <div className="grid size-10 shrink-0 place-items-center rounded-lg text-base font-bold text-white" style={{ backgroundColor: color }}>
                {name.trim().charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight" data-testid="apply-school">
                {name}
              </div>
              <div className="truncate text-xs text-muted-foreground">{(await getTranslations("admissions.apply"))("headerSub")}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <JoinLocaleToggle />
            {applicant && <ApplySignOut slug={school.slug} />}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">{children}</main>
    </div>
  );
}
