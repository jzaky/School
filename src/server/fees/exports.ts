// Finance exports for accounting software (CSV and Excel). Amounts are AED with two decimals as numbers.
// The journal follows plain double entry: invoices debit receivables and credit income and VAT, credit notes the
// reverse, receipts debit cash or bank and credit receivables, refunds and returned cheques the reverse.
import type { Tx } from "@/server/db";
import type { Sheet } from "@/lib/xlsx-out";
import { agingByFamily, billedVsCollected, cashBook, discountsGiven, outstandingByGrade, vatSummary, type Period } from "./reports";

export const EXPORTS = ["invoices", "lines", "payments", "credit_notes", "journal", "vat", "aging", "cashbook", "discounts", "billed", "by_grade"] as const;
export type ExportKind = (typeof EXPORTS)[number];

const aed = (fils: number) => Math.round(fils) / 100;
const day = (d: Date | null | undefined) => (d ? new Date(d.getTime() + 4 * 3_600_000).toISOString().slice(0, 10) : "");
const range = (p: Period) => ({ gte: new Date(`${p.from}T00:00:00+04:00`), lt: new Date(new Date(`${p.to}T00:00:00+04:00`).getTime() + 86_400_000) });

const INCOME: Record<string, string> = {
  TUITION: "Tuition fee income",
  TRANSPORT: "Transport income",
  REGISTRATION: "Registration fee income",
  REENROLLMENT: "Re-enrollment fee income",
  SEAT_DEPOSIT: "Seat deposits",
  BOOKS: "Books income",
  UNIFORM: "Uniform income",
  TRIP: "Trips income",
  EXAM: "Exam fee income",
  OTHER: "Other fee income",
};
const CASH_ACCOUNT: Record<string, string> = { CASH: "Cash", CHEQUE: "Bank", BANK_TRANSFER: "Bank", CARD: "Card clearing", ONLINE: "Online payments clearing" };

