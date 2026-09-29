import "server-only";
import type { Ctx } from "@/server/context";
import { visibleStudentIds } from "@/server/access/student-access";

export type Viewer = "manager" | "student" | "parent" | "none";

/** How the member relates to applications: counselors and career advisors manage, students own, parents read. */
export function viewerOf(ctx: Ctx): Viewer {
  if (ctx.isStaff && ctx.can("applications.manage")) return "manager";
  if (ctx.isStudent && ctx.can("pathways.view")) return "student";
  if (ctx.isParent && ctx.can("pathways.view")) return "parent";
  return "none";
}

/** Students whose applications the member may read. null means every student in the school. */
export async function applicationStudentIds(ctx: Ctx): Promise<string[] | null> {
  const v = viewerOf(ctx);
  if (v === "manager") return null;
  if (v === "student" || v === "parent") return (await visibleStudentIds(ctx)) ?? [];
  return [];
}

/** Load one application if the member may read it. Scoped to the tenant and to the member's students. */
export async function readableApplication(ctx: Ctx, id: string) {
  const ids = await applicationStudentIds(ctx);
  if (ids !== null && ids.length === 0) return null;
  return ctx.db.application.findFirst({ where: { id, orgId: ctx.orgId, ...(ids === null ? {} : { studentId: { in: ids } }) }, include: { items: { orderBy: { id: "asc" } } } });
}

/** May the member change checklist items? Managers on any application, students on their own. Parents never. */
export async function canEditItems(ctx: Ctx, studentId: string) {
  const v = viewerOf(ctx);
  if (v === "manager") return true;
  return v === "student" && ctx.membership.student?.id === studentId;
}
