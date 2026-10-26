// Building each return from Horizon data into tables (src/server/govreports/table.ts). Aggregates where the return
// is about numbers; lists only where the authority needs the learner or member of staff. Never reads health
// details. Counts of people of determination and small results groups are merged or shown as "fewer than 5".
import type { TenantDb } from "@/lib/tenant-db";
import { ALL_GRADE_LEVELS } from "@/lib/grade-levels";
import { ageFlag } from "@/server/admissions/rules";
import { asTx, entryYearOf, loadSettings as loadAdmissionSettings } from "@/server/admissions/settings";
import { buildReport } from "@/server/attendance/reports";
import { limitStanding } from "@/server/attendance/alerts";
import { loadSettings as loadAttendanceSettings } from "@/server/attendance/settings";
import { attendancePct } from "@/server/attendance/maths";
import { bandFor, DEFAULT_BANDS, sortBands, weightedAverage } from "@/server/grades/calc";
import { SYSTEM_ROLES } from "@/server/identity/permissions";
import { dateKey, keyToDate } from "@/server/timetable/cover";
import type { Problem, ReturnKind } from "./kinds";
import { STAFF_GAPS } from "./kinds";
import { dayText, gbi, gradeBi, gradeSpan, gt, tbi, type Bi } from "./labels";
import { nationalityOf } from "./nationality";
import { currentYear, movements, rollAt, type RollStudent } from "./roll";
import { mergeSmall, safeCount, SMALL } from "./suppress";
import type { Cell, Column, ReturnData, Table } from "./table";
import { eidHashesFor, referencedStudents, studentProblems } from "./validate";

export type ReturnSpec = { kind: ReturnKind; asOf: Date; periodFrom: Date | null };

const col = (key: string, num = false): Column => ({ key, label: gbi(`col.${key}`), num });
const table = (key: string, columns: Column[], rows: Cell[][], opts: { note?: Bi; totalRow?: boolean; values?: Record<string, string | number> } = {}): Table => ({ key, title: gbi(`tables.${key}`, opts.values), columns, rows, note: opts.note, totalRow: opts.totalRow });
const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
/** "fewer than 5" for a suppressed count. */
const FEWER = (): Bi => gbi("fewer", { n: SMALL });
const safeShort = (n: number): Cell => (safeCount(n) === null ? gbi("fewerShort", { n: SMALL }) : n);
const safe = (n: number): Cell => {
  const v = safeCount(n);
  return v === null ? FEWER() : v;
};
const nameBi = (s: { firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string }): Bi => ({ en: `${s.firstNameEn} ${s.lastNameEn}`.trim(), ar: `${s.firstNameAr || s.firstNameEn} ${s.lastNameAr || s.lastNameEn}`.trim() });
const genderOf = (g: string | null): "M" | "F" | null => (g === "M" || g === "F" ? g : null);
const genderBi = (g: string | null): Cell => (g === "M" ? gbi("gender.M") : g === "F" ? gbi("gender.F") : gbi("notRecorded"));

/** The period a return covers: its own start, else the start of the current school year, else 30 days. */
export async function periodOf(db: TenantDb, spec: ReturnSpec) {
  const to = dateKey(spec.asOf);
  if (spec.periodFrom) return { from: dateKey(spec.periodFrom), to };
  const y = await currentYear(db);
  if (y && dateKey(y.startsOn) <= to) return { from: dateKey(y.startsOn), to };
  return { from: dateKey(new Date(spec.asOf.getTime() - 29 * 86_400_000)), to };
}

/** Year of entry for the age check: the school year that contains the date (or the calendar year it falls in). */
async function entryYearFor(db: TenantDb, asOf: Date) {
  const y = await db.academicYear.findFirst({ where: { startsOn: { lte: asOf }, endsOn: { gte: asOf } }, select: { startsOn: true } });
  if (y) return entryYearOf(y);
  const m = asOf.getUTCMonth();
  return m >= 7 ? asOf.getUTCFullYear() : asOf.getUTCFullYear() - 1;
}

