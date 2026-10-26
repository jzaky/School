import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { ALL_GRADE_LEVELS, gradeLevelValues } from "@/lib/grade-levels";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { canManageAdmissions, canViewAdmissions } from "@/server/admissions/access";
import { seatCounts } from "@/server/admissions/capacity";
import { filsToAed, seatsAvailable } from "@/server/admissions/rules";
import { asTx } from "@/server/admissions/settings";
import { filterOptions, filtersFrom, type SP } from "@/server/admissions/page-data";
import { CapacityEditor } from "@/components/admissions/capacity-editor";
import { AdmissionFilters } from "@/components/admissions/filters";

export async function generateMetadata() {
  const t = await getTranslations("admissions.capacity");
  return { title: t("title") };
}

export default async function CapacityPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!canViewAdmissions(ctx)) notFound();
  const t = await getTranslations("admissions.capacity");
  const tg = await getTranslations("gradeLevel");
  const { filters, years } = await filtersFrom(ctx, sp);
  const opts = await filterOptions(ctx, years);
  const year = years.find((y) => y.id === filters.yearId);
  const counts = year ? await seatCounts(asTx(ctx.db), ctx.orgId, year) : new Map();
  const rows = ALL_GRADE_LEVELS.map((g) => {
    const c = counts.get(g);
    return {
      grade: g,
      label: tg("label", gradeLevelValues(g)),
      sectionSeats: c?.sectionSeats ?? [],
      seatFee: c?.seatFeeFils ? filsToAed(c.seatFeeFils).replace(/,/g, "") : "",
      capacity: c?.capacity ?? null,
      enrolled: c?.enrolled ?? 0,
      holding: c?.holding ?? 0,
      offered: c?.offered ?? 0,
      waitlisted: c?.waitlisted ?? 0,
      free: c ? seatsAvailable(c) : null,
    };
  });
  return (
    <PageBody className="max-w-6xl">
      <PageHeader title={t("title")} description={t("subtitle", { year: year ? pick(ctx.locale, year.nameEn, year.nameAr) : "" })} />
      <AdmissionFilters year={filters.yearId} years={opts.years} grades={[]} search={false} />
      {year ? <CapacityEditor yearId={year.id} rows={rows} editable={canManageAdmissions(ctx)} current={year.isCurrent} /> : <p className="text-sm text-muted-foreground">{t("noYear")}</p>}
    </PageBody>
  );
}
