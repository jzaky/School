import { describe, expect, it } from "vitest";
import { DEFAULT_CODES, codeForStatus, isUnexplained, resolveCode, statusOf, validateCodes, visibleCode, type Code } from "@/server/attendance/codes";
import { addTo, attendancePct, band, emptyTally, isPersistent, latePct, merge, round1, unauthorisedPct } from "@/server/attendance/maths";
import { limitLevel, schoolDaysBetween, unexcusedRuns, warnAt, type DayKind } from "@/server/attendance/limits";
import { localClock, minutesLateNow, registerWindow, toMin } from "@/server/attendance/settings";
import { checkSettings, type SettingsInput } from "@/server/attendance/admin";
import { toCsv } from "@/server/attendance/reports";
import { writeXlsx } from "@/server/attendance/xlsx-write";

const code = (c: string) => DEFAULT_CODES.find((x) => x.code === c)!;

describe("attendance codes", () => {
  it("the default set is valid and every one-tap button is backed once", () => {
    expect(validateCodes(DEFAULT_CODES)).toBeNull();
    for (const q of ["present", "late", "absent", "excused", "activity"]) expect(DEFAULT_CODES.filter((c) => c.quick === q)).toHaveLength(1);
  });

  it("maps codes to the legacy status the API and older screens read", () => {
    expect(statusOf(code("P"))).toBe("PRESENT");
    expect(statusOf(code("L"))).toBe("LATE");
    expect(statusOf(code("SA"))).toBe("PRESENT");
    expect(statusOf(code("A"))).toBe("ABSENT");
    expect(statusOf(code("U"))).toBe("ABSENT");
    expect(statusOf(code("I"))).toBe("EXCUSED");
    expect(statusOf(code("N"))).toBe("EXCUSED");
  });

  it("resolves a record without a code from its status", () => {
    expect(codeForStatus(DEFAULT_CODES, "ABSENT")?.code).toBe("A");
    expect(codeForStatus(DEFAULT_CODES, "EXCUSED")?.code).toBe("E");
    expect(resolveCode(DEFAULT_CODES, null, "LATE")?.code).toBe("L");
    expect(resolveCode(DEFAULT_CODES, "M", "EXCUSED")?.code).toBe("M");
  });

  it("hides private reasons from people without attendance.reasons", () => {
    expect(visibleCode(DEFAULT_CODES, code("I"), false).code).toBe("E");
    expect(visibleCode(DEFAULT_CODES, code("M"), false).code).toBe("E");
    expect(visibleCode(DEFAULT_CODES, code("I"), true).code).toBe("I");
    expect(visibleCode(DEFAULT_CODES, code("U"), false).code).toBe("U");
  });

  it("only the not-known-yet absence needs follow-up", () => {
    expect(DEFAULT_CODES.filter(isUnexplained).map((c) => c.code)).toEqual(["A"]);
  });

  it("rejects lists that break the one-tap buttons or the rules", () => {
    const swap = (patch: (l: Code[]) => Code[]) => validateCodes(patch(DEFAULT_CODES.map((c) => ({ ...c }))));
    expect(swap((l) => l.map((c) => (c.code === "E" ? { ...c, quick: null } : c)))).toBe("quickMissing");
    expect(swap((l) => [...l, { ...l[0], quick: null }])).toBe("duplicate");
    expect(swap((l) => l.map((c) => (c.code === "P" ? { ...c, code: "P!" } : c)))).toBe("code");
    expect(swap((l) => l.map((c) => (c.code === "E" ? { ...c, private: true } : c)))).toBe("quickExcused");
    expect(swap((l) => l.map((c) => (c.code === "SA" ? { ...c, late: true } : c)))).toBeNull();
    expect(swap((l) => l.map((c) => (c.code === "U" ? { ...c, late: true } : c)))).toBe("late");
    expect(swap((l) => l.map((c) => (c.code === "P" ? { ...c, authorised: true } : c)))).toBe("authorised");
    expect(swap((l) => l.map((c) => (c.code === "A" ? { ...c, active: false } : c)))).toBe("quickInactive");
    expect(swap((l) => l.map((c) => (c.code === "N" ? { ...c, category: "nonsense" } : c)))).toBe("category");
  });
});

