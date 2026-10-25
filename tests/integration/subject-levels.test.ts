// Elective impact and subject levels through the RLS-restricted app role: next year's course selection
// with an AP and a regular version of one subject, a student's target list, the impact numbers the
// picker shows, access (parents see only their own child) and tenant isolation of school programmes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import type { Permission } from "@/server/identity/permissions";
import { EngineAccessError, type EngineActor } from "@/server/pathway-engine/access";
import { clearLevelCaches, electiveImpactFor, subjectLevelsFor, worldPrograms } from "@/server/pathway-engine/levels-service";
import { offeringsFor, saveRegistration, selectionYear } from "@/server/registration/service";
import { seedGlobalCatalog } from "../../prisma/seed/catalog";
import { wipeTenant } from "../../prisma/seed/lib";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
let orgA: string;
let orgB: string;
let student: string;
let otherStudent: string;
let nextYearId: string;
const sub: Record<string, string> = {};
const prog: Record<string, string> = {};

const actor = (orgId: string, over: Partial<EngineActor> = {}): EngineActor => ({
  db: tenantDb(orgId),
  orgId,
  membershipId: "m-staff",
  isStudent: false,
  isParent: false,
  isStaff: true,
  visibleStudentIds: null,
  can: (p: Permission) => p === "pathways.view",
  ...over,
});

/** A school's own programme with one American requirement line (verbatim-style quote). */
async function ownProgram(orgId: string, key: string, country: string, keys: string[], quote: string) {
  const uni = await owner.university.create({ data: { orgId, key: `${key}-uni`, nameEn: `${key} University`, nameAr: `جامعة ${key}`, countryCode: country, cityEn: "City", cityAr: "مدينة", programsEn: ["Computer Science"] } });
  const p = await owner.universityProgram.create({ data: { orgId, universityId: uni.id, key, nameEn: `${key} Computer Science`, nameAr: `علوم الحاسوب ${key}`, field: "computer_science", degree: "BSc", requirements: {}, fieldKeys: ["computer_science"] } });
  await owner.programRequirement.create({
    data: { orgId, programId: p.id, intakeYear: 2028, curriculum: "AMERICAN", confidence: "OFFICIAL", subjects: { create: [{ orgId, type: "REQUIRED", canonicalSubjectKeys: keys, minimumLevel: "ADVANCED", alternatives: [], evidenceQuote: quote }] } },
  });
  return { programId: p.id, universityId: uni.id, nameEn: p.nameEn };
}

beforeAll(async () => {
  await seedGlobalCatalog(owner);
  clearLevelCaches();
  orgA = (await owner.organization.create({ data: { slug: uid("levels-itest"), nameEn: "Levels Test School", nameAr: "مدرسة اختبار المستويات" } })).id;
  orgB = (await owner.organization.create({ data: { slug: uid("levels-itest-b"), nameEn: "Other School", nameAr: "مدرسة أخرى" } })).id;
  const year = await owner.academicYear.create({ data: { orgId: orgA, nameEn: "2026-2027", nameAr: "2026-2027", startsOn: new Date("2026-08-24"), endsOn: new Date("2027-07-02"), isCurrent: true } });
  nextYearId = (await owner.academicYear.create({ data: { orgId: orgA, nameEn: "2027-2028", nameAr: "2027-2028", startsOn: new Date("2027-08-23"), endsOn: new Date("2028-07-01") } })).id;
  void year;
  for (const [code, en] of [["MATH", "Mathematics"], ["AP_PHYS_1", "AP Physics 1"], ["US_PHYS", "Physics"], ["US_ART", "Studio Art"]]) {
    sub[code] = (await owner.subject.create({ data: { orgId: orgA, code, nameEn: en, nameAr: en } })).id;
  }
  const courses = new Map((await owner.curriculumCourse.findMany({ where: { orgId: null, code: { in: ["AP_PHYS_1", "US_PHYS"] } } })).map((c) => [c.code, c.id]));
  await owner.subjectOffering.createMany({
    data: [
      { orgId: orgA, academicYearId: nextYearId, subjectId: sub.MATH, gradeLevel: 10, kind: "CORE", curriculum: "AMERICAN" },
      { orgId: orgA, academicYearId: nextYearId, subjectId: sub.AP_PHYS_1, gradeLevel: 10, kind: "OPTION", optionBlock: "A", curriculum: "AMERICAN", courseId: courses.get("AP_PHYS_1")!, isAP: true },
      { orgId: orgA, academicYearId: nextYearId, subjectId: sub.US_PHYS, gradeLevel: 10, kind: "OPTION", optionBlock: "A", curriculum: "AMERICAN", courseId: courses.get("US_PHYS")! },
      { orgId: orgA, academicYearId: nextYearId, subjectId: sub.US_ART, gradeLevel: 10, kind: "OPTION", optionBlock: "B", curriculum: "AMERICAN" },
    ],
  });
  student = (await owner.student.create({ data: { orgId: orgA, studentNo: "LV-1", firstNameEn: "Test", lastNameEn: "One", firstNameAr: "طالب", lastNameAr: "واحد", gradeLevel: 9, curriculum: "AMERICAN" } })).id;
  otherStudent = (await owner.student.create({ data: { orgId: orgA, studentNo: "LV-2", firstNameEn: "Test", lastNameEn: "Two", firstNameAr: "طالب", lastNameAr: "اثنان", gradeLevel: 9, curriculum: "AMERICAN" } })).id;
  // Two targets: one asks for AP Physics, one accepts any physics course.
  const ap = await ownProgram(orgA, uid("apuni"), "GB", ["physics"], "5, 5, 5 in three Advanced Placement Tests including Physics 1");
  const any = await ownProgram(orgA, uid("anyuni"), "CA", ["physics"], "Courses must include: physics");
  prog.ap = ap.programId;
  prog.any = any.programId;
  for (const p of [ap, any]) await owner.shortlistEntry.create({ data: { orgId: orgA, studentId: student, universityId: p.universityId, programEn: p.nameEn, category: "TARGET" } });
  // Another school's own programme must never appear for this school.
  prog.foreign = (await ownProgram(orgB, uid("foreign"), "US", ["physics"], "Courses must include: physics")).programId;
});

