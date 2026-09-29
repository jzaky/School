import { describe, expect, it } from "vitest";
import { assignTeachers, type AssignSection, type TeacherQualification } from "@/server/timetable/assign";
import { busyKey, pickSubstitutes, type CoverCandidate, type CoverLesson } from "@/server/timetable/cover-picker";
import { buildPreset, UAE_PRESET, validateDay } from "@/server/timetable/bell";

describe("assignTeachers", () => {
  const quals: TeacherQualification[] = [
    { teacherId: "t-a", subjectId: "math", gradeLevels: [9, 10], maxPeriodsPerWeek: 12 },
    { teacherId: "t-b", subjectId: "math", gradeLevels: [9, 10, 11], maxPeriodsPerWeek: 12 },
    { teacherId: "t-c", subjectId: "phys", gradeLevels: [9], maxPeriodsPerWeek: 8 },
  ];

  it("assigns a qualified teacher to every empty section and balances load", () => {
    const sections: AssignSection[] = [
      { id: "m9a", subjectId: "math", gradeLevel: 9, teacherId: null, periods: 4 },
      { id: "m9b", subjectId: "math", gradeLevel: 9, teacherId: null, periods: 4 },
      { id: "m10", subjectId: "math", gradeLevel: 10, teacherId: null, periods: 4 },
      { id: "m11", subjectId: "math", gradeLevel: 11, teacherId: null, periods: 4 },
    ];
    const res = assignTeachers({ sections, qualifications: quals });
    expect(res.unassigned).toEqual([]);
    const by = Object.fromEntries(res.assignments.map((a) => [a.sectionId, a.teacherId]));
    expect(by.m11).toBe("t-b"); // only t-b teaches grade 11
    expect(res.load["t-a"]).toBe(8);
    expect(res.load["t-b"]).toBe(8);
  });

  it("never overwrites a manually set teacher unless asked", () => {
    const sections: AssignSection[] = [
      { id: "m9a", subjectId: "math", gradeLevel: 9, teacherId: "t-a", periods: 4 },
      { id: "m9b", subjectId: "math", gradeLevel: 9, teacherId: null, periods: 4 },
    ];
    const keep = assignTeachers({ sections, qualifications: quals });
    expect(keep.assignments.map((a) => a.sectionId)).toEqual(["m9b"]);
    expect(keep.assignments[0].teacherId).toBe("t-b");
    const over = assignTeachers({ sections, qualifications: quals, overwrite: true });
    expect(over.assignments).toHaveLength(2);
  });

  it("lists unassignable sections with the reason", () => {
    const sections: AssignSection[] = [
      { id: "art", subjectId: "art", gradeLevel: 9, teacherId: null, periods: 4 },
      { id: "p1", subjectId: "phys", gradeLevel: 9, teacherId: null, periods: 4 },
      { id: "p2", subjectId: "phys", gradeLevel: 9, teacherId: null, periods: 4 },
      { id: "p3", subjectId: "phys", gradeLevel: 9, teacherId: null, periods: 4 },
      { id: "hr", subjectId: null, gradeLevel: 9, teacherId: null, periods: 4 },
    ];
    const res = assignTeachers({ sections, qualifications: quals });
    const reason = Object.fromEntries(res.unassigned.map((u) => [u.sectionId, u.reason]));
    expect(reason.art).toBe("NO_QUALIFIED");
    expect(reason.hr).toBe("NO_SUBJECT");
    expect(Object.values(reason).filter((r) => r === "AT_CAPACITY")).toHaveLength(1);
    expect(res.load["t-c"]).toBe(8);
  });

  it("does not give one teacher two sections that run in parallel", () => {
    const sections: AssignSection[] = [
      { id: "p1", subjectId: "phys", gradeLevel: 9, teacherId: null, periods: 2, optionBlock: "A" },
      { id: "p2", subjectId: "phys", gradeLevel: 9, teacherId: null, periods: 2, optionBlock: "A" },
    ];
    const res = assignTeachers({ sections, qualifications: quals });
    expect(res.assignments).toHaveLength(1);
    expect(res.unassigned[0].reason).toBe("BLOCK_CLASH");
  });
});

