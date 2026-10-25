// AP and level guidance per requirement line, checked against real quotes from the official catalog.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apExamRule, levelGuide, meetsGuide, LEVEL_OVERRIDES, type LevelClass } from "@/server/pathway-engine/level-guide";
import { evaluate } from "@/server/pathway-engine/evaluate";
import { LEVEL_RANK, type SubjectLevel } from "@/server/pathway-engine/types";
import { course, m, profile, program, row, subj } from "./fixtures";

const us = (keys: string[], quote: string, level: SubjectLevel | null = "ADVANCED", type = "REQUIRED") => levelGuide({ type, keys, minimumLevel: level, evidenceQuote: quote }, "AMERICAN");

describe("American lines, read from the verbatim quote", () => {
  it("AP required when the quote asks for AP tests, naming the AP course (Bath)", () => {
    const calc = us(["calculus"], "5, 5, 5 in three Advanced Placement Tests including Calculus BC and Physics 1");
    expect(calc.cls).toBe("AP_REQUIRED");
    expect(calc.onlyCodes).toEqual(["AP_CALC_BC"]);
    expect(calc.effectiveLevel).toBe("ADVANCED");
    const phys = us(["physics"], "5, 5, 5 in three Advanced Placement Tests including Calculus BC and Physics 1");
    expect(phys.cls).toBe("AP_REQUIRED");
    expect(phys.apCourses).toEqual(["AP_PHYS_1"]);
    expect(phys.onlyCodes).toBeUndefined();
  });

  it("Calculus AB named only to refuse it means BC only (Birmingham)", () => {
    const g = us(["calculus"], "For subjects requiring A-level Mathematics applicants must present with AP Calculus BC or International Baccalaureate HL Mathematics. (We do not accept AP Calculus AB to fulfil this requirement).");
    expect(g.cls).toBe("AP_REQUIRED");
    expect(g.apCourses).toEqual(["AP_CALC_BC"]);
    expect(g.onlyCodes).toEqual(["AP_CALC_BC"]);
  });

  it("AB or BC accepted: either AP Calculus course, nothing else (Manchester)", () => {
    const g = us(["calculus"], "Grade 5 in AP Calculus BC or Calculus AB (subscore not accepted)");
    expect(g.cls).toBe("AP_REQUIRED");
    expect(g.onlyCodes).toEqual(["AP_CALC_AB", "AP_CALC_BC"]);
    expect(us(["physics", "computer_science"], "Grade 5 in AP Physics or Computer Science").cls).toBe("AP_REQUIRED");
  });

  it("AP or a regular course when the quote offers both routes (Toronto, UAE University)", () => {
    expect(us(["precalculus", "calculus"], "Pre-Calculus and one of the following Calculus: AP Calculus AB or AP Calculus BC or Calculus 12").cls).toBe("AP_OR_REGULAR");
    const uaeu = us(["mathematics"], "Math: HS 90% or its equivalent: SAT Math: 590 points AP Math: 4 points IB- HL Math: 5 points GCE A-Level: B grade", null);
    expect(uaeu.cls).toBe("AP_OR_REGULAR");
    expect(uaeu.effectiveLevel).toBeNull();
  });

  it("Senior-level course when the quote asks for Grade 12 or senior high school, without AP (McMaster, NUS, NTU)", () => {
    const mcmaster = us(["english_language"], "Grade 12 English or English Literature is required for all programs.");
    expect(mcmaster.cls).toBe("SENIOR");
    expect(mcmaster.fromGrade).toBe(12);
    expect(mcmaster.effectiveLevel).toBeNull();
    expect(us(["mathematics"], "Year 12 or higher level pass in Mathematics Computer Engineering No").fromGrade).toBe(12);
    expect(us(["mathematics"], "Pass in Senior High School Level Mathematics, and").fromGrade).toBe(10);
    expect(levelGuide({ type: "OPTIONAL", keys: ["biology"], minimumLevel: "ADVANCED", evidenceQuote: "Applicants must have passed any three science subjects in any of the following grades: 11th or 12th." }, "AMERICAN").fromGrade).toBe(11);
  });

  it("Any level when the quote states no level, even if the stored tag is ADVANCED (McGill, Stanford)", () => {
    const mcgill = us(["precalculus"], "Courses must include: Pre-calculus; two of biology, chemistry or physics");
    expect(mcgill.cls).toBe("ANY_LEVEL");
    expect(mcgill.effectiveLevel).toBeNull();
    expect(us(["mathematics", "calculus"], "Mathematics: four years of rigorous mathematics, including calculus.", null, "RECOMMENDED").cls).toBe("ANY_LEVEL");
  });

  it("never says AP required without AP in the quote", () => {
    for (const q of ["Courses must include: Pre-calculus; chemistry and physics", "USA | American Diploma | Biology - 90%", "Applicants must complete Mathematics as a mandatory subject, along with one science subject (Physics, Biology, or Chemistry) *."]) {
      expect(us(["mathematics"], q).cls).not.toBe("AP_REQUIRED");
    }
  });

  it("reviewed overrides correct the rules, each with a reason", () => {
    expect(LEVEL_OVERRIDES.every((o) => o.why.length > 20)).toBe(true);
    const manchesterBus = us(["mathematics"], "USA High School Graduation Diploma with an overall GPA of 3.0 including grade B in Mathematics and English Language. PLUS three APs with scores 5, 5, 5.");
    expect(manchesterBus.cls).toBe("ANY_LEVEL");
    expect(manchesterBus.basis).toBe("override");
    const khalifa = us(["mathematics"], "Applicants must complete Mathematics as a mandatory subject, along with one science subject (Physics, Biology, or Chemistry) *.");
    expect(khalifa.cls).toBe("SENIOR");
    expect(khalifa.fromGrade).toBe(12);
  });

  it("keeps the stored level when there is no quote", () => {
    const g = levelGuide({ type: "REQUIRED", keys: ["calculus"], minimumLevel: "ADVANCED", evidenceQuote: null }, "AMERICAN");
    expect(g.basis).toBe("level");
    expect(g.effectiveLevel).toBe("ADVANCED");
  });
});