async function identityChecks(db: TenantDb, orgId: string, students: RollStudent[], asOf: Date) {
  const ids = students.map((s) => s.id);
  const [settings, entryYear, withReference, eidHashes] = await Promise.all([loadAdmissionSettings(asTx(db), orgId), entryYearFor(db, asOf), referencedStudents(db, ids), eidHashesFor(db, ids)]);
  return { problems: studentProblems({ students, entryYear, cutoff: settings.cutoff, withReference, eidHashes }), entryYear, cutoff: settings.cutoff };
}

// ---------------------------------------------------------------------------
// Enrollment census
// ---------------------------------------------------------------------------

export type CensusCounts = ReturnType<typeof aggregateCensus>;

/** The census figures from the students on roll and the period's joiners and leavers. Pure. */
export function aggregateCensus(students: RollStudent[], moves: { joined: Array<{ grade: number }>; left: Array<{ grade: number }> }, age: { entryYear: number; cutoff: { month: number; day: number } }) {
  type G = { grade: number; sections: Map<string, { M: number; F: number; X: number; emirati: number; other: number; unknownNat: number }>; M: number; F: number; X: number; emirati: number; other: number; unknownNat: number; joined: number; left: number; expected: number; under: number; over: number; noDob: number; sen: number };
  const grades = new Map<number, G>();
  const g = (n: number): G => {
    let v = grades.get(n);
    if (!v) grades.set(n, (v = { grade: n, sections: new Map(), M: 0, F: 0, X: 0, emirati: 0, other: 0, unknownNat: 0, joined: 0, left: 0, expected: 0, under: 0, over: 0, noDob: 0, sen: 0 }));
    return v;
  };
  const nat = new Map<string, { en: string; ar: string; n: number; emirati: boolean }>();
  for (const s of students) {
    const row = g(s.grade);
    const sec = s.section?.trim() || "";
    const sr = row.sections.get(sec) ?? { M: 0, F: 0, X: 0, emirati: 0, other: 0, unknownNat: 0 };
    const gen = genderOf(s.gender) ?? "X";
    row[gen]++;
    sr[gen]++;
    const n = nationalityOf(s.nationalityEn, s.nationalityAr);
    if (!n) {
      row.unknownNat++;
      sr.unknownNat++;
    } else {
      if (n.emirati) {
        row.emirati++;
        sr.emirati++;
      } else {
        row.other++;
        sr.other++;
      }
      const e = nat.get(n.key) ?? { en: n.en, ar: n.ar, n: 0, emirati: n.emirati };
      e.n++;
      nat.set(n.key, e);
    }
    row.sections.set(sec, sr);
    if (s.hasSen) row.sen++;
    if (!s.dateOfBirth) row.noDob++;
    else {
      const a = ageFlag(s.dateOfBirth, s.grade, age.entryYear, age.cutoff);
      if (a.flag === "UNDER") row.under++;
      else if (a.flag === "OVER") row.over++;
      else row.expected++;
    }
  }
  for (const j of moves.joined) g(j.grade).joined++;
  for (const l of moves.left) g(l.grade).left++;
  const rows = [...grades.values()].sort((a, b) => a.grade - b.grade);
  const total = rows.reduce((t, r) => ({ M: t.M + r.M, F: t.F + r.F, X: t.X + r.X, emirati: t.emirati + r.emirati, other: t.other + r.other, unknownNat: t.unknownNat + r.unknownNat, joined: t.joined + r.joined, left: t.left + r.left, expected: t.expected + r.expected, under: t.under + r.under, over: t.over + r.over, noDob: t.noDob + r.noDob, sen: t.sen + r.sen, sections: t.sections + r.sections.size }), { M: 0, F: 0, X: 0, emirati: 0, other: 0, unknownNat: 0, joined: 0, left: 0, expected: 0, under: 0, over: 0, noDob: 0, sen: 0, sections: 0 });
  // People of determination: merged across neighbouring grades so that no printed group is below SMALL.
  const senBands = mergeSmall(rows.map((r) => ({ key: r.grade, n: r.sen })));
  const nationalities = [...nat.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.n - a.n || a.en.localeCompare(b.en));
  return { rows, total: { ...total, students: students.length }, senBands, senTotal: safeCount(total.sen), nationalities };
}

