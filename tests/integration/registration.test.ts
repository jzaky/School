// Subject registration then allocation, against real Postgres through the RLS-restricted app role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantTx } from "@/lib/tenant-db";
import { applySubjectChange, currentYear, moveStudent, runAllocation, saveRegistration } from "@/server/registration/service";
import { importRegistrationRows } from "@/server/registration/import";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
let orgId: string;
let yearId: string;
let actor: { membershipId: string; userId: string };
const sub: Record<string, string> = {};
const stu: string[] = [];
let physA: string;

beforeAll(async () => {
  const org = await owner.organization.create({ data: { slug: uid("reg-itest"), nameEn: "Registration Test School", nameAr: "مدرسة اختبار التسجيل" } });
  orgId = org.id;
  const user = await owner.user.create({ data: { email: `${uid("reg")}@itest.example`, nameEn: "Registrar" } });
  const membership = await owner.membership.create({ data: { orgId, userId: user.id } });
  actor = { membershipId: membership.id, userId: user.id };
  const year = await owner.academicYear.create({ data: { orgId, nameEn: "2026-27", nameAr: "2026-27", startsOn: new Date("2026-08-24"), endsOn: new Date("2027-07-02"), isCurrent: true } });
  yearId = year.id;
  for (const [code, en, ar] of [
    ["MATH", "Mathematics", "الرياضيات"],
    ["PHYS", "Physics", "الفيزياء"],
    ["CS", "Computer Science", "علوم الحاسوب"],
    ["CHEM", "Chemistry", "الكيمياء"],
  ]) {
    sub[code] = (await owner.subject.create({ data: { orgId, code, nameEn: en, nameAr: ar } })).id;
  }
  await owner.subjectOffering.createMany({
    data: [
      { orgId, academicYearId: yearId, subjectId: sub.MATH, gradeLevel: 10, kind: "CORE" },
      { orgId, academicYearId: yearId, subjectId: sub.PHYS, gradeLevel: 10, kind: "OPTION", optionBlock: "A", prerequisites: ["MATH"] },
      { orgId, academicYearId: yearId, subjectId: sub.CS, gradeLevel: 10, kind: "OPTION", optionBlock: "A" },
      { orgId, academicYearId: yearId, subjectId: sub.CHEM, gradeLevel: 10, kind: "OPTION", optionBlock: "B" },
    ],
  });
  await owner.schoolClass.create({ data: { orgId, academicYearId: yearId, subjectId: sub.MATH, nameEn: "Mathematics 10", nameAr: "الرياضيات 10", gradeLevel: 10 } });
  physA = (await owner.schoolClass.create({ data: { orgId, academicYearId: yearId, subjectId: sub.PHYS, nameEn: "Physics 10", nameAr: "الفيزياء 10", gradeLevel: 10, capacity: 2, teacherMembershipId: membership.id } })).id;
  for (let i = 1; i <= 3; i++) {
    stu.push((await owner.student.create({ data: { orgId, studentNo: `RG-00${i}`, firstNameEn: `Student${i}`, lastNameEn: "Test", firstNameAr: "طالب", lastNameAr: "اختبار", gradeLevel: 10 } })).id);
  }
});

