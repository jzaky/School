// A school's attendance settings and code list, with defaults, plus the clock rules for registers.
// No "server-only" marker: the worker and the seed use it too. Reads go through the caller's tenant client.
import type { AttendanceSettings, RegisterMode } from "@prisma/client";
import type { TenantDb, TenantTx } from "@/lib/tenant-db";
import { DEFAULT_CODES, type Code } from "./codes";

type Db = TenantDb | TenantTx;

export type Settings = {
  mode: RegisterMode;
  dailyStart: string;
  lateCutoffMin: number;
  closeTime: string;
  followUpTime: string;
  autoNotify: boolean;
  persistentThreshold: number;
  persistentMinDays: number;
  dailyOnlyGrades: number[];
  headsOfYear: Record<string, string[]>;
  /** Regulator absence limit (src/server/attendance/limits.ts). */
  limit: { enabled: boolean; consecutive: number; total: number; warnPct: number };
  /** False when the school has never saved settings (the defaults apply). */
  saved: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
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
  limit: { enabled: false, consecutive: 10, total: 15, warnPct: 70 },
  saved: false,
};

function cleanHeads(v: unknown): Record<string, string[]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, ids] of Object.entries(v as Record<string, unknown>)) {
    if (!/^-?\d{1,2}$/.test(k) || !Array.isArray(ids)) continue;
    out[k] = ids.filter((x): x is string => typeof x === "string").slice(0, 5);
  }
  return out;
}

export function settingsFromRow(row: AttendanceSettings | null): Settings {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    mode: row.mode,
    dailyStart: row.dailyStart,
    lateCutoffMin: row.lateCutoffMin,
    closeTime: row.closeTime,
    followUpTime: row.followUpTime,
    autoNotify: row.autoNotify,
    persistentThreshold: row.persistentThreshold,
    persistentMinDays: row.persistentMinDays,
    dailyOnlyGrades: row.dailyOnlyGrades,
    headsOfYear: cleanHeads(row.headsOfYear),
    limit: { enabled: row.limitEnabled, consecutive: row.limitConsecutive, total: row.limitTotal, warnPct: row.limitWarnPct },
    saved: true,
  };
}

/** Local date keys of the school's published holidays between two date keys (holidays are stored as local midnights). */
export async function holidayKeys(db: Db, from: string, to: string, timeZone = "Asia/Dubai"): Promise<Set<string>> {
  const lo = new Date(`${from}T00:00:00Z`).getTime() - 86_400_000;
  const hi = new Date(`${to}T00:00:00Z`).getTime() + 2 * 86_400_000;
  const events = await (db as TenantTx).calendarEvent.findMany({ where: { kind: "HOLIDAY", published: true, startsAt: { lt: new Date(hi) }, endsAt: { gt: new Date(lo) } }, select: { startsAt: true, endsAt: true } });
  const out = new Set<string>();
  for (const e of events) {
    let k = localClock(e.startsAt, timeZone).dateKey;
    const last = localClock(new Date(e.endsAt.getTime() - 1), timeZone).dateKey;
    for (let i = 0; i < 60 && k <= last; i++) {
      if (k >= from && k <= to) out.add(k);
      const d = new Date(`${k}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      k = d.toISOString().slice(0, 10);
    }
  }
  return out;
}

export async function loadSettings(db: Db): Promise<Settings> {
  const row = await (db as TenantTx).attendanceSettings.findFirst();
  return settingsFromRow(row);
}

/** The school's codes in order (inactive ones too, so old marks keep their label), or the default set. */
export async function loadCodes(db: Db): Promise<{ codes: Code[]; custom: boolean }> {
  const rows = await (db as TenantTx).attendanceCode.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  if (!rows.length) return { codes: DEFAULT_CODES.map((c) => ({ ...c })), custom: false };
  const codes: Code[] = rows.map((r) => ({
    code: r.code,
    labelEn: r.labelEn,
    labelAr: r.labelAr,
    countsAs: r.countsAs,
    authorised: r.authorised,
    late: r.late,
    category: r.category,
    private: r.private,
    quick: r.quick,
    active: r.active,
    sortOrder: r.sortOrder,
  }));
  return { codes, custom: true };
}

// ---------------------------------------------------------------------------
// Clock: local date and minute in the school's time zone
// ---------------------------------------------------------------------------

export function toMin(hhmm: string) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

export function isHhmm(v: string) {
  const m = toMin(v);
  return Number.isFinite(m) && m >= 0 && m < 24 * 60;
}

/** Local date key (YYYY-MM-DD), minute of the day and weekday (0 Sunday) for an instant. */
export function localClock(now: Date, timeZone = "Asia/Dubai") {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  const minute = Number(get("hour")) * 60 + Number(get("minute"));
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return { dateKey, minute, weekday };
}

export type RegisterClock = {
  /** Start of the register (the lesson start, or the daily registration time), minute of day. */
  startMin: number;
  dateKey: string;
};

/**
 * What a teacher without attendance.manage may still do on a register:
 * - "open": any mark, including late.
 * - "late_closed": the late cut-off has passed; they can mark present or absent, but not late.
 * - "closed": the register is closed (by the office, or the day's close time, or a past date); read only.
 * - "future": the day has not come yet; read only.
 */
export function registerWindow(s: Pick<Settings, "lateCutoffMin" | "closeTime">, reg: RegisterClock & { closedAt: Date | null }, clock: { dateKey: string; minute: number }): "open" | "late_closed" | "closed" | "future" {
  if (reg.closedAt) return "closed";
  if (reg.dateKey > clock.dateKey) return "future";
  if (reg.dateKey < clock.dateKey) return "closed";
  if (clock.minute >= toMin(s.closeTime)) return "closed";
  if (clock.minute > reg.startMin + s.lateCutoffMin) return "late_closed";
  return "open";
}

/** Minutes late if the student arrives now, for a register that started at `startMin`. */
export function minutesLateNow(startMin: number, clockMinute: number) {
  return Math.max(1, Math.min(240, clockMinute - startMin));
}