describe("pickSubstitutes", () => {
  const lesson = (key: string, periodNo: number, date = "2026-09-28"): CoverLesson => ({ key, date, periodNo, subjectId: "phys", gradeLevel: 9, departmentId: "science" });
  const cand = (id: string, departmentId: string | null, subjects: string[] = [], teaching = 18): CoverCandidate => ({
    id,
    departmentId,
    qualifications: subjects.map((s) => ({ subjectId: s, gradeLevels: [9] })),
    maxPeriodsPerWeek: 24,
    teachingPeriods: teaching,
  });

  it("only picks someone free that period", () => {
    const busy = new Set([busyKey("2026-09-28", 2, "sci1")]);
    const picks = pickSubstitutes({ lessons: [lesson("l1", 2)], candidates: [cand("sci1", "science")], busy });
    expect(picks).toEqual([{ key: "l1", substituteId: null, tier: null }]);
  });

  it("prefers the same department, then qualified, then anyone", () => {
    const candidates = [cand("any1", "arts"), cand("qual1", "maths", ["phys"]), cand("sci1", "science")];
    expect(pickSubstitutes({ lessons: [lesson("l1", 2)], candidates, busy: new Set() })[0]).toEqual({ key: "l1", substituteId: "sci1", tier: "DEPARTMENT" });
    const busy = new Set([busyKey("2026-09-28", 2, "sci1")]);
    expect(pickSubstitutes({ lessons: [lesson("l1", 2)], candidates, busy })[0]).toEqual({ key: "l1", substituteId: "qual1", tier: "QUALIFIED" });
    busy.add(busyKey("2026-09-28", 2, "qual1"));
    expect(pickSubstitutes({ lessons: [lesson("l1", 2)], candidates, busy })[0]).toEqual({ key: "l1", substituteId: "any1", tier: "ANY" });
  });

  it("spreads cover fairly across people", () => {
    const candidates = [cand("sci1", "science"), cand("sci2", "science"), cand("sci3", "science")];
    const lessons = [1, 2, 3, 4, 5, 6].map((p) => lesson(`l${p}`, p));
    const picks = pickSubstitutes({ lessons, candidates, busy: new Set() });
    const counts: Record<string, number> = {};
    for (const p of picks) counts[p.substituteId!] = (counts[p.substituteId!] ?? 0) + 1;
    expect(Object.values(counts)).toEqual([2, 2, 2]);
  });

  it("accounts for cover already given this week and skips excluded people", () => {
    const candidates = [cand("sci1", "science"), cand("sci2", "science")];
    const picks = pickSubstitutes({ lessons: [lesson("l1", 1)], candidates, busy: new Set(), coverCount: { sci1: 2 } });
    expect(picks[0].substituteId).toBe("sci2");
    const ex = pickSubstitutes({ lessons: [lesson("l1", 1)], candidates, busy: new Set(), exclude: { l1: ["sci2"] }, coverCount: { sci1: 2 } });
    expect(ex[0].substituteId).toBe("sci1");
  });

  it("never double-books a substitute in one period", () => {
    const candidates = [cand("sci1", "science")];
    const picks = pickSubstitutes({ lessons: [lesson("a", 3), { ...lesson("b", 3), key: "b" }], candidates, busy: new Set() });
    expect(picks.map((p) => p.substituteId)).toEqual(["sci1", null]);
  });
});

describe("bell schedule preset", () => {
  it("builds a UAE week with a shorter Friday and valid days", () => {
    const rows = buildPreset(UAE_PRESET);
    const lessons = (d: number) => rows.filter((r) => r.dayOfWeek === d && r.kind === "LESSON").length;
    expect(lessons(1)).toBe(8);
    expect(lessons(5)).toBe(5);
    for (const d of [1, 2, 3, 4, 5]) expect(validateDay(rows.filter((r) => r.dayOfWeek === d))).toBeNull();
    const fri = rows.filter((r) => r.dayOfWeek === 5);
    expect(fri[fri.length - 1].endTime < rows.filter((r) => r.dayOfWeek === 1).slice(-1)[0].endTime).toBe(true);
  });
});
