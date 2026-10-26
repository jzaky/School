// Attendance reports: percentages per student, class, grade and school over a term or a date range, lateness and
// unauthorised absence. Aggregates run in SQL (groupBy over the daily records, or the lesson marks of one class),
// so a full school year (about 1,500 students and two million lesson marks) is never loaded into memory.
// Reports show codes and counts, never reasons: private codes are folded into "authorised" for everyone.
import type { AttendanceStatus } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";
import { dateKey, keyToDate } from "@/server/timetable/cover";
import { resolveCode, type Code } from "./codes";
import { addTo, attendancePct, emptyTally, merge, type Tally } from "./maths";
import { loadCodes } from "./settings";

export type Range = { from: string; to: string; termId: string | null };

const KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The current term to date, a chosen term, or an explicit range (at most 400 days). */
export async function resolveRange(db: TenantDb, input: { termId?: string | null; from?: string | null; to?: string | null }, todayKey: string): Promise<{ range: Range; terms: Array<{ id: string; nameEn: string; nameAr: string; from: string; to: string }> }> {
  const year = (await db.academicYear.findFirst({ where: { isCurrent: true }, include: { terms: { orderBy: { startsOn: "asc" } } } })) ?? null;
  const terms = (year?.terms ?? []).map((t) => ({ id: t.id, nameEn: t.nameEn, nameAr: t.nameAr, from: dateKey(t.startsOn), to: dateKey(t.endsOn) }));
  const cap = (k: string) => (k > todayKey ? todayKey : k);
  if (input.from && input.to && KEY.test(input.from) && KEY.test(input.to) && input.from <= input.to) {
    const days = (keyToDate(input.to).getTime() - keyToDate(input.from).getTime()) / 86_400_000;
    if (days <= 400) return { range: { from: input.from, to: cap(input.to), termId: null }, terms };
  }
  const chosen = input.termId ? terms.find((t) => t.id === input.termId) : null;
  const current = chosen ?? terms.find((t) => t.from <= todayKey && todayKey <= t.to) ?? [...terms].reverse().find((t) => t.from <= todayKey) ?? terms[0];
  if (current) return { range: { from: current.from, to: cap(current.to) < current.from ? current.from : cap(current.to), termId: current.id }, terms };
  // No academic year yet: the last 30 days.
  const from = dateKey(new Date(keyToDate(todayKey).getTime() - 29 * 86_400_000));
  return { range: { from, to: todayKey, termId: null }, terms };
}

type Group = { studentId: string; code: string | null; status: AttendanceStatus; _count: { _all: number }; _sum: { minutesLate: number | null } };

function tallyGroups(groups: Group[], codes: Code[]) {
  const by = new Map<string, Tally>();
  for (const g of groups) {
    const c = resolveCode(codes, g.code, g.status);
    if (!c) continue;
    const t = by.get(g.studentId) ?? emptyTally();
    addTo(t, c, g._count._all, g._sum.minutesLate ?? 0);
    by.set(g.studentId, t);
  }
  return by;
}

export type Scope = { kind: "school" } | { kind: "grade"; grade: number } | { kind: "class"; classId: string } | { kind: "student"; studentId: string };

/** Per-student tallies of daily marks for a scope and range. */
export async function dailyTallies(db: TenantDb, scope: Scope, range: Range) {
  const { codes } = await loadCodes(db);
  const dateWhere = { gte: keyToDate(range.from), lte: keyToDate(range.to) };
  let studentFilter: object = {};
  if (scope.kind === "grade") studentFilter = { student: { gradeLevel: scope.grade, status: "ACTIVE" } };
  else if (scope.kind === "student") studentFilter = { studentId: scope.studentId };
  else if (scope.kind === "class") {
    const ids = (await db.enrollment.findMany({ where: { classId: scope.classId, status: "ACTIVE" }, select: { studentId: true } })).map((e) => e.studentId);
    studentFilter = { studentId: { in: ids } };
  } else studentFilter = { student: { status: "ACTIVE" } };
  const groups = (await db.attendanceRecord.groupBy({
    by: ["studentId", "code", "status"],
    where: { date: dateWhere, ...studentFilter },
    _count: { _all: true },
    _sum: { minutesLate: true },
  })) as unknown as Group[];
  return { byStudent: tallyGroups(groups, codes), codes };
}

