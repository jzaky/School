import { describe, expect, it } from "vitest";
import { evaluate, statusCounts, homeCurriculumFor } from "@/server/pathway-engine/evaluate";
import { course, m, profile, program, row, subj } from "./fixtures";

const maths = (grade: string, status: "COMPLETED" | "IN_PROGRESS" | "PLANNED" = "COMPLETED", extra = {}) =>
  course({ status, finalGrade: status === "COMPLETED" ? grade : null, predictedGrade: status === "COMPLETED" ? null : grade || null, mappings: [m("mathematics"), m("calculus")], nameEn: "A-Level Mathematics", ...extra });

describe("subject lines", () => {
  it("REQUIRED lines are ANDed: all must be met", () => {
    const p = program(row({ subjects: [subj("REQUIRED", ["mathematics"]), subj("REQUIRED", ["physics"])] }));
    const r = evaluate(profile({ courses: [maths("A")] }), p);
    expect(r.status).toBe("MISSING_REQUIREMENTS");
    expect(r.counts.requiredSatisfied).toBe(1);
    expect(r.counts.requiredMissing).toBe(1);
  });

  it("several keys on one line are OR", () => {
    const p = program(row({ subjects: [subj("REQUIRED", ["physics", "mathematics"])] }));
    expect(evaluate(profile({ courses: [maths("A")] }), p).status).toBe("ELIGIBLE");
  });

  it("ONE_OF is met by any one key", () => {
    const p = program(row({ subjects: [subj("ONE_OF", ["biology", "chemistry", "mathematics"])] }));
    const r = evaluate(profile({ courses: [maths("B")] }), p);
    expect(r.status).toBe("ELIGIBLE");
    expect(r.lines[0].satisfiedBy?.[0].nameEn).toBe("A-Level Mathematics");
  });

  it("TWO_OF needs two different subjects", () => {
    const p = program(row({ subjects: [subj("TWO_OF", ["biology", "physics", "mathematics"])] }));
    const one = evaluate(profile({ courses: [maths("A")] }), p);
    expect(one.status).toBe("MISSING_REQUIREMENTS");
    expect(one.lines[0].filled).toBe(1);
    expect(one.classesToTake[0].slots).toBe(1);
    const two = evaluate(profile({ courses: [maths("A"), course({ finalGrade: "B", mappings: [m("physics")] })] }), p);
    expect(two.status).toBe("ELIGIBLE");
    expect(two.lines[0].satisfiedBy).toHaveLength(2);
  });

  it("TWO_OF counts one course once, even if it maps to two subjects", () => {
    const combined = course({ finalGrade: "A", mappings: [m("physics"), m("biology")], nameEn: "Combined Science" });
    const p = program(row({ subjects: [subj("TWO_OF", ["biology", "physics"])] }));
    const r = evaluate(profile({ courses: [combined] }), p);
    expect(r.status).toBe("MISSING_REQUIREMENTS");
    expect(r.lines[0].filled).toBe(1);
  });

  it("a STANDARD course does not satisfy an ADVANCED requirement", () => {
    const igcse = course({ finalGrade: "A*", gradeScale: "IGCSE_LETTER", mappings: [m("mathematics", "STANDARD", 3)] });
    const p = program(row({ subjects: [subj("REQUIRED", ["mathematics"], "ADVANCED")] }));
    const r = evaluate(profile({ courses: [igcse] }), p);
    expect(r.status).toBe("MISSING_REQUIREMENTS");
    expect(r.classesToTake[0]).toMatchObject({ subjectKeys: ["mathematics"], minimumLevel: "ADVANCED" });
  });

  it("a HIGHER course satisfies an ADVANCED requirement", () => {
    const hl = course({ finalGrade: "7", gradeScale: "IB_7", mappings: [m("mathematics", "HIGHER", 5)] });
    const p = program(row({ curriculum: "IB", subjects: [subj("REQUIRED", ["mathematics"], "ADVANCED")] }));
    expect(evaluate(profile({ curriculum: "IB", courses: [hl] }), p).status).toBe("ELIGIBLE");
  });

  it("checks the minimum grade on the course's own scale", () => {
    const p = program(row({ subjects: [subj("REQUIRED", ["mathematics"], "ADVANCED", "A*")] }));
    expect(evaluate(profile({ courses: [maths("A")] }), p).status).toBe("MISSING_REQUIREMENTS");
    expect(evaluate(profile({ courses: [maths("A*")] }), p).status).toBe("ELIGIBLE");
  });

  it("a grade on a different scale is unknown, never converted", () => {
    const ap = course({ finalGrade: "5", gradeScale: "AP_5", mappings: [m("mathematics")] });
    const p = program(row({ subjects: [subj("REQUIRED", ["mathematics"], "ADVANCED", "A")] }));
    const r = evaluate(profile({ courses: [ap] }), p);
    expect(r.lines[0]).toMatchObject({ status: "unknown", reason: "scale_mismatch" });
    expect(r.status).toBe("POSSIBLY_ELIGIBLE");
  });

  it("RECOMMENDED lines are never gaps", () => {
    const p = program(row({ subjects: [subj("REQUIRED", ["mathematics"]), subj("RECOMMENDED", ["further_mathematics"]), subj("PREFERRED", ["computer_science"])] }));
    const r = evaluate(profile({ courses: [maths("A")] }), p);
    expect(r.status).toBe("ELIGIBLE");
    expect(r.counts.requiredMissing).toBe(0);
    expect(r.classesToTake).toHaveLength(0);
    expect(r.suggestedClasses.map((c) => c.subjectKeys[0])).toEqual(["further_mathematics", "computer_science"]);
  });

  it("recommended subjects that are met are counted", () => {
    const p = program(row({ subjects: [subj("RECOMMENDED", ["mathematics"])] }));
    expect(evaluate(profile({ courses: [maths("A")] }), p).counts.recommendedSatisfied).toBe(1);
  });

  it("reports the course that satisfied a line", () => {
    const p = program(row({ subjects: [subj("REQUIRED", ["calculus"])] }));
    const r = evaluate(profile({ courses: [maths("A", "COMPLETED", { id: "math-1" })] }), p);
    expect(r.lines[0].satisfiedBy?.[0]).toMatchObject({ courseId: "math-1", subjectKey: "calculus", grade: "A", basis: "final" });
  });
});

