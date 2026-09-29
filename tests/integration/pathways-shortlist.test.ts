// Adding a university programme to a student's shortlist and seeing the gaps, through the RLS-restricted app role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb } from "@/lib/tenant-db";
import { addProgramToShortlist, programsForEntries } from "@/server/pathways/shortlist";
import { checkProgram, loadStudentPathway, CONFIRM_SCORE, SCORE_ENTITY } from "@/server/pathways/profile";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
const orgIds: string[] = [];
let orgId: string;
let otherOrgId: string;
let studentId: string;
let programId: string;

beforeAll(async () => {
  const org = await owner.organization.create({ data: { slug: uid("pathways-itest"), nameEn: "Pathways Test School", nameAr: "مدرسة اختبار المسارات" } });
  const other = await owner.organization.create({ data: { slug: uid("pathways-other"), nameEn: "Other School", nameAr: "مدرسة أخرى" } });
  orgId = org.id;
  otherOrgId = other.id;
  orgIds.push(orgId, otherOrgId);
  const phys = await owner.subject.create({ data: { orgId, code: "PHYS", nameEn: "Physics", nameAr: "الفيزياء" } });
  await owner.subject.create({ data: { orgId, code: "MATH", nameEn: "Mathematics", nameAr: "الرياضيات" } });
  const student = await owner.student.create({ data: { orgId, studentNo: "PW-1", firstNameEn: "Test", lastNameEn: "Student", firstNameAr: "طالب", lastNameAr: "اختبار", gradeLevel: 11, curriculum: "BRITISH" } });
  studentId = student.id;
  await owner.subjectRegistration.create({ data: { orgId, academicYearId: "year-1", studentId, subjectId: phys.id, status: "ALLOCATED" } });
  await owner.studentSubjectResult.createMany({
    data: [
      { orgId, studentId, subjectCode: "PHYS", curriculum: "BRITISH", level: "A_LEVEL", predicted: "A*" },
      { orgId, studentId, subjectCode: "CHEM", curriculum: "BRITISH", level: "A_LEVEL", predicted: "A" },
      { orgId, studentId, subjectCode: "ECON", curriculum: "BRITISH", level: "A_LEVEL", predicted: "A" },
    ],
  });
  const score = await owner.studentTestScore.create({ data: { orgId, studentId, kind: "IELTS", score: 6.5 } });
  await owner.auditEvent.create({ data: { orgId, action: CONFIRM_SCORE, entityType: SCORE_ENTITY, entityId: score.id } });
  const uni = await owner.university.create({ data: { orgId, key: "test_uni", nameEn: "Test University", nameAr: "جامعة الاختبار", countryCode: "GB", cityEn: "London", cityAr: "لندن", programsEn: ["Computer Science"], deadlineMonth: 1, acceptanceRate: 60 } });
  const program = await owner.universityProgram.create({
    data: {
      orgId,
      universityId: uni.id,
      key: "test-cs",
      nameEn: "Computer Science BSc",
      nameAr: "بكالوريوس علوم الحاسوب",
      field: "computer_science",
      degree: "BSc",
      requiredSubjects: ["MATH"],
      recommendedSubjects: ["FURTHER_MATH"],
      requirements: { route: { via: "UCAS", deadlines: [{ kind: "equal", month: 1, day: 14 }] }, admissionsTests: ["TMUA"], BRITISH: { grades: "A*AA", subjects: [{ code: "MATH", min: "A*" }] } },
      englishReq: { ielts: 7 },
      sourceUrl: "https://example.org/cs",
    },
  });
  programId = program.id;
});

afterAll(async () => {
  for (const id of orgIds) {
    const where = { orgId: id };
    await owner.shortlistRequirement.deleteMany({ where });
    await owner.shortlistEntry.deleteMany({ where });
    await owner.universityProgram.deleteMany({ where });
    await owner.university.deleteMany({ where });
    await owner.studentTestScore.deleteMany({ where });
    await owner.studentSubjectResult.deleteMany({ where });
    await owner.subjectRegistration.deleteMany({ where });
    await owner.student.deleteMany({ where });
    await owner.subject.deleteMany({ where });
    await owner.auditEvent.deleteMany({ where });
    await owner.organization.delete({ where: { id } });
  }
  await owner.$disconnect();
});

describe("pathways shortlist", () => {
  it("adds a programme to the shortlist and shows the gaps", async () => {
    const db = tenantDb(orgId);
    const res = await addProgramToShortlist(db, orgId, { studentId, programId, actorId: null });
    expect(res).toMatchObject({ ok: true, created: true });
    if (!res.ok) return;

    const entry = await owner.shortlistEntry.findUniqueOrThrow({ where: { id: res.entryId }, include: { requirements: true } });
    expect(entry).toMatchObject({ programEn: "Computer Science BSc", programAr: "بكالوريوس علوم الحاسوب", category: "REACH", status: "RESEARCHING" });
    expect(entry.deadline?.getUTCMonth()).toBe(0);
    expect(entry.requirements.map((r) => r.labelEn)).toContain("Register for the TMUA admissions test");
    expect(await owner.auditEvent.count({ where: { orgId, action: "pathways.shortlist.add", entityId: entry.id } })).toBe(1);

    // The shortlist finds the programme again and the checker lists the gaps.
    const programs = await programsForEntries(db, [entry]);
    const program = programs.get(`${entry.universityId}|${entry.programEn}`)!;
    const data = (await loadStudentPathway(db, orgId, studentId))!;
    expect(data.subjects).toEqual(["PHYS"]);
    expect(data.scores[0].confirmed).toBe(true);
    const check = checkProgram(program, data);
    expect(check.classesToTake).toEqual([
      { code: "MATH", required: true, offered: true },
      { code: "FURTHER_MATH", required: false, offered: false },
    ]);
    expect(check.scoreGaps).toContainEqual({ code: "IELTS", required: 7, have: 6.5 });
    expect(check.items.find((i) => i.id === "overall")).toMatchObject({ status: "met", have: "A*AA" });
    expect(check.items.find((i) => i.id === "admissions:TMUA")?.status).toBe("not_met");
  });

  it("does not add the same programme twice", async () => {
    const res = await addProgramToShortlist(tenantDb(orgId), orgId, { studentId, programId, actorId: null });
    expect(res).toMatchObject({ ok: true, created: false });
    expect(await owner.shortlistEntry.count({ where: { orgId } })).toBe(1);
  });

  it("cannot reach another school's programme", async () => {
    const res = await addProgramToShortlist(tenantDb(otherOrgId), otherOrgId, { studentId, programId, actorId: null });
    expect(res).toEqual({ ok: false, error: "not_found" });
  });
});