/** Per-student tallies of lesson marks for one class (a subject class's lesson attendance). */
export async function lessonTallies(db: TenantDb, classId: string, range: Range) {
  const { codes } = await loadCodes(db);
  const groups = (await db.attendanceLessonMark.groupBy({
    by: ["studentId", "code", "status"],
    where: { date: { gte: keyToDate(range.from), lte: keyToDate(range.to) }, register: { classId } },
    _count: { _all: true },
    _sum: { minutesLate: true },
  })) as unknown as Group[];
  return { byStudent: tallyGroups(groups, codes), codes };
}

export type StudentRow = {
  id: string;
  firstNameEn: string;
  lastNameEn: string;
  firstNameAr: string;
  lastNameAr: string;
  studentNo: string;
  gradeLevel: number;
  section: string | null;
  homeroom: { id: string; en: string; ar: string } | null;
  tally: Tally;
  pct: number | null;
};

export type Rollup = { key: string; label: { en: string; ar: string }; gradeLevel: number | null; students: number; tally: Tally; pct: number | null };

/** The whole report for a scope: per-student rows plus class and grade rollups and the school total. */
export async function buildReport(db: TenantDb, scope: Scope, range: Range, opts: { source?: "daily" | "lessons" } = {}) {
  const lessons = opts.source === "lessons" && scope.kind === "class";
  const { byStudent } = lessons ? await lessonTallies(db, scope.classId, range) : await dailyTallies(db, scope, range);
  const ids = [...byStudent.keys()];
  const [students, homerooms] = await Promise.all([
    ids.length ? db.student.findMany({ where: { id: { in: ids } }, select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, studentNo: true, gradeLevel: true, section: true } }) : [],
    ids.length ? db.enrollment.findMany({ where: { studentId: { in: ids }, status: "ACTIVE", class: { isHomeroom: true, academicYear: { isCurrent: true } } }, select: { studentId: true, class: { select: { id: true, nameEn: true, nameAr: true, gradeLevel: true } } } }) : [],
  ]);
  const hr = new Map(homerooms.map((h) => [h.studentId, h.class]));
  const rows: StudentRow[] = students.map((s) => {
    const t = byStudent.get(s.id)!;
    const h = hr.get(s.id);
    return { ...s, homeroom: h ? { id: h.id, en: h.nameEn, ar: h.nameAr } : null, tally: t, pct: attendancePct(t) };
  });
  const classes = new Map<string, Rollup>();
  const grades = new Map<number, Rollup>();
  let total = emptyTally();
  for (const r of rows) {
    total = merge(total, r.tally);
    const ck = r.homeroom?.id ?? "none";
    const c = classes.get(ck) ?? { key: ck, label: r.homeroom ? { en: r.homeroom.en, ar: r.homeroom.ar } : { en: "", ar: "" }, gradeLevel: r.gradeLevel, students: 0, tally: emptyTally(), pct: null };
    c.students++;
    c.tally = merge(c.tally, r.tally);
    classes.set(ck, c);
    const g = grades.get(r.gradeLevel) ?? { key: String(r.gradeLevel), label: { en: "", ar: "" }, gradeLevel: r.gradeLevel, students: 0, tally: emptyTally(), pct: null };
    g.students++;
    g.tally = merge(g.tally, r.tally);
    grades.set(r.gradeLevel, g);
  }
  const fin = (x: Rollup) => ({ ...x, pct: attendancePct(x.tally) });
  return {
    rows,
    classes: [...classes.values()].map(fin).sort((a, b) => (a.gradeLevel ?? 0) - (b.gradeLevel ?? 0) || a.label.en.localeCompare(b.label.en)),
    grades: [...grades.values()].map(fin).sort((a, b) => (a.gradeLevel ?? 0) - (b.gradeLevel ?? 0)),
    total,
    pct: attendancePct(total),
  };
}

