import "server-only";
import type { Ctx } from "@/server/context";
import { getTranslations } from "next-intl/server";
import { personName } from "@/lib/i18n-data";
import { gradeLabel } from "@/lib/grade-levels";
import { canConfirm, pathwayStudentIds, resolvePathwayStudent } from "./access";
import { loadStudentPathway } from "./profile";

/** The student in focus for pathway pages, their loaded data and the picker options. */
export async function pathwayFocus(ctx: Ctx, requested?: string | null) {
  const ids = await pathwayStudentIds(ctx);
  const student = await resolvePathwayStudent(ctx, requested);
  const data = student ? await loadStudentPathway(ctx.db, ctx.orgId, student.id) : null;
  let options: Array<{ value: string; label: string }> = [];
  // Advising staff search the whole Grade 9 to 12 cohort on the server; the options hold only the student in focus.
  const search = ids === null;
  if (search) {
    if (student) {
      const tg = await getTranslations("gradeLevel");
      options = [{ value: student.id, label: `${personName(student, ctx.locale)} (${gradeLabel(tg, student.gradeLevel, student.section, { short: true })})` }];
    }
  } else if (ids.length > 1) {
    const rows = await ctx.db.student.findMany({ where: { orgId: ctx.orgId, id: { in: ids } }, orderBy: { gradeLevel: "desc" } });
    options = rows.map((s) => ({ value: s.id, label: personName(s, ctx.locale) }));
  }
  return { student, data, options, search, isAdvisor: canConfirm(ctx), canAdd: !!student && !ctx.isParent };
}

export const withStudent = (href: string, studentId: string | null | undefined, self: boolean) => (studentId && !self ? `${href}${href.includes("?") ? "&" : "?"}student=${studentId}` : href);
