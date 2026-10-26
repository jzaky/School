import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight, CalendarRange, ChevronLeft, Settings2 } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { tenantTx } from "@/lib/tenant-db";
import { Link } from "@/i18n/navigation";
import { ALL_GRADE_LEVELS, gradeLevelValues } from "@/lib/grade-levels";
import { gradeRuns, windowState } from "@/lib/selection-window";
import { currentYear, selectionYear } from "@/server/registration/service";
import { getSelectionSettings, windowCohort, windowsForYears } from "@/server/registration/selection";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { CloseWindowButton, SelectionSettingsForm, WindowDialog } from "@/components/registration/window-controls";

export async function generateMetadata() {
  const t = await getTranslations("selection.windows");
  return { title: t("title") };
}

export default async function SelectionWindowsPage() {
  const ctx = await getCtx();
  if (!ctx.can("registration.manage")) notFound();
  const t = await getTranslations("selection.windows");
  const tg = await getTranslations("gradeLevel");
  const prefs = await formatPrefs(ctx);
  const { orgId, locale } = ctx;
  const now = new Date();
  const data = await tenantTx(
    orgId,
    async (tx) => {
      const current = await currentYear(tx, orgId);
      const next = current ? await selectionYear(tx, orgId) : null;
      const years = [current, next].filter((y): y is NonNullable<typeof y> => !!y);
      const windows = await windowsForYears(tx, orgId, years.map((y) => y.id));
      const settings = await getSelectionSettings(tx, orgId);
      const withProgress = [];
      for (const w of windows) {
        const cohort = await windowCohort(tx, orgId, w);
        const done = cohort.filter((s) => s.progress.status === "submitted" || s.progress.status === "signed_off").length;
        withProgress.push({ ...w, total: cohort.length, done });
      }
      const grades = await tx.student.groupBy({ by: ["gradeLevel"], where: { orgId, status: "ACTIVE" }, orderBy: { gradeLevel: "asc" } });
      return { current, next, years, windows: withProgress, settings, grades: grades.map((g) => g.gradeLevel) };
    },
    { timeout: 60_000 },
  );
  const yearLabel = (y: { id: string; nameEn: string; nameAr: string }) => `⁦${pick(locale, y.nameEn, y.nameAr)}⁩`;
  const yearOptions = data.years.map((y) => ({ id: y.id, label: y.id === data.next?.id ? t("yearNext", { year: yearLabel(y) }) : t("yearCurrent", { year: yearLabel(y) }), next: y.id === data.next?.id }));
  // Grades with students; a new school without students yet sees every grade from KG1 to Grade 12.
  const grades = data.grades.length ? data.grades : [...ALL_GRADE_LEVELS];
  const gradesText = (levels: number[]) =>
    gradeRuns(levels)
      .map(([a, b]) => (a === b ? tg("label", gradeLevelValues(a)) : t("gradeSpan", { from: tg("label", gradeLevelValues(a)), to: tg("label", gradeLevelValues(b)) })))
      .join(locale === "ar" ? "، " : ", ");

  return (
    <PageBody>
      <div>
        <Link href="/admin/registration" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {t("back")}
        </Link>
      </div>
      <PageHeader title={t("title")} description={t("subtitle")} actions={data.years.length > 0 ? <WindowDialog years={yearOptions} grades={grades} /> : null} />
      {data.years.length === 0 ? (
        <EmptyState icon={<CalendarRange className="size-5" />} title={t("noYear")} body={t("noYearBody")} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            {data.years.map((y) => {
              const ws = data.windows.filter((w) => w.academicYearId === y.id).sort((a, b) => b.opensAt.getTime() - a.opensAt.getTime());
              return (
                <section key={y.id} className="space-y-3" data-testid={`windows-${y.id === data.next?.id ? "next" : "current"}`}>
                  <h2 className="text-sm font-semibold">{y.id === data.next?.id ? t("yearNext", { year: yearLabel(y) }) : t("yearCurrent", { year: yearLabel(y) })}</h2>
                  {ws.length === 0 ? (
                    <EmptyState icon={<CalendarRange className="size-5" />} title={t("empty")} body={t("emptyBody")} />
                  ) : (
                    <ul className="space-y-3">
                      {ws.map((w) => {
                        const state = windowState(w, now);
                        const pct = w.total ? Math.round((w.done / w.total) * 100) : 0;
                        const round = pick(locale, w.roundEn, w.roundAr);
                        return (
                          <li key={w.id} className="rounded-xl border bg-card p-4 shadow-xs" data-testid="window-card" data-state={state}>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="text-sm font-semibold">{gradesText(w.gradeLevels)}</h3>
                                  <Pill tone={state === "open" ? "success" : state === "upcoming" ? "brand" : "neutral"} dot>
                                    {t(`state.${state}`)}
                                  </Pill>
                                  {round && <Pill>{round}</Pill>}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">{t("range", { opens: fmtDateTime(prefs, w.opensAt), closes: fmtDateTime(prefs, w.closesAt) })}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-1">
                                <WindowDialog trigger="edit" years={yearOptions} grades={grades} value={{ id: w.id, yearId: w.academicYearId, gradeLevels: w.gradeLevels, opensAt: w.opensAt.toISOString(), closesAt: w.closesAt.toISOString(), roundEn: w.roundEn, roundAr: w.roundAr }} />
                                {state !== "closed" && <CloseWindowButton id={w.id} />}
                              </div>
                            </div>
                            <div className="mt-3 flex items-center gap-3">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t("done", { done: fmtNumber(prefs, w.done), total: fmtNumber(prefs, w.total) })}</span>
                            </div>
                            <Link href={`/admin/registration/windows/${w.id}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline" data-testid="window-open-overview">
                              {t("overview")}
                              <ArrowRight className="size-3.5 rtl:rotate-180" />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
          <Panel className="h-fit">
            <PanelHeader title={t("settingsTitle")} description={t("settingsBody")} icon={<Settings2 className="size-4" />} />
            <SelectionSettingsForm value={data.settings} />
          </Panel>
        </div>
      )}
    </PageBody>
  );
}
