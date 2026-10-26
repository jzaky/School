// Who was on roll on a date, and who joined or left in a period, from student records, withdrawals and the
// admissions history. Reads only the fields returns need: never health details, never decrypted identifiers.
import type { TenantDb } from "@/lib/tenant-db";
import { KG1 } from "@/lib/grade-levels";
import { keyToDate } from "@/server/timetable/cover";

export type RollStudent = {
  id: string;
  studentNo: string;
  firstNameEn: string;
  lastNameEn: string;
  firstNameAr: string;
  lastNameAr: string;
  /** Grade on the census date (see gradeShift). */
  grade: number;
  section: string | null;
  gender: string | null;
  dateOfBirth: Date | null;
  nationalityEn: string | null;
  nationalityAr: string | null;
  hasEid: boolean;
  hasSen: boolean;
  enrolledOn: Date | null;
  curriculum: string;
  status: string;
};

const DAY = 86_400_000;

/**
 * How many school years before the current one a date falls: 0 inside or after the current year's start, 1 in
 * the year before, and so on. Grades on an earlier census date are the stored grade minus this.
 */
export function gradeShift(asOf: Date, currentYearStart: Date | null): number {
  if (!currentYearStart || asOf.getTime() >= currentYearStart.getTime()) return 0;
  return Math.ceil((currentYearStart.getTime() - asOf.getTime()) / (365.25 * DAY));
}

export const SELECT = {
  id: true,
  studentNo: true,
  firstNameEn: true,
  lastNameEn: true,
  firstNameAr: true,
  lastNameAr: true,
  gradeLevel: true,
  section: true,
  gender: true,
  dateOfBirth: true,
  nationalityEn: true,
  nationalityAr: true,
  emiratesIdLast4: true,
  emiratesIdEnc: true,
  hasSen: true,
  enrolledOn: true,
  curriculum: true,
  status: true,
} as const;

type Row = { id: string; studentNo: string; firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string; gradeLevel: number; section: string | null; gender: string | null; dateOfBirth: Date | null; nationalityEn: string | null; nationalityAr: string | null; emiratesIdEnc: string | null; hasSen: boolean; enrolledOn: Date | null; curriculum: string; status: string };

export const toRoll = (s: Row, shift: number): RollStudent => ({
  id: s.id,
  studentNo: s.studentNo,
  firstNameEn: s.firstNameEn,
  lastNameEn: s.lastNameEn,
  firstNameAr: s.firstNameAr,
  lastNameAr: s.lastNameAr,
  grade: s.gradeLevel - shift,
  section: s.section,
  gender: s.gender,
  dateOfBirth: s.dateOfBirth,
  nationalityEn: s.nationalityEn,
  nationalityAr: s.nationalityAr,
  hasEid: Boolean(s.emiratesIdEnc),
  hasSen: s.hasSen,
  enrolledOn: s.enrolledOn,
  curriculum: s.curriculum,
  status: s.status,
});

export async function currentYear(db: TenantDb) {
  return db.academicYear.findFirst({ where: { isCurrent: true }, orderBy: { startsOn: "desc" }, select: { id: true, startsOn: true, endsOn: true } });
}

/**
 * Students on roll at the end of a census day: active students who had joined by then, and students who left
 * after it (a completed withdrawal with a later leaving date). Students admitted for a later date are not counted.
 */
export async function rollAt(db: TenantDb, asOfKey: string): Promise<{ students: RollStudent[]; shift: number }> {
  const asOf = keyToDate(asOfKey);
  const endOfDay = new Date(asOf.getTime() + DAY - 1);
  const year = await currentYear(db);
  const shift = gradeShift(asOf, year?.startsOn ?? null);
  const leftAfter = await db.studentWithdrawal.findMany({ where: { status: "COMPLETED", leavingDate: { gt: endOfDay } }, select: { studentId: true } });
  const rows = await db.student.findMany({
    where: {
      anonymisedAt: null,
      OR: [{ enrolledOn: null }, { enrolledOn: { lte: endOfDay } }],
      AND: [{ OR: [{ status: "ACTIVE" }, { status: "WITHDRAWN", id: { in: leftAfter.map((w) => w.studentId) } }] }],
    },
    select: SELECT,
    orderBy: [{ gradeLevel: "asc" }, { section: "asc" }, { lastNameEn: "asc" }],
  });
  const students = rows.map((r) => toRoll(r, shift)).filter((s) => s.grade >= KG1);
  return { students, shift };
}

export type Movement = {
  kind: "ADMISSION" | "TRANSFER_IN" | "FROM_ABROAD" | "READMISSION" | "WITHDRAWAL";
  studentId: string;
  /** Joining or leaving date (UTC midnight of the calendar day). */
  on: Date;
  previousSchool: string | null;
  destination: string | null;
  tcNumber: string | null;
  withdrawalId: string | null;
};

type Schooling = { attended?: boolean; schoolName?: string; country?: string } | null;

/** Joiners (by enrollment date) and completed withdrawals (by leaving date) between two dates, inclusive. */
export async function movements(db: TenantDb, fromKey: string, toKey: string): Promise<Movement[]> {
  const from = keyToDate(fromKey);
  const to = new Date(keyToDate(toKey).getTime() + DAY - 1);
  const [joined, left] = await Promise.all([
    db.student.findMany({ where: { anonymisedAt: null, enrolledOn: { gte: from, lte: to } }, select: { id: true, enrolledOn: true } }),
    db.studentWithdrawal.findMany({ where: { status: "COMPLETED", leavingDate: { gte: from, lte: to } }, select: { id: true, studentId: true, leavingDate: true, destination: true, tcNumber: true } }),
  ]);
  const ids = joined.map((j) => j.id);
  const [apps, readmits] = await Promise.all([
    ids.length ? db.admissionApplication.findMany({ where: { studentId: { in: ids }, stage: "ENROLLED" }, select: { id: true, studentId: true, schooling: true, enrolledAt: true }, orderBy: { enrolledAt: "desc" } }) : [],
    // Readmissions are rare: read them all (indexed by action) rather than sending every joiner's id; only joiners are looked up below.
    ids.length ? db.auditEvent.findMany({ where: { action: "student.readmit", entityType: "Student" }, select: { entityId: true } }) : [],
  ]);
  const readmitted = new Set(readmits.map((r) => r.entityId));
  const out: Movement[] = [];
  for (const j of joined) {
    const app = apps.find((a) => a.studentId === j.id);
    const sch = (app?.schooling ?? null) as Schooling;
    const kind: Movement["kind"] = readmitted.has(j.id) ? "READMISSION" : sch?.attended ? (sch.country && sch.country !== "AE" ? "FROM_ABROAD" : "TRANSFER_IN") : "ADMISSION";
    out.push({ kind, studentId: j.id, on: j.enrolledOn!, previousSchool: sch?.attended ? (sch.schoolName ?? null) : null, destination: null, tcNumber: null, withdrawalId: null });
  }
  for (const w of left) out.push({ kind: "WITHDRAWAL", studentId: w.studentId, on: w.leavingDate, previousSchool: null, destination: w.destination, tcNumber: w.tcNumber, withdrawalId: w.id });
  return out.sort((a, b) => a.on.getTime() - b.on.getTime());
}
