// Attendance percentages. Pure and unit-tested.
// - A possible session is a mark whose code counts as present or absent. Not-counted codes are left out.
// - Attendance % = sessions attended / possible sessions. Late, school activity and remote learning count as attended.
// - Unauthorised absence includes absences still unexplained: until the office explains them, they are not authorised.
import type { Code } from "./codes";

export type Tally = {
  possible: number;
  attended: number;
  late: number;
  minutesLate: number;
  authorised: number;
  unauthorised: number;
  unexplained: number;
  activity: number;
  notCounted: number;
};

export const emptyTally = (): Tally => ({ possible: 0, attended: 0, late: 0, minutesLate: 0, authorised: 0, unauthorised: 0, unexplained: 0, activity: 0, notCounted: 0 });

/** Add `n` marks of one code (and their late minutes) to a tally. */
export function addTo(t: Tally, code: Pick<Code, "countsAs" | "authorised" | "late" | "category">, n: number, minutesLate = 0): Tally {
  if (n <= 0) return t;
  if (code.countsAs === "NOT_COUNTED") {
    t.notCounted += n;
    return t;
  }
  t.possible += n;
  if (code.countsAs === "PRESENT") {
    t.attended += n;
    if (code.late) {
      t.late += n;
      t.minutesLate += minutesLate;
    }
    if (code.category === "activity") t.activity += n;
    return t;
  }
  if (code.authorised) t.authorised += n;
  else {
    t.unauthorised += n;
    if (code.category === "unexplained") t.unexplained += n;
  }
  return t;
}

export function merge(a: Tally, b: Tally): Tally {
  return {
    possible: a.possible + b.possible,
    attended: a.attended + b.attended,
    late: a.late + b.late,
    minutesLate: a.minutesLate + b.minutesLate,
    authorised: a.authorised + b.authorised,
    unauthorised: a.unauthorised + b.unauthorised,
    unexplained: a.unexplained + b.unexplained,
    activity: a.activity + b.activity,
    notCounted: a.notCounted + b.notCounted,
  };
}

const ratio = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);

/** Attendance percentage, or null when there are no possible sessions. */
export const attendancePct = (t: Tally) => ratio(t.attended, t.possible);
export const unauthorisedPct = (t: Tally) => ratio(t.unauthorised, t.possible);
export const authorisedPct = (t: Tally) => ratio(t.authorised, t.possible);
export const latePct = (t: Tally) => ratio(t.late, t.possible);

/** One decimal, rounded half away from zero, so 89.95 shows as 90.0 and 89.94 as 89.9. */
export function round1(n: number) {
  return Math.sign(n) * Math.round(Math.abs(n) * 10 + 1e-9) / 10;
}

/** Below the persistent absence threshold, once enough sessions are on record. */
export function isPersistent(t: Tally, threshold: number, minPossible: number) {
  const pct = attendancePct(t);
  return pct !== null && t.possible >= minPossible && pct < threshold;
}

/** Colour band for a percentage: at or above 95 good, 90 to 95 watch, below 90 concern (the threshold). */
export function band(pct: number | null, threshold = 90): "good" | "watch" | "concern" | "none" {
  if (pct === null) return "none";
  if (pct >= Math.max(threshold, 95)) return "good";
  if (pct >= threshold) return "watch";
  return "concern";
}
