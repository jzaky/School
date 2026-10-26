import { getTranslations } from "next-intl/server";
import { GraduationCap, Search } from "lucide-react";
import type { CoursePlanStatus, Prisma } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { personName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { Pill } from "@/components/app/badges";
import { StaffPathwayLinks } from "@/components/transcripts/views";
import { Pager, pageHref } from "@/components/app/pager";
import { formatPrefs } from "@/server/format";
import { gradeLabel, PATHWAY_MIN_GRADE } from "@/lib/grade-levels";
import { pageWindow, searchTerm } from "@/server/common/paging";
import { studentSearchWhere } from "@/server/students/grade-options";

const PLAN_TONE: Record<CoursePlanStatus, "success" | "warning" | "neutral"> = { APPROVED: "success", PROPOSED: "warning", DRAFT: "neutral", ARCHIVED: "neutral" };

/**
 * Staff entry point: Grade 9 to 12 students with their plan status, plans waiting for approval first. Paged on the
 * server with real counts, so a 400-student senior school lists everyone.
 */
export async function StaffStudentList({ ctx, q, tab, page }: { ctx: Ctx; q: string; tab: string; page?: string }) {
  const t = await getTranslations("engine");
  const td = await getTranslations("discovery");
  const tg = await getTranslations("gradeLevel");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, locale } = ctx;
  const needle = searchTerm(q);
  const base: Prisma.StudentWhereInput = { orgId, status: "ACTIVE", gradeLevel: { gte: PATHWAY_MIN_GRADE }, ...(needle ? studentSearchWhere(needle) : {}) };
  // Latest plan per student (a school has at most a few hundred plans).
  const plans = await db.studentCoursePlan.findMany({ where: { orgId, status: { in: ["DRAFT", "PROPOSED", "APPROVED"] } }, select: { studentId: true, status: true }, orderBy: { updatedAt: "desc" } });
  const planBy = new Map<string, (typeof plans)[number]>();
  for (const p of plans) if (!planBy.has(p.studentId)) planBy.set(p.studentId, p);
  const proposedIds = [...planBy.values()].filter((p) => p.status === "PROPOSED").map((p) => p.studentId);
  const plannedIds = [...planBy.keys()];
  const order: Prisma.StudentOrderByWithRelationInput[] = [{ gradeLevel: "desc" }, { lastNameEn: "asc" }, { id: "asc" }];
  const [allCount, awaiting, withPlan] = await Promise.all([
    db.student.count({ where: base }),
    db.student.count({ where: { AND: [base, { id: { in: proposedIds } }] } }),
    db.student.count({ where: { AND: [base, { id: { in: plannedIds } }] } }),
  ]);
  let rows: Awaited<ReturnType<typeof db.student.findMany>> = [];
  let win;
  if (tab === "awaiting" || tab === "withPlan") {
    const where = { AND: [base, { id: { in: tab === "awaiting" ? proposedIds : plannedIds } }] };
    win = pageWindow(page, tab === "awaiting" ? awaiting : withPlan);
    rows = await db.student.findMany({ where, orderBy: order, skip: win.skip, take: win.take });
  } else {
    // Waiting plans first, then everyone else: page across the two lists.
    win = pageWindow(page, allCount);
    const first = win.skip < awaiting ? await db.student.findMany({ where: { AND: [base, { id: { in: proposedIds } }] }, orderBy: order, skip: win.skip, take: win.take }) : [];
    const rest = win.take - first.length;
    const second = rest > 0 ? await db.student.findMany({ where: { AND: [base, { id: { notIn: proposedIds } }] }, orderBy: order, skip: Math.max(0, win.skip - awaiting), take: rest }) : [];
    rows = [...first, ...second];
  }
  const keep = { q: q || undefined, tab: tab === "all" ? undefined : tab };

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("staff.desc")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/career/pathways/search" className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium shadow-xs hover:bg-muted" data-testid="open-search">
              <Search className="size-4" />
              {td("findProgrammes")}
            </Link>
            <StaffPathwayLinks ctx={ctx} />
          </div>
        }
      />
      <FilterBar
        tabs={[
          { value: "all", label: t("staff.all"), count: allCount },
          { value: "awaiting", label: t("staff.awaiting"), count: awaiting },
          { value: "withPlan", label: t("staff.withPlan"), count: withPlan },
        ]}
        searchPlaceholder={t("staff.search")}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<GraduationCap className="size-5" />} title={t("staff.empty")} />
      ) : (
        <>
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="pathway-students">
          {rows.map((s) => {
            const p = planBy.get(s.id);
            return (
              <li key={s.id}>
                <Link href={`/career/pathways/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30" data-testid="pathway-student">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{personName(s, locale)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {gradeLabel(tg, s.gradeLevel, s.section)} · {t(`curriculum.${s.curriculum}`)}
                    </span>
                  </span>
                  {p ? <Pill tone={PLAN_TONE[p.status]} dot>{t(`planStatus.${p.status}`)}</Pill> : <Pill>{t("staff.noPlan")}</Pill>}
                </Link>
              </li>
            );
          })}
        </ul>
        <Pager win={win} prefs={prefs} href={(n) => pageHref("/career/pathways", keep, n)} />
        </>
      )}
    </PageBody>
  );
}
