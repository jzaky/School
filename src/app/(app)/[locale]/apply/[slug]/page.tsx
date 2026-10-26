import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CalendarDays, FileCheck2, ShieldCheck } from "lucide-react";
import { tenantTx } from "@/lib/tenant-db";
import { pick } from "@/lib/i18n-data";
import { ALL_GRADE_LEVELS, gradeLevelValues } from "@/lib/grade-levels";
import { Link } from "@/i18n/navigation";
import { applySchoolBySlug } from "@/server/admissions/public-school";
import { currentApplicant } from "@/server/admissions/applicant";
import { capacityRows, gradesOffered, loadSettings, openYears } from "@/server/admissions/settings";
import { listFamilyApplications } from "@/server/admissions/family";
import { familyStatus } from "@/server/admissions/stages";
import { birthRangeFor } from "@/server/admissions/rules";
import { docTypesFor } from "@/server/admissions/config";
import { ApplyAccount, StartApplication } from "@/components/admissions/apply-account";
import { FamilyStatusPill } from "@/components/admissions/apply-status";

export default async function ApplyLanding({ params }: { params: Promise<{ slug: string; locale: string }> }) {
  const { slug, locale } = await params;
  const school = await applySchoolBySlug(slug);
  if (!school) notFound();
  const t = await getTranslations("admissions.apply");
  const tg = await getTranslations("gradeLevel");
  const name = pick(locale, school.nameEn, school.nameAr);
  const { settings, years } = await tenantTx(school.id, async (tx) => {
    const s = await loadSettings(tx, school.id);
    const ys = await openYears(tx, school.id, s);
    const withGrades = await Promise.all(ys.map(async (y) => ({ ...y, grades: gradesOffered(await capacityRows(tx, school.id, y.id), ALL_GRADE_LEVELS) })));
    return { settings: s, years: withGrades };
  });
  const applicant = await currentApplicant();
  const apps = applicant?.verified ? await listFamilyApplications(school.id, applicant.userId) : [];
  const intro = pick(locale, settings.intro.en, settings.intro.ar);
  const fmt = (d: Date) => new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  const cutoff = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2028, settings.cutoff.month - 1, settings.cutoff.day)));
  const firstYear = years[0];
  const kgRows = firstYear ? [-1, 0, 1].filter((g) => firstYear.grades.includes(g)).map((g) => ({ g, range: birthRangeFor(g, firstYear.entryYear, settings.cutoff) })) : [];
  const docs = docTypesFor(settings.docTypes, 5, null).filter((d) => d.required);

  if (!settings.publicOpen || years.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center shadow-sm" data-testid="apply-closed">
        <h1 className="text-lg font-semibold">{t("closedTitle", { school: name })}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{school.supportEmail ? t("closedBodyEmail", { email: school.supportEmail }) : t("closedBody")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="bg-gradient-to-br from-brand to-[oklch(0.42_0.1_250)] px-5 py-6 text-white sm:px-7">
          <p className="text-xs font-medium uppercase tracking-wider text-white/75">{t("eyebrow")}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance" data-testid="apply-title">
            {t("title", { school: name })}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-white/85">{intro || t("introDefault")}</p>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
          <Fact icon={<CalendarDays className="size-4" />} title={t("factYears")} body={years.map((y) => pick(locale, y.nameEn, y.nameAr)).join(" · ")} />
          <Fact icon={<FileCheck2 className="size-4" />} title={t("factDocs")} body={t("factDocsBody", { n: docs.length })} />
          <Fact icon={<ShieldCheck className="size-4" />} title={t("factPrivacy")} body={t("factPrivacyBody")} />
        </div>
      </section>

      {!applicant ? (
        <ApplyAccount slug={school.slug} mode="account" demo={school.isDemo} />
      ) : !applicant.verified ? (
        <ApplyAccount slug={school.slug} mode="verify" demo={school.isDemo} email={applicant.email} />
      ) : (
        <>
          <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-testid="my-applications">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{t("myApplications")}</h2>
              <span className="text-xs text-muted-foreground">{t("signedInAs", { email: applicant.email })}</span>
            </div>
            {apps.length ? (
              <ul className="mt-3 divide-y">
                {apps.map((a) => {
                  const year = years.find((y) => y.id === a.academicYearId);
                  const child = a.firstNameEn ? (locale === "ar" && a.firstNameAr ? `${a.firstNameAr} ${a.lastNameAr ?? ""}` : `${a.firstNameEn} ${a.lastNameEn}`) : t("newChild");
                  return (
                    <li key={a.id}>
                      <Link href={`/apply/${school.slug}/${a.id}`} className="flex items-center gap-3 py-3 hover:text-brand" data-testid="my-application">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{child}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {tg("label", gradeLevelValues(a.gradeLevel))}
                            {year ? ` · ${pick(locale, year.nameEn, year.nameAr)}` : ""} · <span dir="ltr">{a.number}</span>
                          </span>
                        </span>
                        <FamilyStatusPill status={familyStatus(a.stage)} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t("noApplications")}</p>
            )}
          </section>
          <StartApplication slug={school.slug} years={years.map((y) => ({ id: y.id, name: pick(locale, y.nameEn, y.nameAr), grades: y.grades, entryYear: y.entryYear }))} cutoff={settings.cutoff} />
        </>
      )}

      {kgRows.length > 0 && firstYear && (
        <section className="rounded-2xl border bg-card p-5 text-sm shadow-sm sm:p-6">
          <h2 className="text-base font-semibold">{t("ageTitle")}</h2>
          <p className="mt-1 text-muted-foreground">{t("ageBody", { date: cutoff, year: pick(locale, firstYear.nameEn, firstYear.nameAr) })}</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {kgRows.map(({ g, range }) => (
              <li key={g} className="rounded-lg border bg-muted/40 px-3 py-2">
                <div className="font-medium">{tg("label", gradeLevelValues(g))}</div>
                <div className="text-xs text-muted-foreground">{t("bornBetween", { from: fmt(new Date(range.from.getTime() + 86_400_000)), to: fmt(range.to) })}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Fact({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">{icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{body}</div>
      </div>
    </div>
  );
}
