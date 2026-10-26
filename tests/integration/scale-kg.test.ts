// Full-size readiness against real Postgres through the RLS-restricted app role: kindergarten rows in the student
// import, grade filters from the school's own grades, paging with real totals, server search, and attendance
// percentages that stay empty for a child who has not started (never 100%).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb } from "@/lib/tenant-db";
import { importStudentRows } from "@/server/admin/people-import";
import { gradesInUse, gradeChoices, studentSearchWhere } from "@/server/students/grade-options";
import { pageWindow } from "@/server/common/paging";
import { attendancePctFor } from "@/server/attendance/reports";
import { ALL_GRADE_LEVELS } from "@/lib/grade-levels";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
let orgId: string;
let otherOrg: string;
let actor: { membershipId: string; userId: string };
const DAY = 86_400_000;

beforeAll(async () => {
  const org = await owner.organization.create({ data: { slug: uid("scale-kg-itest"), nameEn: "KG Test School", nameAr: "مدرسة اختبار الروضة" } });
  orgId = org.id;
  otherOrg = (await owner.organization.create({ data: { slug: uid("scale-kg-other"), nameEn: "Other School", nameAr: "مدرسة أخرى" } })).id;
  const user = await owner.user.create({ data: { email: `${uid("kg")}@itest.example`, nameEn: "Import Admin" } });
  const membership = await owner.membership.create({ data: { orgId, userId: user.id } });
  actor = { membershipId: membership.id, userId: user.id };
  // 130 more students over every grade, so paging and grade filters have something to do.
  await owner.student.createMany({
    data: Array.from({ length: 130 }, (_, i) => ({ orgId, studentNo: `P-${String(i).padStart(4, "0")}`, firstNameEn: i % 2 ? "Layla" : "Omar", lastNameEn: `Family${i}`, firstNameAr: i % 2 ? "ليلى" : "عمر", lastNameAr: "العائلة", gradeLevel: ALL_GRADE_LEVELS[i % ALL_GRADE_LEVELS.length] })),
  });
  // A student in the other school must never show up here.
  await owner.student.create({ data: { orgId: otherOrg, studentNo: "OTHER-1", firstNameEn: "Hidden", lastNameEn: "Elsewhere", firstNameAr: "مخفي", lastNameAr: "مخفي", gradeLevel: 5 } });
});

