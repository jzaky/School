import { describe, expect, it } from "vitest";
import { computeSlots, dubaiDateKey, dubaiInstant, pickRoundRobinHost, type HostInput, type TypeInput } from "@/server/appointments/slots";

// Monday 5 October 2026, 06:00 Dubai (02:00 UTC)
const NOW = new Date(Date.UTC(2026, 9, 5, 2, 0));
const MON = "2026-10-05";
const type: TypeInput = { id: "t", durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 10, minNoticeMin: 0, dailyMax: null, horizonDays: 30 };
const host = (over: Partial<HostInput> = {}): HostInput => ({
  id: "h1",
  rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 11 * 60 })),
  overrides: [],
  busy: [],
  ...over,
});

describe("slot calculation", () => {
  it("uses Asia/Dubai wall-clock times", () => {
    const slots = computeSlots({ type, hosts: [host()], now: NOW, days: 1 });
    const first = slots.get(MON)![0];
    expect(first.start.toISOString()).toBe("2026-10-05T05:00:00.000Z"); // 09:00 Dubai
    expect(dubaiDateKey(first.start)).toBe(MON);
    expect(slots.get(MON)!.map((s) => s.start.getUTCHours() * 60 + s.start.getUTCMinutes() + 240)).toEqual([540, 570, 600, 630]);
  });

  it("skips the weekend (Saturday and Sunday)", () => {
    const slots = computeSlots({ type, hosts: [host()], now: NOW, days: 7 });
    expect([...slots.keys()]).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  });

  it("respects existing bookings and buffers", () => {
    const busy = [{ start: dubaiInstant(MON, 9 * 60 + 30), end: dubaiInstant(MON, 10 * 60) }];
    const slots = computeSlots({ type, hosts: [host({ busy })], now: NOW, days: 1 });
    const minutes = slots.get(MON)!.map((s) => (s.start.getTime() - dubaiInstant(MON, 0).getTime()) / 60000);
    // 09:00 would end 09:30 plus a 10 minute buffer, overlapping the 09:30 booking. 10:00 is free, 10:30 too.
    expect(minutes).toEqual([600, 630]);
  });

  it("applies the buffer before a new booking", () => {
    const t2 = { ...type, bufferBeforeMin: 15, bufferAfterMin: 0 };
    const busy = [{ start: dubaiInstant(MON, 9 * 60), end: dubaiInstant(MON, 9 * 60 + 30) }];
    const slots = computeSlots({ type: t2, hosts: [host({ busy })], now: NOW, days: 1 });
    const minutes = slots.get(MON)!.map((s) => (s.start.getTime() - dubaiInstant(MON, 0).getTime()) / 60000);
    expect(minutes).toEqual([600, 630]);
  });

  it("enforces minimum notice", () => {
    const now = dubaiInstant(MON, 9 * 60 + 5);
    const slots = computeSlots({ type: { ...type, minNoticeMin: 60 }, hosts: [host()], now, days: 1 });
    const minutes = slots.get(MON)!.map((s) => (s.start.getTime() - dubaiInstant(MON, 0).getTime()) / 60000);
    expect(minutes).toEqual([630]);
  });

  it("enforces the daily maximum per host", () => {
    const busy = [
      { start: dubaiInstant(MON, 13 * 60), end: dubaiInstant(MON, 13 * 60 + 30), typeId: "t" },
      { start: dubaiInstant(MON, 14 * 60), end: dubaiInstant(MON, 14 * 60 + 30), typeId: "t" },
    ];
    const slots = computeSlots({ type: { ...type, dailyMax: 2 }, hosts: [host({ busy })], now: NOW, days: 2 });
    expect(slots.has(MON)).toBe(false);
    expect(slots.has("2026-10-06")).toBe(true);
  });

  it("applies date overrides: full day off, custom hours, partial block", () => {
    const off = computeSlots({ type, hosts: [host({ overrides: [{ date: MON, isUnavailable: true }] })], now: NOW, days: 1 });
    expect(off.has(MON)).toBe(false);
    const custom = computeSlots({ type, hosts: [host({ overrides: [{ date: MON, isUnavailable: false, startMinute: 14 * 60, endMinute: 15 * 60 }] })], now: NOW, days: 1 });
    expect(custom.get(MON)!.length).toBe(2);
    const partial = computeSlots({ type, hosts: [host({ overrides: [{ date: MON, isUnavailable: true, startMinute: 9 * 60, endMinute: 10 * 60 }] })], now: NOW, days: 1 });
    expect(partial.get(MON)!.length).toBe(2);
  });

  it("does not go past the booking horizon", () => {
    const slots = computeSlots({ type: { ...type, horizonDays: 2 }, hosts: [host()], now: NOW, days: 14 });
    expect([...slots.keys()]).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
  });

  it("merges round-robin hosts and assigns the least booked", () => {
    const a = host({ id: "a", busy: [{ start: dubaiInstant("2026-10-06", 9 * 60), end: dubaiInstant("2026-10-06", 9 * 60 + 30), typeId: "t" }] });
    const b = host({ id: "b" });
    const slots = computeSlots({ type, hosts: [a, b], now: NOW, days: 1 });
    const first = slots.get(MON)![0];
    expect(first.hostIds.sort()).toEqual(["a", "b"]);
    expect(pickRoundRobinHost(first, [a, b], "t")).toBe("b");
  });
});
