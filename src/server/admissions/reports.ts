// Admissions reports as SQL aggregates: funnel by stage and grade, conversion, capacity against enrolled, and
// nationality and age-group summaries. Counts only, never individual records; nationalities with fewer than
// SMALL_GROUP applicants are merged into "Other" so no child can be singled out in a chart.
import type { Tx } from "@/server/db";
import { seatCounts } from "./capacity";
import { seatsAvailable } from "./rules";
import type { Settings, YearOption } from "./settings";
import { phaseOf } from "./stages";

export const SMALL_GROUP = 3;

type Big = bigint | number;
const n = (v: Big) => Number(v);

/** Applications that reached each stage (from the history), by grade. Drafts are not counted. */
export async function funnel(tx: Tx, orgId: string, yearId: string) {
  const rows = await tx.$queryRaw<Array<{ stage: string; grade: number; n: Big }>>`
    SELECT e."toStage" AS stage, a."gradeLevel" AS grade, count(DISTINCT e."applicationId") AS n
    FROM "AdmissionEvent" e JOIN "AdmissionApplication" a ON a.id = e."applicationId"
    WHERE a."orgId" = ${orgId} AND a."academicYearId" = ${yearId} AND e."toStage" IS NOT NULL AND e."toStage" <> 'DRAFT'
    GROUP BY 1, 2`;
  return rows.map((r) => ({ stage: r.stage, grade: r.grade, n: n(r.n) }));
}

/** Where applications are now, by stage and grade. */
export async function currentByStage(tx: Tx, orgId: string, yearId: string) {
  const rows = await tx.admissionApplication.groupBy({ by: ["stage", "gradeLevel"], where: { orgId, academicYearId: yearId, stage: { not: "DRAFT" } }, _count: { _all: true } });
  return rows.map((r) => ({ stage: r.stage, grade: r.gradeLevel, n: r._count._all }));
}

export type Conversion = { submitted: number; offered: number; accepted: number; enrolled: number; offerRate: number | null; acceptRate: number | null; enrollRate: number | null };

/** Submitted, offered, accepted and enrolled (reached at any point), and the rates between them. */
export function conversionFrom(f: Array<{ stage: string; n: number }>, s: Settings): Conversion {
  const reached = (pred: (stage: string) => boolean) => f.filter((r) => pred(r.stage)).reduce((sum, r) => sum + r.n, 0);
  // Every submitted application has a NEW event; offered counts OFFER_MADE; accepted counts OFFER_ACCEPTED.
  const submitted = reached((x) => x === "NEW");
  const offered = reached((x) => x === "OFFER_MADE");
  const accepted = reached((x) => x === "OFFER_ACCEPTED");
  const enrolled = reached((x) => phaseOf(x, s.stages) === "enrolled");
  const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  return { submitted, offered, accepted, enrolled, offerRate: rate(offered, submitted), acceptRate: rate(accepted, offered), enrollRate: rate(enrolled, submitted) };
}

/** Capacity against enrolled, holding and offered seats per grade. */
export async function capacityReport(tx: Tx, orgId: string, year: YearOption) {
  const counts = await seatCounts(tx, orgId, year);
  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([grade, c]) => ({ grade, capacity: c.capacity, enrolled: c.enrolled, holding: c.holding, offered: c.offered, waitlisted: c.waitlisted, available: seatsAvailable(c) }));
}

/** Applicants by nationality (submitted applications), small groups merged into "OTHER". */
export async function nationalitySummary(tx: Tx, orgId: string, yearId: string) {
  const rows = await tx.admissionApplication.groupBy({ by: ["nationality"], where: { orgId, academicYearId: yearId, stage: { not: "DRAFT" } }, _count: { _all: true } });
  const out: Array<{ code: string; n: number }> = [];
  let other = 0;
  for (const r of rows) {
    if (!r.nationality || r._count._all < SMALL_GROUP) other += r._count._all;
    else out.push({ code: r.nationality, n: r._count._all });
  }
  out.sort((a, b) => b.n - a.n);
  if (other) out.push({ code: "OTHER", n: other });
  return out;
}

export const AGE_BANDS = [
  { key: "kg", min: 0, max: 5 },
  { key: "lower", min: 6, max: 10 },
  { key: "middle", min: 11, max: 13 },
  { key: "upper", min: 14, max: 18 },
] as const;

/**
 * Applicants by age band on the school's cut-off date, and how many are outside the usual age for the grade they
 * applied for. Ages are computed in SQL from the date of birth; nothing individual leaves the database.
 */
export async function ageSummary(tx: Tx, orgId: string, year: YearOption, cutoff: { month: number; day: number }) {
  const cutoffDate = new Date(Date.UTC(year.entryYear, cutoff.month - 1, cutoff.day));
  const rows = await tx.$queryRaw<Array<{ age: number | null; expected: number; n: Big }>>`
    SELECT CASE WHEN "dateOfBirth" IS NULL THEN NULL ELSE date_part('year', age(${cutoffDate}::date, "dateOfBirth"::date))::int END AS age,
           ("gradeLevel" + 5) AS expected, count(*) AS n
    FROM "AdmissionApplication"
    WHERE "orgId" = ${orgId} AND "academicYearId" = ${year.id} AND stage <> 'DRAFT'
    GROUP BY 1, 2`;
  const bands = AGE_BANDS.map((b) => ({ key: b.key as string, n: 0 }));
  let under = 0;
  let over = 0;
  let unknown = 0;
  for (const r of rows) {
    const count = n(r.n);
    if (r.age === null) {
      unknown += count;
      continue;
    }
    const band = AGE_BANDS.findIndex((b) => r.age! >= b.min && r.age! <= b.max);
    if (band >= 0) bands[band].n += count;
    else unknown += count;
    if (r.age < r.expected) under += count;
    if (r.age > r.expected) over += count;
  }
  return { bands, under, over, unknown };
}
