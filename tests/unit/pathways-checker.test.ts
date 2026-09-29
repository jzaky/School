import { describe, expect, it } from "vitest";
import { aLevelRank, checkRequirements, parseGradeProfile } from "@/server/pathways/checker";
import type { ProgramForCheck, StudentForCheck } from "@/server/pathways/types";

const program = (p: Partial<ProgramForCheck>): ProgramForCheck => ({ requiredSubjects: [], recommendedSubjects: [], requirements: {}, englishReq: null, ...p });
const student = (s: Partial<StudentForCheck>): StudentForCheck => ({ curriculum: "BRITISH", subjects: [], offered: ["MATH", "PHYS", "CHEM", "BIO", "CS", "ENG", "ECON"], results: [], tests: [], ...s });
const r = (subjectCode: string, level: string | null, predicted: string | null, achieved: string | null = null, confirmed = true) => ({ subjectCode, level, predicted, achieved, confirmed });
const byId = (res: ReturnType<typeof checkRequirements>, id: string) => res.items.find((i) => i.id === id);

const computing = program({
  requiredSubjects: ["MATH"],
  recommendedSubjects: ["FURTHER_MATH"],
  requirements: {
    BRITISH: { grades: "A*AA", subjects: [{ code: "MATH", min: "A*" }] },
    IB: { points: 39, hl: [{ code: "MATH", min: "7" }] },
    AMERICAN: { gpa: 3.8, testPolicy: "REQUIRED", sat: 1500, act: 34, ap: [{ code: "MATH", min: "5" }] },
    UAE_MOE: { average: 90, streams: ["ADVANCED", "ELITE"], emsat: [{ kind: "EMSAT_MATH", min: 900 }] },
    JORDAN_TAWJIHI: { average: 80, streams: ["SCIENTIFIC"], byStream: { SCIENTIFIC: 85 } },
    admissionsTests: ["TMUA"],
  },
  englishReq: { ielts: 7, toefl: 100 },
});

describe("grade helpers", () => {
  it("parses A-level profiles and ranks grades", () => {
    expect(parseGradeProfile("A*A*A")).toEqual(["A*", "A*", "A"]);
    expect(parseGradeProfile("aab")).toEqual(["A", "A", "B"]);
    expect(aLevelRank("A*")!).toBeGreaterThan(aLevelRank("A")!);
    expect(aLevelRank("Z")).toBeNull();
  });
});

describe("requirements checker: British A-levels", () => {
  it("reports met, not met and missing classes, including recommended subjects and English gaps", () => {
    const res = checkRequirements(
      computing,
      student({
        subjects: ["MATH", "PHYS", "CHEM", "ENG"],
        results: [r("MATH", "A_LEVEL", "A*"), r("PHYS", "A_LEVEL", "A"), r("CHEM", "A_LEVEL", "B")],
        tests: [{ kind: "IELTS", score: 6.5, confirmed: true }],
      }),
    );
    expect(res.listed).toBe(true);
    expect(byId(res, "overall")).toMatchObject({ status: "not_met", required: "A*AA", have: "A*AB", provisional: true });
    expect(byId(res, "subject:MATH")).toMatchObject({ status: "met", have: "A*" });
    expect(byId(res, "recommended:FURTHER_MATH")).toMatchObject({ status: "not_met", optional: true, offered: false });
    expect(byId(res, "admissions:TMUA")?.status).toBe("not_met");
    expect(byId(res, "english")).toMatchObject({ status: "not_met", code: "IELTS", required: 7, have: 6.5 });
    expect(res.classesToTake).toEqual([{ code: "FURTHER_MATH", required: false, offered: false }]);
    expect(res.scoreGaps).toContainEqual({ code: "IELTS", required: 7, have: 6.5 });
    // Optional items never count as gaps.
    expect(res.summary).toEqual({ met: 1, notMet: 3, unknown: 0 });
  });

  it("uses achieved grades over predictions and meets the offer", () => {
    const res = checkRequirements(
      computing,
      student({
        subjects: ["MATH", "PHYS", "CS"],
        results: [r("MATH", "A_LEVEL", "A", "A*"), r("PHYS", "A_LEVEL", "A"), r("CS", "A_LEVEL", "A", null, false)],
        tests: [{ kind: "TOEFL", score: 104, confirmed: false }, { kind: "TMUA", score: 6.1, confirmed: true }],
      }),
    );
    expect(byId(res, "overall")).toMatchObject({ status: "met", have: "A*AA", unconfirmed: true });
    expect(byId(res, "subject:MATH")).toMatchObject({ status: "met", have: "A*", provisional: false });
    expect(byId(res, "english")).toMatchObject({ status: "met", code: "TOEFL", unconfirmed: true });
    expect(res.summary.notMet).toBe(0);
  });

  it("flags a required subject the student does not take as a class to take", () => {
    const res = checkRequirements(computing, student({ subjects: ["PHYS", "CHEM", "BIO"], results: [r("PHYS", "A_LEVEL", "A"), r("CHEM", "A_LEVEL", "A"), r("BIO", "A_LEVEL", "A")] }));
    expect(byId(res, "subject:MATH")).toMatchObject({ status: "not_met", taking: false, offered: true });
    expect(res.classesToTake[0]).toEqual({ code: "MATH", required: true, offered: true });
  });

  it("is unknown when there are not enough grades yet, and taking a subject without a grade is unknown", () => {
    const res = checkRequirements(computing, student({ subjects: ["MATH"] }));
    expect(byId(res, "overall")?.status).toBe("unknown");
    expect(byId(res, "subject:MATH")).toMatchObject({ status: "unknown", taking: true });
    expect(byId(res, "english")?.status).toBe("unknown");
  });
});