describe("predicted, planned and final results", () => {
  const p = program(row({ subjects: [subj("REQUIRED", ["mathematics"], "ADVANCED", "A")] }));

  it("final results give ELIGIBLE", () => {
    expect(evaluate(profile({ courses: [maths("A")] }), p).status).toBe("ELIGIBLE");
  });
  it("predicted grades give ON_TRACK", () => {
    expect(evaluate(profile({ courses: [maths("A", "IN_PROGRESS")] }), p).status).toBe("ON_TRACK");
  });
  it("a planned course without a grade leaves the line unknown (grade pending)", () => {
    const r = evaluate(profile({ courses: [maths("", "PLANNED")] }), p);
    expect(r.lines[0]).toMatchObject({ status: "unknown", reason: "grade_pending" });
    expect(r.status).toBe("POSSIBLY_ELIGIBLE");
  });
  it("a planned course with no grade requirement counts as on track", () => {
    const q = program(row({ subjects: [subj("REQUIRED", ["mathematics"])] }));
    const r = evaluate(profile({ courses: [maths("", "PLANNED")] }), q);
    expect(r.status).toBe("ON_TRACK");
    expect(r.lines[0].basis).toBe("planned");
  });
  it("a completed course without a final grade is unknown (grade missing)", () => {
    const c = course({ status: "COMPLETED", mappings: [m("mathematics")] });
    expect(evaluate(profile({ courses: [c] }), p).lines[0].reason).toBe("grade_missing");
  });
  it("a predicted grade below the minimum is not met", () => {
    expect(evaluate(profile({ courses: [maths("B", "IN_PROGRESS")] }), p).status).toBe("MISSING_REQUIREMENTS");
  });
});

