// Career guidance report for families: assessment results, top matched careers, related university fields,
// the course plan status and next steps. Drawn as a bilingual PDF by report-pdf.ts.
import type { CoursePlanStatus } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";
import type { Permission } from "@/server/identity/permissions";
import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./dimensions";

type T = { en: string; ar: string };

export type ReportViewer = {
  isStudent: boolean;
  isParent: boolean;
  isStaff: boolean;
  can: (p: Permission) => boolean;
  /** Students this member may see; null means every student (staff with people.view). */
  visibleStudentIds: string[] | null;
};

/**
 * Who may download a student's career report: the student, their own parents, and staff who advise on
 * careers or university planning and can see the student. Returns the audience, which decides whether
 * matches still waiting for the advisor's review are included (never for families).
 */
export function careerReportAudience(v: ReportViewer, studentId: string): "family" | "student" | "staff" | null {
  const visible = v.visibleStudentIds === null || v.visibleStudentIds.includes(studentId);
  if (v.isStudent) return visible && v.visibleStudentIds !== null ? "student" : null;
  if (v.isParent) return visible && v.visibleStudentIds !== null ? "family" : null;
  if (v.isStaff && visible && (v.can("career.advise") || v.can("pathways.view"))) return "staff";
  return null;
}

export type CareerReportData = {
  school: T;
  student: T & { studentNo: string; grade: string };
  issuedAt: string;
  assessment: { completedAt: string; scores: Array<T & { key: Dimension; score: number }> } | null;
  careers: Array<T & { cluster: T; score: number; reviewed: boolean; chosen: boolean }>;
  fields: T[];
  plan: { name: string; status: CoursePlanStatus; approvedAt: string | null; courses: number; grades: string; goal: T | null } | null;
  nextSteps: T[];
};

export const PLAN_STATUS: Record<CoursePlanStatus, T> = {
  DRAFT: { en: "Draft, not yet sent for approval", ar: "مسودة لم تُرسل للاعتماد بعد" },
  PROPOSED: { en: "Sent to the counselor for approval", ar: "أُرسلت إلى المرشد للاعتماد" },
  APPROVED: { en: "Approved by the school", ar: "معتمدة من المدرسة" },
  ARCHIVED: { en: "Archived", ar: "مؤرشفة" },
};

/** Next steps from where the student is. Pure, so it can be tested on its own. */
export function nextStepsFor(input: { hasAssessment: boolean; reviewedCount: number; pendingCount: number; chosen: boolean; plan: CoursePlanStatus | null; shortlist: number; grade: number }): T[] {
  const steps: T[] = [];
  if (!input.hasAssessment) steps.push({ en: "Complete the career interests assessment in the school portal.", ar: "إكمال تقييم الميول المهنية في بوابة المدرسة." });
  if (input.pendingCount > 0 && input.reviewedCount === 0) steps.push({ en: "The career advisor will review the matches and share them with the family.", ar: "سيراجع المرشد المهني المهن المقترحة ويشاركها مع الأسرة." });
  if (input.reviewedCount > 0 && !input.chosen) steps.push({ en: "Discuss the top matches at home and choose a career to explore further.", ar: "مناقشة أفضل المهن المقترحة في المنزل واختيار مهنة لاستكشافها أكثر." });
  if (input.chosen) steps.push({ en: "Book a meeting with the career advisor to plan the next steps for the chosen career.", ar: "حجز لقاء مع المرشد المهني لتخطيط الخطوات التالية للمهنة المختارة." });
  if (input.plan === null) steps.push({ en: "Build a course plan for the coming years in University planning.", ar: "إعداد خطة المواد للسنوات القادمة في قسم التخطيط الجامعي." });
  else if (input.plan === "DRAFT") steps.push({ en: "Finish the course plan and send it to the counselor for approval.", ar: "إكمال خطة المواد وإرسالها إلى المرشد للاعتماد." });
  else if (input.plan === "PROPOSED") steps.push({ en: "Wait for the counselor to approve the course plan, then follow it when choosing subjects.", ar: "انتظار اعتماد المرشد لخطة المواد ثم الالتزام بها عند اختيار المواد." });
  else if (input.plan === "APPROVED") steps.push({ en: "Follow the approved course plan and review it with the counselor each term.", ar: "الالتزام بخطة المواد المعتمدة ومراجعتها مع المرشد كل فصل دراسي." });
  if (input.grade >= 10) {
    steps.push(
      input.shortlist > 0
        ? { en: "Check the entry requirements of the shortlisted universities against current grades.", ar: "مقارنة شروط القبول في الجامعات المختارة بالدرجات الحالية." }
        : { en: "Start a university shortlist that matches the related fields of study.", ar: "البدء بقائمة جامعات تناسب مجالات الدراسة المرتبطة." },
    );
  }
  return steps.slice(0, 5);
}

const MAX_CAREERS = 5;
const MAX_FIELDS = 6;