describe("requirements checker: other curricula", () => {
  it("IB: total points and HL subject minimum", () => {
    const res = checkRequirements(computing, student({ curriculum: "IB", subjects: ["MATH"], results: [r("OVERALL", null, "40"), r("MATH", "HL", "6")] }));
    expect(byId(res, "overall")).toMatchObject({ status: "met", required: 39, have: 40 });
    expect(byId(res, "subject:MATH")).toMatchObject({ status: "not_met", required: "7", have: "6" });
  });

  it("IB: sums six subject grades when no total is recorded", () => {
    const six = ["MATH", "PHYS", "CHEM", "ENG", "ECON", "CS"].map((c) => r(c, "HL", "6"));
    const res = checkRequirements(computing, student({ curriculum: "IB", results: six }));
    expect(byId(res, "overall")).toMatchObject({ status: "not_met", have: 36 });
  });

  it("American: GPA, SAT or ACT and AP", () => {
    const res = checkRequirements(
      computing,
      student({ curriculum: "AMERICAN", subjects: ["MATH"], results: [r("OVERALL", "GPA", "3.9"), r("MATH", "AP", "5")], tests: [{ kind: "SAT", score: 1450, confirmed: true }, { kind: "ACT", score: 35, confirmed: true }] }),
    );
    expect(byId(res, "overall")?.status).toBe("met");
    expect(byId(res, "subject:MATH")?.status).toBe("met");
    expect(byId(res, "test:SAT_ACT")).toMatchObject({ status: "met" });
  });

  it("American: a required test that is missing is not met; test blind adds no test item", () => {
    const res = checkRequirements(computing, student({ curriculum: "AMERICAN", results: [r("OVERALL", "GPA", "3.5")] }));
    expect(byId(res, "test:SAT_ACT")?.status).toBe("not_met");
    expect(res.scoreGaps).toContainEqual({ code: "OVERALL", required: 3.8, have: 3.5 });
    const blind = checkRequirements(program({ requirements: { AMERICAN: { testPolicy: "BLIND" } } }), student({ curriculum: "AMERICAN" }));
    expect(byId(blind, "test:SAT_ACT")).toBeUndefined();
    const optional = checkRequirements(program({ requirements: { AMERICAN: { testPolicy: "OPTIONAL" } } }), student({ curriculum: "AMERICAN" }));
    expect(byId(optional, "test:SAT_ACT")).toMatchObject({ status: "unknown", optional: true });
  });

  it("UAE MoE: stream, average and EmSAT", () => {
    const res = checkRequirements(computing, student({ curriculum: "UAE_MOE", results: [r("OVERALL", "GENERAL", "93")], tests: [{ kind: "EMSAT_MATH", score: 850, confirmed: true }] }));
    expect(byId(res, "stream")).toMatchObject({ status: "not_met", have: "GENERAL" });
    expect(byId(res, "overall")?.status).toBe("met");
    expect(byId(res, "test:EMSAT_MATH")).toMatchObject({ status: "not_met", required: 900, have: 850 });
    // Stream-based curricula do not list individual subject gaps.
    expect(res.items.some((i) => i.kind === "subject" || i.kind === "recommended")).toBe(false);
  });

  it("Jordan Tawjihi: minimum average by stream", () => {
    const sci = checkRequirements(computing, student({ curriculum: "JORDAN_TAWJIHI", results: [r("OVERALL", "SCIENTIFIC", "83.5")] }));
    expect(byId(sci, "stream")?.status).toBe("met");
    expect(byId(sci, "overall")).toMatchObject({ status: "not_met", required: 85, have: 83.5 });
    const lit = checkRequirements(computing, student({ curriculum: "JORDAN_TAWJIHI", results: [r("OVERALL", "LITERARY", "95")] }));
    expect(byId(lit, "stream")?.status).toBe("not_met");
    expect(byId(lit, "overall")).toMatchObject({ status: "met", required: 80 });
    const none = checkRequirements(computing, student({ curriculum: "JORDAN_TAWJIHI" }));
    expect(byId(none, "overall")?.status).toBe("unknown");
    expect(byId(none, "stream")?.status).toBe("unknown");
  });

  it("marks a programme that lists nothing for the curriculum as not listed", () => {
    const res = checkRequirements(program({ requirements: { BRITISH: { grades: "AAA" } } }), student({ curriculum: "JORDAN_TAWJIHI" }));
    expect(res.listed).toBe(false);
    const other = checkRequirements(computing, student({ curriculum: "OTHER", subjects: ["MATH"] }));
    expect(other.listed).toBe(false);
    expect(byId(other, "subject:MATH")?.status).toBe("met");
  });
});
