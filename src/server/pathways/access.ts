import "server-only";
import type { Ctx } from "@/server/context";
import { visibleStudentIds } from "@/server/access/student-access";
import { PATHWAY_MIN_GRADE } from "@/lib/grade-levels";

/** Staff who confirm results and scores entered by students and parents. */
export const canConfirm = (ctx: Ctx) => ctx.isStaff && (ctx.can("pathways.manage") || ctx.can("career.advise"));

/** Students whose pathway this member may open: self, own children, or any student for advising staff. */
export async function pathwayStudentIds(ctx: Ctx): Promise<string[] | null> {
  if (!ctx.can("pathways.view")) return [];
  if (ctx.isStudent || ctx.isParent) return (await visibleStudentIds(ctx)) ?? [];
  if (canConfirm(ctx) && ctx.can("people.view")) return null;
  return [];
}

/** Resolve the student in focus. Students always get themselves; parents default to their first child. */
export async function resolvePathwayStudent(ctx: Ctx, requested?: string | null) {
  const ids = await pathwayStudentIds(ctx);
  if (ids !== null && ids.length === 0) return null;
  const id = requested && (ids === null || ids.includes(requested)) ? requested : null;
  // Parents plan with children in Grade 9 and above (students keep their own page at any grade).
  const minGrade = ctx.isParent ? { gradeLevel: { gte: PATHWAY_MIN_GRADE } } : {};
  if (id) return ctx.db.student.findFirst({ where: { id, orgId: ctx.orgId, ...minGrade } });
  if (ids === null) return null;
  // Parents with several children start with the oldest, who is closest to applying.
  return ctx.db.student.findFirst({ where: { id: { in: ids }, orgId: ctx.orgId, ...minGrade }, orderBy: { gradeLevel: "desc" } });
}

/** May this member change results and scores for the student? Students and parents edit their own, advising staff anyone. */
export async function canEditFor(ctx: Ctx, studentId: string) {
  const ids = await pathwayStudentIds(ctx);
  if (ids === null) return true;
  return ids.includes(studentId);
}
