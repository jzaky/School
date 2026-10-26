// Course selection window rules shared by the server (enforcement) and the browser (countdowns).
// Pure: no database. A window is open from opensAt (inclusive) until closesAt (exclusive). Times are
// instants; the school enters and reads them in Dubai time (UTC+4, no daylight saving).

export type WindowLike = { id: string; academicYearId: string; gradeLevels: number[]; opensAt: Date; closesAt: Date };
export type WindowState = "upcoming" | "open" | "closed";

export const DUBAI_OFFSET_MINUTES = 240;

export function windowState(w: Pick<WindowLike, "opensAt" | "closesAt">, now: Date): WindowState {
  const t = now.getTime();
  if (t < w.opensAt.getTime()) return "upcoming";
  if (t < w.closesAt.getTime()) return "open";
  return "closed";
}

/**
 * The window that applies to a student in a grade for a year: an open one (the one closing last when
 * rounds overlap), else the next to open, else the one that closed most recently. Null when the school
 * has no window for that grade and year.
 */
export function pickWindow<T extends WindowLike>(windows: T[], yearId: string, grade: number, now: Date): T | null {
  const mine = windows.filter((w) => w.academicYearId === yearId && w.gradeLevels.includes(grade));
  const open = mine.filter((w) => windowState(w, now) === "open").sort((a, b) => b.closesAt.getTime() - a.closesAt.getTime());
  if (open[0]) return open[0];
  const upcoming = mine.filter((w) => windowState(w, now) === "upcoming").sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime());
  if (upcoming[0]) return upcoming[0];
  const closed = mine.sort((a, b) => b.closesAt.getTime() - a.closesAt.getTime());
  return closed[0] ?? null;
}

/** A time window that lets one student change choices (an exception or a class session) is active. */
export function activeUntil(row: { until?: Date; endsAt?: Date; startsAt?: Date; revokedAt?: Date | null; endedAt?: Date | null }, now: Date): boolean {
  if (row.revokedAt || row.endedAt) return false;
  if (row.startsAt && row.startsAt.getTime() > now.getTime()) return false;
  const end = row.until ?? row.endsAt;
  return !!end && end.getTime() > now.getTime();
}

/** Days, hours and minutes left until a time (never negative). */
export function timeLeft(until: Date, now: Date): { days: number; hours: number; minutes: number; totalMinutes: number } {
  const ms = Math.max(0, until.getTime() - now.getTime());
  const totalMinutes = Math.floor(ms / 60_000);
  return { days: Math.floor(totalMinutes / 1440), hours: Math.floor((totalMinutes % 1440) / 60), minutes: totalMinutes % 60, totalMinutes };
}

/** A Dubai date ("2026-11-03") and time ("15:00") as an instant. Null when either is malformed. */
export function dubaiInstant(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00+04:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The Dubai date and time parts of an instant, for date and time inputs. */
export function dubaiParts(d: Date): { date: string; time: string } {
  const local = new Date(d.getTime() + DUBAI_OFFSET_MINUTES * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/** Grade levels as contiguous runs, for labels such as "Grade 9 to Grade 11". */
export function gradeRuns(levels: number[]): Array<[number, number]> {
  const sorted = [...new Set(levels)].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (const g of sorted) {
    const last = runs[runs.length - 1];
    if (last && g === last[1] + 1) last[1] = g;
    else runs.push([g, g]);
  }
  return runs;
}

/** Reminder points before a window closes, in hours. Each is sent at most once per person. */
export const REMINDER_HOURS = [72, 24] as const;

/** Which reminder is due now (the closest one already reached), or null. */
export function dueReminder(w: Pick<WindowLike, "opensAt" | "closesAt">, now: Date): (typeof REMINDER_HOURS)[number] | null {
  if (windowState(w, now) !== "open") return null;
  const hoursLeft = (w.closesAt.getTime() - now.getTime()) / 3_600_000;
  // A window shorter than a reminder point does not send it (it would arrive as soon as it opens).
  const length = (w.closesAt.getTime() - w.opensAt.getTime()) / 3_600_000;
  const due = REMINDER_HOURS.filter((h) => hoursLeft <= h && length > h);
  return due.length ? due[due.length - 1] : null;
}
