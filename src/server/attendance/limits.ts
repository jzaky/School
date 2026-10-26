// Regulator absence limit: counting school days of unexcused absence. Pure and unit-tested.
//
// Example rule: under the Sharjah Private Education Authority's learner admission policy (SPEA-8.1-01.0), a learner
// is de-registered after 10 consecutive or 15 separate school days of unexcused absence, based on the school's
// report. Schools switch the limit on and set both numbers in attendance settings; it is off by default.
//
// Counting, over the academic year to date:
// - Only school days count: the school's week days, without holidays on the school calendar.
// - An unexcused day is a daily mark that counts as an absence and is not authorised (absences still unexplained
//   count, because they are unexcused until the office explains them).
// - A run of consecutive days is broken by a school day the student attended or was excused. A school day with no
//   mark at all, or a not-counted mark, neither adds to nor breaks the run.
import { addDays, keyToDate } from "@/server/timetable/cover";

export type DayKind = "unexcused" | "break" | "skip";

/** School days (YYYY-MM-DD) from `from` to `to`, on the school's week days and not on a holiday. */
export function schoolDaysBetween(from: string, to: string, weekDays: number[], holidays: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (from > to) return out;
  let k = from;
  for (let i = 0; i < 800 && k <= to; i++) {
    if (weekDays.includes(keyToDate(k).getUTCDay()) && !holidays.has(k)) out.push(k);
    k = addDays(k, 1);
  }
  return out;
}

/** Longest and current run of consecutive unexcused school days, and the total, over the given school days. */
export function unexcusedRuns(schoolDays: string[], kinds: ReadonlyMap<string, DayKind>) {
  let run = 0;
  let longest = 0;
  let total = 0;
  for (const d of schoolDays) {
    const k = kinds.get(d) ?? "skip";
    if (k === "unexcused") {
      run++;
      total++;
      if (run > longest) longest = run;
    } else if (k === "break") run = 0;
  }
  return { longest, current: run, total };
}

export type Limits = { enabled: boolean; consecutive: number; total: number; warnPct: number };

export const SHARJAH_PRESET = { consecutive: 10, total: 15 } as const;

/** The count at which staff are warned: the warning percentage of a limit, rounded up, and below the limit itself. */
export function warnAt(limit: number, warnPct: number) {
  return Math.min(limit - 1, Math.max(1, Math.ceil((limit * warnPct) / 100)));
}

/** Where a student stands against the limit. */
export function limitLevel(counts: { longest: number; total: number }, l: Limits): "none" | "warning" | "reached" {
  if (!l.enabled) return "none";
  if (counts.longest >= l.consecutive || counts.total >= l.total) return "reached";
  if (counts.longest >= warnAt(l.consecutive, l.warnPct) || counts.total >= warnAt(l.total, l.warnPct)) return "warning";
  return "none";
}
