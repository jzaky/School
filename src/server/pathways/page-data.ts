import "server-only";
import type { Ctx } from "@/server/context";
import { personName } from "@/lib/i18n-data";
import { canConfirm, pathwayStudentIds, resolvePathwayStudent } from "./access";
import { loadStudentPathway } from "./profile";

/** The student in focus for pathway pages, their loaded data and the picker options. */
export async function pathwayFocus(ctx: Ctx, requested?: string | null) {
  const ids = await pathwayStudentIds(ctx);
  const student = await resolvePathwayStudent(ctx, requested);
  const data = student ? await loadStudentPathway(ctx.db, ctx.orgId, student.id) : null;
  let options: Array<{ value: string; label: string }> = [];
  if (ids === null) {
    // Advising staff: seniors first, then Grade 9 and 10.
    const rows = await ctx.db.student.findMany({ where: { orgId: ctx.orgId, gradeLevel: { gte: 9 }, status: "ACTIVE" }, orderBy: [{ gradeLevel: "desc" }, { lastNameEn: "asc" }], take: 400 });
    options = rows.map((s) => ({ value: s.id, label: `${personName(s, ctx.locale)} (${s.gradeLevel}${s.section ?? ""})` }));
  } else if (ids.length > 1) {
    const rows = await ctx.db.student.findMany({ where: { orgId: ctx.orgId, id: { in: ids } }, orderBy: { gradeLevel: "desc" } });
    options = rows.map((s) => ({ value: s.id, label: personName(s, ctx.locale) }));
  }
  return { student, data, options, isAdvisor: canConfirm(ctx), canAdd: !!student && !ctx.isParent };
}

export const withStudent = (href: string, studentId: string | null | undefined, self: boolean) => (studentId && !self ? `${href}${href.includes("?") ? "&" : "?"}student=${studentId}` : href);
