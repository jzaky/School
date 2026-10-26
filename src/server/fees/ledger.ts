// The fee ledger: invoices, credit notes, payments, allocations and refunds. Every function runs inside a tenant
// transaction (tenantTx, or the owner client in seeds) and locks the family account first, so money changes for one
// family never interleave. Issued documents are never edited: corrections are credit notes, a bounced cheque or a
// credit note releases allocations with negative rows (append only, see prisma/rls.sql).
import type { FeeItemKind, FeePaymentMethod, InvoiceKind, Prisma } from "@prisma/client";
import { execCtx, type Effect, type Tx } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { loadFinanceConfig, sellerFor, taxInvoiceBlockers, type FinanceConfig } from "./config";
import { allocateFifo, bpOf, computeLine, dubaiDayNumber, invoiceStatusFor, totalsOf, vatOf, type ComputedLine, type LineInput } from "./money";
import { nextDocNumber } from "./numbering";
import { SEAT_REF_PREFIX, seatPaidHandler } from "./hooks";

export class FeeError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "FeeError";
  }
}

export type Actor = { membershipId: string | null; userId: string | null };
const SYSTEM: Actor = { membershipId: null, userId: null };

async function lockAccount(tx: Tx, orgId: string, accountId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "FeeAccount" WHERE "id" = ${accountId} AND "orgId" = ${orgId} FOR UPDATE`;
  if (!rows.length) throw new FeeError("ACCOUNT_NOT_FOUND");
}

async function logMoney(tx: Tx, orgId: string, actor: Actor, action: string, entityType: string, entityId: string, meta: Record<string, unknown>) {
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action, entityType, entityId, meta });
}

/** Who the invoice is addressed to: the paying guardian or the sponsoring company. */
export async function billToFor(tx: Tx, orgId: string, accountId: string) {
  const account = await tx.feeAccount.findFirst({ where: { id: accountId, orgId } });
  if (!account) throw new FeeError("ACCOUNT_NOT_FOUND");
  if (account.payerType === "SPONSOR" && account.sponsorName) {
    return { account, name: account.sponsorName, nameAr: null as string | null, address: account.billingAddress, trn: account.sponsorTrn, email: account.billingEmail };
  }
  const g = account.payerGuardianId ? await tx.guardian.findFirst({ where: { id: account.payerGuardianId, orgId } }) : null;
  return {
    account,
    name: g ? `${g.firstNameEn} ${g.lastNameEn}` : account.nameEn,
    nameAr: g ? `${g.firstNameAr} ${g.lastNameAr}` : account.nameAr,
    address: account.billingAddress,
    trn: null as string | null,
    email: account.billingEmail ?? g?.email ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------------------------

export type IssueInvoiceInput = {
  kind: InvoiceKind;
  accountId: string;
  academicYearId?: string | null;
  billingRunId?: string | null;
  planPartId?: string | null;
  issueDate: Date;
  dueDate: Date;
  period?: { start: Date; end: Date; labelEn: string; labelAr: string } | null;
  lines: LineInput[];
  sourceRef?: string | null;
  chargeIds?: string[];
  /** Apply the family's unallocated credit to the new tax invoice (default true). */
  applyCredit?: boolean;
};

async function createInvoiceRecord(
  tx: Tx,
  orgId: string,
  cfg: FinanceConfig,
  input: Omit<IssueInvoiceInput, "lines"> & { lines: ComputedLine[] },
  actor: Actor,
) {
  if (input.kind === "TAX" && taxInvoiceBlockers(cfg).length) throw new FeeError("TAX_SETUP_INCOMPLETE");
  if (!input.lines.length) throw new FeeError("NO_LINES");
  if (dubaiDayNumber(input.dueDate) < dubaiDayNumber(input.issueDate)) throw new FeeError("DUE_BEFORE_ISSUE");
  const totals = totalsOf(input.lines);
  if (totals.totalFils <= 0) throw new FeeError("ZERO_TOTAL");
  await lockAccount(tx, orgId, input.accountId);
  const billTo = await billToFor(tx, orgId, input.accountId);
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { nameEn: true, nameAr: true, emirate: true } });
  const number = await nextDocNumber(tx, orgId, input.kind === "TAX" ? "INV" : "PF", input.kind === "TAX" ? cfg.invoicePrefix : cfg.proformaPrefix, input.issueDate);
  const invoice = await tx.invoice.create({
    data: {
      orgId,
      kind: input.kind,
      number,
      accountId: input.accountId,
      academicYearId: input.academicYearId ?? null,
      billingRunId: input.billingRunId ?? null,
      planPartId: input.planPartId ?? null,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      periodStart: input.period?.start ?? null,
      periodEnd: input.period?.end ?? null,
      periodLabelEn: input.period?.labelEn ?? null,
      periodLabelAr: input.period?.labelAr ?? null,
      billToName: billTo.name,
      billToNameAr: billTo.nameAr,
      billToAddress: billTo.address,
      billToTrn: billTo.trn,
      billToEmail: billTo.email,
      seller: sellerFor(org, cfg) as unknown as Prisma.InputJsonValue,
      ...totals,
      sourceRef: input.sourceRef ?? null,
      createdById: actor.membershipId,
      lines: {
        create: input.lines.map((l) => ({
          orgId,
          seq: l.seq,
          studentId: l.studentId,
          feeItemId: l.feeItemId,
          kind: l.kind,
          descriptionEn: l.descriptionEn,
          descriptionAr: l.descriptionAr,
          quantity: l.quantity,
          unitFils: l.unitFils,
          grossFils: l.grossFils,
          discountFils: l.discountFils,
          netFils: l.netFils,
          vatTreatment: l.vatTreatment,
          vatRateBp: l.vatRateBp,
          vatFils: l.vatFils,
          totalFils: l.totalFils,
          prorataNum: l.prorataNum,
          prorataDen: l.prorataDen,
          discounts: l.discounts.length ? (l.discounts as unknown as Prisma.InputJsonValue) : undefined,
        })),
      },
    },
  });
  if (input.chargeIds?.length) {
    await tx.feeCharge.updateMany({ where: { orgId, id: { in: input.chargeIds }, accountId: input.accountId, invoiceId: null }, data: { invoiceId: invoice.id } });
  }
  await logMoney(tx, orgId, actor, input.kind === "TAX" ? "fees.invoice.issue" : "fees.proforma.issue", "Invoice", invoice.id, {
    number,
    accountId: input.accountId,
    totalFils: totals.totalFils,
    vatFils: totals.vatFils,
    billingRunId: input.billingRunId ?? null,
  });
  if (input.kind === "TAX" && input.applyCredit !== false) await applyAccountCredit(tx, orgId, input.accountId, actor);
  return invoice;
}

/** Issue a proforma or a tax invoice. Lines are computed here (pro rata, discounts, VAT per line). */
export async function issueInvoice(tx: Tx, orgId: string, input: IssueInvoiceInput, actor: Actor = SYSTEM, cfgIn?: FinanceConfig) {
  const cfg = cfgIn ?? (await loadFinanceConfig(tx, orgId));
  const lines = input.lines.map((l, i) => computeLine(l, i + 1, cfg));
  return createInvoiceRecord(tx, orgId, cfg, { ...input, lines }, actor);
}

export function balanceOf(inv: { totalFils: number; paidFils: number; creditedFils: number }) {
  return inv.totalFils - inv.paidFils - inv.creditedFils;
}

async function setInvoiceAmounts(tx: Tx, orgId: string, invoiceId: string, delta: { paid?: number; credited?: number }) {
  const inv = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId, orgId } });
  const paidFils = inv.paidFils + (delta.paid ?? 0);
  const creditedFils = inv.creditedFils + (delta.credited ?? 0);
  if (paidFils < 0 || creditedFils < 0 || paidFils + creditedFils > inv.totalFils) throw new FeeError("OVER_ALLOCATED");
  const status = inv.kind === "PROFORMA" ? inv.status : invoiceStatusFor({ kind: inv.kind, totalFils: inv.totalFils, paidFils, creditedFils });
  return tx.invoice.update({ where: { id: invoiceId }, data: { paidFils, creditedFils, status } });
}

/** Cancel a proforma that was never paid (tax invoices are corrected with credit notes instead). */
export async function cancelProforma(tx: Tx, orgId: string, invoiceId: string, actor: Actor) {
  const inv = await tx.invoice.findFirst({ where: { id: invoiceId, orgId } });
  if (!inv || inv.kind !== "PROFORMA") throw new FeeError("NOT_FOUND");
  if (inv.status !== "OPEN") throw new FeeError("NOT_OPEN");
  await lockAccount(tx, orgId, inv.accountId);
  await tx.invoice.update({ where: { id: inv.id }, data: { status: "CANCELLED" } });
  await tx.paymentLink.updateMany({ where: { orgId, invoiceId: inv.id, status: "OPEN" }, data: { status: "CANCELLED" } });
  await logMoney(tx, orgId, actor, "fees.proforma.cancel", "Invoice", inv.id, { number: inv.number });
}

/** Turn a proforma into a tax invoice with exactly the same lines and amounts. */
export async function convertProforma(tx: Tx, orgId: string, invoiceId: string, actor: Actor, issueDate: Date) {
  const pf = await tx.invoice.findFirst({ where: { id: invoiceId, orgId }, include: { lines: { orderBy: { seq: "asc" } } } });
  if (!pf || pf.kind !== "PROFORMA") throw new FeeError("NOT_FOUND");
  if (pf.status === "CONVERTED" && pf.convertedToId) return tx.invoice.findFirstOrThrow({ where: { id: pf.convertedToId, orgId } });
  if (pf.status !== "OPEN") throw new FeeError("NOT_OPEN");
  const cfg = await loadFinanceConfig(tx, orgId);
  const lines: ComputedLine[] = pf.lines.map((l) => ({
    seq: l.seq,
    studentId: l.studentId,
    feeItemId: l.feeItemId,
    kind: l.kind,
    descriptionEn: l.descriptionEn,
    descriptionAr: l.descriptionAr,
    quantity: l.quantity,
    unitFils: l.unitFils,
    grossFils: l.grossFils,
    discountFils: l.discountFils,
    netFils: l.netFils,
    vatTreatment: l.vatTreatment,
    vatRateBp: l.vatRateBp,
    vatFils: l.vatFils,
    totalFils: l.totalFils,
    prorataNum: l.prorataNum,
    prorataDen: l.prorataDen,
    discounts: (l.discounts as ComputedLine["discounts"] | null) ?? [],
  }));
  const due = dubaiDayNumber(pf.dueDate) < dubaiDayNumber(issueDate) ? issueDate : pf.dueDate;
  const inv = await createInvoiceRecord(
    tx,
    orgId,
    cfg,
    {
      kind: "TAX",
      accountId: pf.accountId,
      academicYearId: pf.academicYearId,
      issueDate,
      dueDate: due,
      period: pf.periodStart && pf.periodEnd ? { start: pf.periodStart, end: pf.periodEnd, labelEn: pf.periodLabelEn ?? "", labelAr: pf.periodLabelAr ?? "" } : null,
      lines,
      sourceRef: pf.sourceRef,
      applyCredit: false,
    },
    actor,
  );
  await tx.invoice.update({ where: { id: pf.id }, data: { status: "CONVERTED", convertedToId: inv.id } });
  await logMoney(tx, orgId, actor, "fees.proforma.convert", "Invoice", pf.id, { from: pf.number, to: inv.number });
  return inv;
}

// ---------------------------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------------------------

async function openTaxInvoices(tx: Tx, orgId: string, accountId: string) {
  const rows = await tx.invoice.findMany({
    where: { orgId, accountId, kind: "TAX", status: { in: ["OPEN", "PARTIAL"] } },
    select: { id: true, dueDate: true, issueDate: true, number: true, totalFils: true, paidFils: true, creditedFils: true },
  });
  return rows.map((r) => ({ id: r.id, dueDate: r.dueDate, issueDate: r.issueDate, number: r.number, balanceFils: balanceOf(r) }));
}

async function allocate(tx: Tx, orgId: string, paymentId: string, allocations: Array<{ invoiceId: string; amountFils: number }>) {
  let total = 0;
  for (const a of allocations) {
    if (a.amountFils <= 0) continue;
    await tx.feeAllocation.create({ data: { orgId, invoiceId: a.invoiceId, paymentId, amountFils: a.amountFils } });
    await setInvoiceAmounts(tx, orgId, a.invoiceId, { paid: a.amountFils });
    total += a.amountFils;
  }
  if (total) await tx.feePayment.update({ where: { id: paymentId }, data: { allocatedFils: { increment: total } } });
  return total;
}

/** Money on a payment not yet applied to an invoice or reserved for a refund. */
export function unallocatedOf(p: { amountFils: number; allocatedFils: number; refundedFils: number; status: string }) {
  return p.status === "CLEARED" ? p.amountFils - p.allocatedFils - p.refundedFils : 0;
}

/** Apply the family's unallocated money (overpayments, released allocations) to open invoices, oldest due first. */
export async function applyAccountCredit(tx: Tx, orgId: string, accountId: string, actor: Actor) {
  await lockAccount(tx, orgId, accountId);
  const payments = await tx.feePayment.findMany({ where: { orgId, accountId, status: "CLEARED" }, orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }] });
  let applied = 0;
  for (const p of payments) {
    const free = unallocatedOf(p);
    if (free <= 0) continue;
    const open = await openTaxInvoices(tx, orgId, accountId);
    if (!open.length) break;
    const plan = allocateFifo(free, open);
    applied += await allocate(tx, orgId, p.id, plan.allocations);
  }
  if (applied) await logMoney(tx, orgId, actor, "fees.credit.apply", "FeeAccount", accountId, { amountFils: applied });
  return applied;
}

/** Release up to `amount` of payment allocations from an invoice (latest payments first). Returns the released total. */
async function releasePaymentAllocations(tx: Tx, orgId: string, invoiceId: string, amount: number) {
  if (amount <= 0) return 0;
  const rows = await tx.feeAllocation.findMany({ where: { orgId, invoiceId, paymentId: { not: null } }, orderBy: { createdAt: "desc" } });
  const byPayment = new Map<string, number>();
  for (const r of rows) byPayment.set(r.paymentId!, (byPayment.get(r.paymentId!) ?? 0) + r.amountFils);
  let left = amount;
  for (const r of rows) {
    if (left <= 0) break;
    const pid = r.paymentId!;
    const held = byPayment.get(pid) ?? 0;
    if (held <= 0) continue;
    const take = Math.min(held, left);
    await tx.feeAllocation.create({ data: { orgId, invoiceId, paymentId: pid, amountFils: -take } });
    await tx.feePayment.update({ where: { id: pid }, data: { allocatedFils: { decrement: take } } });
    byPayment.set(pid, held - take);
    left -= take;
  }
  const released = amount - left;
  if (released) await setInvoiceAmounts(tx, orgId, invoiceId, { paid: -released });
  return released;
}

// ---------------------------------------------------------------------------------------------
// Credit notes
// ---------------------------------------------------------------------------------------------

export type CreditNoteInput = {
  invoiceId: string;
  reasonKind: "CORRECTION" | "EARLY_PAYMENT" | "LEAVER" | "DISCOUNT" | "CANCELLATION";
  reasonEn: string;
  reasonAr?: string | null;
  /** Net amount (before VAT) to credit per invoice line. Omit to credit everything still creditable. */
  lines?: Array<{ invoiceLineId: string; netFils: number }>;
  issueDate: Date;
};

/** What is still creditable on each line of an invoice (net and VAT), after earlier credit notes. */
export async function creditableLines(tx: Tx, orgId: string, invoiceId: string) {
  const inv = await tx.invoice.findFirst({ where: { id: invoiceId, orgId }, include: { lines: { orderBy: { seq: "asc" } } } });
  if (!inv) throw new FeeError("NOT_FOUND");
  const prior = await tx.creditNoteLine.findMany({ where: { orgId, invoiceLineId: { in: inv.lines.map((l) => l.id) } } });
  return {
    invoice: inv,
    lines: inv.lines.map((l) => {
      const used = prior.filter((p) => p.invoiceLineId === l.id);
      return { line: l, netLeft: l.netFils - used.reduce((s, p) => s + p.netFils, 0), vatLeft: l.vatFils - used.reduce((s, p) => s + p.vatFils, 0) };
    }),
  };
}

export async function issueCreditNote(tx: Tx, orgId: string, input: CreditNoteInput, actor: Actor) {
  const { invoice, lines } = await creditableLines(tx, orgId, input.invoiceId);
  if (invoice.kind !== "TAX") throw new FeeError("NOT_TAX_INVOICE");
  if (!input.reasonEn.trim()) throw new FeeError("REASON_REQUIRED");
  await lockAccount(tx, orgId, invoice.accountId);
  const wanted = input.lines ?? lines.filter((l) => l.netLeft > 0).map((l) => ({ invoiceLineId: l.line.id, netFils: l.netLeft }));
  const cnLines: Array<{ invoiceLineId: string; descriptionEn: string; descriptionAr: string; netFils: number; vatTreatment: (typeof invoice.lines)[number]["vatTreatment"]; vatRateBp: number; vatFils: number; totalFils: number }> = [];
  for (const w of wanted) {
    const l = lines.find((x) => x.line.id === w.invoiceLineId);
    if (!l) throw new FeeError("LINE_NOT_FOUND");
    if (!Number.isInteger(w.netFils) || w.netFils <= 0) continue;
    if (w.netFils > l.netLeft) throw new FeeError("MORE_THAN_INVOICED");
    // Crediting what is left of a line takes exactly its remaining VAT, so a full credit always matches to the fils.
    const vat = w.netFils === l.netLeft ? l.vatLeft : Math.min(l.vatLeft, vatOf(w.netFils, l.line.vatRateBp));
    cnLines.push({ invoiceLineId: l.line.id, descriptionEn: l.line.descriptionEn, descriptionAr: l.line.descriptionAr, netFils: w.netFils, vatTreatment: l.line.vatTreatment, vatRateBp: l.line.vatRateBp, vatFils: vat, totalFils: w.netFils + vat });
  }
  if (!cnLines.length) throw new FeeError("NOTHING_TO_CREDIT");
  const totals = cnLines.reduce((t, l) => ({ net: t.net + l.netFils, vat: t.vat + l.vatFils, total: t.total + l.totalFils }), { net: 0, vat: 0, total: 0 });
  const fresh = await tx.invoice.findFirstOrThrow({ where: { id: invoice.id, orgId } });
  if (totals.total > fresh.totalFils - fresh.creditedFils) throw new FeeError("MORE_THAN_INVOICED");
  // Make room on the invoice: money already paid against the credited part becomes the family's credit.
  const room = balanceOf(fresh);
  if (room < totals.total) await releasePaymentAllocations(tx, orgId, invoice.id, totals.total - room);
  const cfg = await loadFinanceConfig(tx, orgId);
  const number = await nextDocNumber(tx, orgId, "CN", cfg.creditNotePrefix, input.issueDate);
  const cn = await tx.creditNote.create({
    data: {
      orgId,
      number,
      invoiceId: invoice.id,
      accountId: invoice.accountId,
      issueDate: input.issueDate,
      reasonKind: input.reasonKind,
      reasonEn: input.reasonEn.trim(),
      reasonAr: input.reasonAr?.trim() || null,
      netFils: totals.net,
      vatFils: totals.vat,
      totalFils: totals.total,
      createdById: actor.membershipId,
      lines: { create: cnLines.map((l) => ({ orgId, ...l })) },
    },
  });
  await tx.feeAllocation.create({ data: { orgId, invoiceId: invoice.id, creditNoteId: cn.id, amountFils: totals.total } });
  await setInvoiceAmounts(tx, orgId, invoice.id, { credited: totals.total });
  await logMoney(tx, orgId, actor, "fees.credit_note.issue", "CreditNote", cn.id, { number, invoice: invoice.number, totalFils: totals.total, reasonKind: input.reasonKind });
  return cn;
}

// ---------------------------------------------------------------------------------------------
// Early payment discount
// ---------------------------------------------------------------------------------------------

/**
 * Early payment discount on a tax invoice: a percentage of the tuition on it, when the whole balance is paid on or
 * before the due date minus the configured number of days, and no early payment credit was given yet.
 */
export async function earlyPaymentOffer(tx: Tx, orgId: string, invoiceId: string, at: Date, cfgIn?: FinanceConfig) {
  const cfg = cfgIn ?? (await loadFinanceConfig(tx, orgId));
  if (cfg.earlyPaymentBp <= 0) return null;
  const inv = await tx.invoice.findFirst({ where: { id: invoiceId, orgId }, include: { lines: true } });
  if (!inv || inv.kind !== "TAX" || inv.status !== "OPEN") return null;
  const deadline = new Date(inv.dueDate.getTime() - cfg.earlyPaymentDays * 86_400_000);
  if (dubaiDayNumber(at) > dubaiDayNumber(deadline)) return null;
  if (await tx.creditNote.count({ where: { orgId, invoiceId, reasonKind: "EARLY_PAYMENT" } })) return null;
  const tuition = inv.lines.filter((l) => l.kind === "TUITION" && l.netFils > 0);
  const base = tuition.reduce((s, l) => s + l.netFils, 0);
  const discountNet = bpOf(base, cfg.earlyPaymentBp);
  if (discountNet <= 0) return null;
  // Spread over the tuition lines in proportion (the last line takes the rounding difference).
  let left = discountNet;
  const parts = tuition.map((l, i) => {
    const share = i === tuition.length - 1 ? left : Math.min(left, Math.round((discountNet * l.netFils) / base));
    left -= share;
    return { invoiceLineId: l.id, netFils: share, vat: vatOf(share, l.vatRateBp) };
  });
  const discountTotal = parts.reduce((s, p) => s + p.netFils + p.vat, 0);
  return { deadline, discountFils: discountTotal, payNowFils: balanceOf(inv) - discountTotal, lines: parts.filter((p) => p.netFils > 0).map((p) => ({ invoiceLineId: p.invoiceLineId, netFils: p.netFils })) };
}

// ---------------------------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------------------------

export type RecordPaymentInput = {
  accountId: string;
  method: FeePaymentMethod;
  amountFils: number;
  receivedAt: Date;
  reference?: string | null;
  chequeNumber?: string | null;
  chequeBank?: string | null;
  chequeDate?: Date | null;
  payerName?: string | null;
  notes?: string | null;
  provider?: string;
  externalId?: string | null;
  idempotencyKey: string;
  /** Invoices to pay first, in order (the rest goes oldest due first). */
  invoiceIds?: string[];
  /** Take the early payment discount on this invoice when the payment settles it in full. */
  earlyDiscountInvoiceId?: string | null;
  /** When the family committed to pay (an online payment link's creation time); defaults to receivedAt. */
  earlyAt?: Date | null;
};

function validatePayment(input: RecordPaymentInput) {
  if (!Number.isSafeInteger(input.amountFils) || input.amountFils <= 0) throw new FeeError("AMOUNT_INVALID");
  if (input.amountFils > 100_000_000_00) throw new FeeError("AMOUNT_INVALID");
  if (input.method === "CHEQUE" && (!input.chequeNumber?.trim() || !input.chequeBank?.trim() || !input.chequeDate)) throw new FeeError("CHEQUE_DETAILS");
  if (input.method === "BANK_TRANSFER" && !input.reference?.trim()) throw new FeeError("REFERENCE_REQUIRED");
  if (!input.idempotencyKey || input.idempotencyKey.length > 120) throw new FeeError("IDEMPOTENCY_KEY");
}

/**
 * Record money received. A cheque dated after today is held (post-dated) and allocated when it clears; everything
 * else is cleared at once, gets a receipt number and is allocated. The same idempotency key never records twice.
 */
/** effects: where follow-up side effects go (for example the seat booking email), run by the caller after commit. */
export async function recordPayment(tx: Tx, orgId: string, input: RecordPaymentInput, actor: Actor, effects?: Effect[]) {
  validatePayment(input);
  const existing = await tx.feePayment.findUnique({ where: { orgId_idempotencyKey: { orgId, idempotencyKey: input.idempotencyKey } } });
  if (existing) return { payment: existing, duplicate: true as const, discountFils: 0 };
  await lockAccount(tx, orgId, input.accountId);
  const again = await tx.feePayment.findUnique({ where: { orgId_idempotencyKey: { orgId, idempotencyKey: input.idempotencyKey } } });
  if (again) return { payment: again, duplicate: true as const, discountFils: 0 };
  const held = input.method === "CHEQUE" && input.chequeDate !== null && input.chequeDate !== undefined && dubaiDayNumber(input.chequeDate) > dubaiDayNumber(input.receivedAt);
  const payment = await tx.feePayment.create({
    data: {
      orgId,
      accountId: input.accountId,
      method: input.method,
      provider: input.provider ?? "manual",
      status: held ? "HELD" : "CLEARED",
      amountFils: input.amountFils,
      receivedAt: input.receivedAt,
      reference: input.reference?.trim() || null,
      chequeNumber: input.chequeNumber?.trim() || null,
      chequeBank: input.chequeBank?.trim() || null,
      chequeDate: input.chequeDate ?? null,
      payerName: input.payerName?.trim() || null,
      notes: input.notes?.trim() || null,
      externalId: input.externalId ?? null,
      idempotencyKey: input.idempotencyKey,
      recordedById: actor.membershipId,
    },
  });
  await logMoney(tx, orgId, actor, held ? "fees.payment.hold" : "fees.payment.record", "FeePayment", payment.id, {
    accountId: input.accountId,
    method: input.method,
    amountFils: input.amountFils,
    provider: input.provider ?? "manual",
  });
  if (held) return { payment, duplicate: false as const, discountFils: 0 };
  const res = await clearAndAllocate(tx, orgId, payment.id, input.receivedAt, actor, input.invoiceIds ?? [], input.earlyDiscountInvoiceId ?? null, input.earlyAt ?? null, effects);
  return { payment: res.payment, duplicate: false as const, discountFils: res.discountFils };
}

async function clearAndAllocate(tx: Tx, orgId: string, paymentId: string, clearedAt: Date, actor: Actor, preferredIn: string[], earlyInvoiceId: string | null, earlyAt: Date | null = null, effects?: Effect[]) {
  const cfg = await loadFinanceConfig(tx, orgId);
  let payment = await tx.feePayment.findFirstOrThrow({ where: { id: paymentId, orgId } });
  const number = payment.number ?? (await nextDocNumber(tx, orgId, "RCT", cfg.receiptPrefix, clearedAt));
  payment = await tx.feePayment.update({ where: { id: payment.id }, data: { status: "CLEARED", clearedAt, number } });
  let discountFils = 0;
  if (earlyInvoiceId) {
    const offer = await earlyPaymentOffer(tx, orgId, earlyInvoiceId, earlyAt ?? payment.receivedAt, cfg);
    if (offer && payment.amountFils >= offer.payNowFils) {
      await issueCreditNote(tx, orgId, { invoiceId: earlyInvoiceId, reasonKind: "EARLY_PAYMENT", reasonEn: "Early payment discount", reasonAr: "خصم السداد المبكر", lines: offer.lines, issueDate: clearedAt }, actor);
      discountFils = offer.discountFils;
    }
  }
  let free = unallocatedOf(payment);
  const { preferred, converted } = await convertCoveredProformas(tx, orgId, payment.accountId, preferredIn, actor, clearedAt);
  const open = await openTaxInvoices(tx, orgId, payment.accountId);
  const first = preferred.map((id) => open.find((o) => o.id === id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const firstPlan: Array<{ invoiceId: string; amountFils: number }> = [];
  for (const inv of first) {
    if (free <= 0) break;
    const take = Math.min(free, inv.balanceFils);
    firstPlan.push({ invoiceId: inv.id, amountFils: take });
    free -= take;
  }
  const rest = allocateFifo(free, open.filter((o) => !first.some((f) => f.id === o.id)));
  const plan = [...firstPlan, ...rest.allocations];
  await allocate(tx, orgId, payment.id, plan);
  // A converted proforma was covered by this payment together with credit the family already had: take that too.
  for (const invoiceId of converted) await topUpFromCredit(tx, orgId, payment.accountId, invoiceId);
  await closeSettledLinks(tx, orgId, [...plan.map((a) => a.invoiceId), ...converted]);
  payment = await tx.feePayment.findFirstOrThrow({ where: { id: payment.id, orgId } });
  await settleSeatBookings(tx, orgId, [...plan.map((a) => a.invoiceId), ...converted], clearedAt, actor, effects);
  return { payment, discountFils };
}

/**
 * Online payment links for invoices that are now paid (and for proformas turned into tax invoices) are cancelled, so a
 * family cannot pay twice. A webhook paying a link marks that link PAID right after this.
 */
async function closeSettledLinks(tx: Tx, orgId: string, invoiceIds: string[]) {
  if (!invoiceIds.length) return;
  const paid = await tx.invoice.findMany({ where: { orgId, id: { in: [...new Set(invoiceIds)] }, status: "PAID" }, select: { id: true } });
  const proformas = await tx.invoice.findMany({ where: { orgId, convertedToId: { in: [...new Set(invoiceIds)] } }, select: { id: true } });
  const ids = [...paid, ...proformas].map((i) => i.id);
  if (ids.length) await tx.paymentLink.updateMany({ where: { orgId, status: "OPEN", invoiceId: { in: ids } }, data: { status: "CANCELLED" } });
}

/** Allocate the account's unallocated payments (oldest first) to one invoice, up to its balance. */
async function topUpFromCredit(tx: Tx, orgId: string, accountId: string, invoiceId: string) {
  const inv = await tx.invoice.findFirst({ where: { id: invoiceId, orgId } });
  let need = inv ? balanceOf(inv) : 0;
  if (need <= 0) return;
  const payments = await tx.feePayment.findMany({ where: { orgId, accountId, status: "CLEARED" }, orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }] });
  for (const p of payments) {
    if (need <= 0) break;
    const take = Math.min(unallocatedOf(p), need);
    if (take <= 0) continue;
    await allocate(tx, orgId, p.id, [{ invoiceId, amountFils: take }]);
    need -= take;
  }
}

/**
 * A proforma is a request for payment, not a receivable. When the family's money (this payment plus any credit it
 * already has) covers one in full, it becomes a tax invoice first: the proformas chosen for this payment, or, when
 * the family has no open tax invoice, its oldest proformas. Until then a part payment stays as family credit.
 * Returns the preferred list with proformas replaced by their tax invoices, and the converted invoice ids.
 */
async function convertCoveredProformas(tx: Tx, orgId: string, accountId: string, preferred: string[], actor: Actor, at: Date) {
  const proformas = await tx.invoice.findMany({ where: { orgId, accountId, kind: "PROFORMA", status: "OPEN" }, orderBy: [{ dueDate: "asc" }, { issueDate: "asc" }] });
  if (!proformas.length) return { preferred, converted: [] as string[] };
  const cleared = await tx.feePayment.findMany({ where: { orgId, accountId, status: "CLEARED" }, select: { amountFils: true, allocatedFils: true, refundedFils: true, status: true } });
  const free = cleared.reduce((sum, p) => sum + unallocatedOf(p), 0);
  const chosen = preferred.length
    ? preferred.map((id) => proformas.find((p) => p.id === id)).filter((x): x is NonNullable<typeof x> => Boolean(x))
    : (await openTaxInvoices(tx, orgId, accountId)).length
      ? []
      : proformas;
  const out = [...preferred];
  const converted: string[] = [];
  let left = free;
  for (const pf of chosen) {
    if (pf.totalFils > left) continue;
    const inv = await convertProforma(tx, orgId, pf.id, actor, at);
    left -= pf.totalFils;
    converted.push(inv.id);
    const i = out.indexOf(pf.id);
    if (i >= 0) out[i] = inv.id;
    else out.push(inv.id);
  }
  return { preferred: out, converted };
}

/**
 * A seat booking invoice paid in full moves the application on (admissions registers the handler). Exactly once is
 * the handler's job (markSeatPaid ignores a second call). An admissions error never undoes the payment.
 */
async function settleSeatBookings(tx: Tx, orgId: string, invoiceIds: string[], at: Date, actor: Actor, effects?: Effect[]) {
  const handler = seatPaidHandler();
  if (!handler || !invoiceIds.length) return;
  const paid = await tx.invoice.findMany({
    where: { orgId, id: { in: [...new Set(invoiceIds)] }, kind: "TAX", status: "PAID", sourceRef: { startsWith: SEAT_REF_PREFIX } },
    select: { id: true, number: true, sourceRef: true },
  });
  for (const inv of paid) {
    const applicationId = (inv.sourceRef ?? "").slice(SEAT_REF_PREFIX.length);
    try {
      await handler(execCtx(tx, orgId, { now: at, effects: effects ?? [], actorId: actor.membershipId }), { applicationId, reference: inv.number });
    } catch (e) {
      // Not found, or no longer waiting for the seat payment: the payment stands and nothing else changes.
      console.warn("[fees] seat booking hook skipped", inv.number, e instanceof Error ? e.name : "error");
    }
  }
}

/** A held (post-dated) cheque has been paid in: give the receipt number and allocate it. */
export async function clearCheque(tx: Tx, orgId: string, paymentId: string, clearedAt: Date, actor: Actor, effects?: Effect[]) {
  const p = await tx.feePayment.findFirst({ where: { id: paymentId, orgId } });
  if (!p) throw new FeeError("NOT_FOUND");
  if (p.status !== "HELD") throw new FeeError("NOT_HELD");
  await lockAccount(tx, orgId, p.accountId);
  const res = await clearAndAllocate(tx, orgId, p.id, clearedAt, actor, [], null, null, effects);
  await logMoney(tx, orgId, actor, "fees.payment.clear", "FeePayment", p.id, { amountFils: p.amountFils, number: res.payment.number });
  return res.payment;
}

/** A cheque bounced: its allocations are released (negative rows) and the invoices are owed again. */
export async function bouncePayment(tx: Tx, orgId: string, paymentId: string, reason: string, at: Date, actor: Actor) {
  const p = await tx.feePayment.findFirst({ where: { id: paymentId, orgId } });
  if (!p) throw new FeeError("NOT_FOUND");
  if (p.method !== "CHEQUE") throw new FeeError("NOT_CHEQUE");
  if (p.status === "BOUNCED") throw new FeeError("ALREADY_BOUNCED");
  if (p.refundedFils > 0) throw new FeeError("HAS_REFUNDS");
  if (!reason.trim()) throw new FeeError("REASON_REQUIRED");
  await lockAccount(tx, orgId, p.accountId);
  const rows = await tx.feeAllocation.findMany({ where: { orgId, paymentId: p.id } });
  const perInvoice = new Map<string, number>();
  for (const r of rows) perInvoice.set(r.invoiceId, (perInvoice.get(r.invoiceId) ?? 0) + r.amountFils);
  for (const [invoiceId, amount] of perInvoice) {
    if (amount <= 0) continue;
    await tx.feeAllocation.create({ data: { orgId, invoiceId, paymentId: p.id, amountFils: -amount } });
    await setInvoiceAmounts(tx, orgId, invoiceId, { paid: -amount });
  }
  await tx.feePayment.update({ where: { id: p.id }, data: { status: "BOUNCED", bouncedAt: at, allocatedFils: 0, notes: [p.notes, `Bounced: ${reason.trim()}`].filter(Boolean).join("\n") } });
  await logMoney(tx, orgId, actor, "fees.payment.bounce", "FeePayment", p.id, { amountFils: p.amountFils });
}

// ---------------------------------------------------------------------------------------------
// Refunds (four eyes: the person who asks cannot approve)
// ---------------------------------------------------------------------------------------------

export async function requestRefund(tx: Tx, orgId: string, input: { paymentId: string; amountFils: number; reason: string }, actor: Actor) {
  const p = await tx.feePayment.findFirst({ where: { id: input.paymentId, orgId } });
  if (!p) throw new FeeError("NOT_FOUND");
  if (!input.reason.trim()) throw new FeeError("REASON_REQUIRED");
  if (!Number.isSafeInteger(input.amountFils) || input.amountFils <= 0) throw new FeeError("AMOUNT_INVALID");
  await lockAccount(tx, orgId, p.accountId);
  const fresh = await tx.feePayment.findFirstOrThrow({ where: { id: p.id, orgId } });
  if (input.amountFils > unallocatedOf(fresh)) throw new FeeError("MORE_THAN_CREDIT");
  await tx.feePayment.update({ where: { id: p.id }, data: { refundedFils: { increment: input.amountFils } } });
  const refund = await tx.feeRefund.create({ data: { orgId, accountId: p.accountId, paymentId: p.id, amountFils: input.amountFils, reason: input.reason.trim(), requestedById: actor.membershipId } });
  await logMoney(tx, orgId, actor, "fees.refund.request", "FeeRefund", refund.id, { amountFils: input.amountFils, paymentId: p.id });
  return refund;
}

export async function decideRefund(tx: Tx, orgId: string, refundId: string, approve: boolean, note: string | null, at: Date, actor: Actor) {
  const r = await tx.feeRefund.findFirst({ where: { id: refundId, orgId } });
  if (!r) throw new FeeError("NOT_FOUND");
  if (r.status !== "REQUESTED") throw new FeeError("ALREADY_DECIDED");
  if (actor.membershipId && r.requestedById === actor.membershipId) throw new FeeError("FOUR_EYES");
  await lockAccount(tx, orgId, r.accountId);
  if (!approve) await tx.feePayment.update({ where: { id: r.paymentId }, data: { refundedFils: { decrement: r.amountFils } } });
  await tx.feeRefund.update({ where: { id: r.id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: actor.membershipId, decidedAt: at, decisionNote: note?.trim() || null } });
  await logMoney(tx, orgId, actor, approve ? "fees.refund.approve" : "fees.refund.reject", "FeeRefund", r.id, { amountFils: r.amountFils });
}

export async function markRefundPaid(tx: Tx, orgId: string, refundId: string, input: { method: FeePaymentMethod; reference: string | null; paidAt: Date }, actor: Actor) {
  const r = await tx.feeRefund.findFirst({ where: { id: refundId, orgId } });
  if (!r) throw new FeeError("NOT_FOUND");
  if (r.status !== "APPROVED") throw new FeeError("NOT_APPROVED");
  await lockAccount(tx, orgId, r.accountId);
  const cfg = await loadFinanceConfig(tx, orgId);
  const number = await nextDocNumber(tx, orgId, "RF", cfg.refundPrefix, input.paidAt);
  await tx.feeRefund.update({ where: { id: r.id }, data: { status: "PAID", number, paidAt: input.paidAt, method: input.method, reference: input.reference?.trim() || null } });
  await logMoney(tx, orgId, actor, "fees.refund.paid", "FeeRefund", r.id, { amountFils: r.amountFils, number });
}

// ---------------------------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------------------------

/** Family balance: owed on tax invoices minus unallocated credit. Positive means the family owes the school. */
export async function accountBalance(tx: Pick<Tx, "invoice" | "feePayment">, orgId: string, accountId: string) {
  const [inv, pays] = await Promise.all([
    tx.invoice.aggregate({ where: { orgId, accountId, kind: "TAX", status: { in: ["OPEN", "PARTIAL"] } }, _sum: { totalFils: true, paidFils: true, creditedFils: true } }),
    tx.feePayment.findMany({ where: { orgId, accountId, status: "CLEARED" }, select: { amountFils: true, allocatedFils: true, refundedFils: true, status: true } }),
  ]);
  const owed = (inv._sum.totalFils ?? 0) - (inv._sum.paidFils ?? 0) - (inv._sum.creditedFils ?? 0);
  const credit = pays.reduce((s, p) => s + unallocatedOf(p), 0);
  return { owedFils: owed, creditFils: credit, balanceFils: owed - credit };
}

export const KIND_ORDER: FeeItemKind[] = ["TUITION", "TRANSPORT", "REGISTRATION", "REENROLLMENT", "SEAT_DEPOSIT", "BOOKS", "UNIFORM", "TRIP", "EXAM", "OTHER"];
