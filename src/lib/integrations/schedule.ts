// Schedule slots for sync sources. A slot names one scheduled run ("h:2026-10-06T14" for an hourly source,
// "d:2026-10-06" for a daily one) in the school's time zone; (source, slot) is the run's idempotency key, so
// a slot runs at most once however often the scheduler ticks. Pure, unit-tested.

export const SYNC_SCHEDULES = ["HOURLY", "DAILY"] as const;
export type SyncSchedule = (typeof SYNC_SCHEDULES)[number];

export const isSyncSchedule = (v: unknown): v is SyncSchedule => v === "HOURLY" || v === "DAILY";

/** Local date (YYYY-MM-DD) and hour (0-23) of an instant in a time zone. */
export function localParts(now: Date, timeZone: string): { date: string; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

/**
 * The slot due now, or null when nothing is due yet. A daily source becomes due at its hour (school time) and
 * stays due for the rest of that day, so a missed tick (worker restart) still runs it.
 */
export function dueSlot(source: { schedule: string; hour: number; enabled: boolean; lastSlot: string | null }, now: Date, timeZone: string): string | null {
  if (!source.enabled) return null;
  const { date, hour } = localParts(now, timeZone);
  const slot = source.schedule === "HOURLY" ? `h:${date}T${String(hour).padStart(2, "0")}` : hour >= source.hour ? `d:${date}` : null;
  if (!slot || slot === source.lastSlot) return null;
  return slot;
}

/** Result of a run from the import counts: nothing saved is a failure, some rows failing is partial. */
export function runStatus(total: number, succeeded: number, failed: number): "SUCCEEDED" | "PARTIAL" | "FAILED" {
  if (total > 0 && succeeded === 0) return "FAILED";
  return failed > 0 ? "PARTIAL" : "SUCCEEDED";
}

/** Admins are told once, when a source reaches this many failed runs in a row. */
export const FAILURE_ALERT_AFTER = 3;
