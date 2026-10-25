// Privacy rules for absence reasons. Sick leave is private by design.
//
// Student absences reported by a family (service absence_request):
// - The family sees their own full request (reason, details, doctor's note).
// - The attendance team (attendance.reasons: registrar, school administrator, school nurse) and staff with
//   people.medical see the reason and the attachment.
// - Everyone else on staff (class teachers, the principal, heads of department) sees only that the absence is
//   excused and who reported it, on registers, attendance and the request itself. An approver of a planned
//   absence (for example the principal for a family trip) sees a non-medical reason, never a medical one.
//
// Staff absences (StaffAbsence, and the staff_leave service):
// - The private reason is seen by the absent person, whoever reported the absence and staff with absence.reasons
//   (school administrator, principal). Substitutes and colleagues see only the cover notes.
import type { AttendanceSource } from "@prisma/client";
import type { Ctx } from "@/server/context";

type Viewer = Pick<Ctx, "isStaff" | "membershipId" | "can">;

export type AbsencePrivacy = {
  subject: "student" | "staff";
  /** The form field that holds the kind of absence. */
  typeField: string;
  /** Form fields only the people above may read: the reason, its details and attachments. */
  privateFields: string[];
  /** Kinds that are medical: never shown to approvers outside the attendance or absence team. */
  medicalTypes: string[];
};

export const ABSENCE_SERVICES: Record<string, AbsencePrivacy> = {
  absence_request: { subject: "student", typeField: "absenceType", privateFields: ["absenceType", "details", "medicalNote"], medicalTypes: ["illness", "medical_appointment"] },
  staff_leave: { subject: "staff", typeField: "leaveType", privateFields: ["leaveType", "medicalCertificate"], medicalTypes: ["sick", "maternity"] },
};

export function absencePrivacy(serviceKey: string | null | undefined): AbsencePrivacy | null {
  return serviceKey ? (ABSENCE_SERVICES[serviceKey] ?? null) : null;
}

export function isMedicalAbsence(serviceKey: string, data: Record<string, unknown> | null | undefined) {
  const p = absencePrivacy(serviceKey);
  return Boolean(p && p.medicalTypes.includes(String(data?.[p.typeField] ?? "")));
}

/** Whether a staff member may see why students are absent (any student). */
export function seesStudentAbsenceReasons(ctx: Viewer) {
  return ctx.isStaff && (ctx.can("attendance.reasons") || ctx.can("people.medical"));
}

/**
 * Whether the viewer may read the reason, details and attachments of an absence request they can already
 * open (the caller has applied requestWhere). Requests of other services are not affected.
 */
export function canSeeAbsenceReason(
  ctx: Viewer,
  r: { requesterId: string; service: { key: string } },
  data: Record<string, unknown> | null | undefined,
  opts: { approver?: boolean } = {},
): boolean {
  const p = absencePrivacy(r.service.key);
  if (!p) return true;
  // Families only reach their own requests or their own children's (requestWhere).
  if (!ctx.isStaff) return true;
  if (r.requesterId === ctx.membershipId) return true;
  if (p.subject === "student" && seesStudentAbsenceReasons(ctx)) return true;
  if (p.subject === "staff" && ctx.can("absence.reasons")) return true;
  return Boolean(opts.approver) && !isMedicalAbsence(r.service.key, data);
}

/** Whether the viewer may see the private reason of a staff absence. */
export function canSeeStaffAbsenceReason(ctx: Viewer, a: { membershipId: string; reportedById: string }) {
  return ctx.isStaff && (a.membershipId === ctx.membershipId || a.reportedById === ctx.membershipId || ctx.can("absence.reasons"));
}

/** Message key (attendance namespace) for an excused mark, without any reason. */
export function excusedLabelKey(source: AttendanceSource) {
  return source === "PARENT" ? "excusedByParent" : source === "STUDENT" ? "excusedByStudent" : source === "OFFICE" ? "excusedByOffice" : "excused";
}