async function buildCensus(db: TenantDb, orgId: string, spec: ReturnSpec): Promise<ReturnData> {
  const asOfKey = dateKey(spec.asOf);
  const period = await periodOf(db, spec);
  const { students, shift } = await rollAt(db, asOfKey);
  const moves = await movements(db, period.from, period.to);
  const gradeById = new Map<string, number>();
  if (moves.length) {
    const rows = await db.student.findMany({ where: { id: { in: moves.map((m) => m.studentId) } }, select: { id: true, gradeLevel: true } });
    for (const r of rows) gradeById.set(r.id, r.gradeLevel - shift);
  }
  const joined = moves.filter((m) => m.kind !== "WITHDRAWAL" && gradeById.has(m.studentId)).map((m) => ({ grade: gradeById.get(m.studentId)! }));
  const left = moves.filter((m) => m.kind === "WITHDRAWAL" && gradeById.has(m.studentId)).map((m) => ({ grade: gradeById.get(m.studentId)! }));
  const checks = await identityChecks(db, orgId, students, spec.asOf);
  const c = aggregateCensus(students, { joined, left }, checks);
  const pct = (n: number) => (c.total.students ? r1((n / c.total.students) * 100) : null);

  const summary = table(
    "summary",
    [col("measure"), col("value", true)],
    [
      [gbi("measure.onRoll"), c.total.students],
      [gbi("measure.male"), c.total.M],
      [gbi("measure.female"), c.total.F],
      [gbi("measure.genderUnknown"), c.total.X],
      [gbi("measure.emirati"), c.total.emirati],
      [gbi("measure.otherNationalities"), c.total.other],
      [gbi("measure.nationalityUnknown"), c.total.unknownNat],
      [gbi("measure.nationalityCount"), c.nationalities.length],
      [gbi("measure.sen"), c.senTotal === null ? FEWER() : c.senTotal],
      [gbi("measure.joined"), c.total.joined],
      [gbi("measure.leavers"), c.total.left],
      [gbi("measure.sections"), c.total.sections],
    ],
  );
  const grades = table(
    "grades",
    [col("grade"), col("sections", true), col("male", true), col("female", true), col("total", true), col("emirati", true), col("otherNationalities", true), col("joined", true), col("leavers", true)],
    [
      ...c.rows.map((r): Cell[] => [gradeBi(r.grade), r.sections.size, r.M, r.F, r.M + r.F + r.X, r.emirati, r.other, r.joined, r.left]),
      [gbi("totalRow"), c.total.sections, c.total.M, c.total.F, c.total.students, c.total.emirati, c.total.other, c.total.joined, c.total.left],
    ],
    { totalRow: true },
  );
  const sections = table(
    "sections",
    [col("grade"), col("section"), col("male", true), col("female", true), col("genderUnknown", true), col("total", true), col("emirati", true), col("otherNationalities", true), col("nationalityUnknown", true)],
    c.rows.flatMap((r) =>
      [...r.sections.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([sec, s]): Cell[] => [gradeBi(r.grade), sec || gbi("noSection"), s.M, s.F, s.X, s.M + s.F + s.X, s.emirati, s.other, s.unknownNat]),
    ),
  );
  const nationality = table(
    "nationality",
    [col("nationality"), col("students", true), col("percent", true)],
    [...c.nationalities.map((n): Cell[] => [{ en: n.en, ar: n.ar }, n.n, pct(n.n)]), ...(c.total.unknownNat ? [[gbi("notRecorded"), c.total.unknownNat, pct(c.total.unknownNat)] as Cell[]] : [])],
  );
  const cut = new Date(Date.UTC(checks.entryYear, checks.cutoff.month - 1, checks.cutoff.day));
  const age = table(
    "age",
    [col("grade"), col("expectedAge", true), col("atExpectedAge", true), col("younger", true), col("older", true), col("noDob", true)],
    [...c.rows.map((r): Cell[] => [gradeBi(r.grade), r.grade + 5, r.expected, r.under, r.over, r.noDob]), [gbi("totalRow"), null, c.total.expected, c.total.under, c.total.over, c.total.noDob]],
    { totalRow: true, note: { en: gt("en", "tables.ageNote", { date: dayText(cut, "en") }), ar: gt("ar", "tables.ageNote", { date: dayText(cut, "ar") }) } },
  );
  const sen = table(
    "sen",
    [col("grades"), col("sen", true)],
    c.senBands.filter((b) => b.keys.length).map((b): Cell[] => [{ en: gradeSpan(b.keys, "en"), ar: gradeSpan(b.keys, "ar") }, b.n === null ? FEWER() : b.n]),
    { note: gbi("tables.senNote", { n: SMALL }) },
  );
  return {
    kind: "CENSUS",
    tables: [summary, grades, sections, nationality, age, sen],
    summary: { students: c.total.students, male: c.total.M, female: c.total.F, emirati: c.total.emirati, otherNationalities: c.total.other, sen: c.senTotal, joined: c.total.joined, left: c.total.left, grades: c.rows.length },
    problems: checks.problems,
    gaps: [],
    rowCount: c.total.students,
  };
}