afterAll(async () => {
  for (const id of [orgId, otherOrg].filter(Boolean)) {
    const where = { orgId: id };
    await owner.attendanceRecord.deleteMany({ where });
    await owner.guardianLink.deleteMany({ where });
    await owner.guardian.deleteMany({ where });
    await owner.student.deleteMany({ where });
    await owner.csvImport.deleteMany({ where });
    await owner.auditEvent.deleteMany({ where });
    const members = await owner.membership.findMany({ where, select: { userId: true } });
    await owner.organization.delete({ where: { id } });
    await owner.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await owner.$disconnect();
});

describe("kindergarten in the student import", () => {
  it("accepts KG1, KG2, PK, KG and Arabic grade names", async () => {
    const rows = [
      { student_no: "KG-001", first_name_en: "Salma", last_name_en: "Hammadi", grade: "KG1" },
      { student_no: "KG-002", first_name_en: "Zayed", last_name_en: "Hammadi", grade: "KG 2" },
      { student_no: "KG-003", first_name_en: "Rayan", last_name_en: "Khoury", grade: "PK" },
      { student_no: "KG-004", first_name_en: "Mira", last_name_en: "Khoury", grade: "KG" },
      { student_no: "KG-005", first_name_en: "Hessa", last_name_en: "Shamsi", grade: "الروضة الأولى" },
      { student_no: "KG-006", first_name_en: "Ali", last_name_en: "Shamsi", grade: "الصف التاسع" },
      { student_no: "KG-007", first_name_en: "Bad", last_name_en: "Grade", grade: "KG3" },
    ];
    const res = await importStudentRows(orgId, actor, "kg.csv", rows);
    expect(res.succeeded).toBe(6);
    expect(res.failed).toBe(1);
    expect(res.errors.map((e) => `${e.row}:${e.field}:${e.code}`)).toEqual(["8:grade:grade"]);
    const got = await owner.student.findMany({ where: { orgId, studentNo: { startsWith: "KG-" } }, orderBy: { studentNo: "asc" }, select: { studentNo: true, gradeLevel: true } });
    expect(got.map((s) => s.gradeLevel)).toEqual([-1, 0, -1, 0, -1, 9]);
  });
});

describe("grade filters and paging", () => {
  it("offers the grades the school has, KG1 first, and nothing from another school", async () => {
    const grades = await gradesInUse(tenantDb(orgId));
    expect(grades[0]).toBe(-1);
    expect(grades).toEqual([...ALL_GRADE_LEVELS]);
    expect(await gradesInUse(tenantDb(otherOrg))).toEqual([5]);
    expect(await gradesInUse(tenantDb(orgId), { min: 9 })).toEqual([9, 10, 11, 12]);
  });

  it("offers every grade to a new school with no students", async () => {
    const empty = await owner.organization.create({ data: { slug: uid("scale-kg-empty"), nameEn: "Empty", nameAr: "فارغة" } });
    try {
      expect(await gradesInUse(tenantDb(empty.id))).toEqual([]);
      expect(await gradeChoices(tenantDb(empty.id))).toEqual([...ALL_GRADE_LEVELS]);
    } finally {
      await owner.organization.delete({ where: { id: empty.id } });
    }
  });

  it("counts the real total and pages through every student exactly once", async () => {
    const db = tenantDb(orgId);
    const where = { orgId, status: "ACTIVE" as const };
    const total = await db.student.count({ where });
    expect(total).toBe(136);
    const seen = new Set<string>();
    const first = pageWindow(undefined, total);
    expect(first).toMatchObject({ pages: 3, from: 1, to: 50 });
    for (let p = 1; p <= first.pages; p++) {
      const w = pageWindow(String(p), total);
      const rows = await db.student.findMany({ where, orderBy: [{ gradeLevel: "asc" }, { section: "asc" }, { lastNameEn: "asc" }, { id: "asc" }], skip: w.skip, take: w.take, select: { id: true } });
      expect(rows.length).toBe(w.to - w.from + 1);
      for (const r of rows) seen.add(r.id);
    }
    expect(seen.size).toBe(total);
  });

  it("filters KG1 by grade and searches every word in English or Arabic", async () => {
    const db = tenantDb(orgId);
    expect(await db.student.count({ where: { gradeLevel: -1 } })).toBe(13);
    expect(await db.student.count({ where: studentSearchWhere("Salma Hammadi") })).toBe(1);
    expect(await db.student.count({ where: studentSearchWhere("ليلى") })).toBe(65);
    expect(await db.student.count({ where: studentSearchWhere("Hidden") })).toBe(0);
  });
});

describe("attendance percentage for a child who has not started", () => {
  it("is empty, not 100%, and counts present, late and absent days for others", async () => {
    const db = tenantDb(orgId);
    const [starter, regular] = await owner.student.findMany({ where: { orgId, studentNo: { in: ["KG-001", "KG-002"] } }, orderBy: { studentNo: "asc" } });
    await owner.student.update({ where: { id: starter.id }, data: { enrolledOn: new Date(Date.now() + 10 * DAY) } });
    const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n));
    await owner.attendanceRecord.createMany({
      data: [
        { orgId, studentId: regular.id, date: day(0), status: "PRESENT", code: "P" },
        { orgId, studentId: regular.id, date: day(1), status: "LATE", code: "L", minutesLate: 5 },
        { orgId, studentId: regular.id, date: day(2), status: "ABSENT", code: "U" },
        { orgId, studentId: regular.id, date: day(3), status: "EXCUSED", code: "N" },
      ],
    });
    const pct = await attendancePctFor(db, [starter.id, regular.id], day(0), day(10));
    expect(pct.get(starter.id)).toBeNull();
    // "N" (not required to attend) is not counted: 2 of 3 counted days attended.
    expect(pct.get(regular.id)).toBeCloseTo((2 / 3) * 100, 5);
  });
});
