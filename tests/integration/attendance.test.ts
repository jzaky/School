// Attendance and grade publishing against real Postgres through the RLS-restricted app role:
// who may take which register, late cut-off and closed registers (audited old and new), private codes, the
// unexplained absence message (idempotent, rule 7, pending reports), explaining an absence, approved absence
// reports, the API's register mode, the publish modes and permissions, report cards, and tenant isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb } from "@/lib/tenant-db";
import type { Permission } from "@/server/identity/permissions";
import { execCtx, type Tx } from "@/server/db";
import { loadRegister, myRegisters, RegisterError, saveRegister, setRegisterClosed, type AttViewer } from "@/server/attendance/registers";
import { explainAbsence, messageFamily, runFollowUp } from "@/server/attendance/followup";
import { applyExcusedAbsence } from "@/server/attendance/absences";
import { buildReport, studentSummary } from "@/server/attendance/reports";
import { runAttendanceAlerts } from "@/server/attendance/alerts";
import { localClock } from "@/server/attendance/settings";
import { upsertAttendance } from "@/server/integrations/api";
import { setPublished } from "@/server/grades/service";
import { publishQueue, publishReady, releaseReportCards, setPublishMode, setReady, unpublishByPublisher } from "@/server/grades/publishing";
import { canCreateReportCard, generateReportCard } from "@/server/grades/report-card";
import type { GradeViewer } from "@/server/grades/queries";
import { wipeTenant } from "../../prisma/seed/lib";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
const ids: Record<string, string> = {};
let orgId: string;
let otherOrg: string;
const users: string[] = [];

// The school day under test: the most recent weekday in Dubai, and instants on it.
const today = (() => {
  let k = localClock(new Date(), "Asia/Dubai").dateKey;
  for (let i = 0; i < 7; i++) {
    const wd = new Date(`${k}T00:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5) break;
    const d = new Date(`${k}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    k = d.toISOString().slice(0, 10);
  }
  return k;
})();
const D = new Date(`${today}T00:00:00Z`);
const WD = D.getUTCDay();
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(D.getUTCFullYear(), D.getUTCMonth(), D.getUTCDate(), h - 4, m));
};

async function member(name: string, org = orgId) {
  const user = await owner.user.create({ data: { email: `${uid(name.replace(/\s/g, ""))}@att.itest`, nameEn: name } });
  users.push(user.id);
  return (await owner.membership.create({ data: { orgId: org, userId: user.id } })).id;
}

function att(membershipId: string, perms: Permission[], org = orgId): AttViewer {
  return { db: tenantDb(org), orgId: org, membershipId, isStaff: true, can: (p) => perms.includes(p), timezone: "Asia/Dubai", weekDays: [1, 2, 3, 4, 5] };
}

function grades(membershipId: string, roles: string[], perms: Permission[], family: string[] = []): GradeViewer {
  return { db: tenantDb(orgId), orgId, membershipId, roles, isStudent: roles.includes("student"), isParent: roles.includes("parent"), can: (p) => perms.includes(p), familyStudentIds: family };
}

const TAKE: Permission[] = ["attendance.take", "grades.enter"];
const OFFICE: Permission[] = ["attendance.manage", "attendance.reasons", "attendance.view_all"];

