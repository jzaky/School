import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookOpen, ChevronLeft, ClipboardList, GraduationCap, Timer } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { personName, pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { ConfirmButton, CurriculumSelect, DeleteRowButton, ResultDialog, ScoreDialog, StudentPicker } from "@/components/pathways/pathway-client";
import { subjectLabel, testLabel } from "@/components/pathways/pathway-ui";
import { pathwayFocus, withStudent } from "@/server/pathways/page-data";
import { PATHWAY_SUBJECTS } from "@/server/pathways/subjects";
import { CURRICULA, OVERALL, RESULT_LEVELS, TAWJIHI_STREAMS, TEST_KINDS, TEST_RANGE, UAE_STREAMS } from "@/server/pathways/types";

export async function generateMetadata() {
  const t = await getTranslations("pathways.results");
  return { title: t("title") };
}

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("pathways.view")) notFound();
  const t = await getTranslations("pathways");
  const prefs = await formatPrefs(ctx);
  const fmt = (n: number) => fmtNumber(prefs, n);
  const { db, locale } = ctx;
  const focus = await pathwayFocus(ctx, sp.student);
  const back = (
    <Link href={withStudent("/career/universities", focus.student?.id, ctx.isStudent)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-4 rtl:rotate-180" />
      {t("title")}
    </Link>
  );
  if (!focus.student || !focus.data) {
    if (!focus.isAdvisor) notFound();
    return (
      <PageBody>
        {back}
        <PageHeader title={t("results.title")} description={t("results.subtitleStaff")} actions={<StudentPicker students={focus.options} current={null} />} />
        <EmptyState icon={<GraduationCap className="size-5" />} title={t("results.pickStudent")} body={t("results.pickStudentBody")} />
      </PageBody>
    );
  }
  const s = focus.student;
  const data = focus.data;
  const cur = data.curriculum;
  const memberIds = [...new Set([...data.results.map((r) => r.confirmedById), ...data.scores.map((x) => x.confirmedById)].filter((x): x is string => !!x))];
  const members = memberIds.length ? await db.membership.findMany({ where: { id: { in: memberIds } }, include: { user: true } }) : [];
  const who = (id: string | null) => {
    const m = members.find((x) => x.id === id);
    return m ? pick(locale, m.user.nameEn, m.user.nameAr) : "";
  };
  const subjects = await db.subject.findMany({ where: { code: { in: data.subjects } }, orderBy: { nameEn: "asc" } });
  const current = data.results.filter((r) => r.curriculum === cur);
  const other = data.results.filter((r) => r.curriculum !== cur);
  const overallLevels = cur === "UAE_MOE" ? UAE_STREAMS.map((v) => ({ value: v, label: t(`stream.${v}`) })) : cur === "JORDAN_TAWJIHI" ? TAWJIHI_STREAMS.map((v) => ({ value: v, label: t(`stream.${v}`) })) : cur === "AMERICAN" ? [{ value: "GPA", label: t("level.GPA") }] : [];
  const overall = cur === "OTHER" || cur === "BRITISH" ? null : { label: t(`check.overall.${cur}`), levels: overallLevels };
  const subjectOpts = cur === "UAE_MOE" || cur === "JORDAN_TAWJIHI" ? [] : PATHWAY_SUBJECTS.map((c) => ({ value: c, label: subjectLabel(t, c) }));
  const levelOpts = (RESULT_LEVELS[cur] ?? []).map((l) => ({ value: l, label: t(`level.${l}`) }));
  const unconfirmedResults = current.filter((r) => !r.confirmed).map((r) => r.id);
  const unconfirmedScores = data.scores.filter((x) => !x.confirmed).map((x) => x.id);
  const status = (confirmed: boolean, by: string | null, at: Date | null) =>
    confirmed ? (
      <Pill tone="success">{by ? t("results.confirmedBy", { name: who(by), date: fmtDate(prefs, at) }) : t("results.confirmedShort")}</Pill>
    ) : (
      <Pill tone="warning">{t("check.unconfirmed")}</Pill>
    );
  const label = (code: string) => (code === OVERALL ? t(`check.overall.${cur}`) : subjectLabel(t, code));

  return (
    <PageBody>
      {back}
      <PageHeader
        title={ctx.isStudent ? t("myResults") : t("results.titleFor", { name: personName(s, locale) })}
        description={focus.isAdvisor ? t("results.subtitleStaff") : t("results.subtitle")}
        actions={
          <>
            {focus.options.length > 0 && <StudentPicker students={focus.options} current={s.id} />}
            {focus.isAdvisor && <ConfirmButton studentId={s.id} resultIds={unconfirmedResults} scoreIds={unconfirmedScores} />}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Panel>
          <PanelHeader title={t("results.curriculum")} icon={<BookOpen className="size-4" />} />
          {focus.isAdvisor ? (
            <CurriculumSelect studentId={s.id} current={cur} options={CURRICULA.map((c) => ({ value: c, label: t(`curriculum.${c}`) }))} />
          ) : (
            <Pill tone="brand">{t(`curriculum.${cur}`)}</Pill>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{t("results.curriculumHint")}</p>
          <div className="mt-4 text-sm font-medium">{t("results.subjects")}</div>
          {subjects.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="current-subjects">
              {subjects.map((x) => (
                <Pill key={x.id}>{pick(locale, x.nameEn, x.nameAr)}</Pill>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{t("results.noSubjects")}</p>
          )}
          <Button asChild variant="link" size="sm" className="mt-2 h-auto px-0">
            <Link href="/subjects">{t("checker.goSubjects")}</Link>
          </Button>
        </Panel>
        <div className="space-y-4 lg:col-span-2">
          <Panel>
            <PanelHeader title={t("results.resultsTitle")} icon={<ClipboardList className="size-4" />} description={t("results.resultsHint")} action={(subjectOpts.length > 0 || overall) && <ResultDialog studentId={s.id} subjects={subjectOpts} levels={levelOpts} overall={overall} />} />
            {current.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("results.noResults")}</p>
            ) : (
              <ul className="divide-y rounded-lg border" data-testid="results-list">
                {current.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 font-medium">
                      {label(r.subjectCode)}
                      {r.level && <span className="ms-2 text-xs font-normal text-muted-foreground">{t.has(`level.${r.level}`) ? t(`level.${r.level}`) : t(`stream.${r.level}`)}</span>}
                    </span>
                    {r.predicted && <span className="text-xs">{t("results.predictedValue", { value: r.predicted })}</span>}
                    {r.achieved && <span className="text-xs font-medium">{t("results.achievedValue", { value: r.achieved })}</span>}
                    {status(r.confirmed, r.confirmedById, r.confirmedAt)}
                    <DeleteRowButton id={r.id} kind="result" />
                  </li>
                ))}
              </ul>
            )}
            {other.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{t("results.otherCurriculum", { n: other.length })}</p>}
          </Panel>
          <Panel>
            <PanelHeader
              title={t("results.scoresTitle")}
              icon={<Timer className="size-4" />}
              description={t("results.scoresHint")}
              action={<ScoreDialog studentId={s.id} kinds={TEST_KINDS.map((k) => ({ value: k, label: testLabel(t, k), ...TEST_RANGE[k] }))} />}
            />
            {data.scores.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("results.noScores")}</p>
            ) : (
              <ul className="divide-y rounded-lg border" data-testid="scores-list">
                {data.scores.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 font-medium">{testLabel(t, x.kind)}</span>
                    <span className="tabular-nums">{fmt(x.score)}</span>
                    {x.takenAt && <span className="text-xs text-muted-foreground">{fmtDate(prefs, x.takenAt)}</span>}
                    {status(x.confirmed, x.confirmedById, x.confirmedAt)}
                    <DeleteRowButton id={x.id} kind="score" />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </PageBody>
  );
}
