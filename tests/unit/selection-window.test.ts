// Course selection window rules: state at the exact opening and closing instants, Dubai time input,
// which window applies to a student, reminders and countdowns.
import { describe, expect, it } from "vitest";
import { activeUntil, dubaiInstant, dubaiParts, dueReminder, gradeRuns, pickWindow, timeLeft, windowState } from "@/lib/selection-window";
import { helperEngineActor } from "@/server/registration/selection-scope";
import type { EngineActor } from "@/server/pathway-engine/access";

const opensAt = dubaiInstant("2026-11-01", "08:00")!;
const closesAt = dubaiInstant("2026-11-12", "15:00")!;
const w = { id: "w1", academicYearId: "y2", gradeLevels: [9, 10, 11], opensAt, closesAt };

describe("window state", () => {
  it("reads Dubai time: 08:00 in Dubai is 04:00 UTC", () => {
    expect(opensAt.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(closesAt.toISOString()).toBe("2026-11-12T11:00:00.000Z");
    expect(dubaiParts(closesAt)).toEqual({ date: "2026-11-12", time: "15:00" });
    // Late evening in Dubai is the next calendar day there, the same day in UTC.
    expect(dubaiParts(new Date("2026-11-12T21:30:00Z"))).toEqual({ date: "2026-11-13", time: "01:30" });
  });

  it("rejects malformed dates and times", () => {
    expect(dubaiInstant("2026-11-1", "08:00")).toBeNull();
    expect(dubaiInstant("2026-11-01", "8:00")).toBeNull();
    expect(dubaiInstant("2026-13-01", "08:00")).toBeNull();
  });

  it("is open from the opening instant (inclusive) to the closing instant (exclusive)", () => {
    expect(windowState(w, new Date(opensAt.getTime() - 1))).toBe("upcoming");
    expect(windowState(w, opensAt)).toBe("open");
    expect(windowState(w, new Date(closesAt.getTime() - 1))).toBe("open");
    expect(windowState(w, closesAt)).toBe("closed");
    expect(windowState(w, new Date(closesAt.getTime() + 1))).toBe("closed");
  });
});

describe("which window applies", () => {
  const round1 = { ...w, id: "r1" };
  const round2 = { id: "r2", academicYearId: "y2", gradeLevels: [10], opensAt: dubaiInstant("2026-11-20", "08:00")!, closesAt: dubaiInstant("2026-11-25", "15:00")! };
  const other = { id: "o", academicYearId: "y1", gradeLevels: [10], opensAt: dubaiInstant("2026-10-01", "08:00")!, closesAt: dubaiInstant("2026-12-01", "15:00")! };
  const all = [round1, round2, other];

  it("prefers the open window, then the next to open, then the last closed", () => {
    expect(pickWindow(all, "y2", 10, dubaiInstant("2026-11-05", "10:00")!)?.id).toBe("r1");
    expect(pickWindow(all, "y2", 10, dubaiInstant("2026-11-15", "10:00")!)?.id).toBe("r2");
    expect(pickWindow(all, "y2", 10, dubaiInstant("2026-12-15", "10:00")!)?.id).toBe("r2");
    expect(pickWindow(all, "y2", 10, dubaiInstant("2026-10-15", "10:00")!)?.id).toBe("r1");
  });

  it("only uses windows for the student's grade and the year asked for", () => {
    expect(pickWindow(all, "y2", 9, dubaiInstant("2026-11-15", "10:00")!)?.id).toBe("r1");
    expect(pickWindow(all, "y2", 12, dubaiInstant("2026-11-05", "10:00")!)).toBeNull();
    expect(pickWindow(all, "y1", 9, dubaiInstant("2026-11-05", "10:00")!)).toBeNull();
  });
});

describe("exceptions, sessions, reminders and countdowns", () => {
  const now = dubaiInstant("2026-11-05", "10:00")!;
  it("an exception or session counts until its end, unless revoked or ended", () => {
    expect(activeUntil({ until: new Date(now.getTime() + 1) }, now)).toBe(true);
    expect(activeUntil({ until: now }, now)).toBe(false);
    expect(activeUntil({ until: new Date(now.getTime() + 60_000), revokedAt: now }, now)).toBe(false);
    expect(activeUntil({ startsAt: new Date(now.getTime() - 60_000), endsAt: new Date(now.getTime() + 60_000) }, now)).toBe(true);
    expect(activeUntil({ startsAt: new Date(now.getTime() + 60_000), endsAt: new Date(now.getTime() + 120_000) }, now)).toBe(false);
    expect(activeUntil({ startsAt: now, endsAt: new Date(now.getTime() + 60_000), endedAt: now }, now)).toBe(false);
  });

  it("sends the 3 day reminder, then the 1 day reminder, only while open", () => {
    const h = (hours: number) => new Date(closesAt.getTime() - hours * 3_600_000);
    expect(dueReminder(w, h(100))).toBeNull();
    expect(dueReminder(w, h(72))).toBe(72);
    expect(dueReminder(w, h(30))).toBe(72);
    expect(dueReminder(w, h(24))).toBe(24);
    expect(dueReminder(w, h(1))).toBe(24);
    expect(dueReminder(w, closesAt)).toBeNull();
    // A two-day window has no 3 day reminder.
    const short = { opensAt: new Date(closesAt.getTime() - 48 * 3_600_000), closesAt };
    expect(dueReminder(short, h(40))).toBeNull();
    expect(dueReminder(short, h(20))).toBe(24);
  });

  it("counts down in days, hours and minutes", () => {
    expect(timeLeft(new Date(now.getTime() + (4 * 24 + 6) * 3_600_000 + 5 * 60_000), now)).toMatchObject({ days: 4, hours: 6, minutes: 5 });
    expect(timeLeft(new Date(now.getTime() - 1000), now).totalMinutes).toBe(0);
  });

  it("groups grades into runs for labels", () => {
    expect(gradeRuns([11, 9, 10])).toEqual([[9, 11]]);
    expect(gradeRuns([-1, 0, 1, 2, 6, 8])).toEqual([
      [-1, 2],
      [6, 6],
      [8, 8],
    ]);
  });
});

describe("assisted access scope", () => {
  it("a helper sees the picker guidance for that one student and gains no other permission", () => {
    const base: EngineActor = { db: {} as EngineActor["db"], orgId: "o", membershipId: "t", isStudent: false, isParent: false, isStaff: true, can: (p) => p === "people.view", visibleStudentIds: null };
    const scoped = helperEngineActor(base, "s1");
    expect(scoped.visibleStudentIds).toEqual(["s1"]);
    expect(scoped.can("pathways.view")).toBe(true);
    expect(scoped.can("people.view")).toBe(true);
    expect(scoped.can("cases.view_all")).toBe(false);
    expect(scoped.can("cases.wellbeing")).toBe(false);
    expect(scoped.can("people.medical")).toBe(false);
    expect(scoped.can("pathways.manage")).toBe(false);
  });
});
