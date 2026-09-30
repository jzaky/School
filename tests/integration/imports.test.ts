// Import center against real Postgres through the RLS-restricted app role: staff import idempotency and
// INVITED activation on invite accept, class import idempotency and enrollments, tenant isolation, permissions.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb } from "@/lib/tenant-db";
import { SYSTEM_ROLES } from "@/server/identity/permissions";
import type { SheetRecord } from "@/lib/imports/table";
import { importStaff, previewStaff } from "@/server/imports/staff";
import { classIdFor, importClasses, importEnrollments, previewClasses } from "@/server/imports/classes";
import { importStudents } from "@/server/imports/reuse";
import type { ImportActor } from "@/server/imports/access";
import { inviteStaff } from "@/server/access/invitations";
import { acceptInvite } from "@/server/access/join";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
type School = { orgId: string; actor: ImportActor; yearId: string; roleIds: Record<string, string>; tag: string };
let A: School;
let B: School;
const PASSWORD = "Sunrise-2026";
const rec = (rows: Array<Record<string, string>>): SheetRecord[] => rows.map((values, i) => ({ row: i + 2, values }));

const ADMIN_PERMS = new Set(SYSTEM_ROLES.find((r) => r.key === "school_admin")!.permissions as string[]);

async function makeSchool(label: string): Promise<School> {
  const tag = `${label}${Math.random().toString(36).slice(2, 6)}`;
  const org = await owner.organization.create({ data: { slug: uid(`imports-${label.toLowerCase()}`), nameEn: `Import School ${label}`, nameAr: `مدرسة الاستيراد ${label}` } });
  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) roleIds[r.key] = (await owner.role.create({ data: { orgId: org.id, key: r.key, nameEn: r.nameEn, nameAr: r.nameAr, permissions: r.permissions } })).id;
  const dept = await owner.department.create({ data: { orgId: org.id, key: "science", nameEn: "Science", nameAr: "العلوم" } });
  for (const [code, en, ar] of [["MATH", "Mathematics", "الرياضيات"], ["PHYS", "Physics", "الفيزياء"]]) await owner.subject.create({ data: { orgId: org.id, code, nameEn: en, nameAr: ar, departmentId: dept.id } });
  const year = await owner.academicYear.create({ data: { orgId: org.id, nameEn: "2026-2027", nameAr: "2026-2027", startsOn: new Date("2026-08-25"), endsOn: new Date("2027-07-01"), isCurrent: true } });
  await owner.campus.create({ data: { orgId: org.id, nameEn: "Main", nameAr: "الرئيسي", isMain: true } });
  const user = await owner.user.create({ data: { email: `${uid("admin")}@imports.test`, nameEn: `Admin ${label}` } });
  const m = await owner.membership.create({ data: { orgId: org.id, userId: user.id } });
  await owner.membershipRole.create({ data: { orgId: org.id, membershipId: m.id, roleId: roleIds.school_admin } });
  for (let i = 1; i <= 4; i++) {
    await owner.student.create({ data: { orgId: org.id, studentNo: `${tag}-S${i}`, firstNameEn: `Student${i}`, lastNameEn: "Test", firstNameAr: "طالب", lastNameAr: "اختبار", gradeLevel: 10 } });
  }
  return { orgId: org.id, actor: { orgId: org.id, membershipId: m.id, userId: user.id, perms: ADMIN_PERMS }, yearId: year.id, roleIds, tag };
}

const email = (p: string) => `${uid(p)}@imports.test`;

beforeAll(async () => {
  A = await makeSchool("A");
  B = await makeSchool("B");
});

afterAll(async () => {
  for (const s of [A, B]) if (s) await owner.organization.delete({ where: { id: s.orgId } }).catch(() => undefined);
  await owner.user.deleteMany({ where: { email: { endsWith: "@imports.test" } } });
  await owner.$disconnect();
});

