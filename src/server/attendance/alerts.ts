// Staff alerts about attendance, never with reasons. No "server-only" marker: the worker runs them.
// - Persistent absence: when a student's term-to-date attendance falls below the school's threshold (after a
//   minimum number of possible sessions), the homeroom teacher and the heads of year for the student's grade are
//   told once per term.
// - Regulator absence limit (when the school switches it on): the attendance office and the heads of year are told
//   when a student's unexcused absence reaches the warning level of either limit, and again on reaching it.
// Idempotent: one AttendanceAlert per student, period and kind (unique), created before anyone is notified.
import type { Effect } from "@/server/db";
import { execCtx } from "@/server/db";
import { tenantDb, tenantTx, type TenantDb } from "@/lib/tenant-db";
import { notify } from "@/server/notify/notify";
import { audit } from "@/server/audit/audit";
import { dateKey, keyToDate } from "@/server/timetable/cover";
import { resolveCode } from "./codes";
import { ensureFollowUpTemplates } from "./followup";
import { isPersistent, round1 } from "./maths";
import { buildReport } from "./reports";
import { limitLevel, schoolDaysBetween, unexcusedRuns, type DayKind } from "./limits";
import { holidayKeys, loadCodes, loadSettings, localClock, type Settings } from "./settings";

const nameOf = (s: { firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string }) => ({ en: `${s.firstNameEn} ${s.lastNameEn}`, ar: `${s.firstNameAr || s.firstNameEn} ${s.lastNameAr || s.lastNameEn}` });

async function flushWith(effects: Effect[], flush?: (effects: Effect[]) => Promise<void>) {
  if (!effects.length) return;
  const f = flush ?? (async (e: Effect[]) => (await import("@/server/queue-core")).flushEffects(e));
  await f(effects);
}

type AlertOpts = { now?: Date; flush?: (effects: Effect[]) => Promise<void>; /** The demo seed: record notifications without sending. */ quiet?: boolean };

export async function runPersistentAlerts(orgId: string, opts: AlertOpts = {}) {
  const now = opts.now ?? new Date();
  const db = tenantDb(orgId);
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
  if (!org) return { created: 0, resolved: 0 };
  const today = localClock(now, org.timezone || "Asia/Dubai").dateKey;
  const year = await db.academicYear.findFirst({ where: { isCurrent: true }, include: { terms: true } });
  const term = year?.terms.find((t) => dateKey(t.startsOn) <= today && today <= dateKey(t.endsOn));
  if (!term) return { created: 0, resolved: 0 };
  const settings = await loadSettings(db);
  const report = await buildReport(db, { kind: "school" }, { from: dateKey(term.startsOn), to: today, termId: term.id });
  const below = report.rows.filter((r) => isPersistent(r.tally, settings.persistentThreshold, settings.persistentMinDays));
  const existing = await db.attendanceAlert.findMany({ where: { periodId: term.id, kind: "PERSISTENT" }, select: { id: true, studentId: true, resolvedAt: true } });
  const fresh = below.filter((r) => !existing.some((e) => e.studentId === r.id));
  // Back above the threshold: the alert is resolved (it stays, so nobody is alerted twice in a term).
  const recovered = existing.filter((e) => !e.resolvedAt && !below.some((r) => r.id === e.studentId));
  const effects: Effect[] = [];
  let created = 0;
  await tenantTx(
    orgId,
    async (tx) => {
      if (recovered.length) await tx.attendanceAlert.updateMany({ where: { id: { in: recovered.map((r) => r.id) } }, data: { resolvedAt: now } });
      if (!fresh.length) return;
      await ensureFollowUpTemplates(tx, orgId);
      const ec = execCtx(tx, orgId, { now, effects, quiet: opts.quiet });
      const homerooms = await tx.enrollment.findMany({ where: { orgId, studentId: { in: fresh.map((r) => r.id) }, status: "ACTIVE", class: { isHomeroom: true, academicYearId: year!.id } }, select: { studentId: true, class: { select: { teacherMembershipId: true } } } });
      for (const r of fresh) {
        const claim = await tx.attendanceAlert.createMany({ data: [{ orgId, studentId: r.id, kind: "PERSISTENT", periodId: term.id, percent: round1(r.pct ?? 0), threshold: settings.persistentThreshold, possible: r.tally.possible, createdAt: now }], skipDuplicates: true });
        if (claim.count !== 1) continue;
        created++;
        const tutor = homerooms.find((h) => h.studentId === r.id)?.class.teacherMembershipId;
        const heads = settings.headsOfYear[String(r.gradeLevel)] ?? [];
        const recipients = [...new Set([tutor, ...heads].filter(Boolean) as string[])];
        if (!recipients.length) continue;
        await notify(ec, {
          recipients,
          templateKey: "attendance_persistent",
          kind: "attendance_persistent",
          vars: { student: nameOf(r), pct: round1(r.pct ?? 0).toFixed(1), threshold: String(settings.persistentThreshold) },
          href: `/attendance/reports?student=${r.id}`,
          idempotencyBase: `att-persistent:${r.id}:${term.id}`,
        });
      }
      if (created) await audit(tx, orgId, { action: "attendance.persistent_alerts", entityType: "AttendanceAlert", meta: { termId: term.id, created, threshold: settings.persistentThreshold } });
    },
    { timeout: 60_000 },
  );
  await flushWith(effects, opts.flush);
  return { created, resolved: recovered.length };
}