describe("other curricula use their own level words", () => {
  const g = (curriculum: string, level: SubjectLevel | null, quote = "") => levelGuide({ type: "REQUIRED", keys: ["mathematics"], minimumLevel: level, evidenceQuote: quote }, curriculum).cls;
  it("British, IB and the rest", () => {
    expect(g("BRITISH", "ADVANCED", "A-level Mathematics grade A")).toBe("A_LEVEL");
    expect(g("BRITISH", "FOUNDATION", "GCSE Mathematics grade 4")).toBe("GCSE");
    expect(g("BRITISH", "STANDARD", "AS Mathematics")).toBe("AS_LEVEL");
    expect(g("IB", "HIGHER")).toBe("IB_HL");
    expect(g("IB", "STANDARD")).toBe("IB_SL");
    expect(g("CBSE", "ADVANCED")).toBe("LEVEL");
    expect(levelGuide({ type: "REQUIRED", keys: ["mathematics"], minimumLevel: "ADVANCED", evidenceQuote: "A-level Mathematics" }, "BRITISH").effectiveLevel).toBe("ADVANCED");
  });
});

describe("meeting a line", () => {
  const bc = us(["calculus"], "Any course asking for maths must have specifically AP Calculus BC at grade 5.");
  const senior = us(["english_language"], "Grade 12 English or English Literature is required for all programs.");
  it("BC only: AP Calculus AB and AP Physics C do not count, BC does", () => {
    expect(meetsGuide(bc, { code: "AP_CALC_BC", gradeLevel: 12 }, "ADVANCED", LEVEL_RANK)).toBe(true);
    expect(meetsGuide(bc, { code: "AP_CALC_AB", gradeLevel: 12 }, "ADVANCED", LEVEL_RANK)).toBe(false);
    expect(meetsGuide(bc, { code: "AP_PHYS_C_MECH", gradeLevel: 12 }, "ADVANCED", LEVEL_RANK)).toBe(false);
    expect(meetsGuide(bc, { code: "US_CALC", gradeLevel: 12 }, "STANDARD", LEVEL_RANK)).toBe(false);
  });
  it("Senior level: a Grade 12 regular course or any AP course", () => {
    expect(meetsGuide(senior, { code: "US_ENG12", gradeLevel: 12 }, "STANDARD", LEVEL_RANK)).toBe(true);
    expect(meetsGuide(senior, { code: "US_ENG10", gradeLevel: 10 }, "STANDARD", LEVEL_RANK)).toBe(false);
    expect(meetsGuide(senior, { code: "AP_ENG_LANG", gradeLevel: 11 }, "ADVANCED", LEVEL_RANK)).toBe(true);
  });
});

