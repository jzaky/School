// Server views for the University planning module. Pages under /career/pathways are thin wrappers.
import { getTranslations } from "next-intl/server";
import { ArrowRight, BookOpenCheck, DoorOpen, FlaskConical, GraduationCap, Info, Route, Search, Target } from "lucide-react";
import type { Ctx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { fmtDate, fmtNumber } from "@/lib/format";
import { formatPrefs } from "@/server/format";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { StudentPicker } from "@/components/pathways/pathway-client";
import { countryLabel } from "@/components/pathways/pathway-ui";
import { computeCourseImpact, computeMatches, getCurrentPlan, getGoal, loadSchoolCatalog, loadStudentProfile } from "@/server/pathway-engine/service";
import { pathwayHref, subjectNames, type EngineFocus } from "@/server/pathway-engine/page-data";
import { STATUS_RANK } from "@/server/pathway-engine/types";
import { gradeOptions } from "@/server/pathway-engine/grade-scales";
import { STATUS_ORDER } from "./labels";
import { StatusChip } from "./ui";
import { AiSummary, GoalForm, PlanBuilder, WhatIfPanel } from "./client";

export const GOAL_COUNTRIES = ["GB", "US", "CA", "AE", "AU", "IE", "NL", "DE", "SG", "HK", "JO", "CH"];
type Tab = "overview" | "plan" | "whatIf";

export async function EngineHeader({ ctx, focus, tab }: { ctx: Ctx; focus: EngineFocus; tab: Tab }) {
  const t = await getTranslations("engine");
  const s = focus.student!;
  const tabs: Array<{ key: Tab; href: string; icon: React.ReactNode }> = [
    { key: "overview", href: pathwayHref(ctx, s.id), icon: <Target className="size-4" /> },
    { key: "plan", href: pathwayHref(ctx, s.id, "/plan"), icon: <Route className="size-4" /> },
    { key: "whatIf", href: pathwayHref(ctx, s.id, "/what-if"), icon: <FlaskConical className="size-4" /> },
  ];
  return (
    <>
      <PageHeader
        eyebrow={ctx.isStudent ? undefined : t("studentLine", { name: s.name, grade: s.gradeLevel, curriculum: t(`curriculum.${s.curriculum}`) })}
        title={t("title")}
        description={ctx.isStudent ? t("subtitle") : t("subtitleStaff")}
        actions={focus.options.length > 0 ? <StudentPicker students={focus.options} current={s.id} /> : undefined}
      />
      <nav className="-mt-2 flex gap-1 overflow-x-auto border-b" aria-label={t("title")}>
        {tabs.map((x) => (
          <Link key={x.key} href={x.href} className={cn("inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm", tab === x.key ? "border-brand font-medium text-brand" : "border-transparent text-muted-foreground hover:text-foreground")} data-testid={`tab-${x.key}`}>
            {x.icon}
            {t(`tabs.${x.key}`)}
          </Link>
        ))}
      </nav>
      <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 px-4 py-3 text-sm" data-testid="example-banner">
        <Info className="mt-0.5 size-4 shrink-0" />
        <span>{t("exampleBanner")}</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Overview

export async function HubView({ ctx, focus }: { ctx: Ctx; focus: EngineFocus }) {
  const t = await getTranslations("engine");
  const td = await getTranslations("discovery");
  const prefs = await formatPrefs(ctx);
  const s = focus.student!;
  const { actor } = focus;
  const [goal, plan, careers] = await Promise.all([getGoal(actor, s.id), getCurrentPlan(actor, s.id), ctx.db.career.findMany({ where: { orgId: ctx.orgId }, orderBy: { titleEn: "asc" }, select: { key: true, titleEn: true, titleAr: true } })]);
  const hasGoal = !!goal.careerKey || goal.fieldKeys.length > 0;
  const [{ matches, counts, profile }, impact] = hasGoal ? await Promise.all([computeMatches(actor, s.id, { planId: plan?.id ?? null }), computeCourseImpact(actor, s.id, { planId: null, limit: 6 })]) : [{ matches: [], counts: null, profile: null }, null];
  // Courses per grade: the record plus the plan (the profile includes planned courses when a plan exists).
  const perGrade = (g: number) => (profile ? profile.profile.courses.filter((c) => c.gradeLevel === g && !c.id.startsWith("legacy:")).length : (plan?.items.filter((i) => i.gradeLevel === g).length ?? 0));
  const career = careers.find((c) => c.key === goal.careerKey);
  const top = [...matches].sort((a, b) => STATUS_RANK[b.result.status] - STATUS_RANK[a.result.status] || (a.meta.university.worldRank ?? 9999) - (b.meta.university.worldRank ?? 9999)).slice(0, 10);
  const programHref = (id: string) => `/career/pathways/programs/${id}${ctx.isStudent ? "" : `?student=${s.id}`}`;
  const fmt = (n: number) => fmtNumber(prefs, n);

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader title={t("goal.title")} icon={<Target className="size-4" />} description={goal.source === "plan" ? t("goal.fromPlan") : goal.source === "career" ? t("goal.fromCareer") : t("goal.none")} />
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="goal-summary">
          {career ? <Pill tone="brand">{pick(ctx.locale, career.titleEn, career.titleAr)}</Pill> : <span className="text-muted-foreground">{t("goal.noCareer")}</span>}
          {goal.countries.map((c) => (
            <Pill key={c}>{countryLabel(c, ctx.locale)}</Pill>
          ))}
        </div>
        {focus.canEdit && (
          <div className="mt-4 border-t pt-4">
            <GoalForm studentId={s.id} careers={careers.map((c) => ({ value: c.key, label: pick(ctx.locale, c.titleEn, c.titleAr) }))} countries={GOAL_COUNTRIES.map((c) => ({ value: c, label: countryLabel(c, ctx.locale) }))} initial={{ careerKey: goal.careerKey, countries: goal.countries }} planHref={pathwayHref(ctx, s.id, "/plan")} hasPlan={!!plan} />
          </div>
        )}
      </Panel>

      {!hasGoal ? (
        <EmptyState icon={<GraduationCap className="size-5" />} title={t("noGoalTitle")} body={focus.canEdit ? t("noGoalBody") : t("noGoalBodyView")} />
      ) : (
        <>
          <section>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">{t("summary.title")}</h2>
              <span className="text-xs text-muted-foreground">{plan ? t("summary.withPlan") : t("summary.recordOnly")}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="status-counts">
              {STATUS_ORDER.map((st) => (
                <div key={st} className="rounded-xl border bg-card p-3 shadow-xs">
                  <div className="text-2xl font-semibold tabular-nums">{fmt(counts?.[st] ?? 0)}</div>
                  <StatusChip status={st} className="mt-1" />
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-5 [&>*]:min-w-0">
            <Panel className="lg:col-span-3">
              <PanelHeader
                title={t("programs.title")}
                icon={<GraduationCap className="size-4" />}
                description={t("programs.desc", { n: matches.length })}
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/career/pathways/search${ctx.isStudent ? "" : `?student=${s.id}`}`} data-testid="open-search">
                      <Search className="size-4" />
                      {td("findProgrammes")}
                    </Link>
                  </Button>
                }
              />
              {top.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("programs.empty")}</p>
              ) : (
                <ul className="divide-y" data-testid="top-programs">
                  {top.map((m) => (
                    <li key={m.meta.id}>
                      <Link href={programHref(m.meta.id)} className="flex flex-col gap-1.5 py-2.5 hover:bg-muted/30 sm:flex-row sm:items-center sm:gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{pick(ctx.locale, m.meta.nameEn, m.meta.nameAr)}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {pick(ctx.locale, m.meta.university.nameEn, m.meta.university.nameAr)} · {countryLabel(m.meta.university.countryCode, ctx.locale)}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          {m.result.counts.requiredMissing > 0 && <span className="text-xs text-danger">{t("programs.missingN", { n: m.result.counts.requiredMissing })}</span>}
                          <StatusChip status={m.result.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel className="lg:col-span-2">
              <PanelHeader title={t("unlock.title")} icon={<DoorOpen className="size-4" />} description={t("unlock.desc")} />
              {!impact || impact.results.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("unlock.empty")}</p>
              ) : (
                <ol className="space-y-2" data-testid="unlock-list">
                  {impact.results.map((r, i) => (
                    <li key={r.course.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            <span className="me-1.5 text-muted-foreground tabular-nums">{fmt(i + 1)}.</span>
                            {pick(ctx.locale, r.course.nameEn, r.course.nameAr)}
                          </div>
                          <div className="text-xs text-muted-foreground">{t("unlock.fromGrade", { grade: r.gradeLevel })}</div>
                        </div>
                        <Pill tone="brand">{t("unlock.score", { score: fmt(r.score) })}</Pill>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                        {r.breakdown
                          .filter((b) => b.count > 0)
                          .map((b) => (
                            <Pill key={b.part} tone={b.part === "unlock" ? "success" : b.part === "improve" ? "info" : "neutral"}>
                              {t(`unlock.part.${b.part}`, { n: b.count, points: fmt(b.points) })}
                            </Pill>
                          ))}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <Button asChild variant="link" size="sm" className="mt-2 h-auto px-0">
                <Link href={pathwayHref(ctx, s.id, "/what-if")}>
                  {t("unlock.tryWhatIf")}
                  <ArrowRight className="size-3.5 rtl:rotate-180" />
                </Link>
              </Button>
            </Panel>
          </div>
        </>
      )}

      <Panel>
        <PanelHeader
          title={t("plan.title")}
          icon={<BookOpenCheck className="size-4" />}
          description={plan ? t("plan.updated", { date: fmtDate(prefs, plan.updatedAt) }) : t("plan.none")}
          action={plan ? <Pill tone={plan.status === "APPROVED" ? "success" : plan.status === "PROPOSED" ? "warning" : "neutral"}>{t(`planStatus.${plan.status}`)}</Pill> : undefined}
        />
        {plan && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="plan-summary">
            {[9, 10, 11, 12].map((g) => (
              <div key={g} className="rounded-lg border p-2.5 text-sm">
                <div className="text-xs text-muted-foreground">{t("plan.grade", { grade: g })}</div>
                <div className="font-medium">{t("plan.coursesN", { n: perGrade(g) })}</div>
              </div>
            ))}
          </div>
        )}
        {plan?.counselorNote && (
          <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">
            <span className="font-medium">{t("plan.counselorNote")}: </span>
            {plan.counselorNote}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" variant={plan ? "outline" : "default"}>
            <Link href={pathwayHref(ctx, s.id, "/plan")} data-testid="open-plan">
              {plan ? t("plan.open") : t("plan.start")}
            </Link>
          </Button>
        </div>
        {plan && hasGoal && (
          <div className="mt-4 border-t pt-4">
            <AiSummary studentId={s.id} />
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Plan

export async function PlanPageView({ ctx, focus }: { ctx: Ctx; focus: EngineFocus }) {
  const t = await getTranslations("engine");
  const prefs = await formatPrefs(ctx);
  const s = focus.student!;
  const [plan, loaded, goal] = await Promise.all([getCurrentPlan(focus.actor, s.id), loadStudentProfile(focus.actor, s.id), getGoal(focus.actor, s.id)]);
  const catalog = await loadSchoolCatalog(ctx.db, ctx.orgId, loaded.student.curriculum);
  const [approver, proposer] = await Promise.all([
    plan?.approvedById ? ctx.db.membership.findUnique({ where: { id: plan.approvedById }, include: { user: true } }) : null,
    plan?.proposedById ? ctx.db.membership.findUnique({ where: { id: plan.proposedById }, include: { user: true } }) : null,
  ]);
  const record = loaded.profile.courses.filter((c) => c.status !== "PLANNED" && !c.id.startsWith("legacy:"));
  const L = (en: string, ar: string) => pick(ctx.locale, en, ar);
  return (
    <PlanBuilder
      studentId={s.id}
      studentGrade={s.gradeLevel}
      firstGrade={record.some((c) => c.status === "IN_PROGRESS" && c.gradeLevel === s.gradeLevel) ? s.gradeLevel + 1 : s.gradeLevel}
      plan={
        plan
          ? {
              id: plan.id,
              status: plan.status,
              counselorNote: plan.counselorNote,
              approvedLine: plan.approvedAt && approver ? t("plan.approvedBy", { name: L(approver.user.nameEn, approver.user.nameAr ?? ""), date: fmtDate(prefs, plan.approvedAt) }) : null,
              proposedLine: plan.status === "PROPOSED" && proposer ? t("plan.proposedBy", { name: L(proposer.user.nameEn, proposer.user.nameAr ?? "") }) : null,
              items: plan.items.map((i) => ({ id: i.id, gradeLevel: i.gradeLevel, schoolCourseId: i.schoolCourseId, name: L(i.nameEn, i.nameAr), reason: i.reasonEn ? L(i.reasonEn, i.reasonAr ?? "") : null, locked: i.locked })),
            }
          : null
      }
      goal={{ careerKey: goal.careerKey, fieldKeys: goal.fieldKeys, countries: goal.countries }}
      record={record.map((c) => ({ id: c.id, name: L(c.nameEn, c.nameAr), gradeLevel: c.gradeLevel, status: c.status, grade: c.finalGrade ?? c.predictedGrade ?? null }))}
      catalog={catalog.map((c) => ({ id: c.id, name: L(c.nameEn, c.nameAr), gradeLevels: c.gradeLevels }))}
      canEdit={focus.canEdit}
      canApprove={focus.canApprove}
      isStudent={ctx.isStudent}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// What if

export async function WhatIfView({ ctx, focus }: { ctx: Ctx; focus: EngineFocus }) {
  const s = focus.student!;
  const plan = await getCurrentPlan(focus.actor, s.id);
  const loaded = await loadStudentProfile(focus.actor, s.id, { planId: plan?.id ?? null });
  const [catalog, names] = await Promise.all([loadSchoolCatalog(ctx.db, ctx.orgId, loaded.student.curriculum), subjectNames(ctx)]);
  const L = (en: string, ar: string) => pick(ctx.locale, en, ar);
  const taken = new Set(loaded.profile.courses.map((c) => c.courseId));
  return (
    <WhatIfPanel
      studentId={s.id}
      planId={plan?.id ?? null}
      locale={ctx.locale}
      names={names}
      courses={loaded.profile.courses.map((c) => ({ ref: c.id, name: L(c.nameEn, c.nameAr), status: c.status, gradeLevel: c.gradeLevel, grade: c.finalGrade ?? c.predictedGrade ?? null, options: gradeOptions(c.gradeScale) }))}
      catalog={catalog
        .filter((c) => !taken.has(c.courseId))
        .map((c) => ({ id: c.id, name: L(c.nameEn, c.nameAr), gradeLevels: c.gradeLevels.filter((g) => g >= s.gradeLevel), options: gradeOptions(c.gradeScale) }))
        .filter((c) => c.gradeLevels.length > 0)}
      tests={loaded.profile.tests}
      programHrefBase={`/career/pathways/programs/`}
      studentQuery={ctx.isStudent ? "" : `?student=${s.id}`}
    />
  );
}
