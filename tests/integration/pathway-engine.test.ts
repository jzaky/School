// Pathway engine service through the RLS-restricted app role: match caching by inputsHash,
// plan approval permission and audit, and parents limited to their own children.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb } from "@/lib/tenant-db";
import type { Ctx } from "@/server/context";
import type { Permission } from "@/server/identity/permissions";
import { visibleStudentIds } from "@/server/access/student-access";
import { EngineAccessError, type EngineActor } from "@/server/pathway-engine/access";
import { approvePlan, computeMatches, generatePlan, loadStudentProfile, requestPlanChanges, submitPlan } from "@/server/pathway-engine/service";
import { seedGlobalCatalog } from "../../prisma/seed/catalog";
import { wipeTenant } from "../../prisma/seed/lib";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
let orgId: string;
let studentA: string;
let studentB: string;
let programId: string;

const actor = (over: Partial<EngineActor> & { perms?: Permission[] }): EngineActor => ({
  db: tenantDb(orgId),
  orgId,
  membershipId: over.membershipId ?? "m-staff",
  isStudent: false,
  isParent: false,
  isStaff: true,
  visibleStudentIds: null,
  ...over,
  can: (p: Permission) => (over.perms ?? []).includes(p),
});

beforeAll(async () => {
  await seedGlobalCatalog(owner);
  const org = await owner.organization.create({ data: { slug: uid("engine-itest"), nameEn: "Engine Test School", nameAr: "مدرسة اختبار المحرك" } });
  orgId = org.id;
  const mk = (no: string, grade: number) => owner.student.create({ data: { orgId, studentNo: no, firstNameEn: "Test", lastNameEn: no, firstNameAr: "طالب", lastNameAr: no, gradeLevel: grade, curriculum: "BRITISH" } });
  studentA = (await mk("PE-A", 11)).id;
  studentB = (await mk("PE-B", 11)).id;
  const courses = await owner.curriculumCourse.findMany({ where: { orgId: null, curriculum: "BRITISH", code: { in: ["AL_MATH", "AL_PHYS", "AL_CS", "AL_FURTHER_MATH"] } } });
  const byCode = new Map(courses.map((c) => [c.code, c]));
  for (const [code, predicted] of [["AL_MATH", "A*"], ["AL_PHYS", "A*"], ["AL_CS", "A"]] as const) {
    await owner.studentCourse.create({ data: { orgId, studentId: studentA, courseId: byCode.get(code)!.id, localName: code, gradeLevel: 11, status: "IN_PROGRESS", predictedGrade: predicted, gradeScale: "A_LEVEL" } });
  }
  await owner.studentTestScore.create({ data: { orgId, studentId: studentA, kind: "IELTS", score: 7.5 } });
  await owner.schoolCourse.create({ data: { orgId, courseId: byCode.get("AL_FURTHER_MATH")!.id, gradeLevels: [11, 12] } });
  programId = (await owner.universityProgram.findFirstOrThrow({ where: { orgId: null, key: "ucl-computer-science-bsc" } })).id;
});

afterAll(async () => {
  await wipeTenant(owner, orgId);
  await owner.organization.delete({ where: { id: orgId } });
  await owner.$disconnect();
});

