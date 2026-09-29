import { describe, expect, it } from "vitest";
import { rankUnlocks } from "@/server/pathway-engine/unlock";
import { applyChanges, whatIf } from "@/server/pathway-engine/whatif";
import { findTargetPrograms, planCourses, type PlannerProgram } from "@/server/pathway-engine/planner";
import { hashString, stableStringify } from "@/server/pathway-engine/hash";
import { catalogCourse, course, m, profile, program, row, subj } from "./fixtures";

// A small American school catalog.
const CATALOG = [
  catalogCourse("US_ENG9", [9], [m("english_language", "STANDARD", 2)]),
  catalogCourse("US_ENG10", [10], [m("english_language", "STANDARD", 2)]),
  catalogCourse("US_ENG11", [11], [m("english_language", "STANDARD", 2)]),
  catalogCourse("AP_ENG_LANG", [11, 12], [m("english_language", "ADVANCED", 4)], "AP_5"),
  catalogCourse("US_ENG12", [12], [m("english_language", "STANDARD", 2)]),
  catalogCourse("US_ALG1_H", [9], [m("mathematics", "STANDARD", 3), m("algebra", "STANDARD", 3)]),
  catalogCourse("US_GEOM_H", [9, 10], [m("mathematics", "STANDARD", 3), m("geometry", "STANDARD", 3)]),
  catalogCourse("US_ALG2_H", [10, 11], [m("mathematics", "STANDARD", 3), m("algebra", "STANDARD", 3)]),
  catalogCourse("US_PRECALC_H", [11, 12], [m("mathematics", "STANDARD", 4), m("precalculus", "STANDARD", 4)]),
  catalogCourse("AP_CALC_AB", [11, 12], [m("mathematics", "ADVANCED", 4), m("calculus", "ADVANCED", 4)], "AP_5"),
  catalogCourse("AP_CALC_BC", [12], [m("mathematics", "ADVANCED", 5), m("calculus", "ADVANCED", 5)], "AP_5"),
  catalogCourse("US_BIO", [9], [m("science", "STANDARD", 2), m("biology", "STANDARD", 2)]),
  catalogCourse("US_PHYS_H", [10, 11], [m("science", "STANDARD", 3), m("physics", "STANDARD", 3)]),
  catalogCourse("AP_PHYS_1", [11, 12], [m("science", "ADVANCED", 4), m("physics", "ADVANCED", 4)], "AP_5"),
  catalogCourse("AP_CSA", [11, 12], [m("computer_science", "ADVANCED", 4)], "AP_5"),
  catalogCourse("US_INTRO_CS", [9, 10], [m("computer_science", "STANDARD", 2)]),
  catalogCourse("US_ARABIC", [9, 10, 11, 12], [m("arabic", "STANDARD", 3)]),
];
const code = (c: string) => CATALOG.find((x) => x.code === c)!;

const adam = () =>
  profile({
    curriculum: "AMERICAN",
    gradeLevel: 9,
    courses: [
      course({ courseId: "cc-US_ALG1_H", code: "US_ALG1_H", status: "IN_PROGRESS", gradeLevel: 9, predictedGrade: "A", gradeScale: "US_LETTER", mappings: code("US_ALG1_H").mappings }),
      course({ courseId: "cc-US_ENG9", code: "US_ENG9", status: "IN_PROGRESS", gradeLevel: 9, predictedGrade: "A-", gradeScale: "US_LETTER", mappings: code("US_ENG9").mappings }),
      course({ courseId: "cc-US_BIO", code: "US_BIO", status: "IN_PROGRESS", gradeLevel: 9, predictedGrade: "A", gradeScale: "US_LETTER", mappings: code("US_BIO").mappings }),
    ],
  });

const ukCs = program(row({ curriculum: "AMERICAN", subjects: [subj("REQUIRED", ["calculus"], "ADVANCED")] }));
const ukEng = program(row({ curriculum: "AMERICAN", subjects: [subj("REQUIRED", ["calculus"], "ADVANCED"), subj("REQUIRED", ["physics"], "ADVANCED")] }));
const usCs = program(row({ curriculum: "AMERICAN", subjects: [subj("REQUIRED", ["mathematics"], "STANDARD"), subj("RECOMMENDED", ["computer_science"], "ADVANCED")] }));

