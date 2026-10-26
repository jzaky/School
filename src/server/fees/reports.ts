// Finance reports as SQL aggregates (they run inside a tenant transaction, so Row-Level Security applies).
// Dates are Dubai calendar days: a timestamp t falls on the day (t + 4 hours)::date. No "server-only" marker:
// tests and the export route use the same functions.
import { Prisma } from "@prisma/client";
import { tenantTx } from "@/lib/tenant-db";
import type { Tx } from "@/server/db";

const n = (v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : v === null || v === undefined ? 0 : Number(v));
const DUBAI_DAY = (col: string) => Prisma.raw(`(${col} + interval '4 hours')::date`);

export type Period = { from: string; to: string };

export async function inTenant<T>(orgId: string, fn: (tx: Tx) => Promise<T>) {
  return tenantTx(orgId, fn, { timeout: 60_000 });
}

// ---------------------------------------------------------------------------------------------
// Aging
// ---------------------------------------------------------------------------------------------

export type AgingTotals = { current: number; d0_30: number; d31_60: number; d61_90: number; d90p: number; overdueFamilies: number; owingFamilies: number };

export async function agingTotals(tx: Tx, orgId: string, today: string): Promise<AgingTotals> {
  const rows = await tx.$queryRaw<Array<Record<string, unknown>>>`
    WITH b AS (
      SELECT "accountId", ("totalFils" - "paidFils" - "creditedFils") AS bal, ${today}::date - ${DUBAI_DAY(`"dueDate"`)} AS dpd
      FROM "Invoice" WHERE "orgId" = ${orgId} AND "kind" = 'TAX' AND "status" IN ('OPEN', 'PARTIAL')
    )
    SELECT
      COALESCE(SUM(bal) FILTER (WHERE dpd < 0), 0) AS current,
      COALESCE(SUM(bal) FILTER (WHERE dpd BETWEEN 0 AND 30), 0) AS d0_30,
      COALESCE(SUM(bal) FILTER (WHERE dpd BETWEEN 31 AND 60), 0) AS d31_60,
      COALESCE(SUM(bal) FILTER (WHERE dpd BETWEEN 61 AND 90), 0) AS d61_90,
      COALESCE(SUM(bal) FILTER (WHERE dpd > 90), 0) AS d90p,
      COUNT(DISTINCT "accountId") FILTER (WHERE dpd >= 0 AND bal > 0) AS overdue_families,
      COUNT(DISTINCT "accountId") FILTER (WHERE bal > 0) AS owing_families
    FROM b`;
  const r = rows[0] ?? {};
  return { current: n(r.current), d0_30: n(r.d0_30), d31_60: n(r.d31_60), d61_90: n(r.d61_90), d90p: n(r.d90p), overdueFamilies: n(r.overdue_families), owingFamilies: n(r.owing_families) };
}

export type FamilyAgingRow = { accountId: string; code: string; nameEn: string; nameAr: string; current: number; d0_30: number; d31_60: number; d61_90: number; d90p: number; total: number; oldestDue: Date | null };

export async function agingByFamily(tx: Tx, orgId: string, today: string, opts: { limit: number; offset: number }): Promise<{ rows: FamilyAgingRow[]; total: number }> {
  const rows = await tx.$queryRaw<Array<Record<string, unknown>>>`
    WITH b AS (
      SELECT "accountId", ("totalFils" - "paidFils" - "creditedFils") AS bal, ${today}::date - ${DUBAI_DAY(`"dueDate"`)} AS dpd, "dueDate"
      FROM "Invoice" WHERE "orgId" = ${orgId} AND "kind" = 'TAX' AND "status" IN ('OPEN', 'PARTIAL')
    ), g AS (
      SELECT "accountId",
        COALESCE(SUM(bal) FILTER (WHERE dpd < 0), 0) AS current,
        COALESCE(SUM(bal) FILTER (WHERE dpd BETWEEN 0 AND 30), 0) AS d0_30,
        COALESCE(SUM(bal) FILTER (WHERE dpd BETWEEN 31 AND 60), 0) AS d31_60,
        COALESCE(SUM(bal) FILTER (WHERE dpd BETWEEN 61 AND 90), 0) AS d61_90,
        COALESCE(SUM(bal) FILTER (WHERE dpd > 90), 0) AS d90p,
        SUM(bal) AS total,
        MIN("dueDate") AS oldest
      FROM b GROUP BY "accountId" HAVING SUM(bal) > 0
    )
    SELECT g.*, a."code", a."nameEn", a."nameAr", COUNT(*) OVER () AS full_count
    FROM g JOIN "FeeAccount" a ON a."id" = g."accountId"
    ORDER BY (g.d90p + g.d61_90 + g.d31_60 + g.d0_30) DESC, g.total DESC, a."code"
    LIMIT ${opts.limit} OFFSET ${opts.offset}`;
  return {
    total: rows.length ? n(rows[0].full_count) : 0,
    rows: rows.map((r) => ({ accountId: String(r.accountId), code: String(r.code), nameEn: String(r.nameEn), nameAr: String(r.nameAr), current: n(r.current), d0_30: n(r.d0_30), d31_60: n(r.d31_60), d61_90: n(r.d61_90), d90p: n(r.d90p), total: n(r.total), oldestDue: (r.oldest as Date) ?? null })),
  };
}

