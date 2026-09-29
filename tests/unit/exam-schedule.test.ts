import { describe, expect, it } from "vitest";
import { dayKey, detectClashes, examDays, instant, suggestSchedule, weekdayOf, type SittingLike } from "@/server/exams/schedule";
import { hijriOf, proposeUaeHolidays } from "@/server/calendar/uae-holidays";

const s = (id: string, grade: number, key: string, startMin: number, durMin: number, room: string | null, inv: string[] = []): SittingLike => ({
  id,
  gradeLevel: grade,
  subjectId: `sub-${id}`,
  startsAt: instant(key, startMin),
  endsAt: instant(key, startMin + durMin),
  room,
  invigilatorIds: inv,
});

// 2026-11-16 is a Monday.
const MON = "2026-11-16";

describe("exam clash detection", () => {
  it("finds no clashes for separate grades, rooms and invigilators", () => {
    const list = [s("a", 9, MON, 510, 90, "Hall A", ["t1"]), s("b", 10, MON, 510, 90, "Hall B", ["t2"]), s("c", 9, MON, 690, 60, "Hall A", ["t1"])];
    expect(detectClashes(list)).toEqual([]);
  });

  it("flags the same grade sitting two exams at once", () => {
    const list = [s("a", 9, MON, 510, 90, "Hall A"), s("b", 9, MON, 540, 60, "Hall B")];
    const c = detectClashes(list);
    expect(c.filter((x) => x.kind === "grade").map((x) => x.sittingId).sort()).toEqual(["a", "b"]);
  });

  it("flags a double-booked invigilator and room", () => {
    const list = [s("a", 9, MON, 510, 90, "Hall A", ["t1", "t2"]), s("b", 10, MON, 560, 60, "hall a ", ["t2"])];
    const c = detectClashes(list);
    expect(c.some((x) => x.kind === "room" && x.sittingId === "a" && x.otherId === "b")).toBe(true);
    expect(c.filter((x) => x.kind === "invigilator").every((x) => x.invigilatorId === "t2")).toBe(true);
    expect(c.filter((x) => x.kind === "invigilator")).toHaveLength(2);
  });

  it("treats back to back sittings as no clash", () => {
    const list = [s("a", 9, MON, 510, 90, "Hall A", ["t1"]), s("b", 9, MON, 600, 60, "Hall A", ["t1"])];
    expect(detectClashes(list)).toEqual([]);
  });

  it("flags weekends and holidays", () => {
    const sat = "2026-11-21";
    const list = [s("a", 9, sat, 510, 60, null), s("b", 9, "2026-12-02", 510, 60, null)];
    const c = detectClashes(list, { holidays: [{ start: instant("2026-12-02", 0), end: instant("2026-12-04", 0), title: "National Day" }] });
    expect(c).toContainEqual({ sittingId: "a", kind: "weekend" });
    expect(c).toContainEqual({ sittingId: "b", kind: "holiday", holiday: "National Day" });
  });
});

describe("exam schedule suggestion", () => {
  const subjects = (n: number) => Array.from({ length: n }, (_, i) => ({ subjectId: `S${i}`, durationMin: 90 }));

  it("lists exam days without weekends or blocked days", () => {
    const days = examDays(MON, "2026-11-27", [1, 2, 3, 4, 5], ["2026-11-18"]);
    expect(days).toHaveLength(9);
    expect(days).not.toContain("2026-11-18");
    expect(days.every((d) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5)).toBe(true);
  });

  it("spreads subjects one per day when the window allows", () => {
    const r = suggestSchedule({ windowStart: MON, windowEnd: "2026-11-27", grades: [{ gradeLevel: 9, subjects: subjects(5) }], maxPerDay: 2, sessions: [510, 690] });
    expect(r.unplaced).toEqual([]);
    const days = r.sittings.map((x) => x.dateKey);
    expect(new Set(days).size).toBe(5);
    expect(days[0]).toBe(MON);
    expect(days[4]).toBe("2026-11-27");
  });

  it("never schedules more than maxPerDay for a grade, and reports what does not fit", () => {
    const r = suggestSchedule({ windowStart: MON, windowEnd: "2026-11-18", grades: [{ gradeLevel: 10, subjects: subjects(8) }], maxPerDay: 2, sessions: [510, 690] });
    expect(r.sittings).toHaveLength(6);
    expect(r.unplaced).toHaveLength(2);
    const perDay = new Map<string, number>();
    for (const x of r.sittings) perDay.set(x.dateKey, (perDay.get(x.dateKey) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(2);
  });

  it("respects maxPerDay of one", () => {
    const r = suggestSchedule({ windowStart: MON, windowEnd: "2026-11-20", grades: [{ gradeLevel: 9, subjects: subjects(7) }], maxPerDay: 1, sessions: [510, 690] });
    expect(r.sittings).toHaveLength(5);
    expect(new Set(r.sittings.map((x) => x.dateKey)).size).toBe(5);
    expect(r.unplaced).toHaveLength(2);
  });

  it("produces a timetable with no clashes across grades, rooms and invigilators", () => {
    const r = suggestSchedule({
      windowStart: MON,
      windowEnd: "2026-11-27",
      grades: [9, 10, 11, 12].map((g) => ({ gradeLevel: g, subjects: subjects(g === 12 ? 12 : 6) })),
      maxPerDay: 2,
      sessions: [510, 690],
      blockedDays: ["2026-11-20"],
      rooms: ["Hall A", "Hall B", "Gym"],
      invigilators: ["t1", "t2", "t3", "t4", "t5"],
      invigilatorsPerSitting: 1,
    });
    expect(r.unplaced).toEqual([]);
    const list: SittingLike[] = r.sittings.map((x, i) => ({ id: String(i), gradeLevel: x.gradeLevel, subjectId: x.subjectId, startsAt: instant(x.dateKey, x.startMinute), endsAt: instant(x.dateKey, x.endMinute), room: x.room, invigilatorIds: x.invigilatorIds }));
    expect(detectClashes(list, { holidays: [{ start: instant("2026-11-20", 0), end: instant("2026-11-21", 0), title: "Blocked" }] })).toEqual([]);
    expect(list.every((x) => x.room && x.invigilatorIds.length === 1)).toBe(true);
    expect(list.every((x) => dayKey(x.startsAt) !== "2026-11-20")).toBe(true);
  });
});

describe("UAE holidays", () => {
  it("proposes fixed holidays as confirmed and Hijri holidays as estimates", () => {
    const list = proposeUaeHolidays("2026-08-24", "2027-07-02");
    const national = list.find((h) => h.key === "national_day_2026");
    expect(national).toMatchObject({ startKey: "2026-12-02", days: 2, estimated: false });
    const fitr = list.find((h) => h.key.startsWith("eid_al_fitr"));
    expect(fitr?.estimated).toBe(true);
    expect(hijriOf(fitr!.startKey)).toMatchObject({ m: 10, d: 1 });
    for (const k of ["arafat_day", "eid_al_adha", "islamic_new_year", "prophets_birthday", "new_year", "commemoration_day"]) expect(list.some((h) => h.key.startsWith(k))).toBe(true);
    const arafat = list.find((h) => h.key.startsWith("arafat_day"))!;
    const adha = list.find((h) => h.key.startsWith("eid_al_adha"))!;
    expect(adha.startKey > arafat.startKey).toBe(true);
  });
});
