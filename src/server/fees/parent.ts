import "server-only";
// The parent's fees page: statements per family and per child, invoices, receipts, balance and due dates.
// Only accounts the parent pays or that bill their own children (parentAccountIds). Students never see fees.
import type { Ctx } from "@/server/context";
import { parentAccountIds } from "./accounts";
import { balanceOf, unallocatedOf } from "./ledger";

export async function parentHasFees(ctx: Ctx): Promise<boolean> {
  if (!ctx.isParent || !ctx.can("family.portal")) return false;
  const ids = await parentAccountIds(ctx.db, ctx);
  if (!ids.length) return false;
  return (await ctx.db.invoice.count({ where: { accountId: { in: ids }, status: { not: "CANCELLED" } } })) > 0;
}

export async function parentStatement(ctx: Ctx, accountId?: string | null) {
  const ids = await parentAccountIds(ctx.db, ctx);
  if (!ids.length) return null;
  const accounts = await ctx.db.feeAccount.findMany({ where: { id: { in: ids } }, include: { students: true }, orderBy: { code: "asc" } });
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  if (!account) return null;
  const studentIds = account.students.map((s) => s.studentId);
  const [students, invoices, payments, creditNotes] = await Promise.all([
    ctx.db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, section: true } }),
    ctx.db.invoice.findMany({ where: { accountId: account.id, status: { notIn: ["CANCELLED", "CONVERTED"] } }, include: { lines: true }, orderBy: [{ issueDate: "desc" }, { number: "desc" }] }),
    ctx.db.feePayment.findMany({ where: { accountId: account.id }, orderBy: { receivedAt: "desc" } }),
    ctx.db.creditNote.findMany({ where: { accountId: account.id }, orderBy: { issueDate: "desc" } }),
  ]);
  const open = invoices.filter((i) => i.kind === "TAX" && (i.status === "OPEN" || i.status === "PARTIAL"));
  const owed = open.reduce((s, i) => s + balanceOf(i), 0);
  const credit = payments.reduce((s, p) => s + unallocatedOf(p), 0);
  const nextDue = [...open].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0] ?? null;
  // Per child: what was billed for them this year, discounts, and what is still open on their lines.
  const perChild = students.map((s) => {
    const lines = invoices.filter((i) => i.kind === "TAX").flatMap((i) => i.lines.filter((l) => l.studentId === s.id).map((l) => ({ ...l, invoice: i })));
    const billed = lines.reduce((sum, l) => sum + l.totalFils, 0);
    const discounts = lines.reduce((sum, l) => sum + l.discountFils, 0);
    const outstanding = lines.reduce((sum, l) => (l.invoice.totalFils > 0 ? sum + Math.round((l.totalFils * balanceOf(l.invoice)) / l.invoice.totalFils) : sum), 0);
    return { student: s, billed, discounts, outstanding, lines };
  });
  return { accounts, account, students, invoices, payments, creditNotes, owed, credit, balance: owed - credit, nextDue, perChild };
}
