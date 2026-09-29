import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, SearchX, Trophy } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { AddToShortlistButton, StudentPicker } from "@/components/pathways/pathway-client";
import { countryLabel } from "@/components/pathways/pathway-ui";
import { StatusChip } from "@/components/pathway-engine/ui";
import { STATUS_ORDER } from "@/components/pathway-engine/labels";
import { CompareProvider, CompareToggle, CompareTray, CountryFilter, ParamSelect, SearchBox } from "@/components/discovery/client";
import { engineFocus, pathwayHref } from "@/server/pathway-engine/page-data";
import { CURRICULA } from "@/server/pathway-engine/types";
import { searchCatalog, shortlistedIds, staffStudentOptions } from "@/server/discovery/service";
import { DEGREE_TYPES, LANGUAGES, LEVELS, SORTS, TUITION_BANDS, parseDiscoveryQuery, queryParams, tuitionUsd } from "@/server/discovery/search";
import { CatalogNotice } from "@/components/pathway-engine/catalog-notice";

export async function generateMetadata() {
  const t = await getTranslations("discovery");
  return { title: t("title") };
}

type SP = Record<string, string | undefined>;

export default async function ProgramSearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("pathways.view")) notFound();
  const t = await getTranslations("discovery");
  const te = await getTranslations("engine");
  const prefs = await formatPrefs(ctx);
  const fmt = (n: number) => fmtNumber(prefs, n);
  const { locale } = ctx;
  const focus = await engineFocus(ctx, sp.student);
  const student = focus.student;
  const query = parseDiscoveryQuery(sp, { hasStudent: !!student });
  const [result, fields, intakeYears, staffOptions] = await Promise.all([
    searchCatalog(ctx, focus, query),
    ctx.db.fieldOfStudy.findMany({ orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }], select: { key: true, nameEn: true, nameAr: true } }),
    ctx.db.programIntake.findMany({ where: { OR: [{ orgId: ctx.orgId }, { orgId: null }], isCurrent: true }, distinct: ["intakeYear"], select: { intakeYear: true }, orderBy: { intakeYear: "asc" } }),
    staffStudentOptions(ctx, focus),
  ]);
  const pickerOptions = focus.options.length ? focus.options : staffOptions;
  const shortlisted = student && !ctx.isParent && focus.canEdit ? await shortlistedIds(ctx, student.id, result.items.map((i) => i.meta)) : null;
  const studentParam = student && !ctx.isStudent ? student.id : null;
  const programHref = (id: string) => `/career/pathways/programs/${id}${studentParam ? `?student=${studentParam}` : ""}`;
  const pageHref = (n: number) => `/career/pathways/search?${queryParams({ ...query, page: n }, { student: studentParam }).toString()}`;
  const filtered = !!(query.q || query.countries.length || query.field || query.degreeType || query.level || query.language || query.tuition || query.intake || query.curriculum || query.status);
  const fieldName = new Map(fields.map((f) => [f.key, pick(locale, f.nameEn, f.nameAr)]));

  const selects = [
    { param: "field", label: t("filter.field"), all: t("filter.allFields"), options: fields.map((f) => ({ value: f.key, label: pick(locale, f.nameEn, f.nameAr) })) },
    { param: "degree", label: t("filter.degree"), all: t("filter.allDegrees"), options: DEGREE_TYPES.map((d) => ({ value: d, label: t(`degreeType.${d}`) })) },
    { param: "level", label: t("filter.level"), all: t("filter.allLevels"), options: LEVELS.map((l) => ({ value: l, label: t(`level.${l}`) })) },
    { param: "lang", label: t("filter.language"), all: t("filter.allLanguages"), options: LANGUAGES.map((l) => ({ value: l, label: te(`language.${l}`) })) },
    { param: "tuition", label: t("filter.tuition"), all: t("filter.anyTuition"), options: TUITION_BANDS.map((b) => ({ value: b, label: t(`tuitionBand.${b}`) })) },
    { param: "intake", label: t("filter.intake"), all: t("filter.anyIntake"), options: intakeYears.map((i) => ({ value: String(i.intakeYear), label: te("program.intake", { year: String(i.intakeYear) }) })) },
    { param: "curriculum", label: t("filter.curriculum"), all: t("filter.anyCurriculum"), options: CURRICULA.filter((c) => c !== "OTHER").map((c) => ({ value: c, label: te(`curriculum.${c}`) })) },
    ...(student ? [{ param: "status", label: t("filter.status"), all: t("filter.anyStatus"), options: STATUS_ORDER.map((s) => ({ value: s, label: te(`status.${s}`) })) }] : []),
  ];

  return (
    <PageBody>
      <Link href={student ? pathwayHref(ctx, student.id) : "/career/pathways"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {te("title")}
      </Link>
      <PageHeader
        eyebrow={student && !ctx.isStudent ? te("studentLine", { name: student.name, grade: student.gradeLevel, curriculum: te(`curriculum.${student.curriculum}`) }) : undefined}
        title={t("title")}
        description={t("subtitle", { n: fmt(result.catalogTotal) })}
        actions={
          <>
            {pickerOptions.length > 0 && <StudentPicker students={pickerOptions} current={student?.id ?? null} />}
            {studentParam && ctx.isStaff && (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/career/pathways/search?${queryParams({ ...query, page: 1, status: null, sort: query.sort === "match" ? "rank" : query.sort }).toString()}`} data-testid="clear-student">
                  {t("clearStudent")}
                </Link>
              </Button>
            )}
          </>
        }
      />

      <CatalogNotice ctx={ctx} />

      <CompareProvider>
        <section className="space-y-3 rounded-xl border bg-card p-3 shadow-xs sm:p-4" aria-label={t("filtersLabel")}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <SearchBox placeholder={t("searchPlaceholder")} />
            <ParamSelect
              param="sort"
              label={t("sort.label")}
              value={query.sort}
              options={SORTS.filter((s) => s !== "match" || student).map((s) => ({ value: s, label: t(`sort.${s}`) }))}
              className="sm:w-52"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5" data-testid="search-filters">
            <CountryFilter label={t("filter.country")} allLabel={t("filter.allCountries")} options={result.countries.map((c) => ({ value: c, label: countryLabel(c, locale) })).sort((a, b) => a.label.localeCompare(b.label, locale))} />
            {selects.map((f) => (
              <ParamSelect key={f.param} param={f.param} label={f.label} allLabel={f.all} options={f.options} />
            ))}
          </div>
          {!student && <p className="text-xs text-muted-foreground">{ctx.isStaff ? t("pickStudentHint") : t("noStudentHint")}</p>}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground" data-testid="result-count" data-total={result.total}>
            {t("resultCount", { n: fmt(result.total) })}
          </span>
          {filtered && (
            <Link href={`/career/pathways/search${studentParam ? `?student=${studentParam}` : ""}`} className="text-brand hover:underline" data-testid="clear-filters">
              {t("clearFilters")}
            </Link>
          )}
        </div>

        {result.items.length === 0 ? (
          <EmptyState icon={<SearchX className="size-5" />} title={t("emptyTitle")} body={t("emptyBody")} />
        ) : (
          <ul className="grid gap-3" data-testid="search-results">
            {result.items.map(({ meta, match }) => {
              const name = pick(locale, meta.nameEn, meta.nameAr);
              const usd = tuitionUsd(meta.tuitionPerYear, meta.tuitionCurrency);
              return (
                <li key={meta.id} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs md:flex-row md:items-start" data-testid="search-result" data-program-id={meta.id} data-status={match?.status ?? ""}>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <Link href={programHref(meta.id)} className="font-semibold hover:text-brand" data-testid="result-link">
                        {name}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">
                        {pick(locale, meta.university.nameEn, meta.university.nameAr)} · {pick(locale, meta.university.cityEn, meta.university.cityAr)}, {countryLabel(meta.university.countryCode, locale)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Pill tone="brand">{meta.degree}</Pill>
                      <Pill>{t("years", { n: fmt(meta.durationYears) })}</Pill>
                      {meta.teachingLanguage && <Pill>{te(`language.${meta.teachingLanguage}`)}</Pill>}
                      {meta.tuitionPerYear !== null && meta.tuitionCurrency && (
                        <span title={usd !== null ? t("usdApprox", { amount: fmt(usd) }) : undefined}>
                          <Pill>{t("tuitionShort", { amount: fmt(meta.tuitionPerYear), currency: meta.tuitionCurrency })}</Pill>
                        </span>
                      )}
                      {meta.university.worldRank && (
                        <Pill tone="gold">
                          <Trophy className="size-3" />
                          {t("rank", { n: fmt(meta.university.worldRank) })}
                        </Pill>
                      )}
                      {meta.fieldKeys.slice(0, 2).map((f) => (
                        <Pill key={f} tone="info">
                          {fieldName.get(f) ?? f}
                        </Pill>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 md:w-64 md:flex-col md:items-end">
                    {match ? (
                      <div className="flex flex-wrap items-center gap-1.5 md:justify-end" data-testid="match-chip">
                        {match.missing > 0 && <span className="text-xs text-danger">{te("programs.missingN", { n: match.missing })}</span>}
                        <StatusChip status={match.status} />
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-3 md:justify-end">
                      <CompareToggle id={meta.id} name={name} />
                      {shortlisted && student && <AddToShortlistButton programId={meta.id} studentId={student.id} inShortlist={shortlisted.has(meta.id)} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {result.pages > 1 && (
          <nav className="flex items-center justify-between text-sm text-muted-foreground" aria-label={t("pagination")}>
            <span>{t("pageOf", { page: fmt(result.page), pages: fmt(result.pages) })}</span>
            <div className="flex gap-2">
              {result.page > 1 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={pageHref(result.page - 1)} aria-label={t("prev")} data-testid="prev-page">
                    <ChevronLeft className="size-4 rtl:rotate-180" />
                  </Link>
                </Button>
              )}
              {result.page < result.pages && (
                <Button asChild variant="outline" size="sm">
                  <Link href={pageHref(result.page + 1)} aria-label={t("next")} data-testid="next-page">
                    <ChevronRight className="size-4 rtl:rotate-180" />
                  </Link>
                </Button>
              )}
            </div>
          </nav>
        )}
        <CompareTray studentParam={studentParam} />
      </CompareProvider>
    </PageBody>
  );
}