describe("pathway engine service", () => {
  it("caches matches by inputsHash and recomputes when inputs change", async () => {
    const staff = actor({ perms: ["pathways.view"] });
    const first = await computeMatches(staff, studentA, { programIds: [programId] });
    expect(first.matches).toHaveLength(1);
    expect(first.matches[0].cached).toBe(false);
    expect(first.matches[0].result.status).toBe("ON_TRACK");
    const row1 = await owner.requirementMatch.findFirstOrThrow({ where: { orgId, studentId: studentA, programId } });

    const second = await computeMatches(staff, studentA, { programIds: [programId] });
    expect(second.matches[0].cached).toBe(true);
    const row2 = await owner.requirementMatch.findFirstOrThrow({ where: { orgId, studentId: studentA, programId } });
    expect(row2.computedAt.getTime()).toBe(row1.computedAt.getTime());
    expect(row2.inputsHash).toBe(row1.inputsHash);

    // A lower IELTS score is a new input: the match is recomputed and now misses the English line.
    await owner.studentTestScore.updateMany({ where: { orgId, studentId: studentA }, data: { score: 6 } });
    const third = await computeMatches(staff, studentA, { programIds: [programId] });
    expect(third.matches[0].cached).toBe(false);
    expect(third.matches[0].result.status).toBe("MISSING_REQUIREMENTS");
    const row3 = await owner.requirementMatch.findFirstOrThrow({ where: { orgId, studentId: studentA, programId } });
    expect(row3.inputsHash).not.toBe(row1.inputsHash);
    expect(await owner.requirementMatch.count({ where: { orgId, studentId: studentA } })).toBe(1);
  });

  it("only counselors approve plans, and approval is audited", async () => {
    const student = actor({ membershipId: "m-student", isStudent: true, isStaff: false, visibleStudentIds: [studentA], perms: ["pathways.view"] });
    const { planId } = await generatePlan(student, studentA, { careerKey: "software_developer", countries: ["GB"] });
    const plan = await owner.studentCoursePlan.findUniqueOrThrow({ where: { id: planId }, include: { items: true } });
    expect(plan.status).toBe("DRAFT");
    expect(plan.orgId).toBe(orgId);

    await expect(approvePlan(student, planId, null)).rejects.toBeInstanceOf(EngineAccessError);
    const teacher = actor({ perms: ["pathways.view"] });
    await expect(approvePlan(teacher, planId, null)).rejects.toMatchObject({ code: "forbidden" });

    await submitPlan(student, planId);
    expect((await owner.studentCoursePlan.findUniqueOrThrow({ where: { id: planId } })).status).toBe("PROPOSED");

    const counselor = actor({ membershipId: "m-counselor", perms: ["pathways.view", "pathways.manage", "planner.approve"] });
    await expect(requestPlanChanges(counselor, planId, "  ")).rejects.toMatchObject({ code: "invalid" });
    await approvePlan(counselor, planId, "Add Further Maths.");
    const approved = await owner.studentCoursePlan.findUniqueOrThrow({ where: { id: planId } });
    expect(approved).toMatchObject({ status: "APPROVED", approvedById: "m-counselor", counselorNote: "Add Further Maths." });
    const events = await owner.auditEvent.findMany({ where: { orgId, entityType: "StudentCoursePlan", entityId: planId }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["pathways.plan.generate", "pathways.plan.submit", "pathways.plan.approve"]));
    expect(events.find((e) => e.action === "pathways.plan.approve")?.actorId).toBe("m-counselor");
  });

  it("a parent cannot load another family's student", async () => {
    // Build the parent's visible students the way request code does.
    const fakeCtx = { isStudent: false, isParent: true, membership: { guardian: { links: [{ studentId: studentB }] } }, can: () => false } as unknown as Ctx;
    const visible = await visibleStudentIds(fakeCtx);
    expect(visible).toEqual([studentB]);
    const parent = actor({ membershipId: "m-parent", isParent: true, isStaff: false, visibleStudentIds: visible, perms: ["pathways.view"] });
    await expect(loadStudentProfile(parent, studentA)).rejects.toMatchObject({ code: "forbidden" });
    await expect(computeMatches(parent, studentA, { programIds: [programId] })).rejects.toBeInstanceOf(EngineAccessError);
    const own = await loadStudentProfile(parent, studentB);
    expect(own.student.id).toBe(studentB);
    // Parents view plans but never edit them.
    await expect(generatePlan(parent, studentB, { careerKey: "doctor", countries: [] })).rejects.toMatchObject({ code: "forbidden" });
  });
});