describe("unknown propagation", () => {
  it("a mapping that needs review makes the line unknown", () => {
    const c = maths("A*", "COMPLETED", { mappingStatus: "NEEDS_REVIEW" });
    const r = evaluate(profile({ courses: [c] }), program(row({ subjects: [subj("REQUIRED", ["mathematics"])] })));
    expect(r.lines[0]).toMatchObject({ status: "unknown", reason: "mapping_review" });
    expect(r.status).toBe("POSSIBLY_ELIGIBLE");
  });
  it("a low-confidence mapping is treated as needing review", () => {
    const c = course({ finalGrade: "A", mappings: [m("mathematics", "ADVANCED", 4, 0.4)] });
    expect(evaluate(profile({ courses: [c] }), program(row({ subjects: [subj("REQUIRED", ["mathematics"])] }))).status).toBe("POSSIBLY_ELIGIBLE");
  });
  it("an EXTRACTED requirement row is never shown as fact", () => {
    const p = program(row({ confidence: "EXTRACTED", subjects: [subj("REQUIRED", ["mathematics"]), subj("REQUIRED", ["physics"])] }));
    const r = evaluate(profile({ courses: [maths("A")] }), p);
    expect(r.status).toBe("POSSIBLY_ELIGIBLE");
    expect(r.lines.map((l) => l.underlying)).toEqual(["met", "not_met"]);
    expect(r.classesToTake).toHaveLength(0);
  });
  it("no requirement rows gives UNKNOWN_DATA", () => {
    expect(evaluate(profile({ courses: [maths("A")] }), program()).status).toBe("UNKNOWN_DATA");
  });
  it("a curriculum without a row gives NEEDS_MANUAL_REVIEW", () => {
    const p = program(row({ curriculum: null, languages: [{ id: "l1", test: "IELTS", minOverall: 6.5 }] }), row({ curriculum: "IB", minimumPoints: 38 }));
    const r = evaluate(profile({ curriculum: "CBSE", tests: [{ kind: "IELTS", score: 7 }] }), p);
    expect(r.covered).toBe(false);
    expect(r.status).toBe("NEEDS_MANUAL_REVIEW");
  });
  it("a programme with only a general row covers every curriculum", () => {
    const p = program(row({ curriculum: null, subjects: [subj("REQUIRED", ["mathematics"])] }));
    expect(evaluate(profile({ curriculum: "SABIS", courses: [maths("A")] }), p).covered).toBe(true);
  });
  it("a required NOTE needs a person", () => {
    const p = program(row({ subjects: [subj("REQUIRED", ["mathematics"])], additional: [{ id: "a1", kind: "NOTE", required: true, noteEn: "Foundation year may be needed" }] }));
    expect(evaluate(profile({ courses: [maths("A")] }), p).status).toBe("NEEDS_MANUAL_REVIEW");
  });
  it("application steps such as interviews are advice, not gaps", () => {
    const p = program(row({ subjects: [subj("REQUIRED", ["mathematics"])], additional: [{ id: "a2", kind: "INTERVIEW", required: true }] }));
    expect(evaluate(profile({ courses: [maths("A")] }), p).status).toBe("ELIGIBLE");
  });
  it("a missing required line beats manual review", () => {
    const p = program(row({ subjects: [subj("REQUIRED", ["physics"])], additional: [{ id: "a3", kind: "NOTE", required: true }] }));
    expect(evaluate(profile({ courses: [maths("A")] }), p).status).toBe("MISSING_REQUIREMENTS");
  });
});

describe("overall figures, streams and grade profiles", () => {
  it("checks GPA and reports a score gap", () => {
    const p = program(row({ curriculum: "AMERICAN", minimumGPA: 3.7 }));
    const low = evaluate(profile({ curriculum: "AMERICAN", overall: { gpa: { value: 3.5, final: true } } }), p);
    expect(low.status).toBe("MISSING_REQUIREMENTS");
    expect(low.scoreGaps[0]).toMatchObject({ kind: "GPA", required: 3.7, have: 3.5 });
    expect(evaluate(profile({ curriculum: "AMERICAN", overall: { gpa: { value: 3.8, final: false } } }), p).status).toBe("ON_TRACK");
  });
  it("checks a percentage and a stream", () => {
    const p = program(row({ curriculum: "UAE_MOE", minimumPercent: 90, stream: "ADVANCED|ELITE" }));
    expect(evaluate(profile({ curriculum: "UAE_MOE", stream: "ADVANCED", overall: { percent: { value: 94, final: true } } }), p).status).toBe("ELIGIBLE");
    expect(evaluate(profile({ curriculum: "UAE_MOE", stream: "GENERAL", overall: { percent: { value: 94, final: true } } }), p).status).toBe("MISSING_REQUIREMENTS");
    expect(evaluate(profile({ curriculum: "UAE_MOE", overall: { percent: { value: 94, final: true } } }), p).status).toBe("POSSIBLY_ELIGIBLE");
  });
  it("checks IB points", () => {
    const p = program(row({ curriculum: "IB", minimumPoints: 40 }));
    expect(evaluate(profile({ curriculum: "IB", overall: { points: { value: 38, final: false } } }), p).status).toBe("MISSING_REQUIREMENTS");
  });
  it("checks an A-level grade profile against the best grades", () => {
    const p = program(row({ gradeProfile: "A*AA" }));
    const al = (g: string, k: string) => course({ status: "IN_PROGRESS", predictedGrade: g, mappings: [m(k)] });
    expect(evaluate(profile({ courses: [al("A", "physics"), al("A*", "mathematics"), al("A", "chemistry")] }), p).status).toBe("ON_TRACK");
    expect(evaluate(profile({ courses: [al("A", "physics"), al("A", "mathematics"), al("A", "chemistry")] }), p).status).toBe("MISSING_REQUIREMENTS");
    expect(evaluate(profile({ courses: [al("A*", "mathematics"), al("A", "physics")] }), p).status).toBe("MISSING_REQUIREMENTS");
  });
  it("a grade profile with grades still to come is unknown", () => {
    const p = program(row({ gradeProfile: "AAA" }));
    const r = evaluate(profile({ courses: [course({ status: "IN_PROGRESS", predictedGrade: "A", mappings: [m("mathematics")] }), course({ status: "PLANNED", mappings: [m("physics")] }), course({ status: "PLANNED", mappings: [m("chemistry")] })] }), p);
    expect(r.status).toBe("POSSIBLY_ELIGIBLE");
  });
});