afterAll(async () => {
  if (orgId) {
    const where = { orgId };
    await owner.enrollment.deleteMany({ where });
    await owner.subjectRegistration.deleteMany({ where });
    await owner.subjectOffering.deleteMany({ where });
    await owner.schoolClass.deleteMany({ where });
    await owner.student.deleteMany({ where });
    await owner.subject.deleteMany({ where });
    await owner.csvImport.deleteMany({ where });
    await owner.auditEvent.deleteMany({ where });
    await owner.academicYear.deleteMany({ where });
    const members = await owner.membership.findMany({ where, select: { userId: true } });
    await owner.organization.delete({ where: { id: orgId } });
    await owner.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await owner.$disconnect();
});

const classesOf = async (studentId: string) =>
  (await owner.enrollment.findMany({ where: { orgId, studentId }, include: { class: true } })).map((e) => e.class.nameEn).sort();

describe("register then allocate", () => {
  it("rejects invalid choices", async () => {
    const res = await tenantTx(orgId, (tx) => saveRegistration(tx, orgId, { studentId: stu[0], optionSubjectIds: [sub.PHYS, sub.CS], source: "STUDENT", actorId: null }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors?.map((e) => e.code).sort()).toEqual(["missingBlock", "sameBlock"]);
  });

  it("registers core and options and places students, opening a section when full", async () => {
    for (const id of stu) {
      const res = await tenantTx(orgId, (tx) => saveRegistration(tx, orgId, { studentId: id, optionSubjectIds: [sub.PHYS, sub.CHEM], source: "STUDENT", actorId: null }));
      expect(res.ok).toBe(true);
    }
    const regs = await owner.subjectRegistration.findMany({ where: { orgId } });
    expect(regs).toHaveLength(9);
    expect(regs.every((r) => r.status === "ALLOCATED" && r.classId)).toBe(true);

    const phys = await owner.schoolClass.findMany({ where: { orgId, subjectId: sub.PHYS }, include: { _count: { select: { enrollments: true } } }, orderBy: { createdAt: "asc" } });
    expect(phys.map((c) => [c.nameEn, c.section, c._count.enrollments])).toEqual([
      ["Physics 10", "A", 2],
      ["Grade 10 Physics B", "B", 1],
    ]);
    expect(phys[1].teacherMembershipId).toBeNull();
    // Chemistry had no class at all: section A is opened.
    const chem = await owner.schoolClass.findMany({ where: { orgId, subjectId: sub.CHEM } });
    expect(chem.map((c) => c.nameEn)).toEqual(["Grade 10 Chemistry A"]);
    expect(await classesOf(stu[0])).toEqual(["Grade 10 Chemistry A", "Mathematics 10", "Physics 10"]);
  });

  it("is idempotent: allocating again changes nothing", async () => {
    const before = await owner.enrollment.findMany({ where: { orgId }, orderBy: { id: "asc" } });
    const s = await tenantTx(orgId, (tx) => runAllocation(tx, orgId, yearId));
    expect(s).toMatchObject({ placed: 0, moved: 0, removed: 0, sectionsCreated: 0, registrationsUpdated: 0 });
    const again = await tenantTx(orgId, (tx) => saveRegistration(tx, orgId, { studentId: stu[0], optionSubjectIds: [sub.PHYS, sub.CHEM], source: "STUDENT", actorId: null }));
    expect(again.ok && again.summary.registrationsUpdated).toBe(0);
    const after = await owner.enrollment.findMany({ where: { orgId }, orderBy: { id: "asc" } });
    expect(after.map((e) => e.id)).toEqual(before.map((e) => e.id));
  });

  it("moves a student between sections", async () => {
    const reg = await owner.subjectRegistration.findFirstOrThrow({ where: { orgId, studentId: stu[2], subjectId: sub.PHYS } });
    const full = await tenantTx(orgId, (tx) => moveStudent(tx, orgId, { registrationId: reg.id, classId: physA }));
    expect(full).toEqual({ ok: false, error: "FULL" });
    const b = await owner.schoolClass.findFirstOrThrow({ where: { orgId, subjectId: sub.PHYS, section: "B" } });
    const s0 = await owner.subjectRegistration.findFirstOrThrow({ where: { orgId, studentId: stu[0], subjectId: sub.PHYS } });
    const moved = await tenantTx(orgId, (tx) => moveStudent(tx, orgId, { registrationId: s0.id, classId: b.id }));
    expect(moved.ok).toBe(true);
    expect(await classesOf(stu[0])).toContain("Grade 10 Physics B");
    expect(await classesOf(stu[0])).not.toContain("Physics 10");
  });

  it("applies a completed subject change: old class left, new subject allocated", async () => {
    await tenantTx(orgId, (tx) => applySubjectChange(tx, orgId, { studentId: stu[1], fromSubject: "PHYS", toSubject: "CS" }));
    const regs = await owner.subjectRegistration.findMany({ where: { orgId, studentId: stu[1] } });
    expect(regs.find((r) => r.subjectId === sub.PHYS)).toMatchObject({ status: "DROPPED", classId: null });
    expect(regs.find((r) => r.subjectId === sub.CS)).toMatchObject({ status: "ALLOCATED", source: "SUBJECT_CHANGE" });
    expect(await classesOf(stu[1])).toEqual(["Grade 10 Chemistry A", "Grade 10 Computer Science A", "Mathematics 10"]);
    // Running it twice is harmless.
    const again = await tenantTx(orgId, (tx) => applySubjectChange(tx, orgId, { studentId: stu[1], fromSubject: "PHYS", toSubject: "CS" }));
    expect(again).toMatchObject({ placed: 0, moved: 0, removed: 0, registrationsUpdated: 0 });
  });

  it("imports the subject sheet with per-row checks and allocates", async () => {
    const res = await importRegistrationRows(orgId, actor, "subjects.csv", [
      { student_no: "RG-003", student_name: "Student3 Test", "Computer Science": "x", CHEM: "yes" },
      { student_no: "RG-001", Physics: "x", CS: "x", CHEM: "x" },
      { student_no: "RG-404", CS: "x", CHEM: "x" },
      { student_no: "", CS: "x" },
    ]);
    expect(res).toMatchObject({ total: 4, succeeded: 1, failed: 3 });
    const codes = res.errors.map((e) => `${e.row}:${e.field}:${e.code}`).sort();
    expect(codes).toEqual(["3:A:sameBlock", "4:student_no:student", "5:student_no:required"]);
    expect(await classesOf(stu[2])).toEqual(["Grade 10 Chemistry A", "Grade 10 Computer Science A", "Mathematics 10"]);
    const record = await owner.csvImport.findUniqueOrThrow({ where: { id: res.importId } });
    expect(record).toMatchObject({ entity: "registrations", succeeded: 1, failed: 3 });
    const year = await tenantTx(orgId, (tx) => currentYear(tx, orgId));
    expect(year?.id).toBe(yearId);
  });
});
