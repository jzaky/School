import "server-only";
// Read models for the Finance pages and the parent fees page. Lists are paginated; balances come from SQL
// aggregates so a school of 900 families loads quickly.
import { Prisma, type InvoiceStatus } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { dubaiDayKey } from "@/lib/format";
import { balanceOf, unallocatedOf } from "./ledger";

export const PAGE_SIZE = 25;
const n = (v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? 0));

export const todayKey = (now = new Date()) => dubaiDayKey(now);
export const dubaiMidnight = (key: string) => new Date(`${key}T00:00:00+04:00`);

export function canFinance(ctx: Ctx) {
  return ctx.isStaff && ctx.can("fees.view");
}

export type AccountListRow = { id: string; code: string; nameEn: string; nameAr: string; payerType: string; sponsorName: string | null; students: number; owed: number; overdue: number; credit: number; applicant: boolean };

export async function listAccounts(ctx: Ctx, opts: { q?: string; filter?: string; page: number }) {
  const today = todayKey();
  const q = opts.q?.trim().slice(0, 80) ?? "";
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const search = q
    ? Prisma.sql`AND (a."code" ILIKE ${like} OR a."nameEn" ILIKE ${like} OR a."nameAr" ILIKE ${like} OR a."sponsorName" ILIKE ${like}
        OR EXISTS (SELECT 1 FROM "StudentFeeProfile" sp JOIN "Student" s ON s."id" = sp."studentId" WHERE sp."accountId" = a."id"
          AND (s."firstNameEn" ILIKE ${like} OR s."lastNameEn" ILIKE ${like} OR s."firstNameAr" ILIKE ${like} OR s."lastNameAr" ILIKE ${like} OR s."studentNo" ILIKE ${like})))`
    : Prisma.empty;
  const filter =
    opts.filter === "overdue" ? Prisma.sql`AND COALESCE(inv.overdue, 0) > 0` : opts.filter === "owing" ? Prisma.sql`AND COALESCE(inv.owed, 0) > 0` : opts.filter === "credit" ? Prisma.sql`AND COALESCE(cr.credit, 0) > 0` : opts.filter === "sponsor" ? Prisma.sql`AND a."payerType" = 'SPONSOR'` : Prisma.empty;
  const offset = (opts.page - 1) * PAGE_SIZE;
  const rows = await tenantTx(ctx.orgId, (tx) =>
    tx.$queryRaw<Array<Record<string, unknown>>>`
      SELECT a."id", a."code", a."nameEn", a."nameAr", a."payerType"::text AS "payerType", a."sponsorName", a."applicationRef",
        COALESCE(inv.owed, 0) AS owed, COALESCE(inv.overdue, 0) AS overdue, COALESCE(cr.credit, 0) AS credit, COALESCE(st.c, 0) AS students,
        COUNT(*) OVER () AS full_count
      FROM "FeeAccount" a
      LEFT JOIN LATERAL (
        SELECT SUM(i."totalFils" - i."paidFils" - i."creditedFils") AS owed,
          SUM(i."totalFils" - i."paidFils" - i."creditedFils") FILTER (WHERE (i."dueDate" + interval '4 hours')::date < ${today}::date) AS overdue
        FROM "Invoice" i WHERE i."orgId" = ${ctx.orgId} AND i."accountId" = a."id" AND i."kind" = 'TAX' AND i."status" IN ('OPEN', 'PARTIAL')
      ) inv ON true
      LEFT JOIN LATERAL (
        SELECT SUM(p."amountFils" - p."allocatedFils" - p."refundedFils") AS credit FROM "FeePayment" p
        WHERE p."orgId" = ${ctx.orgId} AND p."accountId" = a."id" AND p."status" = 'CLEARED'
      ) cr ON true
      LEFT JOIN LATERAL (SELECT COUNT(*) AS c FROM "StudentFeeProfile" sp WHERE sp."accountId" = a."id") st ON true
      WHERE a."orgId" = ${ctx.orgId} ${search} ${filter}
      ORDER BY COALESCE(inv.overdue, 0) DESC, COALESCE(inv.owed, 0) DESC, a."code"
      LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
  );
  return {
    total: rows.length ? n(rows[0].full_count) : 0,
    rows: rows.map(
      (r): AccountListRow => ({ id: String(r.id), code: String(r.code), nameEn: String(r.nameEn), nameAr: String(r.nameAr), payerType: String(r.payerType), sponsorName: (r.sponsorName as string) ?? null, students: n(r.students), owed: n(r.owed), overdue: n(r.overdue), credit: n(r.credit), applicant: Boolean(r.applicationRef) }),
    ),
  };
}

export type InvoiceFilter = "all" | "open" | "overdue" | "paid" | "proforma" | "credited";

export function invoiceWhere(orgId: string, filter: InvoiceFilter, q: string, extra: Prisma.InvoiceWhereInput = {}): Prisma.InvoiceWhereInput {
  const today = dubaiMidnight(todayKey());
  const open: InvoiceStatus[] = ["OPEN", "PARTIAL"];
  const byFilter: Prisma.InvoiceWhereInput =
    filter === "open"
      ? { kind: "TAX", status: { in: open } }
      : filter === "overdue"
        ? { kind: "TAX", status: { in: open }, dueDate: { lt: today } }
        : filter === "paid"
          ? { kind: "TAX", status: "PAID" }
          : filter === "proforma"
            ? { kind: "PROFORMA" }
            : filter === "credited"
              ? { kind: "TAX", status: "CREDITED" }
              : {};
  const text = q.trim().slice(0, 80);
  const search: Prisma.InvoiceWhereInput = text ? { OR: [{ number: { contains: text, mode: "insensitive" } }, { billToName: { contains: text, mode: "insensitive" } }, { billToNameAr: { contains: text } }] } : {};
  return { orgId, ...byFilter, ...search, ...extra };
}

export async function listInvoices(ctx: Ctx, opts: { filter: InvoiceFilter; q: string; page: number; extra?: Prisma.InvoiceWhereInput }) {
  const where = invoiceWhere(ctx.orgId, opts.filter, opts.q, opts.extra);
  const [rows, total] = await Promise.all([
    ctx.db.invoice.findMany({ where, orderBy: [{ issueDate: "desc" }, { number: "desc" }], skip: (opts.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    ctx.db.invoice.count({ where }),
  ]);
  const accounts = await ctx.db.feeAccount.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.accountId))] } }, select: { id: true, code: true, nameEn: true, nameAr: true } });
  return { total, rows: rows.map((r) => ({ ...r, balanceFils: balanceOf(r), account: accounts.find((a) => a.id === r.accountId) ?? null })) };
}

export async function listPayments(ctx: Ctx, opts: { tab: "all" | "held" | "bounced"; q: string; page: number }) {
  const text = opts.q.trim().slice(0, 80);
  const where: Prisma.FeePaymentWhereInput = {
    orgId: ctx.orgId,
    ...(opts.tab === "held" ? { status: "HELD" } : opts.tab === "bounced" ? { status: "BOUNCED" } : {}),
    ...(text ? { OR: [{ number: { contains: text, mode: "insensitive" } }, { reference: { contains: text, mode: "insensitive" } }, { chequeNumber: { contains: text } }, { payerName: { contains: text, mode: "insensitive" } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    ctx.db.feePayment.findMany({ where, orderBy: opts.tab === "held" ? [{ chequeDate: "asc" }] : [{ receivedAt: "desc" }, { createdAt: "desc" }], skip: (opts.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    ctx.db.feePayment.count({ where }),
  ]);
  const accounts = await ctx.db.feeAccount.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.accountId))] } }, select: { id: true, code: true, nameEn: true, nameAr: true } });
  return { total, rows: rows.map((r) => ({ ...r, unallocatedFils: unallocatedOf(r), account: accounts.find((a) => a.id === r.accountId) ?? null })) };
}

/** Everything on one family account, with a chronological statement. */
export async function accountDetail(ctx: Ctx, accountId: string) {
  const account = await ctx.db.feeAccount.findFirst({ where: { id: accountId }, include: { students: true } });
  if (!account) return null;
  const studentIds = account.students.map((s) => s.studentId);
  const [students, invoices, payments, creditNotes, refunds, charges, awards, payer, linkedGuardians] = await Promise.all([
    ctx.db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, section: true, studentNo: true, status: true, enrolledOn: true } }),
    ctx.db.invoice.findMany({ where: { accountId }, orderBy: [{ issueDate: "desc" }, { number: "desc" }] }),
    ctx.db.feePayment.findMany({ where: { accountId }, orderBy: [{ receivedAt: "desc" }] }),
    ctx.db.creditNote.findMany({ where: { accountId }, orderBy: [{ issueDate: "desc" }] }),
    ctx.db.feeRefund.findMany({ where: { accountId }, orderBy: [{ requestedAt: "desc" }] }),
    ctx.db.feeCharge.findMany({ where: { accountId, invoiceId: null }, orderBy: { createdAt: "asc" } }),
    ctx.db.feeAward.findMany({ where: { studentId: { in: studentIds } }, include: { discount: true }, orderBy: { createdAt: "desc" } }),
    account.payerGuardianId ? ctx.db.guardian.findFirst({ where: { id: account.payerGuardianId } }) : Promise.resolve(null),
    studentIds.length ? ctx.db.guardianLink.findMany({ where: { studentId: { in: studentIds } }, include: { guardian: { select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true } } } }) : Promise.resolve([]),
  ]);
  const chargeItems = charges.length ? await ctx.db.feeItem.findMany({ where: { id: { in: charges.map((c) => c.feeItemId) } }, select: { id: true, nameEn: true, nameAr: true, kind: true } }) : [];
  const open = invoices.filter((i) => i.kind === "TAX" && (i.status === "OPEN" || i.status === "PARTIAL"));
  const owed = open.reduce((s, i) => s + balanceOf(i), 0);
  const credit = payments.reduce((s, p) => s + unallocatedOf(p), 0);
  const today = dubaiMidnight(todayKey());
  const overdue = open.filter((i) => i.dueDate < today).reduce((s, i) => s + balanceOf(i), 0);

  // Statement: tax invoices and refunds paid add to what is owed; payments, credit notes and returned cheques move it.
  type Entry = { at: Date; kind: "INVOICE" | "PAYMENT" | "CREDIT_NOTE" | "REFUND" | "RETURNED"; ref: string; id: string; debit: number; credit: number };
  const entries: Entry[] = [
    ...invoices.filter((i) => i.kind === "TAX").map((i) => ({ at: i.issueDate, kind: "INVOICE" as const, ref: i.number, id: i.id, debit: i.totalFils, credit: 0 })),
    ...payments.filter((p) => p.clearedAt).map((p) => ({ at: p.clearedAt!, kind: "PAYMENT" as const, ref: p.number ?? "", id: p.id, debit: 0, credit: p.amountFils })),
    ...payments.filter((p) => p.bouncedAt && p.clearedAt).map((p) => ({ at: p.bouncedAt!, kind: "RETURNED" as const, ref: p.number ?? p.chequeNumber ?? "", id: p.id, debit: p.amountFils, credit: 0 })),
    ...creditNotes.map((c) => ({ at: c.issueDate, kind: "CREDIT_NOTE" as const, ref: c.number, id: c.id, debit: 0, credit: c.totalFils })),
    ...refunds.filter((r) => r.status === "PAID" && r.paidAt).map((r) => ({ at: r.paidAt!, kind: "REFUND" as const, ref: r.number ?? "", id: r.id, debit: r.amountFils, credit: 0 })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.ref.localeCompare(b.ref));
  let running = 0;
  const statement = entries.map((e) => {
    running += e.debit - e.credit;
    return { ...e, balance: running };
  });
  return { account, students, invoices, payments, creditNotes, refunds, charges: charges.map((c) => ({ ...c, item: chargeItems.find((i) => i.id === c.feeItemId) ?? null })), awards, payer, linkedGuardians, owed, credit, overdue, balance: owed - credit, statement };
}

export async function invoiceDetail(ctx: Ctx, invoiceId: string) {
  const invoice = await ctx.db.invoice.findFirst({ where: { id: invoiceId }, include: { lines: { orderBy: { seq: "asc" } } } });
  if (!invoice) return null;
  const [account, allocations, creditNotes, links] = await Promise.all([
    ctx.db.feeAccount.findFirst({ where: { id: invoice.accountId } }),
    ctx.db.feeAllocation.findMany({ where: { invoiceId }, orderBy: { createdAt: "asc" } }),
    ctx.db.creditNote.findMany({ where: { invoiceId }, include: { lines: true }, orderBy: { issueDate: "asc" } }),
    ctx.db.paymentLink.findMany({ where: { invoiceId }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const paymentIds = [...new Set(allocations.map((a) => a.paymentId).filter((x): x is string => Boolean(x)))];
  const payments = paymentIds.length ? await ctx.db.feePayment.findMany({ where: { id: { in: paymentIds } } }) : [];
  const perPayment = paymentIds.map((id) => ({ payment: payments.find((p) => p.id === id)!, amountFils: allocations.filter((a) => a.paymentId === id).reduce((s, a) => s + a.amountFils, 0) })).filter((x) => x.payment && x.amountFils > 0);
  const converted = invoice.convertedToId ? await ctx.db.invoice.findFirst({ where: { id: invoice.convertedToId }, select: { id: true, number: true } }) : null;
  const from = await ctx.db.invoice.findFirst({ where: { convertedToId: invoice.id }, select: { id: true, number: true } });
  const studentIds = [...new Set(invoice.lines.map((l) => l.studentId).filter((x): x is string => Boolean(x)))];
  const students = studentIds.length ? await ctx.db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, gradeLevel: true } }) : [];
  return { invoice, account, perPayment, creditNotes, links, converted, from, students, balanceFils: balanceOf(invoice) };
}

/** Active students not yet on a family account. */
export async function studentsWithoutAccount(orgId: string) {
  const rows = await tenantTx(orgId, (tx) =>
    tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM "Student" s
      WHERE s."orgId" = ${orgId} AND s."status" = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM "StudentFeeProfile" p WHERE p."studentId" = s."id")`,
  );
  return n(rows[0]?.n);
}

/** The current academic year and its plans and parts (setup screens and billing). */
export async function yearContext(ctx: Ctx, yearId?: string | null) {
  const years = await ctx.db.academicYear.findMany({ orderBy: { startsOn: "desc" }, include: { terms: { orderBy: { startsOn: "asc" } } } });
  const year = (yearId ? years.find((y) => y.id === yearId) : null) ?? years.find((y) => y.isCurrent) ?? years[0] ?? null;
  const plans = year ? await ctx.db.instalmentPlan.findMany({ where: { academicYearId: year.id }, include: { parts: { orderBy: { seq: "asc" } } }, orderBy: [{ isDefault: "desc" }, { key: "asc" }] }) : [];
  return { years, year, plans };
}