/** Daily school attendance for a range (for the trend chart): one point per day with marks. */
export async function dailyTrend(db: TenantDb, scope: Scope, range: Range) {
  const { codes } = await loadCodes(db);
  const where: Record<string, unknown> = { date: { gte: keyToDate(range.from), lte: keyToDate(range.to) } };
  if (scope.kind === "grade") where.student = { gradeLevel: scope.grade };
  if (scope.kind === "student") where.studentId = scope.studentId;
  if (scope.kind === "class") where.studentId = { in: (await db.enrollment.findMany({ where: { classId: scope.classId, status: "ACTIVE" }, select: { studentId: true } })).map((e) => e.studentId) };
  const groups = await db.attendanceRecord.groupBy({ by: ["date", "code", "status"], where, _count: { _all: true } });
  const byDay = new Map<string, Tally>();
  for (const g of groups) {
    const c = resolveCode(codes, g.code, g.status);
    if (!c) continue;
    const k = dateKey(g.date);
    byDay.set(k, addTo(byDay.get(k) ?? emptyTally(), c, g._count._all));
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, t]) => ({ day, pct: attendancePct(t), tally: t }));
}

/** One student's summary for a range: tally, percentage and the day-by-day marks (codes resolved, private ones masked by the caller). */
export async function studentSummary(db: TenantDb, studentId: string, range: Range) {
  const { codes } = await loadCodes(db);
  const [groups, days] = await Promise.all([
    db.attendanceRecord.groupBy({ by: ["studentId", "code", "status"], where: { studentId, date: { gte: keyToDate(range.from), lte: keyToDate(range.to) } }, _count: { _all: true }, _sum: { minutesLate: true } }),
    db.attendanceRecord.findMany({ where: { studentId, date: { gte: keyToDate(range.from), lte: keyToDate(range.to) } }, orderBy: { date: "asc" }, select: { date: true, code: true, status: true, minutesLate: true, source: true, requestId: true } }),
  ]);
  const tally = tallyGroups(groups as unknown as Group[], codes).get(studentId) ?? emptyTally();
  return { tally, pct: attendancePct(tally), days, codes };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const EXPORT_COLUMNS = [
  "student_no",
  "first_name",
  "last_name",
  "grade",
  "homeroom",
  "possible_sessions",
  "attended",
  "attendance_percent",
  "late",
  "minutes_late",
  "authorised_absences",
  "unauthorised_absences",
  "unexplained_absences",
  "not_counted",
] as const;

/** Rows for CSV and Excel: one per student, numbers as numbers. Names in the chosen language. */
export function exportTable(rows: StudentRow[], locale: "en" | "ar"): Array<Array<string | number>> {
  const out: Array<Array<string | number>> = [[...EXPORT_COLUMNS]];
  for (const r of rows) {
    const t = r.tally;
    out.push([
      r.studentNo,
      locale === "ar" ? r.firstNameAr || r.firstNameEn : r.firstNameEn,
      locale === "ar" ? r.lastNameAr || r.lastNameEn : r.lastNameEn,
      r.gradeLevel,
      r.homeroom ? (locale === "ar" ? r.homeroom.ar : r.homeroom.en) : "",
      t.possible,
      t.attended,
      r.pct === null ? "" : Math.round(r.pct * 10) / 10,
      t.late,
      t.minutesLate,
      t.authorised,
      t.unauthorised,
      t.unexplained,
      t.notCounted,
    ]);
  }
  return out;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  // Formula injection: a cell starting with = + - @ is prefixed so spreadsheets read it as text.
  const safe = /^[=+\-@]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(table: Array<Array<string | number>>) {
  return table.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