describe("attendance percentages", () => {
  const tally = (marks: Array<[string, number, number?]>) => marks.reduce((t, [c, n, m]) => addTo(t, code(c), n, m ?? 0), emptyTally());

  it("counts late, school activity and remote learning as attended", () => {
    const t = tally([["P", 15], ["L", 2, 25], ["SA", 1], ["RL", 1], ["A", 1]]);
    expect(t.possible).toBe(20);
    expect(t.attended).toBe(19);
    expect(t.late).toBe(2);
    expect(t.minutesLate).toBe(25);
    expect(t.activity).toBe(1);
    expect(attendancePct(t)).toBeCloseTo(95);
    expect(latePct(t)).toBeCloseTo(10);
  });

  it("leaves not-counted marks out of the possible sessions", () => {
    const t = tally([["P", 9], ["A", 1], ["N", 5]]);
    expect(t.possible).toBe(10);
    expect(t.notCounted).toBe(5);
    expect(attendancePct(t)).toBeCloseTo(90);
  });

  it("splits authorised and unauthorised absence, with unexplained ones unauthorised until explained", () => {
    const t = tally([["P", 16], ["E", 1], ["I", 1], ["U", 1], ["A", 1]]);
    expect(t.authorised).toBe(2);
    expect(t.unauthorised).toBe(2);
    expect(t.unexplained).toBe(1);
    expect(unauthorisedPct(t)).toBeCloseTo(10);
  });

  it("has no percentage without possible sessions", () => {
    expect(attendancePct(emptyTally())).toBeNull();
    expect(attendancePct(tally([["N", 3]]))).toBeNull();
  });

  it("merges tallies for class, grade and school totals", () => {
    const a = tally([["P", 9], ["A", 1]]);
    const b = tally([["P", 10]]);
    expect(attendancePct(merge(a, b))).toBeCloseTo(95);
  });

  it("rounds to one decimal half away from zero", () => {
    expect(round1(89.95)).toBe(90);
    expect(round1(89.94)).toBe(89.9);
    expect(round1((17 / 19) * 100)).toBe(89.5);
  });

  it("flags persistent absence only below the threshold and after enough sessions", () => {
    expect(isPersistent(tally([["P", 8], ["A", 1]]), 90, 10)).toBe(false); // 9 sessions: too few
    expect(isPersistent(tally([["P", 8], ["A", 2]]), 90, 10)).toBe(true); // 80%
    expect(isPersistent(tally([["P", 9], ["A", 1]]), 90, 10)).toBe(false); // exactly 90%
    expect(band(96)).toBe("good");
    expect(band(92)).toBe("watch");
    expect(band(85)).toBe("concern");
    expect(band(null)).toBe("none");
  });
});

describe("register clock", () => {
  const s = { lateCutoffMin: 30, closeTime: "15:30" };
  const reg = (dateKey: string, start = "07:30", closedAt: Date | null = null) => ({ dateKey, startMin: toMin(start), closedAt });

  it("is open until the late cut-off, then late marks need the office, then closes", () => {
    expect(registerWindow(s, reg("2026-10-26"), { dateKey: "2026-10-26", minute: toMin("07:40") })).toBe("open");
    expect(registerWindow(s, reg("2026-10-26"), { dateKey: "2026-10-26", minute: toMin("08:00") })).toBe("open");
    expect(registerWindow(s, reg("2026-10-26"), { dateKey: "2026-10-26", minute: toMin("08:01") })).toBe("late_closed");
    expect(registerWindow(s, reg("2026-10-26"), { dateKey: "2026-10-26", minute: toMin("15:30") })).toBe("closed");
  });

  it("past days and registers the office closed are closed; future days are not open yet", () => {
    expect(registerWindow(s, reg("2026-10-23"), { dateKey: "2026-10-26", minute: 600 })).toBe("closed");
    expect(registerWindow(s, reg("2026-10-26", "07:30", new Date()), { dateKey: "2026-10-26", minute: 460 })).toBe("closed");
    expect(registerWindow(s, reg("2026-10-27"), { dateKey: "2026-10-26", minute: 600 })).toBe("future");
  });

  it("reads the local date and minute in the school's time zone", () => {
    // 04:15 UTC is 08:15 in Dubai on a Monday.
    const c = localClock(new Date("2026-10-26T04:15:00Z"), "Asia/Dubai");
    expect(c).toEqual({ dateKey: "2026-10-26", minute: 8 * 60 + 15, weekday: 1 });
    // 21:00 UTC on Sunday is already Monday in Dubai.
    expect(localClock(new Date("2026-10-25T21:00:00Z"), "Asia/Dubai").dateKey).toBe("2026-10-26");
    expect(minutesLateNow(toMin("08:30"), toMin("08:42"))).toBe(12);
    expect(minutesLateNow(toMin("08:30"), toMin("08:00"))).toBe(1);
  });
});