describe("staff import", () => {
  it("creates INVITED staff with profile, roles, department and subjects, and re-import updates instead of duplicating", async () => {
    const hana = email("hana");
    const file = rec([
      { name_en: "Hana Karimi", name_ar: "هناء كريمي", email: hana.toUpperCase(), roles: "Teacher", department: "Science", job_title_en: "Physics Teacher", subjects: "PHYS; الرياضيات", grades: "9-11" },
      { name_en: "Bad Row", email: "nope", roles: "teacher" },
    ]);
    const first = await importStaff(A.actor, "staff.csv", file);
    expect(first).toMatchObject({ total: 2, succeeded: 1, failed: 1, created: 1, updated: 0 });
    expect(first.errors).toEqual([{ row: 3, field: "email", code: "email" }]);

    const user = await owner.user.findUnique({ where: { email: hana } });
    expect(user?.nameAr).toBe("هناء كريمي");
    const m = await owner.membership.findUnique({ where: { orgId_userId: { orgId: A.orgId, userId: user!.id } }, include: { roles: { include: { role: true } }, staffProfile: true } });
    expect(m?.status).toBe("INVITED");
    expect(m?.roles.map((r) => r.role.key)).toEqual(["teacher"]);
    expect(m?.staffProfile).toMatchObject({ jobTitleEn: "Physics Teacher", gradeLevels: [9, 10, 11] });
    const quals = await owner.teacherSubject.findMany({ where: { membershipId: m!.id } });
    expect(quals).toHaveLength(2);
    expect(quals.every((q) => q.gradeLevels.join() === "9,10,11")).toBe(true);

    // Same file again: nothing changes, nothing is duplicated.
    const again = await importStaff(A.actor, "staff.csv", file);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(await owner.membership.count({ where: { orgId: A.orgId, userId: user!.id } })).toBe(1);
    expect(await owner.teacherSubject.count({ where: { membershipId: m!.id } })).toBe(2);

    // A changed file updates the title and adds a role, and never removes the existing one.
    const preview = await previewStaff(A.actor, rec([{ name_en: "Hana Karimi", email: hana, roles: "Head of Department", job_title_en: "Head of Science" }]), "en");
    expect(preview.rows[0]).toMatchObject({ action: "update", changes: ["roles", "title"] });
    const third = await importStaff(A.actor, "staff-v2.csv", rec([{ name_en: "Hana Karimi", email: hana, roles: "Head of Department", job_title_en: "Head of Science" }]));
    expect(third.updated).toBe(1);
    const after = await owner.membership.findUnique({ where: { id: m!.id }, include: { roles: { include: { role: true } }, staffProfile: true } });
    expect(after?.roles.map((r) => r.role.key).sort()).toEqual(["department_head", "teacher"]);
    expect(after?.staffProfile?.jobTitleEn).toBe("Head of Science");
    const history = await tenantDb(A.orgId).csvImport.findMany({ where: { entity: "staff" } });
    expect(history.map((h) => h.status)).toEqual(["COMPLETED", "COMPLETED", "COMPLETED"]);
    expect(JSON.stringify(history.map((h) => h.errors))).not.toContain("nope");
  });

  it("sensitive roles need roles.manage, and the import needs admin.access with people.manage", async () => {
    const noRoles = { ...A.actor, perms: new Set([...ADMIN_PERMS].filter((p) => p !== "roles.manage")) };
    const res = await importStaff(noRoles, "dsl.csv", rec([{ name_en: "Safe Guard", email: email("dsl"), roles: "dsl" }]));
    expect(res.errors.map((e) => e.code)).toEqual(["sensitiveRole"]);
    expect(res.created).toBe(0);
    const ok = await importStaff(A.actor, "dsl.csv", rec([{ name_en: "Safe Guard", email: email("dsl"), roles: "dsl" }]));
    expect(ok.created).toBe(1);
    const registrar = { ...A.actor, perms: new Set(SYSTEM_ROLES.find((r) => r.key === "registrar")!.permissions as string[]) };
    await expect(importStaff(registrar, "x.csv", rec([{ name_en: "Xx Yy", email: email("x"), roles: "teacher" }]))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accepting an invitation activates the imported INVITED membership instead of creating another, keeping the school's roles", async () => {
    const e = email("omar");
    await importStaff(A.actor, "one.csv", rec([{ name_en: "Omar Test", email: e, roles: "teacher; counselor", subjects: "MATH", grades: "10" }]));
    const user = await owner.user.findUnique({ where: { email: e } });
    const before = await owner.membership.findUnique({ where: { orgId_userId: { orgId: A.orgId, userId: user!.id } }, include: { roles: true } });
    expect(before?.status).toBe("INVITED");

    // Inviting reuses the INVITED membership (no second one), then the school takes the counselor role away.
    const inv = await inviteStaff({ orgId: A.orgId, membershipId: A.actor.membershipId, userId: A.actor.userId }, [{ nameEn: "Omar Test", email: e, roleKeys: ["teacher", "counselor"] }], { send: false });
    expect(inv.problems).toEqual([]);
    await owner.membershipRole.deleteMany({ where: { membershipId: before!.id, roleId: A.roleIds.counselor } });

    const joined = await acceptInvite(inv.created[0].token, { mode: "create", name: "Omar Test", email: e, password: PASSWORD }, { ip: `itest-${uid("ip")}` });
    expect(joined.membershipId).toBe(before!.id);
    expect(await owner.membership.count({ where: { orgId: A.orgId, userId: user!.id } })).toBe(1);
    const after = await owner.membership.findUnique({ where: { id: before!.id }, include: { roles: { include: { role: true } } } });
    expect(after?.status).toBe("ACTIVE");
    expect(after?.roles.map((r) => r.role.key)).toEqual(["teacher"]);
    expect(await owner.teacherSubject.count({ where: { membershipId: before!.id } })).toBe(1);
  });

  it("sends invitations once: re-importing with invitations on does not email the same person again", async () => {
    const e = email("invite");
    const first = await importStaff(A.actor, "inv.csv", rec([{ name_en: "Invite Me", email: e, roles: "teacher" }]), { invite: true });
    expect(first.extra).toMatchObject({ invited: 1, alreadyInvited: 0 });
    expect(first.effects.length).toBeGreaterThan(0);
    const second = await importStaff(A.actor, "inv.csv", rec([{ name_en: "Invite Me", email: e, roles: "teacher" }]), { invite: true });
    expect(second.extra).toMatchObject({ invited: 0, alreadyInvited: 1 });
    expect(await owner.invitation.count({ where: { orgId: A.orgId, email: e, revokedAt: null } })).toBe(1);
  });
});

describe("classes and enrollments import", () => {
  let teacher: string;
  beforeAll(async () => {
    teacher = email("teacher");
    await importStaff(A.actor, "t.csv", rec([{ name_en: "Class Teacher", email: teacher, roles: "teacher" }]));
  });

  it("creates classes with an invited teacher and enrollments, and re-importing changes nothing", async () => {
    const S = (i: number) => `${A.tag}-S${i}`;
    const file = rec([
      { class_code: "10A-MATH", subject: "MATH", grade: "10", section: "A", teacher_email: teacher, room: "B-1", capacity: "24", students: `${S(1)}; ${S(2)}` },
      { class_code: "10B-MATH", subject: "Mathematics", grade: "10", section: "B", students: S(3) },
      { class_code: "10A-HR", grade: "10", section: "A", homeroom: "yes", students: `${S(1)} ${S(2)} ${S(3)}` },
      { class_code: "BAD", subject: "MATH", grade: "10", teacher_email: "ghost@imports.test", students: "NOPE-1" },
    ]);
    const res = await importClasses(A.actor, "classes.csv", file);
    expect(res).toMatchObject({ created: 3, failed: 1 });
    expect(res.extra).toMatchObject({ enrolled: 6, qualifications: 1 });
    expect(res.errors.map((e) => `${e.row}:${e.code}`)).toEqual(["5:unknownTeacher", "5:unknownStudent"]);
    const math = await owner.schoolClass.findUnique({ where: { id: classIdFor(A.orgId, A.yearId, "10a-math") }, include: { enrollments: true } });
    expect(math).toMatchObject({ nameEn: "Mathematics 10A", nameAr: "الرياضيات 10A", section: "A", room: "B-1", capacity: 24, academicYearId: A.yearId });
    expect(math?.enrollments).toHaveLength(2);
    const quals = await owner.teacherSubject.findFirst({ where: { membershipId: math!.teacherMembershipId! } });
    expect(quals?.gradeLevels).toEqual([10]);

    const again = await importClasses(A.actor, "classes.csv", file);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    expect(await owner.schoolClass.count({ where: { orgId: A.orgId } })).toBe(3);
    expect(await owner.enrollment.count({ where: { orgId: A.orgId } })).toBe(6);
  });

  it("an enrollments file moves a student between sections of the same subject and is idempotent", async () => {
    const S1 = `${A.tag}-S1`;
    const file = rec([{ class_code: "10B-MATH", student_no: S1 }, { class_code: "10A-HR", student_no: `${A.tag}-S4` }, { class_code: "NOPE", student_no: S1 }]);
    const res = await importEnrollments(A.actor, "enrol.csv", file);
    expect(res).toMatchObject({ created: 1, updated: 1, failed: 1 });
    const s1 = await owner.student.findFirst({ where: { orgId: A.orgId, studentNo: S1 }, include: { enrollments: { include: { class: true } } } });
    expect(s1?.enrollments.map((e) => e.class.nameEn).sort()).toEqual(["Homeroom 10A", "Mathematics 10B"]);
    const again = await importEnrollments(A.actor, "enrol.csv", file);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
  });

  it("adopts an existing class with the same grade, subject and section, then finds it by code next time", async () => {
    const phys = await owner.subject.findFirst({ where: { orgId: A.orgId, code: "PHYS" } });
    const legacy = await owner.schoolClass.create({ data: { orgId: A.orgId, academicYearId: A.yearId, subjectId: phys!.id, nameEn: "Physics 10", nameAr: "الفيزياء 10", gradeLevel: 10 } });
    const file = rec([{ class_code: "10-PHYS", subject: "PHYS", grade: "10", room: "LAB-2" }]);
    const preview = await previewClasses(A.actor, file, "en");
    expect(preview.rows[0].warnings.map((w) => w.code)).toEqual(["adopted"]);
    const res = await importClasses(A.actor, "phys.csv", file);
    expect(res).toMatchObject({ updated: 1, created: 0 });
    expect((await owner.schoolClass.findUnique({ where: { id: legacy.id } }))?.room).toBe("LAB-2");
    const enrol = await importEnrollments(A.actor, "phys-enrol.csv", rec([{ class_code: "10-phys", student_no: `${A.tag}-S2` }]));
    expect(enrol.created).toBe(1);
    expect(await owner.enrollment.count({ where: { classId: legacy.id } })).toBe(1);
    expect(await owner.schoolClass.count({ where: { orgId: A.orgId, gradeLevel: 10, subjectId: phys!.id } })).toBe(1);
  });
});

describe("tenant isolation", () => {
  it("a school cannot import into or through another school", async () => {
    // B uses A's teacher email, A's student numbers and A's class code: none of them exist for B.
    const aTeacher = await owner.membership.findFirst({ where: { orgId: A.orgId, status: "INVITED" }, include: { user: true } });
    const res = await importClasses(B.actor, "b.csv", rec([{ class_code: "10A-MATH", subject: "MATH", grade: "10", teacher_email: aTeacher!.user.email, students: `${A.tag}-S1` }]));
    expect(res.errors.map((e) => e.code)).toEqual(["unknownTeacher", "unknownStudent"]);
    const enrol = await importEnrollments(B.actor, "b.csv", rec([{ class_code: "10A-MATH", student_no: `${A.tag}-S1` }]));
    expect(enrol.errors.map((e) => e.code)).toEqual(["unknownClass", "unknownStudent"]);

    // Importing A's staff member into B adds a separate B membership and leaves A's untouched.
    const before = await owner.membership.findUnique({ where: { id: aTeacher!.id }, include: { roles: true, staffProfile: true } });
    const staff = await importStaff(B.actor, "b-staff.csv", rec([{ name_en: "Other Name", email: aTeacher!.user.email, roles: "School Counselor", job_title_en: "Counselor" }]));
    expect(staff.created).toBe(1);
    const afterA = await owner.membership.findUnique({ where: { id: aTeacher!.id }, include: { roles: true, staffProfile: true } });
    expect(afterA?.roles.map((r) => r.roleId)).toEqual(before?.roles.map((r) => r.roleId));
    expect(afterA?.staffProfile?.jobTitleEn).toBe(before?.staffProfile?.jobTitleEn);
    expect(await owner.membership.count({ where: { userId: aTeacher!.userId } })).toBe(2);

    // Import history and classes stay inside each school.
    expect((await tenantDb(B.orgId).csvImport.findMany()).every((i) => i.orgId === B.orgId)).toBe(true);
    expect(await tenantDb(B.orgId).schoolClass.findUnique({ where: { id: classIdFor(A.orgId, A.yearId, "10A-MATH") } })).toBeNull();
    expect(classIdFor(A.orgId, A.yearId, "10A-MATH")).not.toBe(classIdFor(B.orgId, B.yearId, "10A-MATH"));
  });

  it("the students importer is reused with real row numbers", async () => {
    const res = await importStudents(B.actor, "students.csv", [
      { row: 2, values: { student_no: "B-NEW-1", first_name_en: "Nadia", last_name_en: "Test", grade: "7" } },
      { row: 5, values: { student_no: "B-NEW-2", first_name_en: "Rami", grade: "7" } },
    ]);
    expect(res).toMatchObject({ created: 1, failed: 1 });
    expect(res.errors).toEqual([{ row: 5, field: "last_name_en", code: "required" }]);
  });
});
