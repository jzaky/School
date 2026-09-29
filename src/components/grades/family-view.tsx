import { getTranslations } from "next-intl/server";
import { BookOpenCheck, ChevronDown, GraduationCap, LineChart, ListChecks } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { fmtDate, fmtNumber, type FormatPrefs } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { StatCard } from "@/components/app/stat-card";
import { Panel, PanelHeader } from "@/components/app/panel";
import type { publishedGradesFor } from "@/server/grades/queries";
import { Sparkline } from "./sparkline";
import { ReportCardButton } from "./grade-controls";

type Data = NonNullable<Awaited<ReturnType<typeof publishedGradesFor>>>;

export function bandTone(band: string | null, bands: Array<{ label: string; minPercent: number }>) {
  if (!band) return "bg-muted text-muted-foreground";
  const b = bands.find((x) => x.label === band);
  const min = b?.minPercent ?? 0;
  if (min >= 80) return "bg-success-soft text-success";
  if (min >= 60) return "bg-brand-soft text-brand";
  if (min >= 40) return "bg-warning-soft text-[oklch(0.55_0.14_65)]";
  return "bg-danger-soft text-danger";
}

export async function FamilyGrades({
  data,
  prefs,
  kids,
  activeChildId,
  highlight,
  reportAvailable,
  isParent,
}: {
  data: Data;
  prefs: FormatPrefs;
  kids: Array<{ id: string; name: string; grade: number }>;
  activeChildId: string;
  highlight?: string;
  reportAvailable: boolean;
  isParent: boolean;
}) {
  const t = await getTranslations("grades");
  const locale = prefs.locale;
  const pct = (n: number | null) => (n === null ? "-" : `${fmtNumber(prefs, n, { maximumFractionDigits: 1 })}%`);
  const defaultTermId = data.term?.id ?? null;
  const termLabel = data.term ? pick(locale, data.term.nameEn, data.term.nameAr) : "";

  return (
    <div className="space-y-6">
      {isParent && kids.length > 1 && (
        <nav className="flex gap-2 overflow-x-auto" aria-label={t("childSwitcher")}>
          {kids.map((c) => (
            <Link
              key={c.id}
              href={`/grades?student=${c.id}`}
              className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition", c.id === activeChildId ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:bg-muted")}
              data-testid="child-switch"
            >
              {c.name} <span className="opacity-70">· {t("gradeLevel", { grade: c.grade })}</span>
            </Link>
          ))}
        </nav>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {data.terms.length > 0 && (
          <FilterBar chips={data.terms.map((tt) => ({ value: tt.id === defaultTermId ? "" : tt.id, label: pick(locale, tt.nameEn, tt.nameAr) }))} chipParam="term" />
        )}
        <ReportCardButton studentId={data.student.id} termId={defaultTermId} available={reportAvailable} termLabel={termLabel} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("overallAverage")} value={pct(data.overall)} hint={data.overallBand ? t("bandIs", { band: data.overallBand }) : t("noGradesYet")} icon={<GraduationCap className="size-4" />} testId="overall-average" />
        <StatCard label={t("publishedAssessments")} value={fmtNumber(prefs, data.publishedCount)} hint={termLabel} icon={<ListChecks className="size-4" />} tone="info" />
        <div className="rounded-xl border bg-card p-5 shadow-xs">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <LineChart className="size-4" />
            {t("termTrend")}
          </div>
          <ul className="mt-3 space-y-1.5">
            {data.byTerm.map((bt) => (
              <li key={bt.termId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs">
                <div className="min-w-0">
                  <div className="truncate text-muted-foreground">{pick(locale, bt.nameEn, bt.nameAr)}</div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, bt.average ?? 0))}%` }} />
                  </div>
                </div>
                <span className="tabular-nums font-medium">{bt.average === null ? t("notYet") : <bdi>{`${pct(bt.average)} ${bt.band ?? ""}`}</bdi>}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {data.publishedCount === 0 ? (
        <EmptyState icon={<BookOpenCheck className="size-5" />} title={t("familyEmpty")} body={t("familyEmptyBody")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.subjects.map((s) => {
            const open = !!highlight && s.assessments.some((a) => a.id === highlight);
            return (
              <Panel key={s.classId} className="flex flex-col" padded={false}>
                <div className="flex items-start justify-between gap-3 p-5 pb-3" data-testid="subject-card">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold">{pick(locale, s.subject.en, s.subject.ar)}</h2>
                    {s.teacher && <p className="truncate text-xs text-muted-foreground">{pick(locale, s.teacher.en, s.teacher.ar)}</p>}
                  </div>
                  <span className={cn("grid min-w-10 place-items-center rounded-lg px-2 py-1 text-sm font-bold", bandTone(s.band, data.bands))} data-testid="subject-band" dir="ltr">
                    {s.band ?? "-"}
                  </span>
                </div>
                <div className="flex items-end justify-between gap-3 px-5">
                  <div>
                    <div className="text-2xl font-semibold tabular-nums tracking-tight">{pct(s.average)}</div>
                    <div className="text-xs text-muted-foreground">{t("weightedAverage")}</div>
                  </div>
                  <Sparkline points={s.trend.map((p) => p.avg)} label={t("trendLabel")} />
                </div>
                <details className="group mt-3 border-t" open={open}>
                  <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                    {t("assessmentsCount", { count: s.assessments.length })}
                    <ChevronDown className="size-4 transition group-open:rotate-180" />
                  </summary>
                  {s.assessments.length === 0 ? (
                    <p className="px-5 pb-4 text-xs text-muted-foreground">{t("noneThisTerm")}</p>
                  ) : (
                    <ul className="divide-y border-t">
                      {s.assessments.map((a) => (
                        <li key={a.id} className={cn("px-5 py-2.5", a.id === highlight && "bg-brand-soft/40")} data-testid="family-assessment">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium">{pick(locale, a.titleEn, a.titleAr)}</div>
                              <div className="text-xs text-muted-foreground">
                                {t(`kind.${a.kind}`)} · {fmtDate(prefs, a.dueAt ?? a.publishedAt, "short")}
                              </div>
                            </div>
                            <div className="shrink-0 text-end">
                              {a.excused ? (
                                <span className="text-xs font-medium text-muted-foreground">{t("excused")}</span>
                              ) : a.score === null ? (
                                <span className="text-xs text-muted-foreground">{t("notSubmitted")}</span>
                              ) : (
                                <>
                                  <div className="text-sm font-semibold tabular-nums" dir="ltr">
                                    {fmtNumber(prefs, a.score)} / {fmtNumber(prefs, a.maxScore)}
                                  </div>
                                  <div className="text-xs text-muted-foreground tabular-nums">{pct(a.percent)}</div>
                                </>
                              )}
                            </div>
                          </div>
                          {(a.commentEn || a.commentAr) && <p className="mt-1 rounded-md bg-muted/60 px-2 py-1 text-xs">{pick(locale, a.commentEn, a.commentAr)}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </Panel>
            );
          })}
        </div>
      )}
      <Panel>
        <PanelHeader title={t("bandKey")} description={t("bandKeyBody")} />
        <div className="flex flex-wrap gap-2">
          {data.bands.map((b) => (
            <span key={b.label} dir="ltr" className={cn("rounded-md px-2 py-1 text-xs font-medium", bandTone(b.label, data.bands))}>
              {b.label} · {fmtNumber(prefs, b.minPercent)}%+
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}
