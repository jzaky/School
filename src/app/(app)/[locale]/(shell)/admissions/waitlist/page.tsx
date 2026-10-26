import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Hourglass } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { gradeLevelValues } from "@/lib/grade-levels";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { canViewAdmissions } from "@/server/admissions/access";
import { seatCounts, waitlist } from "@/server/admissions/capacity";
import { seatsAvailable } from "@/server/admissions/rules";
import { asTx } from "@/server/admissions/settings";
import { filterOptions, filtersFrom, type SP } from "@/server/admissions/page-data";
import { AdmissionFilters, Pager } from "@/components/admissions/filters";

const PER_PAGE = 50;

export async function generateMetadata() {
  const t = await getTranslations("admissions.waitlist");
  return { title: t("title") };
}

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!canViewAdmissions(ctx)) notFound();
  const t = await getTranslations("admissions.waitlist");
  const tg = await getTranslations("gradeLevel");
  const { filters, years, page } = await filtersFrom(ctx, sp);
  const opts = await filterOptions(ctx, years);
  const year = years.find((y) => y.id === filters.yearId);
  const tx = asTx(ctx.db);
  const [list, seats] = year ? await Promise.all([waitlist(tx, ctx.orgId, year.id, filters.grade, page, PER_PAGE), seatCounts(tx, ctx.orgId, year)]) : [{ total: 0, rows: [] }, new Map()];
  const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat(ctx.locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(d) : "");
  return (
    <PageBody className="max-w-5xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AdmissionFilters year={filters.yearId} years={opts.years} grades={opts.grades} />
      {list.rows.length === 0 ? (
        <EmptyState icon={<Hourglass className="size-5" />} title={t("empty")} body={t("emptyBody")} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <ul className="divide-y" data-testid="waitlist">
            {list.rows.map((r, i) => {
              const s = seats.get(r.gradeLevel);
              const free = s ? seatsAvailable(s) : null;
              const showGrade = i === 0 || list.rows[i - 1].gradeLevel !== r.gradeLevel;
              return (
                <li key={r.id}>
                  {showGrade && (
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-4 py-2 text-xs font-semibold">
                      <span>{tg("label", gradeLevelValues(r.gradeLevel))}</span>
                      <span className="font-normal text-muted-foreground">{free === null ? t("noCapacity") : t("freeSeats", { n: Math.max(0, free) })}</span>
                    </div>
                  )}
                  <Link href={`/admissions/applications/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30" data-testid="waitlist-row">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold tabular-nums text-brand">{r.position}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{pick(ctx.locale, `${r.firstNameEn} ${r.lastNameEn}`, r.firstNameAr ? `${r.firstNameAr} ${r.lastNameAr ?? ""}` : null)}</span>
                      <span className="block text-xs text-muted-foreground">
                        <span dir="ltr">{r.number}</span> · {t("since", { date: fmt(r.waitlistedAt ?? r.submittedAt) })}
                      </span>
                    </span>
                    <span className="flex flex-wrap justify-end gap-1">
                      {r.siblingStudentIds.length > 0 && <Pill tone="info">{t("sibling")}</Pill>}
                      {r.staffChildVerified && <Pill tone="info">{t("staffChild")}</Pill>}
                      {r.priorityBoost !== 0 && <Pill tone={r.priorityBoost > 0 ? "success" : "neutral"}>{t("boost", { n: r.priorityBoost > 0 ? `+${r.priorityBoost}` : String(r.priorityBoost) })}</Pill>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("orderNote")}</p>
      <Pager page={page} total={list.total} perPage={PER_PAGE} />
    </PageBody>
  );
}
