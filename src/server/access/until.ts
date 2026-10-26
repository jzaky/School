// End dates for time-limited role assignments. A person picks a calendar day ("until 5 November"); access
// lasts to the end of that day in the school's time zone (Asia/Dubai, UTC+4 all year, no daylight saving).
const DUBAI_OFFSET_MS = 4 * 3_600_000;
const DAY = 86_400_000;
/** Longest time-limited assignment, so a typo cannot turn cover into a multi-year grant. */
export const MAX_UNTIL_DAYS = 400;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar day in Dubai for an instant, as YYYY-MM-DD. */
export function dubaiDayKey(d: Date): string {
  return new Date(d.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
}

/** The last millisecond of a Dubai calendar day. */
export function endOfDubaiDay(day: string): Date | null {
  const m = DATE_RE.exec(day);
  if (!m) return null;
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(start) || new Date(start).toISOString().slice(0, 10) !== day) return null;
  return new Date(start - DUBAI_OFFSET_MS + DAY - 1);
}

export type UntilError = "INVALID_DATE" | "PAST_DATE" | "TOO_FAR";

/** Parse an "until" day for a new or changed assignment: today or later, and at most MAX_UNTIL_DAYS ahead. */
export function parseUntil(day: string, now: Date = new Date()): { ok: true; expiresAt: Date } | { ok: false; error: UntilError } {
  const end = endOfDubaiDay(day.trim());
  if (!end) return { ok: false, error: "INVALID_DATE" };
  if (end.getTime() <= now.getTime()) return { ok: false, error: "PAST_DATE" };
  if (end.getTime() - now.getTime() > (MAX_UNTIL_DAYS + 1) * DAY) return { ok: false, error: "TOO_FAR" };
  return { ok: true, expiresAt: end };
}

/** Whether an assignment still grants access at `now`. */
export function assignmentActive(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  return !expiresAt || expiresAt.getTime() > now.getTime();
}

/** Prisma filter for assignments that still grant access. */
export function activeAssignmentWhere(now: Date = new Date()) {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

/**
 * How the request context (src/server/context.ts) loads a member's roles: only assignments that have not
 * ended, so a time-limited role stops working on the person's very next request.
 */
export function activeRolesInclude(now: Date = new Date()) {
  return { where: activeAssignmentWhere(now), include: { role: true as const } };
}

/** Whole days left until an assignment ends (0 on its last day). */
export function daysLeft(expiresAt: Date, now: Date = new Date()): number {
  const a = Date.parse(`${dubaiDayKey(now)}T00:00:00Z`);
  const b = Date.parse(`${dubaiDayKey(expiresAt)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / DAY));
}
