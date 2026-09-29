import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { ChevronLeft, ChevronRight, ClipboardList, GraduationCap, Landmark, Settings2 } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState } from "@/components/app/empty-state";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { PathwayFilters, StudentPicker } from "@/components/pathways/pathway-client";
import { CheckSummary, countryLabel, requirementLines } from "@/components/pathways/pathway-ui";
import { pathwayFocus, withStudent } from "@/server/pathways/page-data";
import { checkProgram } from "@/server/pathways/profile";
import { programsForEntries } from "@/server/pathways/shortlist";
import { CURRICULA, DEGREES, FIELDS, REQ_CURRICULA, type Curriculum, type ProgramRequirements } from "@/server/pathways/types";

export async function generateMetadata() {
  const t = await getTranslations("pathways");
  return { title: t("title") };
}

const PAGE = 40;
type SP = { tab?: string; q?: string; country?: string; city?: string; field?: string; degree?: string; curriculum?: string; page?: string; student?: string };

export default async function UniversitiesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("pathways.view")) notFound();
  const t = await getTranslations("pathways");
  const prefs = await formatPrefs(ctx);
  const fmt = (n: number) => fmtNumber(prefs, n);
  const { db, orgId, locale } = ctx;
  const tab = sp.tab === "universities" ? "universities" : "programmes";
  const q = sp.q?.trim() ?? "";
  const focus = await pathwayFocus(ctx, sp.student);
  const self = ctx.isStudent;
  const link = (href: string) => withStudent(href, focus.student?.id, self);
  const curriculum = (CURRICULA as readonly string[]).includes(sp.curriculum ?? "") ? (sp.curriculum as Curriculum) : (focus.data?.curriculum ?? "BRITISH");

  const [countryRows, programs] = await Promise.all([
    db.university.groupBy({ by: ["countryCode"], where: { orgId }, _count: { _all: true } }),
    db.universityProgram.findMany({ where: { orgId }, orderBy: { nameEn: "asc" } }),
  ]);
  const uniIds = [...new Set(programs.map((p) => p.universityId))];
  const programUnis = await db.university.findMany({ where: { id: { in: uniIds } } });
  const uniById = new Map(programUnis.map((u) => [u.id, u]));
  const cityRows = sp.country
    ? await db.university.groupBy({ by: ["cityEn", "cityAr"], where: { orgId, countryCode: sp.country }, orderBy: { cityEn: "asc" }, take: 400 })
    : programUnis.map((u) => ({ cityEn: u.cityEn, cityAr: u.cityAr }));
  const cities = [...new Map(cityRows.map((c) => [c.cityEn, { value: c.cityEn, label: pick(locale, c.cityEn, c.cityAr) }])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const countries = countryRows.map((c) => ({ value: c.countryCode, label: countryLabel(c.countryCode, locale) })).sort((a, b) => a.label.localeCompare(b.label));

  const filters = [
    { param: "country", label: t("filter.country"), all: t("filter.allCountries"), options: countries },
    { param: "city", label: t("filter.city"), all: t("filter.allCities"), options: cities },
    { param: "field", label: t("filter.field"), all: t("filter.allFields"), options: FIELDS.map((f) => ({ value: f, label: t(`field.${f}`) })) },
    { param: "degree", label: t("filter.degree"), all: t("filter.allDegrees"), options: DEGREES.map((d) => ({ value: d, label: d })) },
    { param: "curriculum", label: t("filter.curriculum"), all: t("filter.anyCurriculum"), options: REQ_CURRICULA.map((c) => ({ value: c, label: t(`curriculum.${c}`) })) },
  ];

  const ql = q.toLowerCase();
  const filteredPrograms = programs.filter((p) => {
    const u = uniById.get(p.universityId);
    if (!u) return false;
    if (sp.country && u.countryCode !== sp.country) return false;
    if (sp.city && u.cityEn !== sp.city) return false;
    if (sp.field && p.field !== sp.field) return false;
    if (sp.degree && p.degree !== sp.degree) return false;
    if (sp.curriculum && !(p.requirements as ProgramRequirements)[sp.curriculum as keyof ProgramRequirements]) return false;
    if (ql && !`${p.nameEn} ${p.nameAr} ${u.nameEn} ${u.nameAr} ${u.cityEn}`.toLowerCase().includes(ql)) return false;
    return true;
  });

  // Universities tab: every institution, including the full US list when it has been imported.
  const page = Math.max(1, Number(sp.page) || 1);
  const uniWhere: Prisma.UniversityWhereInput = {
    orgId,
    ...(sp.country ? { countryCode: sp.country } : {}),
    ...(sp.city ? { cityEn: sp.city } : {}),
    ...(q ? { OR: [{ nameEn: { contains: q, mode: "insensitive" } }, { nameAr: { contains: q } }, { cityEn: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [uniTotal, uniRows] =
    tab === "universities"
      ? await Promise.all([db.university.count({ where: uniWhere }), db.university.findMany({ where: uniWhere, orderBy: [{ worldRank: { sort: "asc", nulls: "last" } }, { nameEn: "asc" }], skip: (page - 1) * PAGE, take: PAGE })])
      : [0, []];
  const programCount = new Map<string, number>();
  for (const p of programs) programCount.set(p.universityId, (programCount.get(p.universityId) ?? 0) + 1);
  const totalUnis = countryRows.reduce((s, c) => s + c._count._all, 0);

  // Shortlist summary for the student in focus.
  const entries = focus.student ? await db.shortlistEntry.findMany({ where: { studentId: focus.student.id }, include: { university: true }, orderBy: { createdAt: "asc" } }) : [];
  const entryPrograms = await programsForEntries(db, entries);
  const pageHref = (n: number) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string" && v) as Array<[string, string]>);
    p.set("page", String(n));
    return `/career/universities?${p.toString()}`;
  };

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <>
            {focus.options.length > 0 && <StudentPicker students={focus.options} current={focus.student?.id ?? null} />}
            {focus.student && (
              <Button asChild variant="outline" size="sm">
                <Link href={link("/career/universities/results")} data-testid="my-results">
                  <ClipboardList className="size-4" />
                  {self ? t("myResults") : t("results.title")}
                </Link>
              </Button>
            )}
            {ctx.can("pathways.manage") && (
              <Button asChild variant="outline" size="sm">
                <Link href="/career/universities/manage" data-testid="manage-pathways">
                  <Settings2 className="size-4" />
                  {t("manage")}
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="rounded-lg border border-warning/40 bg-warning-soft/40 px-4 py-3 text-sm" data-testid="accuracy-banner">
        {t("accuracyBanner")}
      </div>

      {focus.student && (
        <Panel>
          <PanelHeader title={self ? t("yourShortlist") : t("shortlistOf")} icon={<GraduationCap className="size-4" />} description={t("shortlistDesc", { curriculum: t(`curriculum.${focus.data?.curriculum ?? "OTHER"}`) })} />
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("shortlistEmpty")}</p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2" data-testid="pathway-shortlist">
              {entries.map((e) => {
                const p = entryPrograms.get(`${e.universityId}|${e.programEn}`);
                const check = p && focus.data ? checkProgram(p, focus.data) : null;
                return (
                  <li key={e.id} className="flex min-w-0 flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      {p ? (
                        <Link href={link(`/career/universities/programs/${p.id}`)} className="block truncate text-sm font-medium hover:text-brand">
                          {pick(locale, e.programEn, e.programAr)}
                        </Link>
                      ) : (
                        <span className="block truncate text-sm font-medium">{pick(locale, e.programEn, e.programAr)}</span>
                      )}
                      <span className="block truncate text-xs text-muted-foreground">
                        {pick(locale, e.university.nameEn, e.university.nameAr)}
                        {e.deadline && ` · ${t("deadlineOn", { date: fmtDate(prefs, e.deadline) })}`}
                      </span>
                    </div>
                    {check ? <CheckSummary check={check} /> : <Pill>{t("noProgramme")}</Pill>}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      <FilterBar
        tabs={[
          { value: "programmes", label: t("tabProgrammes"), count: programs.length },
          { value: "universities", label: t("tabUniversities"), count: totalUnis },
        ]}
        searchPlaceholder={t("search")}
      />
      <PathwayFilters filters={tab === "universities" ? filters.slice(0, 2) : filters} />

      {tab === "programmes" ? (
        filteredPrograms.length === 0 ? (
          <EmptyState icon={<Landmark className="size-5" />} title={t("noResults")} body={t("noResultsBody")} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2" data-testid="program-list">
            {filteredPrograms.map((p) => {
              const u = uniById.get(p.universityId)!;
              const req = p.requirements as ProgramRequirements;
              const lines = requirementLines(t, curriculum, req, fmt);
              const check = focus.data ? checkProgram(p, focus.data) : null;
              const checked = !!p.lastVerifiedAt && !p.indicative;
              return (
                <Link key={p.id} href={link(`/career/universities/programs/${p.id}`)} className="flex min-w-0 flex-col rounded-xl border bg-card p-4 shadow-xs transition hover:border-brand/40" data-testid="program-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{pick(locale, p.nameEn, p.nameAr)}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {pick(locale, u.nameEn, u.nameAr)} · {pick(locale, u.cityEn, u.cityAr)}, {countryLabel(u.countryCode, locale)}
                      </div>
                    </div>
                    <Pill tone="brand">{p.degree}</Pill>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Pill>{t(`field.${p.field}`)}</Pill>
                    {req.route && <Pill tone="info">{t(`route.${req.route.via}`)}</Pill>}
                    <Pill tone={checked ? "success" : "warning"}>{checked ? t("checkedShort") : t("indicative")}</Pill>
                  </div>
                  <div className="mt-3 flex-1 text-xs">
                    <div className="mb-1 font-medium text-muted-foreground">{t("forCurriculum", { curriculum: t(`curriculum.${curriculum}`) })}</div>
                    {lines.length ? (
                      <ul className="space-y-0.5">
                        {lines.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">{t("notListedForCurriculum")}</p>
                    )}
                  </div>
                  {check && (
                    <div className="mt-3 border-t pt-3">
                      <CheckSummary check={check} />
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )
      ) : uniRows.length === 0 ? (
        <EmptyState icon={<Landmark className="size-5" />} title={t("noResults")} body={t("noResultsBody")} />
      ) : (
        <div className="space-y-3">
          <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="university-list">
            {uniRows.map((u) => (
              <li key={u.id}>
                <Link href={link(`/career/universities/${u.id}`)} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{pick(locale, u.nameEn, u.nameAr)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {pick(locale, u.cityEn, u.cityAr)}, {countryLabel(u.countryCode, locale)}
                      {u.acceptanceRate != null && ` · ${t("admitRate", { pct: fmt(u.acceptanceRate) })}`}
                    </div>
                  </div>
                  {(programCount.get(u.id) ?? 0) > 0 && <Pill tone="brand">{t("programmesN", { n: programCount.get(u.id)! })}</Pill>}
                  {u.applyVia && <Pill tone="info">{t(`route.${u.applyVia}`)}</Pill>}
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("pageOf", { from: fmt((page - 1) * PAGE + 1), to: fmt(Math.min(page * PAGE, uniTotal)), total: fmt(uniTotal) })}</span>
            <div className="flex gap-2">
              {page > 1 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={pageHref(page - 1)} aria-label={t("prev")}>
                    <ChevronLeft className="size-4 rtl:rotate-180" />
                  </Link>
                </Button>
              )}
              {page * PAGE < uniTotal && (
                <Button asChild variant="outline" size="sm">
                  <Link href={pageHref(page + 1)} aria-label={t("next")} data-testid="next-page">
                    <ChevronRight className="size-4 rtl:rotate-180" />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </PageBody>
  );
}
