// Subject levels across targets, elective impact (with and without each option) and the worldwide summary.
import { describe, expect, it } from "vitest";
import { buildLevelPlan, electiveImpact, familyOf, worldSummary } from "@/server/pathway-engine/levels";
import type { RequirementRow, SubjectLine } from "@/server/pathway-engine/types";
import { catalogCourse, course, m, profile, program, row } from "./fixtures";

const line = (type: SubjectLine["type"], keys: string[], quote: string, level: SubjectLine["minimumLevel"] = "ADVANCED"): SubjectLine => ({ id: `l-${keys.join("-")}-${quote.length}`, type, keys, minimumLevel: level, evidenceQuote: quote });
const american = (subjects: SubjectLine[], additional: RequirementRow["additional"] = []) => program(row({ curriculum: "AMERICAN", confidence: "OFFICIAL", subjects, additional }));

const bristol = american([line("REQUIRED", ["calculus"], "Any course asking for maths must have specifically AP Calculus BC at grade 5.")]);
const manchester = american([
  line("REQUIRED", ["calculus"], "Grade 5 in AP Calculus BC or Calculus AB (subscore not accepted)"),
  line("ONE_OF", ["physics", "computer_science"], "Grade 5 in AP Physics or Computer Science"),
]);
const mcgill = american([line("REQUIRED", ["precalculus"], "Courses must include: Pre-calculus; two of biology, chemistry or physics"), line("TWO_OF", ["biology", "chemistry", "physics"], "Courses must include: Pre-calculus; two of biology, chemistry or physics")]);
const imperial = american([], [{ id: "imp-note", kind: "NOTE", required: true, noteEn: "Five AP scores of 5", evidenceQuote: "Our minimum entry standard is: EITHER 5, 5, 5, 5, 5 to include Calculus BC OR 5, 5, 5 to include Calculus BC" }]);
const stanford = american([line("RECOMMENDED", ["mathematics", "calculus"], "Mathematics: four years of rigorous mathematics, including calculus.", null)]);

const grade9 = () =>
  profile({
    curriculum: "AMERICAN",
    gradeLevel: 9,
    courses: [course({ code: "US_BIO", gradeLevel: 9, status: "IN_PROGRESS", gradeScale: "US_LETTER", mappings: [m("biology", "STANDARD", 2), m("science", "STANDARD", 2)] })],
  });

describe("subject families", () => {
  it("groups mathematics lines and choices of sciences", () => {
    expect(familyOf(["calculus"])).toBe("mathematics");
    expect(familyOf(["precalculus", "calculus"])).toBe("mathematics");
    expect(familyOf(["biology", "chemistry", "physics"])).toBe("sciences");
    expect(familyOf(["physics", "computer_science"])).toBe("computer_science+physics");
  });
});

describe("subject levels across targets", () => {
  const plan = buildLevelPlan(grade9(), [bristol, manchester, mcgill, imperial, stanford]);
  const maths = plan.rows.find((r) => r.key === "mathematics")!;
  it("counts each target once per family, most demanding line first", () => {
    expect(maths.high.sort()).toEqual([bristol.id, imperial.id, manchester.id].sort());
    expect(maths.regular).toEqual([mcgill.id]);
    expect(maths.advice).toEqual([stanford.id]);
  });
  it("names AP Calculus BC when a target accepts only BC, and counts those targets", () => {
    expect(maths.course).toBe("AP_CALC_BC");
    expect(maths.bcOnly.sort()).toEqual([bristol.id, imperial.id].sort());
  });
  it("reads the AP exam rule note and keeps its quote", () => {
    expect(plan.examRules).toHaveLength(1);
    expect(plan.examRules[0].included).toEqual(["AP_CALC_BC"]);
    expect(maths.entries.find((e) => e.programId === imperial.id)?.via).toBe("exam_rule");
  });
  it("puts rows that need AP first", () => {
    expect(plan.rows[0].key).toBe("mathematics");
    expect(plan.rows.find((r) => r.key === "sciences")?.regular).toEqual([mcgill.id]);
  });
});

describe("elective impact", () => {
  const apPhysics = catalogCourse("AP_PHYS_1", [10], [m("physics", "ADVANCED", 4), m("science", "ADVANCED", 4)], "AP_5");
  const physics = catalogCourse("US_PHYS", [10], [m("physics", "STANDARD", 2), m("science", "STANDARD", 2)]);
  const apCsa = catalogCourse("AP_CSA", [10], [m("computer_science", "ADVANCED", 5)], "AP_5");
  const options = [
    { key: "ap-phys", block: "A", course: apPhysics, gradeLevel: 10 },
    { key: "phys", block: "A", course: physics, gradeLevel: 10 },
    { key: "art", block: "A", course: null, gradeLevel: 10 },
    { key: "ap-csa", block: "B", course: apCsa, gradeLevel: 10 },
  ];
  const programs = [manchester, mcgill, bristol];
  const targets = new Set([manchester.id, mcgill.id]);

  it("AP Physics 1 meets Manchester's AP line and McGill's any-level line; regular Physics only McGill's", () => {
    const r = electiveImpact(grade9(), programs, targets, options, {});
    expect(r["ap-phys"].targets.sort()).toEqual([manchester.id, mcgill.id].sort());
    expect(r["phys"].targets).toEqual([mcgill.id]);
    expect(r["ap-phys"].programs.length).toBeGreaterThan(r["phys"].programs.length);
    expect(r["ap-phys"].lines.find((l) => l.programId === manchester.id)?.cls).toBe("AP_REQUIRED");
    expect(r["phys"].lines[0].cls).toBe("ANY_LEVEL");
    expect(r["art"].programs).toEqual([]);
  });

  it("a choice in another block that already meets the line takes the credit away", () => {
    const r = electiveImpact(grade9(), programs, targets, options, { B: "ap-csa" });
    // AP Computer Science A already meets Manchester's "AP Physics or Computer Science" line.
    expect(r["ap-phys"].targets).toEqual([mcgill.id]);
    expect(r["ap-csa"].targets).toEqual([manchester.id]);
  });

  it("a course already on the record shows no impact", () => {
    const p = grade9();
    p.courses.push({ ...course({ courseId: apPhysics.courseId, code: "AP_PHYS_1", gradeLevel: 9, mappings: apPhysics.mappings }), status: "IN_PROGRESS" });
    expect(electiveImpact(p, programs, targets, options, {})["ap-phys"].programs).toEqual([]);
  });
});

describe("worldwide summary", () => {
  it("counts programmes, universities, countries and the open ones", () => {
    const s = worldSummary([
      { programId: "a", universityId: "u1", countryCode: "GB", status: "ELIGIBLE", covered: true },
      { programId: "b", universityId: "u1", countryCode: "GB", status: "MISSING_REQUIREMENTS", covered: true },
      { programId: "c", universityId: "u2", countryCode: "US", status: "ON_TRACK", covered: true },
      { programId: "d", universityId: "u3", countryCode: "CA", status: "NEEDS_MANUAL_REVIEW", covered: false },
    ]);
    expect(s).toMatchObject({ programs: 4, universities: 3, countries: 3, open: 2, openUniversities: 2, openCountries: 2 });
    expect(s.counts.MISSING_REQUIREMENTS).toBe(1);
    expect(s.byCountry[0]).toEqual({ country: "GB", programs: 2, open: 1 });
  });
});