beforeAll(async () => {
  const org = await owner.organization.create({ data: { slug: uid("att-itest"), nameEn: "Attendance Test School", nameAr: "مدرسة اختبار الحضور" } });
  orgId = org.id;
  const year = await owner.academicYear.create({ data: { orgId, nameEn: "Year", nameAr: "العام", startsOn: new Date(D.getTime() - 60 * 86400000), endsOn: new Date(D.getTime() + 200 * 86400000), isCurrent: true } });
  ids.year = year.id;
  ids.term = (await owner.term.create({ data: { orgId, academicYearId: year.id, nameEn: "Term", nameAr: "الفصل", startsOn: new Date(D.getTime() - 60 * 86400000), endsOn: new Date(D.getTime() + 30 * 86400000) } })).id;
  ids.tutor = await member("Tutor");
  ids.teacher = await member("Lesson Teacher");
  ids.cover = await member("Cover Teacher");
  ids.other = await member("Other Teacher");
  ids.office = await member("Office");
  ids.it = await member("Head of IT");
  ids.parentMember = await member("Parent");
  const homeroom = await owner.schoolClass.create({ data: { orgId, academicYearId: year.id, nameEn: "Homeroom 9A", nameAr: "الفصل 9A", gradeLevel: 9, section: "A", isHomeroom: true, teacherMembershipId: ids.tutor } });
  const lesson = await owner.schoolClass.create({ data: { orgId, academicYearId: year.id, nameEn: "Maths 9", nameAr: "الرياضيات 9", gradeLevel: 9, teacherMembershipId: ids.teacher } });
  const kg = await owner.schoolClass.create({ data: { orgId, academicYearId: year.id, nameEn: "KG2 Blue", nameAr: "الروضة الثانية", gradeLevel: 0, teacherMembershipId: ids.teacher } });
  ids.homeroom = homeroom.id;
  ids.lesson = lesson.id;
  ids.kg = kg.id;
  const mk = (n: number) => owner.student.create({ data: { orgId, studentNo: `ATT-${n}`, firstNameEn: `Student${n}`, lastNameEn: "Test", firstNameAr: `طالب${n}`, lastNameAr: "اختبار", gradeLevel: 9, section: "A" } });
  const [s1, s2, s3, s4] = await Promise.all([mk(1), mk(2), mk(3), mk(4)]);
  Object.assign(ids, { s1: s1.id, s2: s2.id, s3: s3.id, s4: s4.id });
  for (const s of [s1, s2, s3, s4]) await owner.enrollment.createMany({ data: [{ orgId, studentId: s.id, classId: homeroom.id }, { orgId, studentId: s.id, classId: lesson.id }] });
  // Guardians who receive updates for every student; S1's parent has an account.
  const g = await owner.guardian.create({ data: { orgId, membershipId: ids.parentMember, firstNameEn: "Parent", lastNameEn: "One", firstNameAr: "ولي", lastNameAr: "أمر", email: `${uid("g")}@att.itest` } });
  for (const s of [s1, s2, s3, s4]) {
    const gm = s.id === s1.id ? g.id : (await owner.guardian.create({ data: { orgId, membershipId: await member(`Guardian ${s.studentNo}`), firstNameEn: "G", lastNameEn: s.studentNo, firstNameAr: "و", lastNameAr: "أ" } })).id;
    await owner.guardianLink.create({ data: { orgId, guardianId: gm, studentId: s.id } });
  }
  // S3 has an open safeguarding case: families are never messaged automatically about it.
  await owner.case.create({ data: { orgId, number: uid("C"), type: "SAFEGUARDING", sensitivity: "SAFEGUARDING", status: "IN_PROGRESS", studentId: s3.id, titleEn: "Concern", titleAr: "قلق" } });
  // Timetable: Maths 9 in period 2 today, covered by the cover teacher.
  await owner.bellPeriod.createMany({ data: [{ orgId, academicYearId: year.id, dayOfWeek: WD, periodNo: 1, startTime: "07:45", endTime: "08:30", kind: "LESSON" }, { orgId, academicYearId: year.id, dayOfWeek: WD, periodNo: 2, startTime: "08:30", endTime: "09:15", kind: "LESSON" }] });
  const slot = await owner.timetableSlot.create({ data: { orgId, academicYearId: year.id, classId: lesson.id, teacherMembershipId: ids.teacher, dayOfWeek: WD, periodNo: 2 } });
  await owner.timetableSlot.create({ data: { orgId, academicYearId: year.id, classId: lesson.id, teacherMembershipId: ids.teacher, dayOfWeek: WD, periodNo: 1 } });
  await owner.timetableSlot.create({ data: { orgId, academicYearId: year.id, classId: kg.id, teacherMembershipId: ids.teacher, dayOfWeek: WD, periodNo: 1 } });
  const absence = await owner.staffAbsence.create({ data: { orgId, membershipId: ids.teacher, startsOn: D, endsOn: D, allDay: false, fromPeriod: 2, toPeriod: 2, reportedById: ids.office } });
  await owner.coverAssignment.create({ data: { orgId, absenceId: absence.id, slotId: slot.id, date: D, periodNo: 2, classId: lesson.id, originalTeacherId: ids.teacher, substituteId: ids.cover, status: "ASSIGNED" } });
  // Office members are found by permission, through a role.
  const role = await owner.role.create({ data: { orgId, key: "office", nameEn: "Office", nameAr: "المكتب", permissions: OFFICE, isSystem: false } });
  await owner.membershipRole.create({ data: { orgId, membershipId: ids.office, roleId: role.id } });

  // A second school with its own attendance, for isolation.
  const other = await owner.organization.create({ data: { slug: uid("att-other"), nameEn: "Other", nameAr: "أخرى" } });
  otherOrg = other.id;
  const os = await owner.student.create({ data: { orgId: otherOrg, studentNo: "OTHER-1", firstNameEn: "O", lastNameEn: "S", firstNameAr: "س", lastNameAr: "ص", gradeLevel: 9 } });
  await owner.attendanceRecord.create({ data: { orgId: otherOrg, studentId: os.id, date: D, status: "ABSENT", code: "A" } });
  await owner.attendanceFollowUp.create({ data: { orgId: otherOrg, studentId: os.id, date: D } });
  await owner.attendanceCode.create({ data: { orgId: otherOrg, code: "ZZ", labelEn: "Other school code", labelAr: "رمز", countsAs: "PRESENT", category: "present" } });
});

