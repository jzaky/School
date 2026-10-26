// Admissions rules that need no database: age check per grade, duplicate keys, waitlist priority and order,
// and seat counts. Pure: safe for client and server.
import { KG1, MAX_GRADE_LEVEL } from "@/lib/grade-levels";

// ---------------------------------------------------------------------------
// Age check
// ---------------------------------------------------------------------------

/** Usual age on the cut-off date for a grade: KG1 (-1) is 4, KG2 (0) is 5, Grade 1 is 6, Grade 12 is 17. */
export function expectedAge(gradeLevel: number): number {
  return gradeLevel + 5;
}

/** Completed years of age on the cut-off date (month 1-12, day) of the year the academic year starts. */
export function ageOnCutoff(dob: Date, entryYear: number, cutoffMonth: number, cutoffDay: number): number {
  const by = dob.getUTCFullYear();
  const bm = dob.getUTCMonth() + 1;
  const bd = dob.getUTCDate();
  let age = entryYear - by;
  if (bm > cutoffMonth || (bm === cutoffMonth && bd > cutoffDay)) age--;
  return age;
}

export type AgeFlag = "UNDER" | "OVER" | null;

/**
 * Whether the child's age fits the grade on the school's cut-off date. Staff see a flag; families are never blocked.
 * The default cut-off is 31 December: the UAE Ministry of Education announced it on 17 December 2025 for new
 * admissions from 2026-27 (KG1 age 4, KG2 age 5, Grade 1 age 6). Schools whose year starts in April use 31 March.
 * The cut-off is a per-school setting; each school confirms it with its regulator.
 */
export function ageFlag(dob: Date | null | undefined, gradeLevel: number, entryYear: number, cutoff: { month: number; day: number }): { flag: AgeFlag; age: number | null; expected: number } {
  const expected = expectedAge(gradeLevel);
  if (!dob) return { flag: null, age: null, expected };
  const age = ageOnCutoff(dob, entryYear, cutoff.month, cutoff.day);
  return { flag: age < expected ? "UNDER" : age > expected ? "OVER" : null, age, expected };
}

/** The birth dates that fit a grade: born after `from` and on or before `to` (both UTC dates). */
export function birthRangeFor(gradeLevel: number, entryYear: number, cutoff: { month: number; day: number }) {
  const age = expectedAge(gradeLevel);
  const to = new Date(Date.UTC(entryYear - age, cutoff.month - 1, cutoff.day));
  const from = new Date(Date.UTC(entryYear - age - 1, cutoff.month - 1, cutoff.day));
  return { from, to };
}

export function validCutoff(month: number, day: number) {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false;
  // A leap year, so 29 February is a valid cut-off day.
  return day <= new Date(Date.UTC(2028, month, 0)).getUTCDate();
}

export function validGrade(g: number) {
  return Number.isInteger(g) && g >= KG1 && g <= MAX_GRADE_LEVEL;
}

// ---------------------------------------------------------------------------
// Duplicate keys
// ---------------------------------------------------------------------------

/** Lower case, no accents, single spaces, letters and digits only (Latin and Arabic). */
export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ًͯ-ٰٟ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ء-ي ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Name and date of birth key for duplicate detection, or null when either is missing. */
export function nameDobKey(firstEn: string | null | undefined, lastEn: string | null | undefined, dob: Date | null | undefined): string | null {
  const f = normName(firstEn);
  const l = normName(lastEn);
  if (!f || !l || !dob) return null;
  return `${f}|${l}|${dob.toISOString().slice(0, 10)}`;
}

/** Emirates ID digits (15, starting 784) or null when it is not a well-formed number. */
export function eidDigits(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return /^784\d{12}$/.test(d) ? d : null;
}

/** 784-YYYY-NNNNNNN-N */
export function formatEid(digits: string): string {
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 14)}-${digits.slice(14)}`;
}

// ---------------------------------------------------------------------------
// Waitlist
// ---------------------------------------------------------------------------

export type PriorityInput = { siblingStudentIds: string[]; staffChildVerified: boolean; priorityBoost: number };

/** Priority points: a sibling at the school and a verified staff child each add one, plus any staff adjustment. */
export function priorityScore(a: PriorityInput): number {
  return (a.siblingStudentIds.length > 0 ? 1 : 0) + (a.staffChildVerified ? 1 : 0) + (Number.isFinite(a.priorityBoost) ? a.priorityBoost : 0);
}

export type WaitlistEntry = PriorityInput & { id: string; number: string; waitlistedAt: Date | null; submittedAt: Date | null; createdAt: Date };

/** Waitlist order: priority first (higher first), then the date the application joined the list (earlier first). */
export function compareWaitlist(a: WaitlistEntry, b: WaitlistEntry): number {
  const p = priorityScore(b) - priorityScore(a);
  if (p !== 0) return p;
  const da = (a.waitlistedAt ?? a.submittedAt ?? a.createdAt).getTime();
  const db = (b.waitlistedAt ?? b.submittedAt ?? b.createdAt).getTime();
  if (da !== db) return da - db;
  return a.number.localeCompare(b.number);
}

export function orderWaitlist<T extends WaitlistEntry>(rows: T[]): Array<T & { position: number; score: number }> {
  return [...rows].sort(compareWaitlist).map((r, i) => ({ ...r, position: i + 1, score: priorityScore(r) }));
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

export type SeatCounts = {
  /** Total places, or null when the school has not set capacity for the grade. */
  capacity: number | null;
  /** Students already placed in the grade for that year (enrolled, or continuing into it). */
  enrolled: number;
  /** Accepted offers not enrolled yet. */
  holding: number;
  /** Offers made and not answered. */
  offered: number;
  waitlisted: number;
};

export function seatsAvailable(c: SeatCounts): number | null {
  if (c.capacity === null) return null;
  return c.capacity - c.enrolled - c.holding - c.offered;
}

/** Can the school make one more offer in this grade? Unlimited when capacity is not set. */
export function canOffer(c: SeatCounts): boolean {
  const free = seatsAvailable(c);
  return free === null || free > 0;
}

export function capacityOf(sectionSeats: number[] | null | undefined): number | null {
  if (!sectionSeats || sectionSeats.length === 0) return null;
  return sectionSeats.reduce((s, n) => s + Math.max(0, n), 0);
}

export const SECTION_LETTERS = "ABCDEFGHIJKLMNOP";
export const sectionName = (i: number) => SECTION_LETTERS[i] ?? String(i + 1);

// ---------------------------------------------------------------------------
// Money (fils)
// ---------------------------------------------------------------------------

/** "1,500.00" from 150000 fils. Never uses floating point for the amount. */
export function filsToAed(fils: number): string {
  const neg = fils < 0;
  const abs = Math.abs(Math.trunc(fils));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** Parse "1500", "1,500.5" or "1500.50" into fils; null when it is not a valid non-negative amount. */
export function aedToFils(input: string): number | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}
