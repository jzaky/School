import type { Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { BookOpen, NotebookPen, Plus } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate } from "@/lib/format";
import { pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { Button } from "@/components/ui/button";
import { CurriculumNav } from "@/components/curriculum/curriculum-nav";
import { AiDraftedBadge, PlanStatusBadge } from "@/components/curriculum/badges";
import { canUseCurriculum, visiblePlanWhere } from "@/server/curriculum/access";
import { curriculumShell } from "@/server/curriculum/shell";

export async function generateMetadata() {
  const t = await getTranslations("curriculum");
  return { title: t("plans.title") };
}

const STATUSES = ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED"] as const;

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; q?: string }> }) {
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
  const canPlan = ctx.can("curriculum.plan");
  const tab = sp.tab ?? (canPlan ? "mine" : "all");
  const status = STATUSES.find((s) => s === sp.status);
  const q = sp.q?.trim();
  const where: Prisma.LessonPlanWhereInput = {
    AND: [
      visiblePlanWhere(ctx),
      tab === "mine" ? { authorId: ctx.membershipId } : {},
      status ? { status } : {},
      q ? { OR: [{ titleEn: { contains: q, mode: "insensitive" } }, { titleAr: { contains: q } }] } : {},
    ],
  };
  const [shell, plans, mineCount] = await Promise.all([
    curriculumShell(ctx),
    db.lessonPlan.findMany({ where, orderBy: [{ plannedFor: "asc" }, { weekNo: "asc" }, { createdAt: "asc" }], take: 200, include: { _count: { select: { standards: true } } } }),
    db.lessonPlan.count({ where: { authorId: ctx.membershipId } }),
  ]);
  const [subjects, classes, authors] = await Promise.all([
    db.subject.findMany({ where: { id: { in: [...new Set(plans.map((p) => p.subjectId))] } } }),
    db.schoolClass.findMany({ where: { id: { in: [...new Set(plans.map((p) => p.classId).filter(Boolean) as string[])] } } }),
    db.membership.findMany({ where: { id: { in: [...new Set(plans.map((p) => p.authorId))] } }, include: { user: true } }),
  ]);

  return (
    <PageBody>
      <PageHeader
        title={t("plans.title")}
        description={t("plans.subtitle")}
        actions={
          <>
            <CurriculumNav tabs={shell.tabs} reviewCount={shell.reviewCount} />
            {canPlan && (
              <Button asChild data-testid="new-plan">
                <Link href="/curriculum/plans/new">
                  <Plus className="size-4" />
                  {t("plans.new")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <FilterBar
        tabs={canPlan ? [{ value: "mine", label: t("plans.tabMine"), count: mineCount }, { value: "all", label: t("plans.tabAll") }] : undefined}
        searchPlaceholder={t("plans.search")}
      />
      <FilterBar chips={[{ value: "", label: t("plans.allStatuses") }, ...STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))]} chipParam="status" />
      {plans.length === 0 ? (
        <EmptyState
          icon={<NotebookPen className="size-5" />}
          title={q || status ? t("plans.emptyFiltered") : t("plans.empty")}
          body={canPlan ? t("plans.emptyBody") : undefined}
          action={
            canPlan && !q && !status ? (
              <Button asChild>
                <Link href="/curriculum/plans/new">{t("plans.new")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="hidden grid-cols-[minmax(0,1fr)_170px_150px_150px] gap-3 border-b bg-muted/30 px-5 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
            <span>{t("plans.colLesson")}</span>
            <span>{t("plans.colClass")}</span>
            <span>{t("plans.colWhen")}</span>
            <span>{t("plans.colStatus")}</span>
          </div>
          <ul className="divide-y">
            {plans.map((p) => {
              const subject = subjects.find((s) => s.id === p.subjectId);
              const cls = classes.find((c) => c.id === p.classId);
              const author = authors.find((a) => a.id === p.authorId);
              return (
                <li key={p.id} data-testid="plan-row">
                  <Link href={`/curriculum/plans/${p.id}`} className="grid gap-2 px-4 py-3.5 hover:bg-muted/30 sm:px-5 lg:grid-cols-[minmax(0,1fr)_170px_150px_150px] lg:items-center lg:gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{pick(locale, p.titleEn, p.titleAr)}</span>
                        {p.aiDrafted && <AiDraftedBadge />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {subject ? pick(locale, subject.nameEn, subject.nameAr) : ""} · {t("gradeN", { grade: p.gradeLevel })} · {t("plans.standardsCount", { count: p._count.standards })}
                        {tab !== "mine" && author ? ` · ${userName(author.user, locale)}` : ""}
                      </div>
                    </div>
                    <div className="text-sm">{cls ? pick(locale, cls.nameEn, cls.nameAr) : <span className="text-muted-foreground">{t("plan.noClass")}</span>}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.weekNo ? t("plan.weekN", { week: p.weekNo }) : ""}
                      {p.weekNo && p.plannedFor ? " · " : ""}
                      {p.plannedFor ? fmtDate(prefs, p.plannedFor, "short") : ""}
                    </div>
                    <div>
                      <PlanStatusBadge status={p.status} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </PageBody>
  );
}