// ---------------------------------------------------------------------------
// Regulator absence limit
// ---------------------------------------------------------------------------

export type LimitRow = { studentId: string; longest: number; current: number; total: number; level: "warning" | "reached" };

/**
 * Students at or above the warning level of the regulator absence limit, for the academic year to date.
 * Reads only unexcused days and, for those students, their other marks (to find what breaks a run).
 */
export async function limitStanding(db: TenantDb, settings: Settings, opts: { timeZone: string; weekDays: number[]; today: string }): Promise<{ yearId: string | null; rows: LimitRow[] }> {
  if (!settings.limit.enabled) return { yearId: null, rows: [] };
  const year = await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, startsOn: true } });
  if (!year) return { yearId: null, rows: [] };
  const from = dateKey(year.startsOn);
  const to = opts.today;
  if (from > to) return { yearId: year.id, rows: [] };
  const range = { gte: keyToDate(from), lte: keyToDate(to) };
  const unexcused = await db.attendanceRecord.groupBy({ by: ["studentId"], where: { date: range, status: "ABSENT", student: { status: "ACTIVE" } }, _count: { _all: true } });
  const { codes } = await loadCodes(db);
  const candidates = unexcused.filter((u) => u._count._all >= Math.min(2, settings.limit.total)).map((u) => u.studentId);
  if (!candidates.length) return { yearId: year.id, rows: [] };
  const [records, holidays] = await Promise.all([
    db.attendanceRecord.findMany({ where: { date: range, studentId: { in: candidates } }, select: { studentId: true, date: true, code: true, status: true } }),
    holidayKeys(db, from, to, opts.timeZone),
  ]);
  const days = schoolDaysBetween(from, to, opts.weekDays, holidays);
  const byStudent = new Map<string, Map<string, DayKind>>();
  for (const r of records) {
    const c = resolveCode(codes, r.code, r.status);
    const kind: DayKind = !c || c.countsAs === "NOT_COUNTED" ? "skip" : c.countsAs === "ABSENT" && !c.authorised ? "unexcused" : "break";
    const m = byStudent.get(r.studentId) ?? new Map<string, DayKind>();
    m.set(dateKey(r.date), kind);
    byStudent.set(r.studentId, m);
  }
  const rows: LimitRow[] = [];
  for (const [studentId, kinds] of byStudent) {
    const runs = unexcusedRuns(days, kinds);
    const level = limitLevel(runs, settings.limit);
    if (level !== "none") rows.push({ studentId, ...runs, level });
  }
  rows.sort((a, b) => (a.level === b.level ? b.total - a.total || b.longest - a.longest : a.level === "reached" ? -1 : 1));
  return { yearId: year.id, rows };
}

