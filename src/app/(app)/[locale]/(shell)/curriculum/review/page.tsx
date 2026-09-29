import { getTranslations } from "next-intl/server";
import { ClipboardCheck, Inbox } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtRelative } from "@/lib/format";
import { pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader, SectionTitle } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { CurriculumNav } from "@/components/curriculum/curriculum-nav";
import { AiDraftedBadge, PlanStatusBadge } from "@/components/curriculum/badges";
import { reviewScope, reviewScopeWhere } from "@/server/curriculum/access";
import { curriculumShell } from "@/server/curriculum/shell";

export async function generateMetadata() {
  const t = await getTranslations("curriculum");
  return { title: t("review.title") };
}

export default async function ReviewQueuePage() {
  const ctx = await getCtx();
  const t = await getTranslations("curriculum");
  if (!ctx.isStaff || !ctx.can("curriculum.review")) {
    return (
      <PageBody>
        <EmptyState icon={<ClipboardCheck className="size-5" />} title={t("noAccess")} body={t("review.noAccessBody")} />
      </PageBody>
    );
  }
  const { db, locale } = ctx;
  const prefs = await formatPrefs(ctx);
  const scope = await reviewScope(ctx);
  const [shell, waiting, recent] = await Promise.all([
    curriculumShell(ctx),
    db.lessonPlan.findMany({ where: { AND: [reviewScopeWhere(scope), { status: "SUBMITTED", authorId: { not: ctx.membershipId } }] }, orderBy: { updatedAt: "asc" }, include: { _count: { select: { standards: true } } } }),
    db.lessonPlan.findMany({ where: { reviewerId: ctx.membershipId, status: { in: ["APPROVED", "CHANGES_REQUESTED"] } }, orderBy: { reviewedAt: "desc" }, take: 10 }),
  ]);
  const all = [...waiting, ...recent];
  const [subjects, classes, authors] = await Promise.all([
    db.subject.findMany({ where: { id: { in: [...new Set(all.map((p) => p.subjectId))] } } }),
    db.schoolClass.findMany({ where: { id: { in: [...new Set(all.map((p) => p.classId).filter(Boolean) as string[])] } } }),
    db.membership.findMany({ where: { id: { in: [...new Set(all.map((p) => p.authorId))] } }, include: { user: true } }),
  ]);
  const label = (p: (typeof all)[number]) => {
    const s = subjects.find((x) => x.id === p.subjectId);
    const c = classes.find((x) => x.id === p.classId);
    return [s ? pick(locale, s.nameEn, s.nameAr) : null, c ? pick(locale, c.nameEn, c.nameAr) : t("gradeN", { grade: p.gradeLevel })].filter(Boolean).join(" · ");
  };
  const author = (id: string) => userName(authors.find((a) => a.id === id)?.user, locale);
  const noScope = !scope.all && scope.subjectIds.length === 0;

  return (
    <PageBody>
      <PageHeader title={t("review.title")} description={t("review.subtitle")} actions={<CurriculumNav tabs={shell.tabs} reviewCount={shell.reviewCount} />} />
      <section>
        <SectionTitle>{t("review.waiting", { count: waiting.length })}</SectionTitle>
        {waiting.length === 0 ? (
          <EmptyState icon={<Inbox className="size-5" />} title={noScope ? t("review.noScope") : t("review.empty")} body={noScope ? t("review.noScopeBody") : t("review.emptyBody")} />
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="review-queue">
            {waiting.map((p) => (
              <li key={p.id}>
                <Link href={`/curriculum/plans/${p.id}`} className="flex flex-col gap-2 px-4 py-3.5 hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{pick(locale, p.titleEn, p.titleAr)}</span>
                      {p.aiDrafted && <AiDraftedBadge />}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {label(p)} · {author(p.authorId)} · {t("plans.standardsCount", { count: p._count.standards })}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {t("review.submittedAgo", { when: fmtRelative(prefs, p.updatedAt) })}
                    <PlanStatusBadge status={p.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {recent.length > 0 && (
        <section>
          <SectionTitle>{t("review.recent")}</SectionTitle>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
            {recent.map((p) => (
              <li key={p.id}>
                <Link href={`/curriculum/plans/${p.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    <div className="text-sm">{pick(locale, p.titleEn, p.titleAr)}</div>
                    <div className="text-xs text-muted-foreground">
                      {label(p)} · {author(p.authorId)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {p.reviewedAt ? fmtDate(prefs, p.reviewedAt, "short") : ""}
                    <PlanStatusBadge status={p.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageBody>
  );
}
