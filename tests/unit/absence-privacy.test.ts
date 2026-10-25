import { describe, expect, it } from "vitest";
import { canSeeAbsenceReason, canSeeStaffAbsenceReason, excusedLabelKey, isMedicalAbsence, seesStudentAbsenceReasons } from "@/server/access/absence-access";
import { absenceDays } from "@/server/attendance/absences";
import { PERMISSIONS, SYSTEM_ROLES, type Permission } from "@/server/identity/permissions";
import { visibleMessageWhere } from "@/server/requests/conversation";

const role = (key: string) => SYSTEM_ROLES.find((r) => r.key === key)!.permissions;
const viewer = (key: string, membershipId = `m-${key}`) => ({ isStaff: !["parent", "student"].includes(key), membershipId, can: (p: Permission) => role(key).includes(p) });
const sickDay = { requesterId: "m-parent", service: { key: "absence_request" } };
const illness = { absenceType: "illness" };
const trip = { absenceType: "travel" };

describe("absence privacy rules", () => {
  it("new permissions exist and sit with the right roles", () => {
    expect(PERMISSIONS).toContain("attendance.reasons");
    expect(PERMISSIONS).toContain("absence.reasons");
    expect(role("registrar")).toContain("attendance.reasons");
    expect(role("school_admin")).toContain("attendance.reasons");
    expect(role("nurse")).toContain("attendance.reasons");
    expect(role("teacher")).not.toContain("attendance.reasons");
    expect(role("principal")).not.toContain("attendance.reasons");
    expect(role("principal")).toContain("absence.reasons");
    expect(role("registrar")).not.toContain("absence.reasons");
    expect(role("department_head")).not.toContain("absence.reasons");
  });

  it("a sick day reason is for the family, the attendance office and the nurse", () => {
    expect(canSeeAbsenceReason(viewer("parent"), sickDay, illness)).toBe(true);
    expect(canSeeAbsenceReason(viewer("registrar"), sickDay, illness)).toBe(true);
    expect(canSeeAbsenceReason(viewer("nurse"), sickDay, illness)).toBe(true);
    expect(canSeeAbsenceReason(viewer("teacher"), sickDay, illness)).toBe(false);
    expect(canSeeAbsenceReason(viewer("teacher"), sickDay, illness, { approver: true })).toBe(false);
    expect(canSeeAbsenceReason(viewer("principal"), sickDay, illness, { approver: true })).toBe(false);
    // A planned trip is shown to the principal who approves it.
    expect(canSeeAbsenceReason(viewer("principal"), sickDay, trip, { approver: true })).toBe(true);
    expect(canSeeAbsenceReason(viewer("principal"), sickDay, trip)).toBe(false);
    expect(seesStudentAbsenceReasons(viewer("teacher"))).toBe(false);
    expect(seesStudentAbsenceReasons(viewer("registrar"))).toBe(true);
  });

  it("staff leave details are for the person and the people who manage staff absence", () => {
    const leave = { requesterId: "m-teacher", service: { key: "staff_leave" } };
    const sick = { leaveType: "sick" };
    expect(canSeeAbsenceReason(viewer("teacher"), leave, sick)).toBe(true);
    expect(canSeeAbsenceReason(viewer("principal"), leave, sick)).toBe(true);
    expect(canSeeAbsenceReason(viewer("registrar"), leave, sick)).toBe(false);
    expect(isMedicalAbsence("staff_leave", sick)).toBe(true);
    expect(isMedicalAbsence("staff_leave", { leaveType: "annual" })).toBe(false);
    const absence = { membershipId: "m-teacher", reportedById: "m-registrar" };
    expect(canSeeStaffAbsenceReason(viewer("teacher"), absence)).toBe(true);
    expect(canSeeStaffAbsenceReason(viewer("registrar"), absence)).toBe(true);
    expect(canSeeStaffAbsenceReason(viewer("department_head"), absence)).toBe(false);
    expect(canSeeStaffAbsenceReason(viewer("counselor"), absence)).toBe(false);
    expect(canSeeStaffAbsenceReason(viewer("principal"), absence)).toBe(true);
  });

  it("other services are not affected", () => {
    expect(canSeeAbsenceReason(viewer("teacher"), { requesterId: "x", service: { key: "document_request" } }, {})).toBe(true);
  });

  it("labels never carry a reason", () => {
    expect(excusedLabelKey("PARENT")).toBe("excusedByParent");
    expect(excusedLabelKey("STUDENT")).toBe("excusedByStudent");
    expect(excusedLabelKey("REGISTER")).toBe("excused");
  });

  it("absence days are school days in the range, capped at 31 days", () => {
    const weekDays = [1, 2, 3, 4, 5];
    expect(absenceDays({ startDate: "2026-10-22", endDate: "2026-10-26" }, weekDays)).toEqual(["2026-10-22", "2026-10-23", "2026-10-26"]);
    expect(absenceDays({ startDate: "2026-10-26", endDate: "2026-10-22" }, weekDays)).toEqual(["2026-10-22", "2026-10-23", "2026-10-26"]);
    expect(absenceDays({ startDate: "2026-10-24" }, weekDays)).toEqual([]);
    expect(absenceDays({ startDate: "bad" }, weekDays)).toEqual([]);
    expect(absenceDays({ startDate: "2026-01-01", endDate: "2026-12-31" }, weekDays).length).toBeLessThanOrEqual(23);
  });
});

describe("message visibility filter", () => {
  it("families get shared messages only", () => {
    expect(visibleMessageWhere({ isStaff: false, membershipId: "p" })).toEqual({ visibility: "SHARED" });
  });
  it("staff get staff notes (not on their own requests) and private notes only as author or recipient", () => {
    const w = visibleMessageWhere({ isStaff: true, membershipId: "s1" });
    expect(JSON.stringify(w)).toContain('"privateToIds":{"has":"s1"}');
    expect(JSON.stringify(w)).toContain('"requesterId":{"not":"s1"}');
  });
});
