// CSV import of students with guardians, against real Postgres through the RLS-restricted app role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importStudentRows, ImportTooLargeError } from "@/server/admin/people-import";
import { decryptField } from "@/lib/crypto";
import { MAX_IMPORT_ROWS } from "@/lib/people-csv";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
let orgId: string;
let actor: { membershipId: string; userId: string };

const rows = [
  {
    student_no: "IT-001",
    first_name_en: "Maya",
    last_name_en: "Haddad",
    first_name_ar: "مايا",
    last_name_ar: "حداد",
    grade: "7",
    section: "a",
    date_of_birth: "2014-03-18",
    emirates_id: "784-2014-1234567-1",
    guardian_first_name_en: "Nour",
    guardian_last_name_en: "Haddad",
    guardian_email: "Nour.Haddad@itest.example",
    guardian_phone: "+971 50 000 0001",
    relationship: "mother",
  },
  {
    // Sibling with the same guardian (matched by email, case-insensitive).
    student_no: "IT-002",
    first_name_en: "Sami",
    last_name_en: "Haddad",
    grade: "Grade 3",
    date_of_birth: "12/09/2018",
    guardian_first_name_en: "Nour",
    guardian_last_name_en: "Haddad",
    guardian_email: "nour.haddad@itest.example",
    relationship: "Mother",
  },
  {
    // Invalid: grade out of range, bad date, bad guardian email.
    student_no: "IT-003",
    first_name_en: "Omar",
    last_name_en: "Saleh",
    grade: "15",
    date_of_birth: "2015-02-30",
    guardian_first_name_en: "Huda",
    guardian_last_name_en: "Saleh",
    guardian_email: "not-an-email",
  },
  {
    // Invalid: duplicate student number in the same file, missing last name.
    student_no: "it-001",
    first_name_en: "Copy",
    grade: "7",
  },
];

beforeAll(async () => {
  const org = await owner.organization.create({ data: { slug: uid("csv-itest"), nameEn: "CSV Test School", nameAr: "مدرسة اختبار" } });
  orgId = org.id;
  const user = await owner.user.create({ data: { email: `${uid("csv")}@itest.example`, nameEn: "Import Admin" } });
  const membership = await owner.membership.create({ data: { orgId, userId: user.id } });
  actor = { membershipId: membership.id, userId: user.id };
});

afterAll(async () => {
  if (orgId) {
    const where = { orgId };
    await owner.guardianLink.deleteMany({ where });
    await owner.guardian.deleteMany({ where });
    await owner.student.deleteMany({ where });
    await owner.csvImport.deleteMany({ where });
    await owner.auditEvent.deleteMany({ where });
    const members = await owner.membership.findMany({ where, select: { userId: true } });
    await owner.organization.delete({ where: { id: orgId } });
    await owner.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await owner.$disconnect();
});

describe("student CSV import", () => {
  it("imports valid rows, reports invalid rows by row number and field, and records the import", async () => {
    const res = await importStudentRows(orgId, actor, "students.csv", rows);
    expect(res.total).toBe(4);
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(2);
    expect(res.created).toBe(2);

    const byRow = (row: number) => res.errors.filter((e) => e.row === row).map((e) => `${e.field}:${e.code}`).sort();
    expect(byRow(4)).toEqual(["date_of_birth:date", "grade:grade", "guardian_email:email"]);
    expect(byRow(5)).toEqual(["last_name_en:required", "student_no:duplicate"]);
    // Error entries never carry cell values.
    for (const e of res.errors) expect(Object.keys(e).sort()).toEqual(["code", "field", "row"]);

    const students = await owner.student.findMany({ where: { orgId }, orderBy: { studentNo: "asc" } });
    expect(students.map((s) => s.studentNo)).toEqual(["IT-001", "IT-002"]);
    const maya = students[0];
    expect(maya.section).toBe("A");
    expect(maya.firstNameAr).toBe("مايا");
    expect(maya.dateOfBirth?.toISOString().slice(0, 10)).toBe("2014-03-18");
    expect(maya.emiratesIdEnc).not.toContain("1234567");
    expect(decryptField(maya.emiratesIdEnc!)).toBe("784-2014-1234567-1");
    expect(maya.emiratesIdLast4).toBe("4567");
    // Arabic names fall back to English when the file leaves them empty.
    expect(students[1].firstNameAr).toBe("Sami");
    expect(students[1].gradeLevel).toBe(3);
    expect(students[1].dateOfBirth?.toISOString().slice(0, 10)).toBe("2018-09-12");

    const guardians = await owner.guardian.findMany({ where: { orgId } });
    expect(guardians).toHaveLength(1);
    const links = await owner.guardianLink.findMany({ where: { orgId } });
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.isPrimary && l.relationshipEn === "Mother" && l.relationshipAr === "الأم")).toBe(true);

    const record = await owner.csvImport.findUniqueOrThrow({ where: { id: res.importId } });
    expect(record).toMatchObject({ entity: "students", status: "COMPLETED", total: 4, succeeded: 2, failed: 2, createdById: actor.membershipId });
    const audit = await owner.auditEvent.findFirst({ where: { orgId, action: "people.import_students", entityId: res.importId } });
    expect(audit).not.toBeNull();
  });

  it("is idempotent: importing the same rows again creates no duplicates", async () => {
    const res = await importStudentRows(orgId, actor, "students.csv", rows);
    expect(res.succeeded).toBe(2);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(2);
    expect(await owner.student.count({ where: { orgId } })).toBe(2);
    expect(await owner.guardian.count({ where: { orgId } })).toBe(1);
    expect(await owner.guardianLink.count({ where: { orgId } })).toBe(2);
    expect(await owner.csvImport.count({ where: { orgId } })).toBe(2);
  });

  it("updates existing students in place when a later file changes them", async () => {
    await importStudentRows(orgId, actor, "update.csv", [{ student_no: "IT-002", first_name_en: "Sami", last_name_en: "Haddad", grade: "4", section: "B" }]);
    const sami = await owner.student.findUniqueOrThrow({ where: { orgId_studentNo: { orgId, studentNo: "IT-002" } } });
    expect(sami.gradeLevel).toBe(4);
    expect(sami.section).toBe("B");
    // Identifiers and date of birth are kept when the new file leaves them blank.
    expect(sami.dateOfBirth?.toISOString().slice(0, 10)).toBe("2018-09-12");
    expect(await owner.guardianLink.count({ where: { orgId } })).toBe(2);
  });

  it("marks an import with no valid rows as failed and rejects oversized files", async () => {
    const res = await importStudentRows(orgId, actor, "bad.csv", [{ student_no: "", first_name_en: "", grade: "x" }]);
    expect(res.succeeded).toBe(0);
    const record = await owner.csvImport.findUniqueOrThrow({ where: { id: res.importId } });
    expect(record.status).toBe("FAILED");
    const big = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ student_no: `B-${i}`, first_name_en: "A", last_name_en: "B", grade: "5" }));
    await expect(importStudentRows(orgId, actor, "big.csv", big)).rejects.toBeInstanceOf(ImportTooLargeError);
  });
});