afterAll(async () => {
  for (const o of [orgId, otherOrg].filter(Boolean)) {
    await wipeTenant(owner, o);
    await owner.organization.deleteMany({ where: { id: o } });
  }
  await owner.user.deleteMany({ where: { id: { in: users } } });
  await owner.$disconnect();
});

describe("taking registers", () => {
  it("the homeroom teacher sees the daily register and their lessons; a KG class takes no lesson register", async () => {
    const { items } = await myRegisters(att(ids.teacher, TAKE), today, at("07:40"));
    expect(items.map((i) => `${i.kind}:${i.classId}:${i.periodNo}`)).toEqual([`LESSON:${ids.lesson}:1`, `LESSON:${ids.lesson}:2`]);
    expect(items.find((i) => i.periodNo === 2)?.coveredBy).not.toBeNull();
    const tutor = await myRegisters(att(ids.tutor, TAKE), today, at("07:40"));
    expect(tutor.items.map((i) => i.kind)).toEqual(["DAILY"]);
    const cover = await myRegisters(att(ids.cover, TAKE), today, at("07:40"));
    expect(cover.items.map((i) => `${i.cover}:${i.periodNo}`)).toEqual(["true:2"]);
  });

  it("only the right people may take a register", async () => {
    const daily = { classId: ids.homeroom, date: today, periodNo: 0 };
    await expect(saveRegister(att(ids.other, TAKE), daily, [{ studentId: ids.s1, code: "P" }], at("07:40"))).rejects.toMatchObject({ code: "forbidden" });
    // The absent teacher cannot take the covered lesson; the cover teacher can.
    const covered = { classId: ids.lesson, date: today, periodNo: 2 };
    await expect(saveRegister(att(ids.teacher, TAKE), covered, [{ studentId: ids.s1, code: "P" }], at("08:35"))).rejects.toBeInstanceOf(RegisterError);
    const res = await saveRegister(att(ids.cover, TAKE), covered, [{ studentId: ids.s1, code: "P" }, { studentId: ids.s2, code: "P" }], at("08:35"));
    expect(res.saved).toBe(2);
    const reg = await owner.attendanceRegister.findFirstOrThrow({ where: { orgId, classId: ids.lesson, periodNo: 2 } });
    expect(reg.coverId).not.toBeNull();
    expect(reg.takenById).toBe(ids.cover);
  });

  it("the daily register writes the day's records with codes, and the same save again changes nothing", async () => {
    const daily = { classId: ids.homeroom, date: today, periodNo: 0 };
    const marks = [
      { studentId: ids.s1, code: "A" },
      { studentId: ids.s2, code: "L", minutesLate: 7 },
      { studentId: ids.s3, code: "A" },
      { studentId: ids.s4, code: "A" },
    ];
    const first = await saveRegister(att(ids.tutor, TAKE), daily, marks, at("07:40"));
    expect(first).toMatchObject({ saved: 4, unchanged: 0, rejected: [] });
    const again = await saveRegister(att(ids.tutor, TAKE), daily, marks, at("07:41"));
    expect(again).toMatchObject({ saved: 0, unchanged: 4 });
    const recs = await owner.attendanceRecord.findMany({ where: { orgId, date: D } });
    expect(recs.find((r) => r.studentId === ids.s2)).toMatchObject({ status: "LATE", code: "L", minutesLate: 7, markedById: ids.tutor });
    expect(recs.filter((r) => r.status === "ABSENT")).toHaveLength(3);
    // Unexplained absences open follow-ups for the attendance office.
    expect(await owner.attendanceFollowUp.count({ where: { orgId, date: D, status: "OPEN" } })).toBe(3);
    expect(await owner.auditEvent.count({ where: { orgId, action: "attendance.register_save" } })).toBeGreaterThan(0);
  });

  it("after the late cut-off only the office marks late, audited with the old and new value", async () => {
    const daily = { classId: ids.homeroom, date: today, periodNo: 0 };
    const late = await saveRegister(att(ids.tutor, TAKE), daily, [{ studentId: ids.s4, code: "L", minutesLate: 40 }], at("08:10"));
    expect(late.rejected).toEqual([{ studentId: ids.s4, error: "lateCutoff" }]);
    const ok = await saveRegister(att(ids.office, OFFICE), daily, [{ studentId: ids.s4, code: "L", minutesLate: 40 }], at("08:10"));
    expect(ok.saved).toBe(1);
    const ev = await owner.auditEvent.findFirstOrThrow({ where: { orgId, action: "attendance.mark_late_after_cutoff" } });
    expect(ev.meta).toMatchObject({ studentId: ids.s4, from: "A", to: "L", toMinutesLate: 40 });
    // The follow-up for S4 is resolved: S4 arrived.
    expect((await owner.attendanceFollowUp.findFirstOrThrow({ where: { orgId, studentId: ids.s4, date: D } })).status).toBe("EXPLAINED");
  });

  it("teachers cannot set or see private codes, and their save never overwrites one", async () => {
    const daily = { classId: ids.homeroom, date: today, periodNo: 0 };
    const res = await saveRegister(att(ids.tutor, TAKE), daily, [{ studentId: ids.s2, code: "I" }], at("07:50"));
    expect(res.rejected).toEqual([{ studentId: ids.s2, error: "code" }]);
    await owner.attendanceRecord.update({ where: { studentId_date: { studentId: ids.s2, date: D } }, data: { code: "I", status: "EXCUSED", minutesLate: null } });
    const view = await loadRegister(att(ids.tutor, TAKE), daily, at("07:50"));
    const s2 = view!.students.find((s) => s.id === ids.s2)!;
    expect(s2.mark).toMatchObject({ code: "E", masked: true });
    expect(view!.codes.some((c) => c.code === "I")).toBe(false);
    const again = await saveRegister(att(ids.tutor, TAKE), daily, [{ studentId: ids.s2, code: "E" }], at("07:51"));
    expect(again.unchanged).toBe(1);
    expect((await owner.attendanceRecord.findUniqueOrThrow({ where: { studentId_date: { studentId: ids.s2, date: D } } })).code).toBe("I");
  });

  it("a closed register is read only for teachers; office changes are audited with old and new", async () => {
    const lesson = { classId: ids.lesson, date: today, periodNo: 1 };
    await saveRegister(att(ids.teacher, TAKE), lesson, [{ studentId: ids.s1, code: "P" }], at("07:50"));
    await setRegisterClosed(att(ids.office, OFFICE), lesson, true, at("09:00"));
    await expect(saveRegister(att(ids.teacher, TAKE), lesson, [{ studentId: ids.s1, code: "A" }], at("09:05"))).rejects.toMatchObject({ code: "closed" });
    await saveRegister(att(ids.office, OFFICE), lesson, [{ studentId: ids.s1, code: "A" }], at("09:05"));
    const ev = await owner.auditEvent.findFirstOrThrow({ where: { orgId, action: "attendance.mark_edit_after_close" } });
    expect(ev.meta).toMatchObject({ studentId: ids.s1, from: "P", to: "A" });
    expect(await owner.auditEvent.count({ where: { orgId, action: "attendance.register_close" } })).toBe(1);
    // After the close time the day's registers are closed for teachers too.
    await expect(saveRegister(att(ids.tutor, TAKE), { classId: ids.homeroom, date: today, periodNo: 0 }, [{ studentId: ids.s1, code: "P" }], at("16:00"))).rejects.toMatchObject({ code: "closed" });
  });
});