// ---------------------------------------------------------------------------
// Learner registration list (joiners and leavers, with the authority's status and reference)
// ---------------------------------------------------------------------------

async function buildRegistration(db: TenantDb, orgId: string, spec: ReturnSpec): Promise<ReturnData> {
  const period = await periodOf(db, spec);
  const moves = await movements(db, period.from, period.to);
  const ids = [...new Set(moves.map((m) => m.studentId))];
  const [students, regs] = await Promise.all([
    ids.length ? db.student.findMany({ where: { id: { in: ids } }, select: { id: true, studentNo: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, section: true, gender: true, dateOfBirth: true, nationalityEn: true, nationalityAr: true, emiratesIdEnc: true, hasSen: true, enrolledOn: true, curriculum: true, status: true } }) : [],
    ids.length ? db.govRegistration.findMany({ where: { studentId: { in: ids } }, orderBy: { createdAt: "desc" } }) : [],
  ]);
  const byId = new Map(students.map((s) => [s.id, s]));
  const rows: Cell[][] = [];
  const counts = new Map<string, number>();
  const roll: RollStudent[] = [];
  for (const m of moves) {
    const s = byId.get(m.studentId);
    if (!s) continue;
    const kind = m.kind === "WITHDRAWAL" ? "WITHDRAWAL" : "ENROLLMENT";
    const reg = regs.find((r) => r.studentId === s.id && r.kind === kind && (kind === "ENROLLMENT" || !r.withdrawalId || r.withdrawalId === m.withdrawalId));
    const status = reg?.status ?? "NONE";
    counts.set(`${m.kind}:${status}`, (counts.get(`${m.kind}:${status}`) ?? 0) + 1);
    const nat = nationalityOf(s.nationalityEn, s.nationalityAr);
    rows.push([
      gbi(`movement.${m.kind}`),
      dateKey(m.on),
      s.studentNo,
      s.firstNameEn,
      s.lastNameEn,
      s.firstNameAr,
      s.lastNameAr,
      s.dateOfBirth ? dateKey(s.dateOfBirth) : null,
      genderBi(s.gender),
      nat ? { en: nat.en, ar: nat.ar } : gbi("notRecorded"),
      { eid: s.id, present: Boolean(s.emiratesIdEnc) },
      gradeBi(s.gradeLevel),
      s.section,
      tbi(`admissions.form.curriculum.${s.curriculum}`),
      m.kind === "WITHDRAWAL" ? m.destination : m.previousSchool,
      m.tcNumber,
      gbi(`regStatus.${status}`),
      reg?.reference ?? null,
      reg?.submittedAt ? dateKey(reg.submittedAt) : null,
      reg?.decidedAt ? dateKey(reg.decidedAt) : null,
    ]);
    if (!roll.some((r) => r.id === s.id)) roll.push({ id: s.id, studentNo: s.studentNo, firstNameEn: s.firstNameEn, lastNameEn: s.lastNameEn, firstNameAr: s.firstNameAr, lastNameAr: s.lastNameAr, grade: s.gradeLevel, section: s.section, gender: s.gender, dateOfBirth: s.dateOfBirth, nationalityEn: s.nationalityEn, nationalityAr: s.nationalityAr, hasEid: Boolean(s.emiratesIdEnc), hasSen: s.hasSen, enrolledOn: s.enrolledOn, curriculum: s.curriculum, status: s.status });
  }
  const learners = table(
    "learners",
    ["movement", "date", "studentNo", "firstNameEn", "lastNameEn", "firstNameAr", "lastNameAr", "dateOfBirth", "gender", "nationality", "emiratesId", "grade", "section", "curriculum", "otherSchool", "tcNumber", "regStatus", "reference", "submittedOn", "decidedOn"].map((k) => col(k)),
    rows,
  );
  const kinds = ["ADMISSION", "TRANSFER_IN", "FROM_ABROAD", "READMISSION", "WITHDRAWAL"] as const;
  const statuses = ["NONE", "NOT_SUBMITTED", "SUBMITTED", "APPROVED", "REJECTED"] as const;
  const summary = table(
    "movements",
    [col("movement"), ...statuses.map((s) => ({ key: `st_${s}`, label: gbi(`regStatus.${s}`), num: true })), col("total", true)],
    kinds.map((k): Cell[] => {
      const vals = statuses.map((s) => counts.get(`${k}:${s}`) ?? 0);
      return [gbi(`movement.${k}`), ...vals, vals.reduce((a, b) => a + b, 0)];
    }),
  );
  // Leavers no longer need an enrollment reference; their identity details still matter to the authority.
  const checks = await identityChecks(db, orgId, roll, spec.asOf);
  const leaverIds = new Set(moves.filter((m) => m.kind === "WITHDRAWAL").map((m) => m.studentId));
  const problems = checks.problems.filter((p) => !(p.rule === "no_reference" && p.studentId && leaverIds.has(p.studentId)) && p.rule !== "age_grade");
  const total = (k: string) => [...counts.entries()].filter(([key]) => key.startsWith(`${k}:`)).reduce((a, [, n]) => a + n, 0);
  return {
    kind: "REGISTRATION",
    tables: [summary, learners],
    summary: { learners: rows.length, admissions: total("ADMISSION"), transfersIn: total("TRANSFER_IN") + total("FROM_ABROAD"), readmissions: total("READMISSION"), withdrawals: total("WITHDRAWAL"), approved: [...counts.entries()].filter(([k]) => k.endsWith(":APPROVED")).reduce((a, [, n]) => a + n, 0) },
    problems,
    gaps: [],
    rowCount: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Attendance return
// ---------------------------------------------------------------------------

async function buildAttendance(db: TenantDb, orgId: string, spec: ReturnSpec): Promise<ReturnData> {
  const period = await periodOf(db, spec);
  const [report, settings, org] = await Promise.all([
    buildReport(db, { kind: "school" }, { from: period.from, to: period.to, termId: null }),
    loadAttendanceSettings(db),
    db.organization.findUnique({ where: { id: orgId }, select: { timezone: true, weekDays: true } }),
  ]);
  const standing = await limitStanding(db, settings, { timeZone: org?.timezone || "Asia/Dubai", weekDays: org?.weekDays?.length ? org.weekDays : [1, 2, 3, 4, 5], today: period.to });
  const reached = standing.rows.filter((r) => r.level === "reached");
  const warned = standing.rows.filter((r) => r.level === "warning");
  const stu = reached.length ? await db.student.findMany({ where: { id: { in: reached.map((r) => r.studentId) } }, select: { id: true, studentNo: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, section: true } }) : [];
  const grades = table(
    "attendanceGrades",
    [col("grade"), col("students", true), col("possible", true), col("attended", true), col("attendancePct", true), col("authorised", true), col("unauthorised", true), col("unexplained", true), col("late", true)],
    [
      ...report.grades.map((g): Cell[] => [gradeBi(g.gradeLevel ?? 0), g.students, g.tally.possible, g.tally.attended, r1(g.pct), g.tally.authorised, g.tally.unauthorised, g.tally.unexplained, g.tally.late]),
      [gbi("totalRow"), report.rows.length, report.total.possible, report.total.attended, r1(report.pct), report.total.authorised, report.total.unauthorised, report.total.unexplained, report.total.late],
    ],
    { totalRow: true, note: gbi("tables.attendanceNote") },
  );
  const limitRows = reached
    .map((r) => ({ r, s: stu.find((x) => x.id === r.studentId) }))
    .filter((x) => x.s)
    .sort((a, b) => a.s!.gradeLevel - b.s!.gradeLevel || a.s!.lastNameEn.localeCompare(b.s!.lastNameEn))
    .map(({ r, s }): Cell[] => [s!.studentNo, nameBi(s!), gradeBi(s!.gradeLevel), s!.section, r.longest, r.total]);
  const limit = table("limit", [col("studentNo"), col("name"), col("grade"), col("section"), col("consecutiveDays", true), col("totalDays", true)], limitRows, {
    note: settings.limit.enabled ? gbi("tables.limitNote", { consecutive: settings.limit.consecutive, total: settings.limit.total }) : gbi("tables.limitOff"),
  });
  const summary = table(
    "summary",
    [col("measure"), col("value", true)],
    [
      [gbi("measure.attendancePct"), r1(attendancePct(report.total))],
      [gbi("measure.possible"), report.total.possible],
      [gbi("measure.unauthorised"), report.total.unauthorised],
      [gbi("measure.unexplained"), report.total.unexplained],
      [gbi("measure.limitReached"), settings.limit.enabled ? reached.length : gbi("limitOffShort")],
      [gbi("measure.limitWarning"), settings.limit.enabled ? warned.length : gbi("limitOffShort")],
    ],
  );
  const problems: Problem[] = [];
  if (report.total.unexplained > 0) problems.push({ key: "unexplained_absences", rule: "unexplained_absences", severity: "warning", count: report.total.unexplained });
  if (!settings.limit.enabled) problems.push({ key: "limit_off", rule: "limit_off", severity: "note" });
  return {
    kind: "ATTENDANCE",
    tables: [summary, grades, limit],
    summary: { attendancePct: r1(attendancePct(report.total)), possible: report.total.possible, unauthorised: report.total.unauthorised, unexplained: report.total.unexplained, limitReached: settings.limit.enabled ? reached.length : null, students: report.rows.length },
    problems,
    gaps: [],
    rowCount: report.grades.length,
  };
}

// ---------------------------------------------------------------------------
// Staff return
// ---------------------------------------------------------------------------

const ROLE_ORDER = SYSTEM_ROLES.map((r) => r.key);
const TEACHING = new Set(["teacher", "department_head"]);

async function buildStaff(db: TenantDb, spec: ReturnSpec): Promise<ReturnData> {
  const end = new Date(spec.asOf.getTime() + 86_400_000 - 1);
  const members = await db.membership.findMany({
    where: { status: "ACTIVE", anonymisedAt: null, createdAt: { lte: end }, roles: { some: { role: { key: { notIn: ["student", "parent"] } } } } },
    select: { id: true, user: { select: { nameEn: true, nameAr: true } }, roles: { select: { expiresAt: true, role: { select: { key: true, nameEn: true, nameAr: true } } } }, staffProfile: { select: { employeeNo: true, jobTitleEn: true, jobTitleAr: true, department: { select: { nameEn: true, nameAr: true } } } } },
  });
  const staff = members
    .map((m) => ({ ...m, roles: m.roles.filter((r) => !r.expiresAt || r.expiresAt > spec.asOf).map((r) => r.role).filter((r) => r.key !== "student" && r.key !== "parent") }))
    .filter((m) => m.roles.length)
    .sort((a, b) => a.user.nameEn.localeCompare(b.user.nameEn));
  const byRole = new Map<string, { label: Bi; n: number }>();
  for (const m of staff) for (const r of m.roles) byRole.set(r.key, { label: { en: r.nameEn, ar: r.nameAr }, n: (byRole.get(r.key)?.n ?? 0) + 1 });
  const order = (k: string) => (ROLE_ORDER.indexOf(k) < 0 ? 999 : ROLE_ORDER.indexOf(k));
  const teaching = staff.filter((m) => m.roles.some((r) => TEACHING.has(r.key))).length;
  const notRecorded = gbi("notRecordedInHorizon");
  const roles = table(
    "roles",
    [col("role"), col("staff", true)],
    [...[...byRole.entries()].sort(([a], [b]) => order(a) - order(b)).map(([, v]): Cell[] => [v.label, v.n]), [gbi("measure.teachingStaff"), teaching], [gbi("measure.allStaff"), staff.length]],
    { note: gbi("tables.rolesNote") },
  );
  const nationality = table("staffNationality", [col("nationality"), col("staff", true)], [[notRecorded, staff.length]], { note: gbi("tables.staffNationalityNote") });
  const list = table(
    "staffList",
    [col("name"), col("employeeNo"), col("jobTitle"), col("department"), col("roles"), col("nationality"), col("qualification"), col("licence")],
    staff.map((m): Cell[] => [
      { en: m.user.nameEn, ar: m.user.nameAr || m.user.nameEn },
      m.staffProfile?.employeeNo ?? null,
      m.staffProfile?.jobTitleEn || m.staffProfile?.jobTitleAr ? { en: m.staffProfile?.jobTitleEn || m.staffProfile?.jobTitleAr || "", ar: m.staffProfile?.jobTitleAr || m.staffProfile?.jobTitleEn || "" } : null,
      m.staffProfile?.department ? { en: m.staffProfile.department.nameEn, ar: m.staffProfile.department.nameAr } : null,
      { en: m.roles.map((r) => r.nameEn).join(", "), ar: m.roles.map((r) => r.nameAr).join("، ") },
      notRecorded,
      notRecorded,
      notRecorded,
    ]),
  );
  const gaps = table("gaps", [col("field"), col("status")], STAFF_GAPS.map((g): Cell[] => [gbi(`gap.${g}`), notRecorded]), { note: gbi("tables.gapsNote") });
  const problems: Problem[] = [];
  for (const m of staff) {
    if (!m.staffProfile?.jobTitleEn && !m.staffProfile?.jobTitleAr) problems.push({ key: `staff_missing_title:${m.id}`, rule: "staff_missing_title", severity: "warning", membershipId: m.id });
    if (!m.staffProfile?.employeeNo) problems.push({ key: `staff_missing_employee_no:${m.id}`, rule: "staff_missing_employee_no", severity: "warning", membershipId: m.id });
    if (!m.staffProfile?.department) problems.push({ key: `staff_missing_department:${m.id}`, rule: "staff_missing_department", severity: "note", membershipId: m.id });
  }
  return { kind: "STAFF", tables: [roles, nationality, gaps, list], summary: { staff: staff.length, teaching, roles: byRole.size }, problems, gaps: [...STAFF_GAPS], rowCount: staff.length };
}

// ---------------------------------------------------------------------------
// Results summary (published internal assessments) and AP entries
// ---------------------------------------------------------------------------

async function buildResults(db: TenantDb, orgId: string, spec: ReturnSpec): Promise<ReturnData> {
  const period = await periodOf(db, spec);
  const from = keyToDate(period.from);
  const to = new Date(keyToDate(period.to).getTime() + 86_400_000 - 1);
  const [assessments, unpublished, bandsRows, ap] = await Promise.all([
    db.assessment.findMany({ where: { publishedAt: { not: null }, dueAt: { gte: from, lte: to } }, select: { id: true, classId: true, maxScore: true, weight: true } }),
    db.assessment.count({ where: { publishedAt: null, dueAt: { gte: from, lte: to } } }),
    db.gradeBand.findMany({ orderBy: { minPercent: "desc" } }),
    db.studentSubjectResult.findMany({ where: { level: "AP" }, select: { subjectCode: true, achieved: true } }),
  ]);
  const bands = sortBands(bandsRows.length ? bandsRows.map((b) => ({ label: b.label, minPercent: b.minPercent })) : DEFAULT_BANDS);
  const classes = assessments.length ? await db.schoolClass.findMany({ where: { id: { in: [...new Set(assessments.map((a) => a.classId))] } }, select: { id: true, gradeLevel: true, subject: { select: { id: true, code: true, nameEn: true, nameAr: true } } } }) : [];
  const grades = assessments.length ? await db.grade.findMany({ where: { assessmentId: { in: assessments.map((a) => a.id) } }, select: { assessmentId: true, studentId: true, score: true, excused: true } }) : [];
  const aById = new Map(assessments.map((a) => [a.id, a]));
  const cById = new Map(classes.map((c) => [c.id, c]));
  // Per student and subject: the weighted average of that subject's published assessments in the period.
  type Key = string;
  const items = new Map<Key, { grade: number; subject: { code: string; en: string; ar: string }; perStudent: Map<string, Array<{ score: number | null; maxScore: number; weight: number; excused: boolean }>> }>();
  for (const g of grades) {
    const a = aById.get(g.assessmentId);
    const c = a ? cById.get(a.classId) : null;
    if (!a || !c?.subject) continue;
    const key = `${c.gradeLevel}|${c.subject.code}`;
    const it = items.get(key) ?? { grade: c.gradeLevel, subject: { code: c.subject.code, en: c.subject.nameEn, ar: c.subject.nameAr }, perStudent: new Map() };
    const list = it.perStudent.get(g.studentId) ?? [];
    list.push({ score: g.score, maxScore: a.maxScore, weight: a.weight, excused: g.excused });
    it.perStudent.set(g.studentId, list);
    items.set(key, it);
  }
  const rows: Cell[][] = [];
  let cells = 0;
  let suppressed = 0;
  for (const it of [...items.values()].sort((a, b) => a.grade - b.grade || a.subject.en.localeCompare(b.subject.en))) {
    const avgs = [...it.perStudent.values()].map((l) => weightedAverage(l)).filter((x): x is number => x !== null);
    if (!avgs.length) continue;
    cells++;
    const small = avgs.length < SMALL;
    if (small) suppressed++;
    const dist = bands.map((b) => avgs.filter((p) => bandFor(p, bands) === b.label).length);
    rows.push([gradeBi(it.grade), { en: it.subject.en, ar: it.subject.ar }, small ? FEWER() : avgs.length, small ? null : r1(avgs.reduce((s, x) => s + x, 0) / avgs.length), ...dist.map((n) => (small ? null : safeShort(n)))]);
  }
  const results = table("results", [col("grade"), col("subject"), col("studentsWithResults", true), col("averagePct", true), ...bands.map((b) => ({ key: `band_${b.label}`, label: { en: b.label, ar: b.label }, num: true }))], rows, { note: gbi("tables.resultsNote", { n: SMALL }) });
  const apBy = new Map<string, number[]>();
  for (const r of ap) {
    const n = Number(r.achieved);
    const list = apBy.get(r.subjectCode) ?? [];
    if (Number.isFinite(n)) list.push(n);
    apBy.set(r.subjectCode, list);
  }
  const apEntries = ap.length;
  const apRows: Cell[][] = apEntries >= SMALL ? [...apBy.entries()].map(([code, scores]): Cell[] => [code, safe(scores.length), scores.length >= SMALL ? r1(scores.reduce((a, b) => a + b, 0) / scores.length) : null]) : [];
  const apTable = table("ap", [col("subject"), col("entries", true), col("averageScore", true)], apRows, { note: apEntries === 0 ? gbi("tables.apNone") : apEntries < SMALL ? gbi("tables.apFew", { n: SMALL }) : gbi("tables.apNote") });
  const problems: Problem[] = [];
  if (unpublished > 0) problems.push({ key: "unpublished_results", rule: "unpublished_results", severity: "note", count: unpublished });
  return {
    kind: "RESULTS",
    tables: [results, apTable],
    summary: { subjects: cells, suppressed, assessments: assessments.length, apEntries: safeCount(apEntries) },
    problems,
    gaps: [],
    rowCount: rows.length,
  };
}

/** Build a return's tables, figures and checks from current data. */
export async function buildReturn(db: TenantDb, orgId: string, spec: ReturnSpec): Promise<ReturnData> {
  switch (spec.kind) {
    case "CENSUS":
      return buildCensus(db, orgId, spec);
    case "REGISTRATION":
      return buildRegistration(db, orgId, spec);
    case "ATTENDANCE":
      return buildAttendance(db, orgId, spec);
    case "STAFF":
      return buildStaff(db, spec);
    case "RESULTS":
      return buildResults(db, orgId, spec);
  }
}

export const GRADES = ALL_GRADE_LEVELS;
