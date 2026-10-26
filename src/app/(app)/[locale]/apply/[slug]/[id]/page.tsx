import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { tenantTx } from "@/lib/tenant-db";
import { pick } from "@/lib/i18n-data";
import { ALL_GRADE_LEVELS } from "@/lib/grade-levels";
import { Link, redirect } from "@/i18n/navigation";
import { applySchoolBySlug } from "@/server/admissions/public-school";
import { currentApplicant } from "@/server/admissions/applicant";
import { familyApplicationView } from "@/server/admissions/family";
import { AdmissionError } from "@/server/admissions/access";
import { capacityRows, gradesOffered, openYears } from "@/server/admissions/settings";
import { docTypesFor } from "@/server/admissions/config";
import { familyStatus } from "@/server/admissions/stages";
import { COMMON_NATIONALITIES, ALL_COUNTRIES, LANGUAGES, countryName, languageName } from "@/server/admissions/config";
import { ApplyWizard } from "@/components/admissions/apply-wizard";
import { ApplyStatus } from "@/components/admissions/apply-status";
import { STEPS } from "@/server/admissions/form";

export default async function ApplicationPage({ params, searchParams }: { params: Promise<{ slug: string; locale: string; id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { slug, locale, id } = await params;
  const sp = await searchParams;
  const school = await applySchoolBySlug(slug);
  if (!school) notFound();
  const applicant = await currentApplicant(school?.id);
  if (!applicant?.verified) redirect({ href: `/apply/${slug}`, locale });
  let view: Awaited<ReturnType<typeof familyApplicationView>>;
  try {
    view = await familyApplicationView(school.id, applicant!.userId, id);
  } catch (e) {
    if (e instanceof AdmissionError) notFound();
    throw e;
  }
  const t = await getTranslations("admissions.apply");
  const { app } = view;
  const back = (
    <Link href={`/apply/${slug}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="back-to-applications">
      <ChevronLeft className="size-4 rtl:rotate-180" />
      {t("backToApplications")}
    </Link>
  );
  const docTypes = docTypesFor(view.settings.docTypes, app.gradeLevel, app.nationality).map((d) => ({ key: d.key, label: pick(locale, d.labelEn, d.labelAr), required: d.required }));
  const docs = view.documents.map((d) => ({ id: d.id, typeKey: d.typeKey, fileName: d.fileName, sizeBytes: d.sizeBytes, status: d.status, createdAt: d.createdAt.toISOString() }));

  if (app.stage === "DRAFT" && view.form) {
    const years = await tenantTx(school.id, async (tx) => {
      const ys = await openYears(tx, school.id, view.settings);
      return Promise.all(ys.map(async (y) => ({ id: y.id, name: pick(locale, y.nameEn, y.nameAr), entryYear: y.entryYear, grades: gradesOffered(await capacityRows(tx, school.id, y.id), ALL_GRADE_LEVELS) })));
    });
    const countries = [...new Set([...COMMON_NATIONALITIES, ...ALL_COUNTRIES.map((c) => c).sort((a, b) => countryName(a, locale).localeCompare(countryName(b, locale), locale))])].map((c) => ({ code: c, name: countryName(c, locale) }));
    const languages = LANGUAGES.map((l) => ({ code: l, name: languageName(l, locale) }));
    const step = (STEPS as readonly string[]).includes(sp.step ?? "") ? (sp.step as (typeof STEPS)[number]) : null;
    return (
      <div>
        {back}
        <ApplyWizard
          slug={slug}
          applicationId={app.id}
          number={app.number}
          initialStep={step}
          saved={(app.step ?? "").split(",").filter(Boolean)}
          form={JSON.parse(JSON.stringify(view.form))}
          years={years}
          curricula={school.curricula}
          cutoff={view.settings.cutoff}
          countries={countries}
          languages={languages}
          docTypes={docTypes}
          docs={docs}
        />
      </div>
    );
  }

  return (
    <div>
      {back}
      <ApplyStatus
        slug={slug}
        app={{
          id: app.id,
          number: app.number,
          stage: app.stage,
          status: familyStatus(app.stage),
          child: app.firstNameEn ? (locale === "ar" && app.firstNameAr ? `${app.firstNameAr} ${app.lastNameAr ?? ""}`.trim() : `${app.firstNameEn} ${app.lastNameEn}`) : "",
          grade: app.gradeLevel,
          year: view.year ? pick(locale, view.year.nameEn, view.year.nameAr) : "",
          submittedAt: app.submittedAt?.toISOString() ?? null,
          offerMadeAt: app.offerMadeAt?.toISOString() ?? null,
          offerDeadline: app.offerDeadline?.toISOString() ?? null,
          offerRespondedAt: app.offerRespondedAt?.toISOString() ?? null,
          seatFeeFils: view.seatFeeFils,
          seatPaidAt: app.seatPaidAt?.toISOString() ?? null,
          payUrl: app.seatPayUrl ?? school.feePaymentUrl ?? null,
          closedBy: app.closedBy,
          enrolledAt: app.enrolledAt?.toISOString() ?? null,
        }}
        appointment={view.appointment ? { startsAt: view.appointment.startsAt.toISOString(), location: pick(locale, view.appointment.locationEn, view.appointment.locationAr) } : null}
        messages={view.messages.map((m) => ({ id: m.id, body: m.body, createdAt: m.createdAt.toISOString(), mine: m.mine, author: m.staff ? pick(locale, m.staff.nameEn, m.staff.nameAr) : null }))}
        docTypes={docTypes}
        docs={docs}
        missing={view.missing.map((d) => pick(locale, d.labelEn, d.labelAr))}
        schoolName={pick(locale, school.nameEn, school.nameAr)}
      />
    </div>
  );
}