describe("unexplained absence follow-up", () => {
  it("messages guardians once per student and day, holds sensitive cases for staff, and skips pending reports", async () => {
    // S1: plain unexplained absence. S3: open safeguarding case. S2 is excused (I), S4 arrived late.
    const before = await owner.notification.count({ where: { orgId, kind: "attendance_unexplained" } });
    expect(await runFollowUp(orgId, { now: at("09:10"), flush: async () => undefined })).toMatchObject({ skipped: "early" });
    const run = await runFollowUp(orgId, { now: at("09:31"), flush: async () => undefined });
    expect(run).toMatchObject({ notified: 1, held: 1 });
    const again = await runFollowUp(orgId, { now: at("09:36"), flush: async () => undefined });
    expect(again).toMatchObject({ notified: 0, held: 0 });
    const sent = await owner.notification.findMany({ where: { orgId, kind: "attendance_unexplained" } });
    expect(sent.length - before).toBe(1);
    expect(sent[0].recipientId).toBe(ids.parentMember);
    expect(await owner.outboundMessage.count({ where: { orgId, templateKey: "attendance_unexplained" } })).toBeLessThanOrEqual(1);
    // Rule 7: the safeguarding student's family got nothing; the office was asked to call.
    const s3 = await owner.attendanceFollowUp.findFirstOrThrow({ where: { orgId, studentId: ids.s3, date: D } });
    expect(s3).toMatchObject({ heldReason: "HELD", notifiedAt: null });
    const s3Guardians = (await owner.guardianLink.findMany({ where: { orgId, studentId: ids.s3 }, include: { guardian: true } })).map((g) => g.guardian.membershipId);
    expect(await owner.notification.count({ where: { orgId, recipientId: { in: s3Guardians as string[] } } })).toBe(0);
    expect(await owner.notification.count({ where: { orgId, kind: "attendance_contact_by_hand", recipientId: ids.office } })).toBe(1);
  });

  it("a staff message to a held family needs a recorded reason", async () => {
    const f = await owner.attendanceFollowUp.findFirstOrThrow({ where: { orgId, studentId: ids.s3, date: D } });
    await expect(messageFamily(att(ids.office, OFFICE), f.id, { message: "Please call the school office." })).rejects.toMatchObject({ code: "reasonRequired" });
    await expect(messageFamily(att(ids.tutor, TAKE), f.id, { message: "Please call the school office.", reason: "x" })).rejects.toMatchObject({ code: "forbidden" });
    const res = await messageFamily(att(ids.office, OFFICE), f.id, { message: "Please call the school office.", reason: "Agreed with the DSL." });
    expect(res.sent).toBe(1);
    const ev = await owner.auditEvent.findFirstOrThrow({ where: { orgId, action: "attendance.family_message_decision" } });
    expect(ev.reason).toBe("Agreed with the DSL.");
  });

  it("explaining an absence recodes the day and its absent lessons, audited", async () => {
    const f = await owner.attendanceFollowUp.findFirstOrThrow({ where: { orgId, studentId: ids.s1, date: D } });
    await expect(explainAbsence(att(ids.office, OFFICE), f.id, "A")).rejects.toMatchObject({ code: "code" });
    await explainAbsence(att(ids.office, OFFICE), f.id, "M");
    expect(await owner.attendanceRecord.findUniqueOrThrow({ where: { studentId_date: { studentId: ids.s1, date: D } } })).toMatchObject({ code: "M", status: "EXCUSED", source: "OFFICE" });
    expect((await owner.attendanceLessonMark.findMany({ where: { orgId, studentId: ids.s1, date: D, code: "A" } })).length).toBe(0);
    expect(await owner.attendanceFollowUp.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ status: "EXPLAINED", explainedCode: "M" });
    expect((await owner.auditEvent.findFirstOrThrow({ where: { orgId, action: "attendance.absence_explained" } })).meta).toMatchObject({ from: "A", to: "M" });
  });

  it("an approved absence report marks the day excused without its reason", async () => {
    const day = new Date(D.getTime() - 7 * 86400000);
    const key = day.toISOString().slice(0, 10);
    await owner.attendanceRecord.create({ data: { orgId, studentId: ids.s4, date: day, status: "ABSENT", code: "A", markedById: ids.tutor } });
    await owner.attendanceFollowUp.create({ data: { orgId, studentId: ids.s4, date: day } });
    await applyExcusedAbsence(execCtx(owner as unknown as Tx, orgId, { now: new Date(), quiet: true }), { id: "req-test", studentId: ids.s4, requesterId: ids.parentMember }, { startDate: key, endDate: key });
    expect(await owner.attendanceRecord.findUniqueOrThrow({ where: { studentId_date: { studentId: ids.s4, date: day } } })).toMatchObject({ code: "E", status: "EXCUSED", requestId: "req-test" });
    expect((await owner.attendanceFollowUp.findFirstOrThrow({ where: { orgId, studentId: ids.s4, date: day } })).status).toBe("EXPLAINED");
  });
});

