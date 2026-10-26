// Seats per grade for one academic year, as SQL aggregates (no per-student rows are loaded).
//
// Enrolled, for the current year: active students in the grade.
// Enrolled, for a later year: students continuing into the grade (active students one grade below, minus those
// leaving: a "leaving" re-enrollment answer for that year or a planned withdrawal before it starts), plus students
// already enrolled for that year through admissions (they start on the year's first day).
// Holding: accepted offers not enrolled yet. Offered: offers waiting for an answer.
import { Prisma } from "@prisma/client";
import type { Tx } from "@/server/db";
import { capacityOf, orderWaitlist, type SeatCounts } from "./rules";
import type { YearOption } from "./settings";
import { rawQuery } from "./sql";

type Row = { grade: number; n: bigint | number };
const num = (v: bigint | number) => Number(v);

export async function seatCounts(tx: Tx, orgId: string, year: YearOption): Promise<Map<number, SeatCounts & { sectionSeats: number[]; seatFeeFils: number }>> {
  const out = new Map<number, SeatCounts & { sectionSeats: number[]; seatFeeFils: number }>();
  const get = (g: number) => {
    let c = out.get(g);
    if (!c) out.set(g, (c = { capacity: null, enrolled: 0, holding: 0, offered: 0, waitlisted: 0, sectionSeats: [], seatFeeFils: 0 }));
    return c;
  };
  const caps = await tx.admissionCapacity.findMany({ where: { orgId, academicYearId: year.id } });
  for (const r of caps) Object.assign(get(r.gradeLevel), { capacity: capacityOf(r.sectionSeats), sectionSeats: r.sectionSeats, seatFeeFils: r.seatFeeFils });

  const apps = await tx.admissionApplication.groupBy({ by: ["gradeLevel", "stage"], where: { orgId, academicYearId: year.id, stage: { in: ["OFFER_MADE", "OFFER_ACCEPTED", "SEAT_PAID", "WAITLISTED"] } }, _count: { _all: true } });
  for (const a of apps) {
    const c = get(a.gradeLevel);
    if (a.stage === "OFFER_MADE") c.offered += a._count._all;
    else if (a.stage === "WAITLISTED") c.waitlisted += a._count._all;
    else c.holding += a._count._all;
  }

  if (year.isCurrent) {
    const rows = await rawQuery<Row[]>(tx, orgId, Prisma.sql`SELECT "gradeLevel" AS grade, count(*) AS n FROM "Student" WHERE "orgId" = ${orgId} AND status = 'ACTIVE' GROUP BY "gradeLevel"`);
    for (const r of rows) get(r.grade).enrolled += num(r.n);
  } else {
    // Continuing students move up one grade; leavers for this year are left out.
    const rows = await rawQuery<Row[]>(tx, orgId, Prisma.sql`
      SELECT s."gradeLevel" + 1 AS grade, count(*) AS n
      FROM "Student" s
      WHERE s."orgId" = ${orgId} AND s.status = 'ACTIVE' AND s."gradeLevel" < 12
        AND NOT EXISTS (
          SELECT 1 FROM "ReenrollmentResponse" r JOIN "ReenrollmentWindow" w ON w.id = r."windowId"
          WHERE r."studentId" = s.id AND r.intent = 'LEAVING' AND w."academicYearId" = ${year.id})
        AND NOT EXISTS (
          SELECT 1 FROM "StudentWithdrawal" d
          WHERE d."studentId" = s.id AND d.status = 'PLANNED' AND d."leavingDate" <= ${year.startsOn})
      GROUP BY 1`);
    for (const r of rows) get(r.grade).enrolled += num(r.n);
    // Students admitted for this year (not started yet).
    const starters = await rawQuery<Row[]>(tx, orgId, Prisma.sql`
      SELECT "gradeLevel" AS grade, count(*) AS n FROM "Student"
      WHERE "orgId" = ${orgId} AND status = 'INACTIVE' AND "enrolledOn" >= ${year.startsOn} AND "enrolledOn" <= ${year.endsOn}
      GROUP BY "gradeLevel"`);
    for (const r of starters) get(r.grade).enrolled += num(r.n);
  }
  return out;
}

/** Seat counts for one grade. */
export async function gradeSeats(tx: Tx, orgId: string, year: YearOption, gradeLevel: number) {
  const all = await seatCounts(tx, orgId, year);
  return all.get(gradeLevel) ?? { capacity: null, enrolled: 0, holding: 0, offered: 0, waitlisted: 0, sectionSeats: [] as number[], seatFeeFils: 0 };
}

/** Students already placed per section for a year and grade (for the "section" choice on an offer and at enrollment). */
export async function sectionCounts(tx: Tx, orgId: string, year: YearOption, gradeLevel: number): Promise<Map<string, number>> {
  const where = year.isCurrent
    ? Prisma.sql`"orgId" = ${orgId} AND status = 'ACTIVE' AND "gradeLevel" = ${gradeLevel}`
    : Prisma.sql`"orgId" = ${orgId} AND status = 'INACTIVE' AND "gradeLevel" = ${gradeLevel} AND "enrolledOn" >= ${year.startsOn} AND "enrolledOn" <= ${year.endsOn}`;
  const rows = await rawQuery<Array<{ section: string | null; n: bigint }>>(tx, orgId, Prisma.sql`SELECT section, count(*) AS n FROM "Student" WHERE ${where} GROUP BY section`);
  const offers = await tx.admissionApplication.groupBy({ by: ["offerSection"], where: { orgId, academicYearId: year.id, gradeLevel, stage: { in: ["OFFER_MADE", "OFFER_ACCEPTED", "SEAT_PAID"] }, offerSection: { not: null } }, _count: { _all: true } });
  const m = new Map<string, number>();
  for (const r of rows) if (r.section) m.set(r.section, (m.get(r.section) ?? 0) + Number(r.n));
  for (const o of offers) if (o.offerSection) m.set(o.offerSection, (m.get(o.offerSection) ?? 0) + o._count._all);
  return m;
}

/** The waitlist for one year and grade in priority order, one page at a time. */
export async function waitlist(tx: Tx, orgId: string, yearId: string, gradeLevel: number | null, page = 1, perPage = 50) {
  const rows = await tx.admissionApplication.findMany({
    where: { orgId, academicYearId: yearId, stage: "WAITLISTED", ...(gradeLevel === null ? {} : { gradeLevel }) },
    select: { id: true, number: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, siblingStudentIds: true, staffChildVerified: true, staffChild: true, priorityBoost: true, waitlistedAt: true, submittedAt: true, createdAt: true },
  });
  // Ordered per grade: a position only makes sense within one grade's list.
  const byGrade = new Map<number, typeof rows>();
  for (const r of rows) byGrade.set(r.gradeLevel, [...(byGrade.get(r.gradeLevel) ?? []), r]);
  const ordered = [...byGrade.entries()].sort(([a], [b]) => a - b).flatMap(([, list]) => orderWaitlist(list));
  return { total: ordered.length, rows: ordered.slice((page - 1) * perPage, page * perPage) };
}
