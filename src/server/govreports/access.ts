// Who may do what with government returns.
// - government.reports (school administrator, registrar): prepare returns, fix problems, export, log submissions
//   and keep the due date calendar.
// - government.view (principal): see returns, the submission log and due dates, download the summary PDF and sign
//   off a return.
// - Full Emirates ID numbers in an export also need people.reveal_ids, and that download is audited.
import type { Permission } from "@/server/identity/permissions";

type C = { isStaff: boolean; can: (p: Permission) => boolean };

export class GovError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export const canPrepare = (ctx: C) => ctx.isStaff && ctx.can("government.reports");
export const canView = (ctx: C) => ctx.isStaff && (ctx.can("government.reports") || ctx.can("government.view"));
export const canSignOff = (ctx: C) => ctx.isStaff && ctx.can("government.view");
export const canExportIds = (ctx: C) => canPrepare(ctx) && ctx.can("people.reveal_ids");
/** Fixing a student's identity details is a change to the student record (people.manage). */
export const canFixStudent = (ctx: C) => ctx.isStaff && ctx.can("people.manage");
/** Recording a registration reference is the admissions enrollment step (admissions.enroll). */
export const canRecordReference = (ctx: C) => ctx.isStaff && ctx.can("admissions.enroll");