describe("reports and alerts", () => {
  it("aggregates per student and in total, never reading another school", async () => {
    const r = await buildReport(tenantDb(orgId), { kind: "school" }, { from: today, to: today, termId: null });
    expect(r.rows.map((x) => x.id).sort()).toEqual([ids.s1, ids.s2, ids.s3, ids.s4].sort());
    expect(r.total.possible).toBe(4);
    const s3 = await studentSummary(tenantDb(orgId), ids.s3, { from: today, to: today, termId: null });
    expect(s3.pct).toBe(0);
  });

  it("raises a persistent absence alert once per student and term", async () => {
    await owner.attendanceSettings.upsert({ where: { orgId }, create: { orgId, persistentMinDays: 1 }, update: { persistentMinDays: 1 } });
    const first = await runAttendanceAlerts(orgId, { now: at("12:00"), flush: async () => undefined });
    expect(first.persistent.created).toBeGreaterThan(0);
    const again = await runAttendanceAlerts(orgId, { now: at("12:30"), flush: async () => undefined });
    expect(again.persistent.created).toBe(0);
    expect(await owner.notification.count({ where: { orgId, kind: "attendance_persistent", recipientId: ids.tutor } })).toBe(first.persistent.created);
  });

  it("alerts the office once on reaching the regulator absence limit, counting school days only", async () => {
    // S3 was absent today; add the previous school day, so S3 has two unexcused school days in a row.
    let prev = new Date(D.getTime() - 86400000);
    while (prev.getUTCDay() === 0 || prev.getUTCDay() === 6) prev = new Date(prev.getTime() - 86400000);
    await owner.attendanceRecord.create({ data: { orgId, studentId: ids.s3, date: prev, status: "ABSENT", code: "U" } });
    await owner.attendanceSettings.update({ where: { orgId }, data: { limitEnabled: true, limitConsecutive: 2, limitTotal: 3, limitWarnPct: 50 } });
    const first = await runAttendanceAlerts(orgId, { now: at("13:00"), flush: async () => undefined });
    expect(first.limits.reached).toBe(1);
    const alerts = await owner.attendanceAlert.findMany({ where: { orgId, studentId: ids.s3, kind: { startsWith: "LIMIT" } } });
    expect(alerts.map((a) => a.kind).sort()).toEqual(["LIMIT_REACHED", "LIMIT_WARNING"]);
    expect(alerts.find((a) => a.kind === "LIMIT_REACHED")).toMatchObject({ consecutive: 2, total: 2 });
    const again = await runAttendanceAlerts(orgId, { now: at("14:00"), flush: async () => undefined });
    expect(again.limits).toEqual({ warned: 0, reached: 0 });
    const sent = await owner.notification.findMany({ where: { orgId, kind: "attendance_limit" } });
    expect(sent.map((n) => n.recipientId)).toEqual([ids.office]);
    // Counts only: the message never carries a reason.
    expect(sent[0].bodyEn).not.toMatch(/illness|medical|safeguard/i);
    await owner.attendanceSettings.update({ where: { orgId }, data: { limitEnabled: false } });
  });
});

