// Transcript import and the counselor dashboard through the RLS-restricted app role: commit is idempotent
// and audited, students and parents get only what they may, another school sees nothing, and the
// dashboard only reads its own school's cached results.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb } from "@/lib/tenant-db";
import type { Permission } from "@/server/identity/permissions";
import { EngineAccessError, type EngineActor } from "@/server/pathway-engine/access";
import { commitImport, createImport, getCourseRecord, getImport, listImports, setRowDecision, updateCourseRow } from "@/server/transcripts/service";
import { loadDashboard, recomputeCaseload } from "@/server/transcripts/dashboard";
import { addSchoolCourse, updateSchoolCourse } from "@/server/transcripts/catalog";
import type { ParsedRow } from "@/server/transcripts/types";
import { seedGlobalCatalog } from "../../prisma/seed/catalog";
import { wipeTenant } from "../../prisma/seed/lib";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
let orgA: string;
let orgB: string;
let student: string;
let sibling: string;
let studentB: string;
let importId: string;

const MANAGER: Permission[] = ["pathways.view", "pathways.manage", "planner.approve"];
const actor = (orgId: string, over: Partial<EngineActor> & { perms?: Permission[] } = {}): EngineActor => ({
  db: tenantDb(orgId),
  orgId,
  membershipId: over.membershipId ?? "m-counselor",
  isStudent: false,
  isParent: false,
  isStaff: true,
  visibleStudentIds: null,
  ...over,
  can: (p: Permission) => (over.perms ?? MANAGER).includes(p),
});

const line = (name: string, gradeLevel: number, status: ParsedRow["status"], finalGrade: string | null, predictedGrade: string | null = null): ParsedRow => ({ name, code: null, curriculum: null, gradeLevel, schoolYear: null, status, finalGrade, predictedGrade, gradeScale: null });

beforeAll(async () => {
  await seedGlobalCatalog(owner);
  orgA = (await owner.organization.create({ data: { slug: uid("tx-a"), nameEn: "Transcript School A", nameAr: "مدرسة أ" } })).id;
  orgB = (await owner.organization.create({ data: { slug: uid("tx-b"), nameEn: "Transcript School B", nameAr: "مدرسة ب" } })).id;
  const mk = (orgId: string, no: string) => owner.student.create({ data: { orgId, studentNo: no, firstNameEn: "Test", lastNameEn: no, firstNameAr: "طالب", lastNameAr: no, gradeLevel: 11, curriculum: "BRITISH" } });
  student = (await mk(orgA, "TX-1")).id;
  sibling = (await mk(orgA, "TX-2")).id;
  studentB = (await mk(orgB, "TX-B")).id;
  // A goal, so matches have target programmes (UK computer science).
  await owner.studentCoursePlan.create({ data: { orgId: orgA, studentId: student, name: "Plan", status: "DRAFT", goalFieldKeys: ["computer_science"], targetCountries: ["GB"] } });
  await owner.studentTestScore.create({ data: { orgId: orgA, studentId: student, kind: "IELTS", score: 7.5 } });
});

afterAll(async () => {
  for (const id of [orgA, orgB]) {
    await wipeTenant(owner, id);
    await owner.organization.delete({ where: { id } });
  }
  await owner.$disconnect();
});

