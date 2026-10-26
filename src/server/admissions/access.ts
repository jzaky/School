// Who may do what in admissions. Staff permissions:
// - admissions.view: the board, applications (without health details), waitlist, capacity, reports.
// - admissions.manage: stages, notes and messages, assessments, offers, payments, settings, re-enrollment, leavers.
// - admissions.enroll: create student records from applications and complete withdrawals.
// Health and learning support details follow the medical rules used for documents: people.medical or
// documents.sensitive, and every view writes an AuditEvent with sensitivity MEDICAL.
import type { Ctx } from "@/server/context";

type C = Pick<Ctx, "can" | "isStaff">;

export const canViewAdmissions = (ctx: C) => ctx.isStaff && ctx.can("admissions.view");
export const canManageAdmissions = (ctx: C) => ctx.isStaff && ctx.can("admissions.manage");
export const canEnroll = (ctx: C) => ctx.isStaff && ctx.can("admissions.enroll");
export const canSeeHealth = (ctx: C) => ctx.isStaff && (ctx.can("people.medical") || ctx.can("documents.sensitive"));
export const canRevealIds = (ctx: C) => ctx.isStaff && ctx.can("people.reveal_ids");

/** Document categories a staff member may open from an application. */
export function canOpenAdmissionDoc(ctx: C, category: string) {
  if (!canViewAdmissions(ctx)) return false;
  if (category === "medical") return canSeeHealth(ctx);
  return true;
}

export class AdmissionError extends Error {
  constructor(public code: string) {
    super(`admissions:${code}`);
  }
}