describe("the engine follows the guidance", () => {
  const regularPrecalc = course({ code: "US_PRECALC_H", gradeLevel: 11, status: "PLANNED", gradeScale: "US_LETTER", mappings: [m("mathematics", "STANDARD", 4), m("precalculus", "STANDARD", 4)] });
  const apCalcAb = course({ code: "AP_CALC_AB", gradeLevel: 12, status: "PLANNED", gradeScale: "AP_5", mappings: [m("mathematics", "ADVANCED", 4), m("calculus", "ADVANCED", 4)] });
  const apCalcBc = course({ code: "AP_CALC_BC", gradeLevel: 12, status: "PLANNED", gradeScale: "AP_5", mappings: [m("mathematics", "ADVANCED", 5), m("calculus", "ADVANCED", 5)] });
  it("a regular Pre-calculus meets McGill's line, which the stored ADVANCED tag alone would refuse", () => {
    const line = { ...subj("REQUIRED", ["precalculus"], "ADVANCED"), evidenceQuote: "Courses must include: Pre-calculus; two of biology, chemistry or physics" };
    const r = evaluate(profile({ curriculum: "AMERICAN", gradeLevel: 9, courses: [regularPrecalc] }), program(row({ curriculum: "AMERICAN", confidence: "OFFICIAL", subjects: [line] })));
    expect(r.lines[0].status).toBe("met");
    expect(r.lines[0].guide?.cls).toBe("ANY_LEVEL");
  });
  it("Bristol needs AP Calculus BC: AB is not enough", () => {
    const line = { ...subj("REQUIRED", ["calculus"], "ADVANCED"), evidenceQuote: "Any course asking for maths must have specifically AP Calculus BC at grade 5." };
    const p = program(row({ curriculum: "AMERICAN", confidence: "OFFICIAL", subjects: [line] }));
    expect(evaluate(profile({ curriculum: "AMERICAN", courses: [apCalcAb] }), p).lines[0].status).toBe("not_met");
    expect(evaluate(profile({ curriculum: "AMERICAN", courses: [apCalcBc] }), p).lines[0].status).toBe("met");
  });
});

describe("AP exam rules on notes", () => {
  it("names the included AP course (Imperial)", () => {
    const r = apExamRule({ required: true, evidenceQuote: "Our minimum entry standard is: EITHER 5, 5, 5, 5, 5 to include Calculus BC OR 5, 5, 5 to include Calculus BC Award of acceptable school leaving qualification" }, "AMERICAN");
    expect(r?.cls).toBe("AP_REQUIRED");
    expect(r?.included).toEqual(["AP_CALC_BC"]);
  });
  it("one route among others, or not about AP at all", () => {
    expect(apExamRule({ required: true, evidenceQuote: "Applicants with US high school qualifications can meet our entry requirements through a combination of APs, Honors or Dual Enrolment Classes*, SATs and ACTs listed below." }, "AMERICAN")?.cls).toBe("AP_OR_REGULAR");
    expect(apExamRule({ required: true, evidenceQuote: "an overall total score of 1190 out of 1600 in SAT / a composite score of 24 in ACT; and" }, "AMERICAN")).toBeNull();
    expect(apExamRule({ required: true, evidenceQuote: "a minimum of 5 Advanced Placement (AP) Scores at grade 5" }, "BRITISH")).toBeNull();
  });
});

describe("every American line in the official catalog", () => {
  it("classifies to the reviewed counts", () => {
    const dir = "prisma/seed/catalog/official";
    const counts: Partial<Record<LevelClass, number>> = {};
    let apWithoutAp = 0;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const batch = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as { universities: Array<{ curriculumRules?: Record<string, { subjects?: Array<{ type: string; keys: string[]; minimumLevel?: SubjectLevel | null; quote?: string }> }>; programs?: Array<{ status: string; curricula?: Record<string, { subjects?: Array<{ type: string; keys: string[]; minimumLevel?: SubjectLevel | null; quote?: string }> }> }> }> };
      for (const u of batch.universities ?? [])
        for (const p of u.programs ?? []) {
          if (p.status === "DROP") continue;
          for (const s of (p.curricula?.AMERICAN ?? u.curriculumRules?.AMERICAN)?.subjects ?? []) {
            const g = levelGuide({ type: s.type, keys: s.keys, minimumLevel: s.minimumLevel ?? null, evidenceQuote: s.quote ?? null }, "AMERICAN");
            counts[g.cls] = (counts[g.cls] ?? 0) + 1;
            if (g.cls === "AP_REQUIRED" && g.basis === "quote" && !/\bAPs?\b|Advanced Placement|Calculus (AB|BC)|Physics C/.test(s.quote ?? "")) apWithoutAp++;
          }
        }
    }
    expect(counts).toEqual({ AP_REQUIRED: 24, AP_OR_REGULAR: 1, SENIOR: 27, ANY_LEVEL: 45 });
    expect(apWithoutAp).toBe(0);
  });
});