// ---------------------------------------------------------------------------------------------
// Billed versus collected
// ---------------------------------------------------------------------------------------------

export type MonthRow = { month: string; billed: number; credited: number; collected: number; refunded: number };

export async function billedVsCollected(tx: Tx, orgId: string, p: Period): Promise<MonthRow[]> {
  const rows = await tx.$queryRaw<Array<Record<string, unknown>>>`
    WITH months AS (
      SELECT generate_series(date_trunc('month', ${p.from}::date), date_trunc('month', ${p.to}::date), interval '1 month')::date AS m
    ),
    billed AS (
      SELECT date_trunc('month', ${DUBAI_DAY(`"issueDate"`)})::date AS m, SUM("totalFils") AS v FROM "Invoice"
      WHERE "orgId" = ${orgId} AND "kind" = 'TAX' AND ${DUBAI_DAY(`"issueDate"`)} BETWEEN ${p.from}::date AND ${p.to}::date GROUP BY 1
    ),
    credited AS (
      SELECT date_trunc('month', ${DUBAI_DAY(`"issueDate"`)})::date AS m, SUM("totalFils") AS v FROM "CreditNote"
      WHERE "orgId" = ${orgId} AND ${DUBAI_DAY(`"issueDate"`)} BETWEEN ${p.from}::date AND ${p.to}::date GROUP BY 1
    ),
    collected AS (
      SELECT date_trunc('month', ${DUBAI_DAY(`"clearedAt"`)})::date AS m, SUM("amountFils") AS v FROM "FeePayment"
      WHERE "orgId" = ${orgId} AND "status" = 'CLEARED' AND ${DUBAI_DAY(`"clearedAt"`)} BETWEEN ${p.from}::date AND ${p.to}::date GROUP BY 1
    ),
    refunded AS (
      SELECT date_trunc('month', ${DUBAI_DAY(`"paidAt"`)})::date AS m, SUM("amountFils") AS v FROM "FeeRefund"
      WHERE "orgId" = ${orgId} AND "status" = 'PAID' AND ${DUBAI_DAY(`"paidAt"`)} BETWEEN ${p.from}::date AND ${p.to}::date GROUP BY 1
    )
    SELECT to_char(months.m, 'YYYY-MM') AS month, COALESCE(billed.v, 0) AS billed, COALESCE(credited.v, 0) AS credited, COALESCE(collected.v, 0) AS collected, COALESCE(refunded.v, 0) AS refunded
    FROM months
    LEFT JOIN billed ON billed.m = months.m
    LEFT JOIN credited ON credited.m = months.m
    LEFT JOIN collected ON collected.m = months.m
    LEFT JOIN refunded ON refunded.m = months.m
    ORDER BY months.m`;
  return rows.map((r) => ({ month: String(r.month), billed: n(r.billed), credited: n(r.credited), collected: n(r.collected), refunded: n(r.refunded) }));
}

// ---------------------------------------------------------------------------------------------
// Outstanding by grade
// ---------------------------------------------------------------------------------------------

export type GradeRow = { grade: number | null; owed: number; students: number };

/** Each open invoice's balance is shared over its lines in proportion to their totals, then grouped by grade. */
export async function outstandingByGrade(tx: Tx, orgId: string): Promise<GradeRow[]> {
  const rows = await tx.$queryRaw<Array<Record<string, unknown>>>`
    SELECT s."gradeLevel" AS grade,
      ROUND(SUM(l."totalFils"::numeric * (i."totalFils" - i."paidFils" - i."creditedFils") / NULLIF(i."totalFils", 0)))::bigint AS owed,
      COUNT(DISTINCT l."studentId") AS students
    FROM "InvoiceLine" l
    JOIN "Invoice" i ON i."id" = l."invoiceId"
    LEFT JOIN "Student" s ON s."id" = l."studentId"
    WHERE l."orgId" = ${orgId} AND i."orgId" = ${orgId} AND i."kind" = 'TAX' AND i."status" IN ('OPEN', 'PARTIAL')
    GROUP BY s."gradeLevel"
    ORDER BY s."gradeLevel" NULLS LAST`;
  return rows.map((r) => ({ grade: r.grade === null ? null : n(r.grade), owed: n(r.owed), students: n(r.students) }));
}