describe("regulator absence limit", () => {
  const weekDays = [1, 2, 3, 4, 5];

  it("counts school days only, skipping weekends and holidays from the school calendar", () => {
    // Thursday 26 November to Thursday 3 December 2026, with 1 and 2 December as holidays.
    const days = schoolDaysBetween("2026-11-26", "2026-12-03", weekDays, new Set(["2026-12-01", "2026-12-02"]));
    expect(days).toEqual(["2026-11-26", "2026-11-27", "2026-11-30", "2026-12-03"]);
  });

  it("a run continues across a weekend and a holiday, and an attended day breaks it", () => {
    const days = schoolDaysBetween("2026-11-26", "2026-12-07", weekDays, new Set(["2026-12-01", "2026-12-02"]));
    const kinds = new Map<string, DayKind>([
      ["2026-11-26", "unexcused"],
      ["2026-11-27", "unexcused"],
      ["2026-11-30", "unexcused"],
      ["2026-12-03", "unexcused"],
      ["2026-12-04", "break"],
      ["2026-12-07", "unexcused"],
    ]);
    expect(unexcusedRuns(days, kinds)).toEqual({ longest: 4, current: 1, total: 5 });
  });

  it("a school day with no mark neither counts nor breaks a run; an excused day breaks it", () => {
    const days = schoolDaysBetween("2026-10-19", "2026-10-23", weekDays, new Set());
    const kinds = new Map<string, DayKind>([
      ["2026-10-19", "unexcused"],
      ["2026-10-21", "unexcused"],
      ["2026-10-22", "break"],
      ["2026-10-23", "unexcused"],
    ]);
    expect(unexcusedRuns(days, kinds)).toEqual({ longest: 2, current: 1, total: 3 });
  });

  it("warns at 70% of either limit and reports reaching it (Sharjah preset 10 in a row or 15 in total)", () => {
    const l = { enabled: true, consecutive: 10, total: 15, warnPct: 70 };
    expect(warnAt(10, 70)).toBe(7);
    expect(warnAt(15, 70)).toBe(11);
    expect(limitLevel({ longest: 6, total: 10 }, l)).toBe("none");
    expect(limitLevel({ longest: 7, total: 7 }, l)).toBe("warning");
    expect(limitLevel({ longest: 2, total: 11 }, l)).toBe("warning");
    expect(limitLevel({ longest: 10, total: 10 }, l)).toBe("reached");
    expect(limitLevel({ longest: 3, total: 15 }, l)).toBe("reached");
    expect(limitLevel({ longest: 30, total: 30 }, { ...l, enabled: false })).toBe("none");
  });
});

describe("settings and exports", () => {
  const base: SettingsInput = {
    mode: "HORIZON",
    dailyStart: "07:30",
    lateCutoffMin: 30,
    closeTime: "15:30",
    followUpTime: "09:30",
    autoNotify: true,
    persistentThreshold: 90,
    persistentMinDays: 10,
    dailyOnlyGrades: [-1, 0],
    headsOfYear: {},
    limitEnabled: true,
    limitConsecutive: 10,
    limitTotal: 15,
    limitWarnPct: 70,
  };
  it("accepts sensible settings and rejects broken ones", () => {
    expect(checkSettings(base)).toBeNull();
    expect(checkSettings({ ...base, followUpTime: "07:00" })).toBe("followUpBeforeStart");
    expect(checkSettings({ ...base, closeTime: "25:00" })).toBe("time");
    expect(checkSettings({ ...base, persistentThreshold: 120 })).toBe("threshold");
    expect(checkSettings({ ...base, dailyOnlyGrades: [14] })).toBe("grades");
    expect(checkSettings({ ...base, limitTotal: 5 })).toBe("limit");
  });

  it("CSV cells cannot start a formula", () => {
    expect(toCsv([["a", "=SUM(A1)"], ["b,c", 3]])).toBe('a,\'=SUM(A1)\r\n"b,c",3\r\n');
  });

  it("writes a readable xlsx zip", () => {
    const buf = writeXlsx([["student_no", "attendance_percent"], ["HIS-1", 95.5]], { sheetName: "Attendance", rtl: true });
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    expect(buf.includes(Buffer.from("xl/worksheets/sheet1.xml"))).toBe(true);
  });
});