describe("unlock ranking", () => {
  it("ranks the course that opens the most doors first, with a score breakdown", () => {
    const res = rankUnlocks(adam(), [ukCs, ukEng, usCs], CATALOG);
    expect(res[0].course.code).toBe("AP_CALC_AB");
    expect(res[0].unlocks).toBe(1);
    expect(res[0].improves).toBe(1);
    expect(res[0].requiredBy).toBe(3);
    expect(res[0].breakdown.find((b) => b.part === "unlock")).toMatchObject({ count: 1, points: 100 });
    expect(res[0].gradeLevel).toBe(11);
  });
  it("is deterministic: ties break by course code", () => {
    const a = rankUnlocks(adam(), [ukCs, ukEng, usCs], CATALOG).map((r) => r.course.code);
    const b = rankUnlocks(adam(), [ukCs, ukEng, usCs], [...CATALOG].reverse()).map((r) => r.course.code);
    expect(a).toEqual(b);
    expect(a.indexOf("AP_CALC_AB")).toBeLessThan(a.indexOf("AP_CALC_BC"));
  });
  it("skips courses the student has and courses not offered in a grade they can still take", () => {
    const codes = rankUnlocks(profile({ ...adam(), gradeLevel: 12 }), [ukCs], CATALOG).map((r) => r.course.code);
    expect(codes).not.toContain("US_ALG1_H");
    expect(codes).not.toContain("US_INTRO_CS");
  });
  it("counts recommended lines separately", () => {
    const res = rankUnlocks(adam(), [usCs], CATALOG);
    const csa = res.find((r) => r.course.code === "AP_CSA")!;
    expect(csa.recommendedBy).toBe(1);
    expect(csa.unlocks).toBe(0);
  });
});

describe("what-if", () => {
  it("adding a course changes the status and lists the changed line", () => {
    const { deltas } = whatIf(adam(), [ukCs], [{ type: "add_course", course: code("AP_CALC_BC"), gradeLevel: 12 }]);
    expect(deltas[0]).toMatchObject({ before: "MISSING_REQUIREMENTS", after: "ON_TRACK", direction: 1, missingBefore: 1, missingAfter: 0 });
    expect(deltas[0].changedLines[0]).toMatchObject({ kind: "subject", before: "not_met", after: "met" });
  });
  it("dropping a course can make things worse", () => {
    const { deltas } = whatIf(adam(), [usCs], [{ type: "drop_course", courseRef: "US_ALG1_H" }]);
    expect(deltas[0]).toMatchObject({ before: "ON_TRACK", after: "MISSING_REQUIREMENTS", direction: -1 });
  });
  it("changing a predicted grade and adding a test score", () => {
    const p = program(row({ curriculum: "AMERICAN", subjects: [subj("REQUIRED", ["mathematics"], "STANDARD", "A")], languages: [{ id: "i", test: "IELTS", minOverall: 7 }] }));
    const base = adam();
    const { deltas } = whatIf(base, [p], [
      { type: "set_grade", courseRef: "US_ALG1_H", predictedGrade: "B" },
      { type: "set_test", kind: "IELTS", score: 6 },
    ]);
    expect(deltas[0].after).toBe("MISSING_REQUIREMENTS");
    expect(deltas[0].changedLines.length).toBe(2);
    // The original profile is not changed.
    expect(base.courses[0].predictedGrade).toBe("A");
    expect(applyChanges(base, [{ type: "set_overall", metric: "gpa", value: 3.9 }]).overall.gpa).toEqual({ value: 3.9, final: false });
  });
});