/** Alert the attendance office and heads of year at the warning level and on reaching the limit, once each per year. */
export async function runLimitAlerts(orgId: string, opts: AlertOpts = {}) {
  const now = opts.now ?? new Date();
  const db = tenantDb(orgId);
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true, weekDays: true } });
  if (!org) return { warned: 0, reached: 0 };
  const settings = await loadSettings(db);
  if (!settings.limit.enabled) return { warned: 0, reached: 0 };
  const tz = org.timezone || "Asia/Dubai";
  const { yearId, rows } = await limitStanding(db, settings, { timeZone: tz, weekDays: org.weekDays.length ? org.weekDays : [1, 2, 3, 4, 5], today: localClock(now, tz).dateKey });
  if (!yearId || !rows.length) return { warned: 0, reached: 0 };
  const effects: Effect[] = [];
  const out = { warned: 0, reached: 0 };
  await tenantTx(
    orgId,
    async (tx) => {
      await ensureFollowUpTemplates(tx, orgId);
      const ec = execCtx(tx, orgId, { now, effects, quiet: opts.quiet });
      const office = (await tx.membership.findMany({ where: { orgId, status: "ACTIVE", roles: { some: { role: { permissions: { has: "attendance.manage" } } } } }, select: { id: true } })).map((m) => m.id);
      const students = await tx.student.findMany({ where: { orgId, id: { in: rows.map((r) => r.studentId) } }, select: { id: true, gradeLevel: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true } });
      for (const r of rows) {
        const s = students.find((x) => x.id === r.studentId);
        if (!s) continue;
        // A student who reaches the limit straight away gets the "reached" alert only; the warning is recorded silently.
        const kinds = r.level === "reached" ? (["LIMIT_WARNING", "LIMIT_REACHED"] as const) : (["LIMIT_WARNING"] as const);
        for (const kind of kinds) {
          const claim = await tx.attendanceAlert.createMany({ data: [{ orgId, studentId: s.id, kind, periodId: yearId, consecutive: r.longest, total: r.total, threshold: kind === "LIMIT_REACHED" ? settings.limit.total : settings.limit.warnPct, createdAt: now }], skipDuplicates: true });
          if (claim.count !== 1) continue;
          if (kind === "LIMIT_WARNING" && r.level === "reached") continue;
          const recipients = [...new Set([...office, ...(settings.headsOfYear[String(s.gradeLevel)] ?? [])])];
          if (!recipients.length) continue;
          await notify(ec, {
            recipients,
            templateKey: kind === "LIMIT_REACHED" ? "attendance_limit_reached" : "attendance_limit_warning",
            kind: "attendance_limit",
            vars: { student: nameOf(s), total: String(r.total), consecutive: String(r.longest), limitConsecutive: String(settings.limit.consecutive), limitTotal: String(settings.limit.total) },
            href: "/attendance/office#limits",
            idempotencyBase: `att-limit:${kind}:${s.id}:${yearId}`,
          });
          if (kind === "LIMIT_REACHED") out.reached++;
          else out.warned++;
        }
      }
      if (out.warned || out.reached) await audit(tx, orgId, { action: "attendance.limit_alerts", entityType: "AttendanceAlert", meta: { yearId, ...out, limit: settings.limit } });
    },
    { timeout: 60_000 },
  );
  await flushWith(effects, opts.flush);
  return out;
}

/** The hourly worker job: both kinds of alert. */
export async function runAttendanceAlerts(orgId: string, opts: AlertOpts = {}) {
  const persistent = await runPersistentAlerts(orgId, opts);
  const limits = await runLimitAlerts(orgId, opts);
  return { persistent, limits };
}