export async function buildExport(tx: Tx, orgId: string, kind: ExportKind, p: Period): Promise<Sheet> {
  const when = range(p);
  switch (kind) {
    case "invoices": {
      const rows = await tx.invoice.findMany({ where: { orgId, issueDate: when }, orderBy: [{ issueDate: "asc" }, { number: "asc" }] });
      const accounts = await tx.feeAccount.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.accountId))] } }, select: { id: true, code: true } });
      return {
        name: "Invoices",
        columns: ["Number", "Type", "Status", "Issue date", "Due date", "Family account", "Bill to", "Customer TRN", "Subtotal", "Discount", "Taxable", "VAT", "Total", "Paid", "Credited", "Balance"],
        rows: rows.map((r) => [r.number, r.kind === "TAX" ? "Tax invoice" : "Proforma", r.status, day(r.issueDate), day(r.dueDate), accounts.find((a) => a.id === r.accountId)?.code ?? "", r.billToName, r.billToTrn ?? "", aed(r.subtotalFils), aed(r.discountFils), aed(r.netFils), aed(r.vatFils), aed(r.totalFils), aed(r.paidFils), aed(r.creditedFils), aed(r.totalFils - r.paidFils - r.creditedFils)]),
      };
    }
    case "lines": {
      const rows = await tx.invoiceLine.findMany({ where: { orgId, invoice: { kind: "TAX", issueDate: when } }, include: { invoice: { select: { number: true, issueDate: true } } }, orderBy: [{ invoice: { number: "asc" } }, { seq: "asc" }] });
      const students = await tx.student.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.studentId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, studentNo: true, gradeLevel: true } });
      return {
        name: "Invoice lines",
        columns: ["Invoice", "Issue date", "Line", "Student no.", "Grade", "Fee type", "Description", "VAT treatment", "VAT rate %", "Quantity", "Gross", "Discount", "Taxable", "VAT", "Total"],
        rows: rows.map((r) => {
          const s = students.find((x) => x.id === r.studentId);
          return [r.invoice.number, day(r.invoice.issueDate), r.seq, s?.studentNo ?? "", s ? s.gradeLevel : "", r.kind, r.descriptionEn, r.vatTreatment, r.vatRateBp / 100, r.quantity, aed(r.grossFils), aed(r.discountFils), aed(r.netFils), aed(r.vatFils), aed(r.totalFils)];
        }),
      };
    }
    case "payments": {
      const rows = await tx.feePayment.findMany({ where: { orgId, receivedAt: when }, orderBy: [{ receivedAt: "asc" }] });
      const accounts = await tx.feeAccount.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.accountId))] } }, select: { id: true, code: true } });
      return {
        name: "Payments",
        columns: ["Receipt", "Status", "Method", "Provider", "Received", "Cleared", "Family account", "Amount", "Allocated", "Refunded", "Reference", "Cheque no.", "Cheque bank", "Cheque date"],
        rows: rows.map((r) => [r.number ?? "", r.status, r.method, r.provider, day(r.receivedAt), day(r.clearedAt), accounts.find((a) => a.id === r.accountId)?.code ?? "", aed(r.amountFils), aed(r.allocatedFils), aed(r.refundedFils), r.reference ?? "", r.chequeNumber ?? "", r.chequeBank ?? "", day(r.chequeDate)]),
      };
    }
    case "credit_notes": {
      const rows = await tx.creditNote.findMany({ where: { orgId, issueDate: when }, orderBy: [{ issueDate: "asc" }, { number: "asc" }] });
      const invoices = await tx.invoice.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.invoiceId))] } }, select: { id: true, number: true } });
      const accounts = await tx.feeAccount.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.accountId))] } }, select: { id: true, code: true } });
      return {
        name: "Credit notes",
        columns: ["Number", "Issue date", "Invoice", "Family account", "Reason type", "Reason", "Taxable", "VAT", "Total"],
        rows: rows.map((r) => [r.number, day(r.issueDate), invoices.find((i) => i.id === r.invoiceId)?.number ?? "", accounts.find((a) => a.id === r.accountId)?.code ?? "", r.reasonKind, r.reasonEn, aed(r.netFils), aed(r.vatFils), aed(r.totalFils)]),
      };
    }
    case "journal": {
      const [invoices, cns, pays, refunds] = await Promise.all([
        tx.invoice.findMany({ where: { orgId, kind: "TAX", issueDate: when }, include: { lines: true }, orderBy: { issueDate: "asc" } }),
        tx.creditNote.findMany({ where: { orgId, issueDate: when }, include: { lines: true }, orderBy: { issueDate: "asc" } }),
        tx.feePayment.findMany({ where: { orgId, OR: [{ clearedAt: when }, { bouncedAt: when }] }, orderBy: { receivedAt: "asc" } }),
        tx.feeRefund.findMany({ where: { orgId, status: "PAID", paidAt: when }, orderBy: { paidAt: "asc" } }),
      ]);
      const accountIds = [...new Set([...invoices.map((i) => i.accountId), ...cns.map((c) => c.accountId), ...pays.map((x) => x.accountId), ...refunds.map((r) => r.accountId)])];
      const accounts = await tx.feeAccount.findMany({ where: { orgId, id: { in: accountIds } }, select: { id: true, code: true } });
      const code = (id: string) => accounts.find((a) => a.id === id)?.code ?? "";
      const lineKind = new Map<string, string>();
      for (const i of invoices) for (const l of i.lines) lineKind.set(l.id, l.kind);
      const out: Array<[string, string, string, string, string, number, number, string]> = [];
      for (const i of invoices) {
        out.push([day(i.issueDate), i.number, "Invoice", "Accounts receivable", code(i.accountId), aed(i.totalFils), 0, i.billToName]);
        const byKind = new Map<string, number>();
        for (const l of i.lines) byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + l.netFils);
        for (const [k, v] of byKind) out.push([day(i.issueDate), i.number, "Invoice", INCOME[k] ?? "Other fee income", code(i.accountId), 0, aed(v), i.billToName]);
        if (i.vatFils) out.push([day(i.issueDate), i.number, "Invoice", "VAT output", code(i.accountId), 0, aed(i.vatFils), i.billToName]);
      }
      const cnLineInvoice = cns.flatMap((c) => c.lines.map((l) => l.invoiceLineId).filter((x): x is string => Boolean(x)));
      const missingKinds = cnLineInvoice.filter((id) => !lineKind.has(id));
      if (missingKinds.length) for (const l of await tx.invoiceLine.findMany({ where: { orgId, id: { in: missingKinds } }, select: { id: true, kind: true } })) lineKind.set(l.id, l.kind);
      for (const c of cns) {
        const byKind = new Map<string, number>();
        for (const l of c.lines) {
          const k = (l.invoiceLineId && lineKind.get(l.invoiceLineId)) || "OTHER";
          byKind.set(k, (byKind.get(k) ?? 0) + l.netFils);
        }
        for (const [k, v] of byKind) out.push([day(c.issueDate), c.number, "Credit note", INCOME[k] ?? "Other fee income", code(c.accountId), aed(v), 0, c.reasonEn]);
        if (c.vatFils) out.push([day(c.issueDate), c.number, "Credit note", "VAT output", code(c.accountId), aed(c.vatFils), 0, c.reasonEn]);
        out.push([day(c.issueDate), c.number, "Credit note", "Accounts receivable", code(c.accountId), 0, aed(c.totalFils), c.reasonEn]);
      }
      for (const x of pays) {
        if (x.clearedAt && x.clearedAt >= when.gte && x.clearedAt < when.lt) {
          out.push([day(x.clearedAt), x.number ?? "", "Receipt", CASH_ACCOUNT[x.method] ?? "Bank", code(x.accountId), aed(x.amountFils), 0, x.reference ?? ""]);
          out.push([day(x.clearedAt), x.number ?? "", "Receipt", "Accounts receivable", code(x.accountId), 0, aed(x.amountFils), x.reference ?? ""]);
        }
        if (x.bouncedAt && x.clearedAt && x.bouncedAt >= when.gte && x.bouncedAt < when.lt) {
          out.push([day(x.bouncedAt), x.number ?? "", "Returned cheque", "Accounts receivable", code(x.accountId), aed(x.amountFils), 0, x.chequeNumber ?? ""]);
          out.push([day(x.bouncedAt), x.number ?? "", "Returned cheque", "Bank", code(x.accountId), 0, aed(x.amountFils), x.chequeNumber ?? ""]);
        }
      }
      for (const r of refunds) {
        out.push([day(r.paidAt), r.number ?? "", "Refund", "Accounts receivable", code(r.accountId), aed(r.amountFils), 0, r.reason]);
        out.push([day(r.paidAt), r.number ?? "", "Refund", CASH_ACCOUNT[r.method ?? "BANK_TRANSFER"] ?? "Bank", code(r.accountId), 0, aed(r.amountFils), r.reason]);
      }
      out.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
      return { name: "Journal", columns: ["Date", "Document", "Type", "Ledger account", "Family account", "Debit", "Credit", "Description"], rows: out };
    }
    case "vat": {
      const v = await vatSummary(tx, orgId, p);
      const rows = [...v.supplies.map((r) => ["Supplies", r.treatment, r.rateBp / 100, aed(r.net), aed(r.vat), r.documents]), ...v.adjustments.map((r) => ["Credit notes", r.treatment, r.rateBp / 100, -aed(r.net), -aed(r.vat), r.documents])];
      return { name: "VAT summary", columns: ["Section", "VAT treatment", "Rate %", "Taxable amount", "VAT", "Documents"], rows };
    }
    case "aging": {
      const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
      const a = await agingByFamily(tx, orgId, today, { limit: 100_000, offset: 0 });
      return { name: "Aging", columns: ["Family account", "Family", "Not yet due", "0 to 30 days", "31 to 60 days", "61 to 90 days", "Over 90 days", "Total", "Oldest due date"], rows: a.rows.map((r) => [r.code, r.nameEn, aed(r.current), aed(r.d0_30), aed(r.d31_60), aed(r.d61_90), aed(r.d90p), aed(r.total), day(r.oldestDue)]) };
    }
    case "cashbook": {
      const c = await cashBook(tx, orgId, p, { limit: 100_000, offset: 0 });
      let bal = c.opening;
      const rows = c.rows.map((r) => {
        bal += r.direction === "IN" ? r.amount : -r.amount;
        return [day(r.at), r.kind, r.number ?? "", r.method, r.reference ?? "", r.code, r.direction === "IN" ? aed(r.amount) : 0, r.direction === "OUT" ? aed(r.amount) : 0, aed(bal)];
      });
      return { name: "Cash book", columns: ["Date", "Type", "Number", "Method", "Reference", "Family account", "In", "Out", "Balance"], rows: [["", "OPENING", "", "", "", "", 0, 0, aed(c.opening)], ...rows] };
    }
    case "discounts": {
      const d = await discountsGiven(tx, orgId, p);
      return { name: "Discounts", columns: ["Discount", "Amount", "Lines or notes"], rows: d.map((r) => [r.kind, aed(r.amount), r.lines]) };
    }
    case "billed": {
      const m = await billedVsCollected(tx, orgId, p);
      return { name: "Billed and collected", columns: ["Month", "Billed", "Credited", "Collected", "Refunded"], rows: m.map((r) => [r.month, aed(r.billed), aed(r.credited), aed(r.collected), aed(r.refunded)]) };
    }
    case "by_grade": {
      const g = await outstandingByGrade(tx, orgId);
      return { name: "Outstanding by grade", columns: ["Grade level", "Outstanding", "Students"], rows: g.map((r) => [r.grade === null ? "Family charges" : r.grade, aed(r.owed), r.students]) };
    }
  }
}
