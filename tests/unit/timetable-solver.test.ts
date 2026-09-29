import { describe, expect, it } from "vitest";
import { findClashes, solveTimetable, type SolverClass } from "@/server/timetable/solver";
import { demoSchool, lessonPeriods } from "./timetable-fixture";

function perDay(placements: Array<{ classId: string; day: number }>, classId: string) {
  const m = new Map<number, number>();
  for (const p of placements) if (p.classId === classId) m.set(p.day, (m.get(p.day) ?? 0) + 1);
  return m;
}

describe("solveTimetable", () => {
  const periods = lessonPeriods();

  it("places every lesson of a demo-sized school with no teacher, student or room clash", () => {
    const { classes } = demoSchool();
    const res = solveTimetable({ periods, classes });
    expect(res.unplaced).toEqual([]);
    expect(findClashes(res.placements, classes)).toEqual([]);
    for (const c of classes) expect(res.placements.filter((p) => p.classId === c.id)).toHaveLength(c.periods);
    expect(res.stats.ms).toBeLessThan(5000);
  });

  it("runs option-block sections in parallel", () => {
    const { classes } = demoSchool();
    const res = solveTimetable({ periods, classes });
    const phys = res.placements.filter((p) => p.classId === "c-9-PHYS").map((p) => `${p.day}|${p.period}`).sort();
    const bus = res.placements.filter((p) => p.classId === "c-9-BUS").map((p) => `${p.day}|${p.period}`).sort();
    expect(phys).toEqual(bus);
  });

  it("spreads a subject across the week and caps a teacher's day", () => {
    const { classes } = demoSchool();
    const res = solveTimetable({ periods, classes, options: { maxTeacherPerDay: 6 } });
    for (const c of classes) {
      const days = perDay(res.placements, c.id);
      expect(Math.max(...days.values())).toBeLessThanOrEqual(2);
      expect(days.size).toBeGreaterThanOrEqual(3);
    }
    const teacherDay = new Map<string, number>();
    const groupSeen = new Set<string>();
    for (const p of res.placements) {
      const c = classes.find((x) => x.id === p.classId)!;
      const key = `${c.teacherId}|${p.day}|${p.period}`;
      if (groupSeen.has(key)) continue;
      groupSeen.add(key);
      const k = `${c.teacherId}|${p.day}`;
      teacherDay.set(k, (teacherDay.get(k) ?? 0) + 1);
    }
    expect(Math.max(...teacherDay.values())).toBeLessThanOrEqual(7);
  });

  it("keeps locked lessons where they are", () => {
    const { classes } = demoSchool();
    const locks = [
      { classId: "c-9-MATH", day: 1, period: 2 },
      { classId: "c-9-MATH", day: 3, period: 2 },
      { classId: "c-10-ENG", day: 1, period: 2 },
    ];
    const res = solveTimetable({ periods, classes, locks });
    for (const l of locks) expect(res.placements).toContainEqual({ ...l, locked: true });
    expect(findClashes(res.placements, classes)).toEqual([]);
    expect(res.stats.lockedKept).toBe(3);
  });

  it("is deterministic", () => {
    const { classes } = demoSchool();
    const a = solveTimetable({ periods, classes });
    const b = solveTimetable({ periods, classes: [...classes].reverse() });
    expect(b.placements).toEqual(a.placements);
  });

  it("reports what it cannot place, with a reason", () => {
    const classes: SolverClass[] = [
      { id: "x1", teacherId: "t1", gradeLevel: 9, periods: 3, studentIds: ["a"] },
      { id: "x2", teacherId: "t1", gradeLevel: 10, periods: 3, studentIds: ["b"] },
    ];
    const tiny = periods.filter((p) => p.day === 1).slice(0, 4);
    const res = solveTimetable({ periods: tiny, classes, options: { maxTeacherPerDay: 8 } });
    const missing = res.unplaced.reduce((n, u) => n + u.missing, 0);
    expect(missing).toBeGreaterThan(0);
    expect(res.unplaced[0].reason).toMatch(/TEACHER_BUSY|DAY_LIMIT|TEACHER_DAY_LIMIT/);
    expect(findClashes(res.placements, classes)).toEqual([]);
  });

  it("reports when there are no lesson periods", () => {
    const res = solveTimetable({ periods: [], classes: [{ id: "x", teacherId: "t", gradeLevel: 6, periods: 4, studentIds: [] }] });
    expect(res.unplaced).toEqual([{ classId: "x", missing: 4, reason: "NO_LESSON_PERIODS", teacherId: "t" }]);
  });

  it("stays fast and clash-free for a much larger school", () => {
    const { classes } = demoSchool(11, 6);
    // Six times the students with the same teachers: split each class into sections with their own teacher id.
    const res = solveTimetable({ periods, classes });
    expect(findClashes(res.placements, classes)).toEqual([]);
    expect(res.stats.ms).toBeLessThan(10000);
  });
});
