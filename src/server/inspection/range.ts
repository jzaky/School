// Date ranges for the evidence pack, as whole days in Dubai time. `to` is exclusive (midnight after the last day).
// Pure.

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const DUBAI_OFFSET_MIN = 240;

/** Midnight in Dubai at the start of the day key, as a UTC instant. */
export function dubaiMidnight(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, -DUBAI_OFFSET_MIN));
}

/** The Dubai calendar day of an instant, as YYYY-MM-DD. */
export function dubaiDayKey(d: Date): string {
  return new Date(d.getTime() + DUBAI_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

export type DayRange = { fromKey: string; toKey: string; from: Date; to: Date };

/** Parse inclusive day keys into an instant range. Returns null for malformed or reversed input. */
export function parseDayRange(fromKey: string | null | undefined, toKey: string | null | undefined): DayRange | null {
  if (!fromKey || !toKey || !KEY_RE.test(fromKey) || !KEY_RE.test(toKey)) return null;
  const from = dubaiMidnight(fromKey);
  const to = new Date(dubaiMidnight(toKey).getTime() + DAY);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return null;
  return { fromKey, toKey, from, to };
}

/** The last `days` days up to and including today (Dubai). */
export function lastDays(now: Date, days: number): DayRange {
  const toKey = dubaiDayKey(now);
  const fromKey = dubaiDayKey(new Date(dubaiMidnight(toKey).getTime() - (days - 1) * DAY + 12 * 3_600_000));
  return parseDayRange(fromKey, toKey)!;
}