describe("planner", () => {
  const programs: PlannerProgram[] = [
    { id: "uk-cs", nameEn: "Computer Science BSc", nameAr: "علوم الحاسوب", universityEn: "UCL", universityAr: "كلية لندن الجامعية", countryCode: "GB", fieldKeys: ["computer_science"], worldRank: 9, program: { ...ukCs, id: "uk-cs" } },
    { id: "uk-eng", nameEn: "Electrical Engineering BEng", nameAr: "الهندسة الكهربائية", universityEn: "Imperial", universityAr: "إمبريال", countryCode: "GB", fieldKeys: ["electrical_engineering"], worldRank: 2, program: { ...ukEng, id: "uk-eng" } },
    { id: "us-cs", nameEn: "Computer Science BS", nameAr: "علوم الحاسوب", universityEn: "CMU", universityAr: "كارنيغي ميلون", countryCode: "US", fieldKeys: ["computer_science", "artificial_intelligence"], worldRank: 52, program: { ...usCs, id: "us-cs" } },
    { id: "uk-law", nameEn: "Law LLB", nameAr: "القانون", universityEn: "KCL", universityAr: "كينغز", countryCode: "GB", fieldKeys: ["law"], program: program(row({ curriculum: "AMERICAN" })) },
  ];
  const careerFields = [
    { careerKey: "ai_engineer", fieldKey: "artificial_intelligence", weight: 5 },
    { careerKey: "ai_engineer", fieldKey: "computer_science", weight: 5 },
    { careerKey: "ai_engineer", fieldKey: "electrical_engineering", weight: 2 },
  ];

  it("finds target programmes from a career and countries", () => {
    const t = findTargetPrograms({ careerKey: "ai_engineer", countries: ["GB"] }, careerFields, programs);
    expect(t.map((x) => x.p.id)).toEqual(["uk-cs", "uk-eng"]);
  });

  it("plans only school courses, in grades the school offers them, with prerequisites first", () => {
    const plan = planCourses({ profile: adam(), goal: { careerKey: "ai_engineer", countries: ["GB", "US"] }, careerFields, programs, catalog: CATALOG });
    const byCode = new Map(plan.items.map((i) => [i.code, i]));
    const calc = byCode.get("AP_CALC_BC")!;
    expect(calc.gradeLevel).toBe(12);
    expect(calc.source).toBe("requirement");
    expect(calc.reasonEn).toContain("UCL");
    expect(calc.reasonAr).toContain("مطلوبة");
    expect(byCode.get("US_PRECALC_H")!.gradeLevel).toBe(11);
    expect(byCode.get("US_ALG2_H")!.gradeLevel).toBe(10);
    expect(byCode.get("AP_PHYS_1")).toBeTruthy();
    for (const i of plan.items) {
      const c = CATALOG.find((x) => x.id === i.catalogId)!;
      expect(c.gradeLevels).toContain(i.gradeLevel);
      expect(i.gradeLevel).toBeGreaterThanOrEqual(10);
    }
  });

  it("adds core English, maths, science and Arabic in every planned year", () => {
    const plan = planCourses({ profile: adam(), goal: { careerKey: "ai_engineer" }, careerFields, programs, catalog: CATALOG });
    for (const g of [10, 11, 12]) {
      const inGrade = plan.items.filter((i) => i.gradeLevel === g).map((i) => i.code);
      expect(inGrade.some((c) => c.includes("ENG"))).toBe(true);
      expect(inGrade).toContain("US_ARABIC");
    }
    expect(plan.items.filter((i) => i.code === "US_ENG10")).toHaveLength(1);
  });

  it("keeps locked items and is deterministic", () => {
    const locked = [{ catalogId: "sc-AP_CSA", gradeLevel: 11 }];
    const a = planCourses({ profile: adam(), goal: { careerKey: "ai_engineer" }, careerFields, programs, catalog: CATALOG, locked });
    const b = planCourses({ profile: adam(), goal: { careerKey: "ai_engineer" }, careerFields, programs, catalog: [...CATALOG].reverse(), locked });
    expect(a.items.find((i) => i.code === "AP_CSA")).toMatchObject({ gradeLevel: 11, locked: true });
    expect(a.items.map((i) => `${i.code}@${i.gradeLevel}`)).toEqual(b.items.map((i) => `${i.code}@${i.gradeLevel}`));
  });

  it("warns when no school course covers a required subject", () => {
    const med: PlannerProgram = { ...programs[0], id: "med", fieldKeys: ["medicine"], program: program(row({ curriculum: "AMERICAN", subjects: [subj("REQUIRED", ["chemistry"], "ADVANCED")] })) };
    const plan = planCourses({ profile: adam(), goal: { fieldKeys: ["medicine"] }, careerFields, programs: [med], catalog: CATALOG });
    expect(plan.warnings).toContainEqual({ code: "no_course", subjectKey: "chemistry" });
  });
});

describe("hashing", () => {
  it("gives the same hash for the same inputs in any key order", () => {
    expect(hashString(stableStringify({ a: 1, b: [1, 2] }))).toBe(hashString(stableStringify({ b: [1, 2], a: 1 })));
    expect(hashString("x")).not.toBe(hashString("y"));
  });
});