afterAll(async () => {
  for (const id of [orgA, orgB]) {
    if (!id) continue;
    await wipeTenant(owner, id);
    await owner.subjectRequirement.deleteMany({ where: { orgId: id } });
    await owner.programRequirement.deleteMany({ where: { orgId: id } });
    await owner.universityProgram.deleteMany({ where: { orgId: id } });
    await owner.university.deleteMany({ where: { orgId: id } });
    await owner.organization.delete({ where: { id } });
  }
  await owner.$disconnect();
});

describe("course selection for next year", () => {
  it("finds next year and its American offerings for the grade above", async () => {
    const res = await tenantTx(orgA, async (tx) => {
      const next = await selectionYear(tx, orgA);
      return { next, offerings: next ? await offeringsFor(tx, orgA, next.id, 10, "AMERICAN") : [] };
    });
    expect(res.next?.id).toBe(nextYearId);
    expect(res.offerings.map((o) => o.code).sort()).toEqual(["AP_PHYS_1", "MATH", "US_ART", "US_PHYS"]);
    expect(res.offerings.find((o) => o.code === "AP_PHYS_1")?.isAP).toBe(true);
    const british = await tenantTx(orgA, (tx) => offeringsFor(tx, orgA, nextYearId, 10, "BRITISH"));
    expect(british).toHaveLength(0);
  });

  it("saves next year's choices without allocating classes", async () => {
    const r = await tenantTx(orgA, (tx) => saveRegistration(tx, orgA, { studentId: otherStudent, optionSubjectIds: [sub.US_PHYS, sub.US_ART], source: "STUDENT", actorId: null, academicYearId: nextYearId }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary.placed).toBe(0);
    const regs = await owner.subjectRegistration.findMany({ where: { orgId: orgA, studentId: otherStudent, academicYearId: nextYearId } });
    expect(regs.map((x) => x.subjectId).sort()).toEqual([sub.MATH, sub.US_ART, sub.US_PHYS].sort());
    expect(regs.every((x) => x.classId === null)).toBe(true);
  });
});

describe("elective impact in the picker", () => {
  it("AP Physics 1 is needed for both targets; regular Physics only for the one that accepts any level", async () => {
    const imp = await electiveImpactFor(actor(orgA), student, { yearId: nextYearId, chosen: [] });
    expect(imp).not.toBeNull();
    expect(imp!.targetIds.sort()).toEqual([prog.ap, prog.any].sort());
    const ap = imp!.options[sub.AP_PHYS_1];
    const reg = imp!.options[sub.US_PHYS];
    expect(ap.targets.sort()).toEqual([prog.ap, prog.any].sort());
    expect(reg.targets).toEqual([prog.any]);
    // Keeps more programmes open: everything regular Physics opens, plus the AP-only ones.
    expect(ap.programs).toEqual(expect.arrayContaining(reg.programs));
    expect(ap.programs.length).toBeGreaterThan(reg.programs.length);
    expect(ap.programs).toContain(prog.ap);
    expect(reg.programs).not.toContain(prog.ap);
    expect(imp!.options[sub.US_ART].programs).toEqual([]);
    expect(imp!.families[sub.AP_PHYS_1]).toBe("physics");
    expect(imp!.families[sub.US_PHYS]).toBe("physics");
  });

  it("subject levels name the AP requirement and the regular one", async () => {
    const lv = await subjectLevelsFor(actor(orgA), student);
    const physics = lv.plan.rows.find((r) => r.key === "physics")!;
    expect(physics.high).toEqual([prog.ap]);
    expect(physics.regular).toEqual([prog.any]);
    expect(lv.source).toBe("shortlist");
  });

  it("a parent sees only their own child", async () => {
    const parent = actor(orgA, { isStaff: false, isParent: true, visibleStudentIds: [otherStudent], can: (p) => p === "pathways.view" });
    await expect(electiveImpactFor(parent, student, { yearId: nextYearId, chosen: [] })).rejects.toBeInstanceOf(EngineAccessError);
    await expect(subjectLevelsFor(parent, student)).rejects.toBeInstanceOf(EngineAccessError);
  });

  it("another school's own programmes never count", async () => {
    clearLevelCaches();
    const ids = (await worldPrograms(actor(orgA))).map((p) => p.meta.id);
    expect(ids).toContain(prog.ap);
    expect(ids).not.toContain(prog.foreign);
    const idsB = (await worldPrograms(actor(orgB))).map((p) => p.meta.id);
    expect(idsB).toContain(prog.foreign);
    expect(idsB).not.toContain(prog.ap);
    const imp = await electiveImpactFor(actor(orgA), student, { yearId: nextYearId, chosen: [] });
    expect(imp!.options[sub.AP_PHYS_1].programs).not.toContain(prog.foreign);
  });
});
