import type { Ctx } from "@/server/context";

type AccessCtx = Pick<Ctx, "isStaff" | "isStudent" | "isParent" | "can" | "membership">;

/** Career advisors and counselors (career.advise) create and run events. */
export function canManageEvents(ctx: Pick<Ctx, "isStaff" | "can">) {
  return ctx.isStaff && ctx.can("career.advise");
}

/** Students the member may register: a student themself, a parent their linked children. */
export function actingStudents(ctx: AccessCtx): Array<{ id: string; gradeLevel: number; firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string; status: string }> {
  if (ctx.isStudent && ctx.membership.student) return ctx.membership.student.status === "ACTIVE" ? [ctx.membership.student] : [];
  if (ctx.isParent && ctx.membership.guardian) return ctx.membership.guardian.links.map((l) => l.student).filter((s) => s.status === "ACTIVE");
  return [];
}

export function canActFor(ctx: AccessCtx, studentId: string) {
  return actingStudents(ctx).some((s) => s.id === studentId);
}
