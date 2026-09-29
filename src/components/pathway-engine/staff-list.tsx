import { getTranslations } from "next-intl/server";
import { GraduationCap } from "lucide-react";
import type { CoursePlanStatus } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { personName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { Pill } from "@/components/app/badges";
import { StaffPathwayLinks } from "@/components/transcripts/views";

const PLAN_TONE: Record<CoursePlanStatus, "success" | "warning" | "neutral"> = { APPROVED: "success", PROPOSED: "warning", DRAFT: "neutral", ARCHIVED: "neutral" };

/** Staff entry point: Grade 9 to 12 students with their plan status, plans waiting for approval first. */
export async function StaffStudentList({ ctx, q, tab }: { ctx: Ctx; q: string; tab: string }) {
  const t = await getTranslations("engine");
  const { db, orgId, locale } = ctx;
  const needle = q.trim();
  const students = await db.student.findMany({
    where: {
      orgId,
      status: "ACTIVE",
      gradeLevel: { gte: 9 },
      ...(needle ? { OR: [{ firstNameEn: { contains: needle, mode: "insensitive" } }, { lastNameEn: { contains: needle, mode: "insensitive" } }, { firstNameAr: { contains: needle } }, { lastNameAr: { contains: needle } }] } : {}),
    },
    orderBy: [{ gradeLevel: "desc" }, { lastNameEn: "asc" }],
    take: 400,
  });
  const plans = await db.studentCoursePlan.findMany({ where: { orgId, studentId: { in: students.map((s) => s.id) }, status: { in: ["DRAFT", "PROPOSED", "APPROVED"] } }, orderBy: { updatedAt: "desc" } });
  const planBy = new Map<string, (typeof plans)[number]>();
  for (const p of plans) if (!planBy.has(p.studentId)) planBy.set(p.studentId, p);
  const rank = (id: string) => ({ PROPOSED: 0, DRAFT: 1, APPROVED: 2, ARCHIVED: 3 })[planBy.get(id)?.status ?? "ARCHIVED"] ?? 3;
  let rows = [...students].sort((a, b) => rank(a.id) - rank(b.id));
  if (tab === "awaiting") rows = rows.filter((s) => planBy.get(s.id)?.status === "PROPOSED");
  if (tab === "withPlan") rows = rows.filter((s) => planBy.has(s.id));
  const awaiting = students.filter((s) => planBy.get(s.id)?.status === "PROPOSED").length;

  return (
    <PageBody>
      <PageHeader title={t("title")} description={t("staff.desc")} actions={<StaffPathwayLinks ctx={ctx} />} />
      <FilterBar
        tabs={[
          { value: "all", label: t("staff.all"), count: students.length },
          { value: "awaiting", label: t("staff.awaiting"), count: awaiting },
          { value: "withPlan", label: t("staff.withPlan"), count: planBy.size },
        ]}
        searchPlaceholder={t("staff.search")}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<GraduationCap className="size-5" />} title={t("staff.empty")} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="pathway-students">
          {rows.map((s) => {
            const p = planBy.get(s.id);
            return (
              <li key={s.id}>
                <Link href={`/career/pathways/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30" data-testid="pathway-student">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{personName(s, locale)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t("staff.gradeLine", { grade: s.gradeLevel, curriculum: t(`curriculum.${s.curriculum}`) })}
                    </span>
                  </span>
                  {p ? <Pill tone={PLAN_TONE[p.status]} dot>{t(`planStatus.${p.status}`)}</Pill> : <Pill>{t("staff.noPlan")}</Pill>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageBody>
  );
}