describe("API and the register mode", () => {
  const actor = () => ({ orgId, membershipId: ids.office, userId: users[4], perms: new Set<string>(["integrations.manage"]) });
  it("Horizon is the register: marks taken here are not overwritten, new days are added", async () => {
    const day = new Date(D.getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const res = await upsertAttendance(actor(), [{ student_no: "ATT-2", date: today, status: "present" }, { student_no: "ATT-3", date: day, status: "absent" }], "test");
    expect(res).toMatchObject({ created: 1, errors: [{ index: 0, field: "date", code: "horizon_register" }] });
  });
  it("another system is the register: the API overwrites, but an approved report stays excused", async () => {
    await owner.attendanceSettings.update({ where: { orgId }, data: { mode: "EXTERNAL" } });
    const res = await upsertAttendance(actor(), [{ student_no: "ATT-2", date: today, status: "present" }, { student_no: "ATT-4", date: new Date(D.getTime() - 7 * 86400000).toISOString().slice(0, 10), status: "absent" }], "test");
    expect(res).toMatchObject({ updated: 1, unchanged: 1, failed: 0 });
    await expect(saveRegister(att(ids.tutor, TAKE), { classId: ids.homeroom, date: today, periodNo: 0 }, [{ studentId: ids.s1, code: "P" }], at("07:40"))).rejects.toMatchObject({ code: "external" });
    await owner.attendanceSettings.update({ where: { orgId }, data: { mode: "HORIZON" } });
  });
});

describe("grade publishing", () => {
  beforeAll(async () => {
    ids.a1 = (await owner.assessment.create({ data: { orgId, classId: ids.lesson, termId: ids.term, titleEn: "Quiz 1", titleAr: "اختبار 1", maxScore: 10, createdById: ids.teacher } })).id;
    ids.a2 = (await owner.assessment.create({ data: { orgId, classId: ids.lesson, termId: ids.term, titleEn: "Quiz 2", titleAr: "اختبار 2", maxScore: 10, createdById: ids.teacher } })).id;
    await owner.grade.createMany({ data: [ids.s1, ids.s2, ids.s3, ids.s4].flatMap((s) => [{ orgId, assessmentId: ids.a1, studentId: s, score: 8 }, { orgId, assessmentId: ids.a2, studentId: s, score: 6 }]) });
  });
  const teacher = () => grades(ids.teacher, ["teacher"], ["grades.enter"]);
  const it_ = () => grades(ids.it, ["head_of_it"], ["grades.publish", "integrations.manage", "signin.manage"]);
  const admin = () => grades(ids.office, ["school_admin"], ["school.manage"]);

  it("teachers publish their own by default; a publisher has nothing to do", async () => {
    expect((await setReady(teacher(), ids.a1, true)).ok).toBe(false);
    expect((await publishReady(it_(), { all: {} })).ok).toBe(false);
  });

  it("in publisher mode teachers mark work ready and only grades.publish holders release it, notifying families once", async () => {
    expect((await setPublishMode(teacher(), "PUBLISHER")).ok).toBe(false);
    expect((await setPublishMode(admin(), "PUBLISHER")).ok).toBe(true);
    expect(await setPublished(teacher(), ids.a1, true)).toMatchObject({ ok: false, error: "publisherMode" });
    expect((await setReady(teacher(), ids.a1, true)).ok).toBe(true);
    expect((await publishReady(teacher(), { ids: [ids.a1] })).ok).toBe(false);
    const q = await publishQueue(it_(), { status: "ready" });
    expect(q?.rows.map((r) => r.id)).toEqual([ids.a1]);
    expect(q?.rows[0].marked).toBe(4);
    const res = await publishReady(it_(), { ids: [ids.a1, ids.a2] });
    expect(res).toMatchObject({ ok: true, published: 1 });
    const again = await publishReady(it_(), { ids: [ids.a1] });
    expect(again).toMatchObject({ ok: true, published: 0 });
    expect(await owner.notification.count({ where: { orgId, kind: "grade_published", recipientId: ids.parentMember } })).toBe(1);
    const a1 = await owner.assessment.findUniqueOrThrow({ where: { id: ids.a1 } });
    expect(a1.publishedById).toBe(ids.it);
    expect(await owner.auditEvent.count({ where: { orgId, action: "grades.publish", entityId: ids.a1 } })).toBe(1);
    expect((await unpublishByPublisher(it_(), ids.a1)).ok).toBe(true);
    expect(await owner.auditEvent.count({ where: { orgId, action: "grades.unpublish", entityId: ids.a1 } })).toBe(1);
    expect((await owner.assessment.findUniqueOrThrow({ where: { id: ids.a1 } })).readyAt).not.toBeNull();
  });

  it("report cards follow the same rule: hidden until released, and families cannot make their own", async () => {
    await publishReady(it_(), { ids: [ids.a1] });
    const parent = grades(ids.parentMember, ["parent"], ["grades.view_own"], [ids.s1]);
    expect(await canCreateReportCard(parent, ids.s1, ids.term)).toBe(false);
    const made = await generateReportCard(teacher(), ids.s1, ids.term);
    expect(made).toMatchObject({ ok: true, held: true });
    const doc = await owner.document.findUniqueOrThrow({ where: { id: (made as { documentId: string }).documentId } });
    expect(doc.visibleToFamily).toBe(false);
    const rel = await releaseReportCards(it_(), { all: true });
    expect(rel).toMatchObject({ ok: true, released: 1 });
    expect((await owner.document.findUniqueOrThrow({ where: { id: doc.id } })).visibleToFamily).toBe(true);
    expect((await releaseReportCards(teacher(), { all: true })).ok).toBe(false);
  });
});

describe("tenant isolation", () => {
  it("one school never reads another school's attendance rows", async () => {
    const db = tenantDb(orgId);
    expect(await db.attendanceRecord.count({ where: { orgId: otherOrg } })).toBe(0);
    expect(await db.attendanceFollowUp.count({ where: { orgId: otherOrg } })).toBe(0);
    expect(await db.attendanceCode.count()).toBe(0);
    const theirs = tenantDb(otherOrg);
    expect(await theirs.attendanceRecord.count()).toBe(1);
    expect(await theirs.attendanceRegister.count()).toBe(0);
    expect(await theirs.attendanceLessonMark.count()).toBe(0);
    expect(await theirs.attendanceAlert.count()).toBe(0);
    await expect(db.attendanceRecord.create({ data: { orgId: otherOrg, studentId: ids.s1, date: new Date(D.getTime() - 86400000), status: "PRESENT" } })).rejects.toThrow();
  });
});