describe("tests and languages", () => {
  const lang = row({ curriculum: null, languages: [{ id: "ielts", test: "IELTS", minOverall: 6.5 }, { id: "toefl", test: "TOEFL", minOverall: 92 }] });
  it("IELTS or TOEFL: either one is enough", () => {
    expect(evaluate(profile({ tests: [{ kind: "TOEFL", score: 100 }] }), program(lang)).status).toBe("ELIGIBLE");
    expect(evaluate(profile({ tests: [{ kind: "IELTS", score: 7 }] }), program(lang)).status).toBe("ELIGIBLE");
  });
  it("a language score below every minimum is a gap", () => {
    const r = evaluate(profile({ tests: [{ kind: "IELTS", score: 6 }] }), program(lang));
    expect(r.status).toBe("MISSING_REQUIREMENTS");
    expect(r.scoreGaps[0]).toMatchObject({ kind: "IELTS", required: 6.5, have: 6 });
  });
  it("a test not taken yet keeps the student on track", () => {
    const r = evaluate(profile({}), program(lang));
    expect(r.lines[0]).toMatchObject({ status: "unknown", reason: "not_taken" });
    expect(r.status).toBe("ON_TRACK");
  });
  it("a REQUIRED test must be met; SAT or ACT are alternatives", () => {
    const p = program(row({ curriculum: "AMERICAN", tests: [{ id: "sat", test: "SAT", policy: "REQUIRED", minScore: 1450 }, { id: "act", test: "ACT", policy: "REQUIRED", minScore: 33 }] }));
    const cur = { curriculum: "AMERICAN" as const };
    expect(evaluate(profile({ ...cur, tests: [{ kind: "ACT", score: 34 }] }), p).status).toBe("ELIGIBLE");
    expect(evaluate(profile({ ...cur, tests: [{ kind: "SAT", score: 1300 }] }), p).status).toBe("MISSING_REQUIREMENTS");
    expect(evaluate(profile({ ...cur, tests: [{ kind: "SAT", score: 1300 }] }), p).lines).toHaveLength(1);
  });
  it("an OPTIONAL test is never a gap and BLIND tests are ignored", () => {
    const p = program(row({ curriculum: "AMERICAN", tests: [{ id: "sat", test: "SAT", policy: "OPTIONAL", minScore: 1500 }, { id: "ap", test: "ACT", policy: "BLIND" }] }));
    const r = evaluate(profile({ curriculum: "AMERICAN", tests: [{ kind: "SAT", score: 1200 }] }), p);
    expect(r.status).toBe("ELIGIBLE");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].advisory).toBe(true);
  });
  it("an admissions test such as UCAT counts when required", () => {
    const p = program(row({ tests: [{ id: "ucat", test: "UCAT", policy: "REQUIRED" }] }));
    expect(evaluate(profile({ tests: [{ kind: "UCAT", score: 2700 }] }), p).status).toBe("ELIGIBLE");
  });
});