export async function buildCareerReport(db: TenantDb, orgId: string, studentId: string, audience: "family" | "student" | "staff", now = new Date()): Promise<CareerReportData | null> {
  const [student, org] = await Promise.all([db.student.findUnique({ where: { id: studentId } }), db.organization.findUnique({ where: { id: orgId }, select: { nameEn: true, nameAr: true } })]);
  if (!student || !org) return null;
  const [assessment, recs, profile, plan, shortlist] = await Promise.all([
    db.aptitudeAssessment.findFirst({ where: { studentId, completedAt: { not: null } }, orderBy: { completedAt: "desc" } }),
    db.careerRecommendation.findMany({
      // Families only ever see matches the career advisor has approved.
      where: { studentId, status: audience === "family" ? "APPROVED" : { in: ["APPROVED", "DRAFT"] } },
      include: { career: true },
      orderBy: { rank: "asc" },
    }),
    db.careerProfile.findUnique({ where: { studentId } }),
    db.studentCoursePlan.findFirst({ where: { studentId, status: { not: "ARCHIVED" } }, orderBy: { updatedAt: "desc" }, include: { items: { select: { gradeLevel: true } } } }),
    db.shortlistEntry.count({ where: { studentId } }),
  ]);
  // One row per career: an approved match wins over a draft of the same career.
  const seen = new Set<string>();
  const ordered = [...recs].sort((a, b) => Number(b.status === "APPROVED") - Number(a.status === "APPROVED") || a.rank - b.rank);
  const top = ordered.filter((r) => (seen.has(r.careerId) ? false : (seen.add(r.careerId), true))).slice(0, MAX_CAREERS);
  const careers = top.map((r) => ({
    en: r.career.titleEn,
    ar: r.career.titleAr,
    cluster: { en: r.career.clusterEn, ar: r.career.clusterAr },
    score: r.matchScore,
    reviewed: r.status === "APPROVED",
    chosen: profile?.chosenCareerId === r.careerId,
  }));

  // Related university fields: weighted by career rank and the career's link weight.
  const keys = top.slice(0, 3).map((r) => r.career.key);
  const goalKey = plan?.goalCareerKey ?? null;
  const links = keys.length || goalKey ? await db.careerField.findMany({ where: { careerKey: { in: [...keys, ...(goalKey ? [goalKey] : [])] } } }) : [];
  const weight = new Map<string, number>();
  for (const l of links) {
    const rank = keys.indexOf(l.careerKey);
    const factor = rank === -1 ? 1 : 3 - rank;
    weight.set(l.fieldKey, (weight.get(l.fieldKey) ?? 0) + l.weight * factor);
  }
  const fieldKeys = [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k).slice(0, MAX_FIELDS);
  const fieldRows = fieldKeys.length ? await db.fieldOfStudy.findMany({ where: { key: { in: fieldKeys } } }) : [];
  const fields = fieldKeys.map((k) => fieldRows.find((f) => f.key === k)).filter((f): f is NonNullable<typeof f> => Boolean(f)).map((f) => ({ en: f.nameEn, ar: f.nameAr }));

  const goalCareer = goalKey ? await db.career.findFirst({ where: { key: goalKey } }) : null;
  const gradesInPlan = [...new Set(plan?.items.map((i) => i.gradeLevel) ?? [])].sort((a, b) => a - b);

  const scores = (assessment?.scores ?? null) as Partial<Record<Dimension, number>> | null;
  return {
    school: { en: org.nameEn, ar: org.nameAr || org.nameEn },
    student: {
      en: `${student.firstNameEn} ${student.lastNameEn}`,
      ar: `${student.firstNameAr || student.firstNameEn} ${student.lastNameAr || student.lastNameEn}`,
      studentNo: student.studentNo,
      grade: `${student.gradeLevel}${student.section ?? ""}`,
    },
    issuedAt: now.toISOString(),
    assessment:
      assessment?.completedAt && scores
        ? {
            completedAt: assessment.completedAt.toISOString(),
            scores: DIMENSIONS.map((key) => ({ key, ...DIMENSION_LABELS[key], score: Math.round(scores[key] ?? 0) })).sort((a, b) => b.score - a.score),
          }
        : null,
    careers,
    fields,
    plan: plan
      ? {
          name: plan.name,
          status: plan.status,
          approvedAt: plan.approvedAt?.toISOString() ?? null,
          courses: plan.items.length,
          grades: gradesInPlan.length ? (gradesInPlan.length > 1 ? `${gradesInPlan[0]}-${gradesInPlan[gradesInPlan.length - 1]}` : `${gradesInPlan[0]}`) : "",
          goal: goalCareer ? { en: goalCareer.titleEn, ar: goalCareer.titleAr } : null,
        }
      : null,
    nextSteps: nextStepsFor({
      hasAssessment: Boolean(assessment?.completedAt),
      reviewedCount: careers.filter((c) => c.reviewed).length,
      pendingCount: audience === "family" ? await db.careerRecommendation.count({ where: { studentId, status: "DRAFT" } }) : careers.filter((c) => !c.reviewed).length,
      chosen: careers.some((c) => c.chosen),
      plan: plan?.status ?? null,
      shortlist,
      grade: student.gradeLevel,
    }),
  };
}