// ---------------------------------------------------------------------------------------------
// VAT summary for a return period
// ---------------------------------------------------------------------------------------------

export type VatRow = { treatment: string; rateBp: number; net: number; vat: number; documents: number };

export async function vatSummary(tx: Tx, orgId: string, p: Period): Promise<{ supplies: VatRow[]; adjustments: VatRow[] }> {
  const supplies = await tx.$queryRaw<Array<Record<string, unknown>>>`
    SELECT l."vatTreatment"::text AS treatment, l."vatRateBp" AS rate, SUM(l."netFils") AS net, SUM(l."vatFils") AS vat, COUNT(DISTINCT i."id") AS docs
    FROM "InvoiceLine" l JOIN "Invoice" i ON i."id" = l."invoiceId"
    WHERE l."orgId" = ${orgId} AND i."orgId" = ${orgId} AND i."kind" = 'TAX' AND ${DUBAI_DAY(`i."issueDate"`)} BETWEEN ${p.from}::date AND ${p.to}::date
    GROUP BY 1, 2 ORDER BY 2 DESC, 1`;
  const adjustments = await tx.$queryRaw<Array<Record<string, unknown>>>`
    SELECT cl."vatTreatment"::text AS treatment, cl."vatRateBp" AS rate, SUM(cl."netFils") AS net, SUM(cl."vatFils") AS vat, COUNT(DISTINCT c."id") AS docs
    FROM "CreditNoteLine" cl JOIN "CreditNote" c ON c."id" = cl."creditNoteId"
    WHERE cl."orgId" = ${orgId} AND c."orgId" = ${orgId} AND ${DUBAI_DAY(`c."issueDate"`)} BETWEEN ${p.from}::date AND ${p.to}::date
    GROUP BY 1, 2 ORDER BY 2 DESC, 1`;
  const map = (r: Record<string, unknown>): VatRow => ({ treatment: String(r.treatment), rateBp: n(r.rate), net: n(r.net), vat: n(r.vat), documents: n(r.docs) });
  return { supplies: supplies.map(map), adjustments: adjustments.map(map) };
}

// ---------------------------------------------------------------------------------------------
// Discounts given
// ---------------------------------------------------------------------------------------------