describe("rows and counts", () => {
  it("uses the general row plus the student's curriculum row only", () => {
    const p = program(row({ curriculum: null, subjects: [subj("REQUIRED", ["mathematics"])] }), row({ curriculum: "IB", subjects: [subj("REQUIRED", ["physics"])] }), row({ curriculum: "BRITISH", subjects: [subj("REQUIRED", ["chemistry"])] }));
    const r = evaluate(profile({ curriculum: "IB", courses: [maths("7", "COMPLETED", { gradeScale: "IB_7" }), course({ finalGrade: "6", gradeScale: "IB_7", mappings: [m("physics")] })] }), p);
    expect(r.rowIds).toHaveLength(2);
    expect(r.status).toBe("ELIGIBLE");
  });
  it("prefers the next intake year when several are current", () => {
    const p = program(row({ intakeYear: 2028, subjects: [subj("REQUIRED", ["physics"])] }), row({ intakeYear: 2027, subjects: [subj("REQUIRED", ["mathematics"])] }));
    expect(evaluate(profile({ courses: [maths("A")] }), p).status).toBe("ELIGIBLE");
  });
  it("counts statuses", () => {
    const counts = statusCounts([{ status: "ELIGIBLE" }, { status: "ELIGIBLE" }, { status: "ON_TRACK" }]);
    expect(counts).toMatchObject({ ELIGIBLE: 2, ON_TRACK: 1, MISSING_REQUIREMENTS: 0 });
  });
});

describe("official page rules", () => {
  it("a curriculum the university does not accept for direct entry is a missing requirement", () => {
    const p = program(row({ curriculum: "UAE_MOE", confidence: "OFFICIAL", additional: [{ id: "na", kind: "NOT_ACCEPTED", required: true, noteEn: "A foundation year is required.", evidenceQuote: "not accepted for direct entry", sourceUrl: "https://example.ac.uk/uae" }] }));
    const r = evaluate(profile({ curriculum: "UAE_MOE", courses: [maths("A")] }), p);
    expect(r.status).toBe("MISSING_REQUIREMENTS");
    const line = r.lines.find((l) => l.type === "NOT_ACCEPTED");
    expect(line?.status).toBe("not_met");
    expect(line?.reason).toBe("not_accepted");
    expect(line?.sourceUrl).toBe("https://example.ac.uk/uae");
  });

  it("an admissions test is an application step, not a blocker", () => {
    const p = program(row({ confidence: "OFFICIAL", subjects: [subj("REQUIRED", ["mathematics"])], additional: [{ id: "t", kind: "ADMISSIONS_TEST", required: true, noteEn: "TMUA" }] }));
    expect(evaluate(profile({ courses: [maths("A")] }), p).status).toBe("ELIGIBLE");
  });

  it("OFFICIAL rows count as known facts, unlike EXTRACTED ones", () => {
    const req = { subjects: [subj("REQUIRED", ["mathematics"])] };
    expect(evaluate(profile({ courses: [maths("A")] }), program(row({ ...req, confidence: "OFFICIAL" }))).status).toBe("ELIGIBLE");
    expect(evaluate(profile({ courses: [maths("A")] }), program(row({ ...req, confidence: "EXTRACTED" }))).status).toBe("POSSIBLY_ELIGIBLE");
  });

  it("the general row covers students on the university's home curriculum", () => {
    const general = row({ id: "g", curriculum: null, confidence: "OFFICIAL", subjects: [subj("REQUIRED", ["mathematics"])] });
    const ib = row({ id: "ib", curriculum: "IB", confidence: "OFFICIAL", minimumPoints: 34 });
    const us = { ...program(general), requirements: [general, ib] };
    const student = profile({ curriculum: "AMERICAN", courses: [maths("A")] });
    expect(evaluate(student, us).status).toBe("NEEDS_MANUAL_REVIEW");
    expect(evaluate(student, { ...us, homeCurriculum: "AMERICAN" }).status).toBe("ELIGIBLE");
    expect(evaluate(profile({ curriculum: "BRITISH", courses: [maths("A")] }), { ...us, homeCurriculum: "AMERICAN" }).status).toBe("NEEDS_MANUAL_REVIEW");
    expect(homeCurriculumFor("us")).toBe("AMERICAN");
    expect(homeCurriculumFor("CA")).toBeNull();
  });
});
