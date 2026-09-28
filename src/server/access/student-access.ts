import type { Ctx } from "@/server/context";

/**
 * Which students the member may see. null means every student in the school (staff with people.view).
 * Parents see only their linked children, students only themselves.
 */
export async function visibleStudentIds(ctx: Ctx): Promise<string[] | null> {
  if (ctx.isStudent) return ctx.membership.student ? [ctx.membership.student.id] : [];
  if (ctx.isParent) return ctx.membership.guardian?.links.map((l) => l.studentId) ?? [];
  if (ctx.can("people.view")) return null;
  return [];
}

export async function canSeeStudent(ctx: Ctx, studentId: string) {
  const ids = await visibleStudentIds(ctx);
  return ids === null || ids.includes(studentId);
}