export async function discountsGiven(tx: Tx, orgId: string, p: Period): Promise<Array<{ kind: string; amount: number; lines: number }>> {
  const rows = await tx.$queryRaw<Array<Record<string, unknown>>>`
    SELECT d->>'kind' AS kind, SUM((d->>'amountFils')::bigint) AS amount, COUNT(*) AS lines
    FROM "InvoiceLine" l
    JOIN "Invoice" i ON i."id" = l."invoiceId"
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l."discounts", '[]'::jsonb)) AS d
    WHERE l."orgId" = ${orgId} AND i."orgId" = ${orgId} AND i."kind" = 'TAX' AND ${DUBAI_DAY(`i."issueDate"`)} BETWEEN ${p.from}::date AND ${p.to}::date
    GROUP BY 1 ORDER BY 2 DESC`;
  const early = await tx.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COALESCE(SUM("totalFils"), 0) AS amount, COUNT(*) AS lines FROM "CreditNote"
    WHERE "orgId" = ${orgId} AND "reasonKind" = 'EARLY_PAYMENT' AND ${DUBAI_DAY(`"issueDate"`)} BETWEEN ${p.from}::date AND ${p.to}::date`;
  const out = rows.map((r) => ({ kind: String(r.kind), amount: n(r.amount), lines: n(r.lines) }));
  if (n(early[0]?.amount)) out.push({ kind: "EARLY_PAYMENT", amount: n(early[0].amount), lines: n(early[0].lines) });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Cash book
// ---------------------------------------------------------------------------------------------

export type CashRow = { at: Date; direction: "IN" | "OUT"; kind: "RECEIPT" | "REFUND" | "RETURNED_CHEQUE"; number: string | null; method: string; reference: string | null; amount: number; code: string; nameEn: string; nameAr: string };

export async function cashBook(tx: Tx, orgId: string, p: Period, opts: { limit: number; offset: number }): Promise<{ rows: CashRow[]; total: number; opening: number; totals: { in: number; out: number } }> {
  const base = Prisma.sql`
    SELECT x.* FROM (
      SELECT pmt."clearedAt" AS at, 'IN' AS direction, 'RECEIPT' AS kind, pmt."number" AS number, pmt."method"::text AS method, pmt."reference" AS reference, pmt."amountFils" AS amount, pmt."accountId" AS "accountId"
      FROM "FeePayment" pmt WHERE pmt."orgId" = ${orgId} AND pmt."clearedAt" IS NOT NULL
      UNION ALL
      SELECT pmt."bouncedAt", 'OUT', 'RETURNED_CHEQUE', pmt."number", pmt."method"::text, pmt."chequeNumber", pmt."amountFils", pmt."accountId"
      FROM "FeePayment" pmt WHERE pmt."orgId" = ${orgId} AND pmt."bouncedAt" IS NOT NULL AND pmt."clearedAt" IS NOT NULL
      UNION ALL
      SELECT r."paidAt", 'OUT', 'REFUND', r."number", COALESCE(r."method"::text, ''), r."reference", r."amountFils", r."accountId"
      FROM "FeeRefund" r WHERE r."orgId" = ${orgId} AND r."status" = 'PAID'
    ) x`;
  const inPeriod = Prisma.sql`(x.at + interval '4 hours')::date BETWEEN ${p.from}::date AND ${p.to}::date`;
  const rows = await tx.$queryRaw<Array<Record<string, unknown>>>`
    SELECT y.*, a."code", a."nameEn", a."nameAr", COUNT(*) OVER () AS full_count
    FROM (${base}) y JOIN "FeeAccount" a ON a."id" = y."accountId"
    WHERE (y.at + interval '4 hours')::date BETWEEN ${p.from}::date AND ${p.to}::date
    ORDER BY y.at, y.number NULLS LAST
    LIMIT ${opts.limit} OFFSET ${opts.offset}`;
  const sums = await tx.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      COALESCE(SUM(CASE WHEN x.direction = 'IN' THEN x.amount ELSE -x.amount END) FILTER (WHERE (x.at + interval '4 hours')::date < ${p.from}::date), 0) AS opening,
      COALESCE(SUM(x.amount) FILTER (WHERE x.direction = 'IN' AND ${inPeriod}), 0) AS total_in,
      COALESCE(SUM(x.amount) FILTER (WHERE x.direction = 'OUT' AND ${inPeriod}), 0) AS total_out
    FROM (${base}) x`;
  return {
    total: rows.length ? n(rows[0].full_count) : 0,
    opening: n(sums[0]?.opening),
    totals: { in: n(sums[0]?.total_in), out: n(sums[0]?.total_out) },
    rows: rows.map((r) => ({ at: r.at as Date, direction: r.direction as "IN" | "OUT", kind: r.kind as CashRow["kind"], number: (r.number as string) ?? null, method: String(r.method), reference: (r.reference as string) ?? null, amount: n(r.amount), code: String(r.code), nameEn: String(r.nameEn), nameAr: String(r.nameAr) })),
  };
}

// ---------------------------------------------------------------------------------------------
// Headline numbers for the overview
// ---------------------------------------------------------------------------------------------

export async function headline(tx: Tx, orgId: string, p: Period) {
  const rows = await tx.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      (SELECT COALESCE(SUM("totalFils"), 0) FROM "Invoice" WHERE "orgId" = ${orgId} AND "kind" = 'TAX' AND ${DUBAI_DAY(`"issueDate"`)} BETWEEN ${p.from}::date AND ${p.to}::date) AS billed,
      (SELECT COALESCE(SUM("totalFils"), 0) FROM "CreditNote" WHERE "orgId" = ${orgId} AND ${DUBAI_DAY(`"issueDate"`)} BETWEEN ${p.from}::date AND ${p.to}::date) AS credited,
      (SELECT COALESCE(SUM("amountFils"), 0) FROM "FeePayment" WHERE "orgId" = ${orgId} AND "status" = 'CLEARED' AND ${DUBAI_DAY(`"clearedAt"`)} BETWEEN ${p.from}::date AND ${p.to}::date) AS collected,
      (SELECT COALESCE(SUM("amountFils"), 0) FROM "FeePayment" WHERE "orgId" = ${orgId} AND "status" = 'HELD') AS held,
      (SELECT COUNT(*) FROM "FeePayment" WHERE "orgId" = ${orgId} AND "status" = 'HELD') AS held_count,
      (SELECT COUNT(*) FROM "FeeRefund" WHERE "orgId" = ${orgId} AND "status" = 'REQUESTED') + (SELECT COUNT(*) FROM "FeeAward" WHERE "orgId" = ${orgId} AND "status" = 'PENDING') AS approvals`;
  const r = rows[0] ?? {};
  return { billed: n(r.billed), credited: n(r.credited), collected: n(r.collected), held: n(r.held), heldCount: n(r.held_count), approvals: n(r.approvals) };
}
