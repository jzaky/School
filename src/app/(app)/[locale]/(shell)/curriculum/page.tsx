import { getTranslations } from "next-intl/server";
import { BookOpen, CheckCircle2, CircleAlert, CircleDashed, Layers, Repeat } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Button } from "@/components/ui/button";
import { CurriculumNav } from "@/components/curriculum/curriculum-nav";
import { CoverageBadge } from "@/components/curriculum/badges";
import { DraftUnitDialog } from "@/components/curriculum/draft-unit";
import { canUseCurriculum, currentTerms, visiblePlanWhere } from "@/server/curriculum/access";
import { curriculumShell } from "@/server/curriculum/shell";
import { computeCoverage, heatLevel } from "@/server/curriculum/coverage";

export async function generateMetadata() {
  const t = await getTranslations("curriculum");
  return { title: t("coverage.title") };
}

const HEAT = ["bg-muted text-muted-foreground", "bg-brand/15 text-foreground", "bg-brand/35 text-foreground", "bg-brand/60 text-white", "bg-brand text-white"];

export default async function CoveragePage({ searchParams }: { searchParams: Promise<{ fw?: string; class?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("curriculum");
  if (!canUseCurriculum(ctx)) {
    return (
      <PageBody>
        <EmptyState icon={<BookOpen className="size-5" />} title={t("noAccess")} body={t("noAccessBody")} />
      </PageBody>
    );
  }
  const { db, locale } = ctx;
  const prefs = await formatPrefs(ctx);
  const [shell, frameworks, terms, subjects] = await Promise.all([
    curriculumShell(ctx),
    db.curriculumFramework.findMany({ orderBy: [{ gradeLevel: "asc" }, { nameEn: "asc" }], include: { _count: { select: { standards: true } } } }),
    currentTerms(ctx),
    db.subject.findMany(),
  ]);

  if (!frameworks.length) {
    return (
      <PageBody>
        <PageHeader title={t("coverage.title")} description={t("coverage.subtitle")} actions={<CurriculumNav tabs={shell.tabs} reviewCount={shell.reviewCount} />} />
        <EmptyState
          icon={<BookOpen className="size-5" />}
          title={t("coverage.noFrameworks")}
          body={ctx.can("curriculum.manage") ? t("coverage.noFrameworksManage") : t("coverage.noFrameworksBody")}
          action={
            ctx.can("curriculum.manage") ? (
              <Button asChild>
                <Link href="/curriculum/frameworks">{t("frameworks.title")}</Link>
              </Button>
            ) : undefined
          }
        />
      </PageBody>
    );
  }

  // Default to a framework the member plans for, then one for a class they teach.
  let fw = frameworks.find((f) => f.id === sp.fw);
  if (!fw) {
    const mine = await db.lessonPlan.findFirst({ where: { authorId: ctx.membershipId }, orderBy: { updatedAt: "desc" } });
    const taught = mine ? null : await db.schoolClass.findFirst({ where: { teacherMembershipId: ctx.membershipId, isHomeroom: false, subjectId: { in: frameworks.map((f) => f.subjectId).filter(Boolean) as string[] } } });
    fw = frameworks.find((f) => (mine ? f.subjectId === mine.subjectId && f.gradeLevel === mine.gradeLevel : taught ? f.subjectId === taught.subjectId && f.gradeLevel === taught.gradeLevel : false)) ?? frameworks[0];
  }
  const subject = subjects.find((s) => s.id === fw.subjectId);
  const [standards, classes] = await Promise.all([
    db.curriculumStandard.findMany({ where: { frameworkId: fw.id }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    fw.subjectId && fw.gradeLevel !== null ? db.schoolClass.findMany({ where: { subjectId: fw.subjectId, gradeLevel: fw.gradeLevel, academicYear: { isCurrent: true } }, orderBy: { nameEn: "asc" } }) : Promise.resolve([]),
  ]);
  const cls = classes.find((c) => c.id === sp.class) ?? null;
  const plans = standards.length
    ? await db.lessonPlan.findMany({
        where: { subjectId: fw.subjectId ?? "", gradeLevel: fw.gradeLevel ?? -1, ...(cls ? { classId: cls.id } : {}), standards: { some: { standard: { frameworkId: fw.id } } } },
        select: { id: true, status: true, termId: true, plannedFor: true, titleEn: true, titleAr: true, authorId: true, standards: { select: { standardId: true } } },
      })
    : [];
  const report = computeCoverage(
    standards,
    plans.map((p) => ({ id: p.id, status: p.status, termId: p.termId, plannedFor: p.plannedFor, standardIds: p.standards.map((s) => s.standardId) })),
    terms,
  );
  const visibleIds = new Set(
    (await db.lessonPlan.findMany({ where: { AND: [visiblePlanWhere(ctx), { id: { in: plans.map((p) => p.id) } }] }, select: { id: true } })).map((p) => p.id),
  );
  const planById = new Map(plans.map((p) => [p.id, p]));
  const std = new Map(standards.map((s) => [s.id, s]));
  const missing = report.missing.map((id) => std.get(id)!);
  const once = report.once.map((id) => std.get(id)!);
  const q = (next: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { fw: fw.id, class: cls?.id ?? null, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/curriculum?${p.toString()}`;
  };
  const canPlan = ctx.can("curriculum.plan");

  return (
    <PageBody>
      <PageHeader title={t("coverage.title")} description={t("coverage.subtitle")} actions={<CurriculumNav tabs={shell.tabs} reviewCount={shell.reviewCount} />} />

      <div className="space-y-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1" data-testid="framework-picker">
          {frameworks.map((f) => (
            <Link
              key={f.id}
              href={q({ fw: f.id, class: null })}
              className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition", f.id === fw.id ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:bg-muted")}
            >
              {pick(locale, f.nameEn, f.nameAr)}
            </Link>
          ))}
        </div>
        {classes.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <Link href={q({ class: null })} className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-medium", !cls ? "border-foreground/30 bg-muted" : "bg-card hover:bg-muted")}>
              {t("coverage.allClasses")}
            </Link>
            {classes.map((c) => (
              <Link key={c.id} href={q({ class: c.id })} className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-medium", cls?.id === c.id ? "border-foreground/30 bg-muted" : "bg-card hover:bg-muted")}>
                {pick(locale, c.nameEn, c.nameAr)}
              </Link>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {subject ? pick(locale, subject.nameEn, subject.nameAr) : ""} · {t("gradeN", { grade: fw.gradeLevel ?? 0 })} · {cls ? pick(locale, cls.nameEn, cls.nameAr) : t("coverage.allClasses")}
          {fw.sourceEn ? ` · ${fw.sourceEn}` : ""}
        </p>
      </div>

      {standards.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-5" />}
          title={t("coverage.noStandards")}
          body={t("coverage.noStandardsBody")}
          action={
            ctx.can("curriculum.manage") ? (
              <Button asChild>
                <Link href={`/curriculum/frameworks/${fw.id}`}>{t("coverage.addStandards")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t("coverage.statCovered")} value={`${fmtNumber(prefs, report.summary.percent)}%`} hint={t("coverage.statCoveredHint", { covered: report.summary.total - report.summary.missing, total: report.summary.total })} icon={<CheckCircle2 className="size-4" />} tone="success" testId="stat-covered" />
            <StatCard label={t("coverage.statMissing")} value={fmtNumber(prefs, report.summary.missing)} icon={<CircleAlert className="size-4" />} tone={report.summary.missing ? "danger" : "success"} testId="stat-missing" />
            <StatCard label={t("coverage.statOnce")} value={fmtNumber(prefs, report.summary.once)} hint={t("coverage.statOnceHint")} icon={<CircleDashed className="size-4" />} tone="warning" />
            <StatCard label={t("coverage.statApproved")} value={fmtNumber(prefs, report.summary.approved)} hint={t("coverage.statApprovedHint")} icon={<Repeat className="size-4" />} tone="info" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Panel className="min-w-0">
              <PanelHeader
                title={t("coverage.missingTitle")}
                description={t("coverage.missingBody")}
                action={canPlan && missing.length ? <DraftUnitDialog frameworkId={fw.id} standards={missing.map((s) => ({ id: s.id, code: s.code, text: pick(locale, s.descEn, s.descAr), strand: pick(locale, s.strandEn, s.strandAr) }))} classes={classes.map((c) => ({ id: c.id, label: pick(locale, c.nameEn, c.nameAr) }))} defaultClassId={cls?.id ?? (classes.length === 1 ? classes[0].id : null)} terms={terms.map((x) => ({ id: x.id, label: pick(locale, x.nameEn, x.nameAr) }))} /> : undefined}
              />
              {missing.length === 0 ? (
                <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">{t("coverage.nothingMissing")}</p>
              ) : (
                <ul className="divide-y" data-testid="missing-list">
                  {missing.map((s) => (
                    <li key={s.id} className="flex gap-3 py-2.5">
                      <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground" dir="ltr">
                        {s.code}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm">{pick(locale, s.descEn, s.descAr)}</div>
                        <div className="text-xs text-muted-foreground">{pick(locale, s.strandEn, s.strandAr)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel className="min-w-0">
              <PanelHeader title={t("coverage.heatmapTitle")} description={t("coverage.heatmapBody")} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] border-separate border-spacing-1 text-xs" data-testid="coverage-heatmap">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="text-start font-medium">{t("coverage.strand")}</th>
                      {terms.map((term) => (
                        <th key={term.id} className="font-medium">
                          {pick(locale, term.nameEn, term.nameAr)}
                        </th>
                      ))}
                      <th className="font-medium">{t("coverage.year")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.strands.map((row) => (
                      <tr key={row.strandEn}>
                        <td className="max-w-[160px] pe-2 text-sm">{pick(locale, row.strandEn, row.strandAr)}</td>
                        {terms.map((term) => {
                          const n = row.byTerm[term.id] ?? 0;
                          return (
                            <td key={term.id} className={cn("h-9 rounded-md text-center tabular-nums", HEAT[heatLevel(n, row.total)])} title={t("coverage.cellHint", { count: n, total: row.total })}>
                              {n}/{row.total}
                            </td>
                          );
                        })}
                        <td className={cn("h-9 rounded-md text-center font-medium tabular-nums", HEAT[heatLevel(row.covered, row.total)])}>
                          {row.covered}/{row.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>{t("coverage.legendLow")}</span>
                {HEAT.map((h, i) => (
                  <span key={i} className={cn("size-4 rounded", h)} />
                ))}
                <span>{t("coverage.legendHigh")}</span>
              </div>
            </Panel>
          </div>

          {once.length > 0 && (
            <Panel>
              <PanelHeader title={t("coverage.onceTitle")} description={t("coverage.onceBody")} />
              <div className="flex flex-wrap gap-2">
                {once.map((s) => (
                  <span key={s.id} className="rounded-md border bg-warning-soft/50 px-2 py-1 text-xs" title={pick(locale, s.descEn, s.descAr)} dir="ltr">
                    {s.code}
                  </span>
                ))}
              </div>
            </Panel>
          )}

          <Panel padded={false}>
            <div className="border-b px-5 py-3">
              <h2 className="text-sm font-semibold">{t("coverage.allStandards")}</h2>
            </div>
            <ul className="divide-y" data-testid="standards-coverage">
              {standards.map((s) => {
                const c = report.byId.get(s.id)!;
                const links = c.planIds.filter((id) => visibleIds.has(id)).slice(0, 3);
                return (
                  <li key={s.id} className="grid gap-2 px-4 py-3 sm:px-5 md:grid-cols-[110px_minmax(0,1fr)_120px_minmax(0,220px)] md:items-center">
                    <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                      {s.code}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm">{pick(locale, s.descEn, s.descAr)}</div>
                      <div className="text-xs text-muted-foreground">{pick(locale, s.strandEn, s.strandAr)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <CoverageBadge status={c.status} />
                      {c.count > 0 && <span className="text-xs text-muted-foreground">{t("coverage.lessonCount", { count: c.count, approved: c.approvedCount })}</span>}
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {links.map((id) => {
                        const p = planById.get(id)!;
                        return (
                          <Link key={id} href={`/curriculum/plans/${id}`} className="truncate text-xs text-brand hover:underline">
                            {pick(locale, p.titleEn, p.titleAr)}
                          </Link>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </>
      )}
    </PageBody>
  );
}