describe("transcript import", () => {
  it("matches rows, commits them and reports the programmes that changed", async () => {
    const staff = actor(orgA);
    const res = await createImport(staff, {
      studentId: student,
      fileName: "record.csv",
      kind: "CSV",
      curriculum: "BRITISH",
      defaultGradeLevel: 11,
      rows: [line("A Level Maths", 11, "IN_PROGRESS", null, "A*"), line("A-Level Physics", 11, "IN_PROGRESS", null, "A*"), line("A-Level Computer Science", 11, "IN_PROGRESS", null, "A"), line("IGCSE Global Perspectives", 10, "COMPLETED", "A")],
      problems: [],
    });
    importId = res.id;
    expect(res).toMatchObject({ rows: 4, needsReview: 1 });
    const view = await getImport(staff, importId);
    expect(view.payload.rows.map((r) => r.decision)).toEqual(["AUTO", "AUTO", "AUTO", "NEEDS_REVIEW"]);
    expect(view.courses.get(view.payload.rows[0].courseId!)?.code).toBe("AL_MATH");

    const first = await commitImport(staff, importId);
    expect(first).toMatchObject({ created: 4, updated: 0, skipped: 0 });
    expect(first.programs.length).toBeGreaterThan(0);
    expect(first.programs.every((p) => p.before !== p.after || p.missingBefore !== p.missingAfter)).toBe(true);
    expect(first.rowEffects["0"]?.length ?? 0).toBeGreaterThan(0);
    const rows = await owner.studentCourse.findMany({ where: { orgId: orgA, studentId: student }, orderBy: { localName: "asc" } });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.source === "IMPORT" && r.importId === importId)).toBe(true);
    expect(rows.find((r) => r.localName === "IGCSE Global Perspectives")).toMatchObject({ mappingStatus: "NEEDS_REVIEW", courseId: null });
    expect(rows.find((r) => r.localName === "A Level Maths")).toMatchObject({ mappingStatus: "AUTO", predictedGrade: "A*", gradeScale: "A_LEVEL" });
    expect((await owner.transcriptImport.findUniqueOrThrow({ where: { id: importId } })).status).toBe("COMPLETED");
  });

  it("is idempotent on re-commit and keeps reviewer decisions", async () => {
    const staff = actor(orgA);
    await setRowDecision(staff, importId, 3, { type: "local" });
    const again = await commitImport(staff, importId);
    expect(again).toMatchObject({ created: 0, updated: 4, skipped: 0 });
    expect(again.programs).toEqual([]);
    const rows = await owner.studentCourse.findMany({ where: { orgId: orgA, studentId: student } });
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.localName === "IGCSE Global Perspectives")).toMatchObject({ mappingStatus: "CONFIRMED", courseId: null });
    const third = await commitImport(staff, importId);
    expect(third.created).toBe(0);
    expect(await owner.studentCourse.count({ where: { orgId: orgA, studentId: student } })).toBe(4);
    const events = await owner.auditEvent.findMany({ where: { orgId: orgA, entityId: importId }, select: { action: true, meta: true } });
    expect(events.filter((e) => e.action === "transcripts.import.commit")).toHaveLength(3);
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["transcripts.import.create", "transcripts.import.map"]));
    // Audit metadata never carries grades or course names.
    expect(JSON.stringify(events.map((e) => e.meta))).not.toMatch(/A\*|Maths|Physics/);
  });

  it("skips a course the student already has on record from another source", async () => {
    const staff = actor(orgA);
    const other = await createImport(staff, { studentId: student, fileName: "again.csv", kind: "CSV", curriculum: "BRITISH", defaultGradeLevel: 11, rows: [line("A Level Maths", 11, "IN_PROGRESS", null, "A")], problems: [] });
    const res = await commitImport(staff, other.id);
    expect(res).toMatchObject({ created: 0, skipped: 1 });
    expect(await owner.studentCourse.count({ where: { orgId: orgA, studentId: student } })).toBe(4);
  });

  it("lets the student view and upload but not commit; parents see neither", async () => {
    const self = actor(orgA, { membershipId: "m-student", isStudent: true, isStaff: false, visibleStudentIds: [student], perms: ["pathways.view"] });
    const record = await getCourseRecord(self, student);
    expect(record.canManage).toBe(false);
    expect(record.rows).toHaveLength(4);
    await expect(commitImport(self, importId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(setRowDecision(self, importId, 0, { type: "local" })).rejects.toMatchObject({ code: "forbidden" });
    const mine = await createImport(self, { studentId: student, fileName: "mine.csv", kind: "CSV", curriculum: "BRITISH", defaultGradeLevel: 11, rows: [line("A Level Chemistry", 11, "IN_PROGRESS", null, "B")], problems: [] });
    expect((await listImports(self)).map((i) => i.id)).toContain(mine.id);
    await expect(createImport(self, { studentId: sibling, fileName: "x.csv", kind: "CSV", curriculum: "BRITISH", defaultGradeLevel: 11, rows: [line("Biology", 11, "IN_PROGRESS", null, null)], problems: [] })).rejects.toBeInstanceOf(EngineAccessError);
    // Students change only the prediction of an unfinished course.
    const maths = record.rows.find((r) => r.localName === "A Level Maths")!;
    await updateCourseRow(self, maths.id, { predictedGrade: "a" });
    expect((await owner.studentCourse.findUniqueOrThrow({ where: { id: maths.id } })).predictedGrade).toBe("A");
    await expect(updateCourseRow(self, maths.id, { finalGrade: "A*" })).rejects.toMatchObject({ code: "forbidden" });

    const parent = actor(orgA, { membershipId: "m-parent", isParent: true, isStaff: false, visibleStudentIds: [student], perms: ["pathways.view"] });
    await expect(getCourseRecord(parent, student)).rejects.toMatchObject({ code: "forbidden" });
    await expect(getImport(parent, importId)).rejects.toMatchObject({ code: "forbidden" });
    expect(await listImports(parent)).toEqual([]);
    const otherParent = actor(orgA, { membershipId: "m-parent2", isParent: true, isStaff: false, visibleStudentIds: [sibling], perms: ["pathways.view"] });
    await expect(getCourseRecord(otherParent, student)).rejects.toBeInstanceOf(EngineAccessError);
    // Teachers without pathways.manage do not see course records.
    await expect(getCourseRecord(actor(orgA, { perms: ["pathways.view"] }), student)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("another school cannot see or commit the import", async () => {
    const staffB = actor(orgB, { membershipId: "m-b" });
    await expect(getImport(staffB, importId)).rejects.toMatchObject({ code: "not_found" });
    await expect(commitImport(staffB, importId)).rejects.toMatchObject({ code: "not_found" });
    expect(await listImports(staffB)).toEqual([]);
    await expect(getCourseRecord(staffB, student)).resolves.toMatchObject({ rows: [] });
  });
});

describe("school catalog and dashboard", () => {
  it("adds, updates and deactivates school courses with audit", async () => {
    const staff = actor(orgA);
    const course = await owner.curriculumCourse.findFirstOrThrow({ where: { orgId: null, code: "AL_FURTHER_MATH" } });
    const row = await addSchoolCourse(staff, course.id, { gradeLevels: [12, 11, 11] });
    expect(row.gradeLevels).toEqual([11, 12]);
    await updateSchoolCourse(staff, row.id, { active: false, notesEn: "Only with a Maths teacher's recommendation." });
    expect(await owner.schoolCourse.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ active: false, notesEn: "Only with a Maths teacher's recommendation." });
    await expect(addSchoolCourse(actor(orgA, { perms: ["pathways.view", "planner.approve"] }), course.id, { gradeLevels: [11] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(addSchoolCourse(staff, course.id, { gradeLevels: [] })).rejects.toMatchObject({ code: "invalid" });
    const actions = (await owner.auditEvent.findMany({ where: { orgId: orgA, entityId: row.id } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["pathways.catalog.add", "pathways.catalog.deactivate"]));
  });

  it("reads only its own school's cached results", async () => {
    await createImport(actor(orgB, { membershipId: "m-b" }), { studentId: studentB, fileName: "b.csv", kind: "CSV", curriculum: "BRITISH", defaultGradeLevel: 11, rows: [line("Mystery Course", 11, "IN_PROGRESS", null, null)], problems: [] });
    await owner.studentCourse.create({ data: { orgId: orgB, studentId: studentB, localName: "Local", gradeLevel: 11, status: "IN_PROGRESS", mappingStatus: "NEEDS_REVIEW" } });
    const a = await loadDashboard(actor(orgA), {});
    expect(a.students.map((s) => s.id).sort()).toEqual([student, sibling].sort());
    expect(Object.values(a.counts).reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
    expect(a.pendingImports.every((i) => i.studentId === student)).toBe(true);
    expect(a.mappings.flatMap((m) => m.studentId)).not.toContain(studentB);

    const b = await loadDashboard(actor(orgB, { membershipId: "m-b" }), {});
    expect(b.students.map((s) => s.id)).toEqual([studentB]);
    expect(Object.values(b.counts).reduce((x, y) => x + y, 0)).toBe(0);
    expect(b.pendingImports.map((i) => i.studentId)).toEqual([studentB]);
    expect(b.mappings.map((m) => m.studentId)).toEqual([studentB]);
    expect(b.awaiting).toEqual([]);

    const filtered = await loadDashboard(actor(orgA), { grade: 9 });
    expect(filtered.students).toEqual([]);
    await expect(loadDashboard(actor(orgA, { perms: ["pathways.view"] }), {})).rejects.toMatchObject({ code: "forbidden" });
    const re = await recomputeCaseload(actor(orgA), {});
    expect(re.evaluated).toBe(1);
  });
});
