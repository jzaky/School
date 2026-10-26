"use server";

// Server actions for Finance. Every action checks its permission, runs in a tenant transaction, and the services
// write the audit events. Amounts arrive as integers of fils.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { DiscountMethod, FeeDiscountKind, FeeItemKind, FeePayerType, FeePaymentMethod, InstalmentPlanKind, VatTreatment } from "@prisma/client";
import { getCtx, type Ctx } from "@/server/context";
import type { Permission } from "@/server/identity/permissions";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { recordManualPayment } from "@/server/payments/manual";
import { consoleSignedEvent, testCheckoutAllowed } from "@/server/payments/providers";
import { createPaymentLink, handlePaymentWebhook } from "@/server/payments/links";
import { bouncePayment, cancelProforma, clearCheque, creditableLines, decideRefund, FeeError, issueCreditNote, issueInvoice, markRefundPaid, requestRefund, applyAccountCredit, type Actor } from "./ledger";
import { billAccount, createBillingRun, partWithShare } from "./billing";
import { kickBillingRun } from "./jobs";
import { copySchedule, decideAward, deleteFeeItem, requestAward, revokeAward, saveDiscount, saveFeeItem, saveFinanceSettings, savePlan, suggestParts, type SettingsInput } from "./schedule";
import { setStudentProfile, syncFamilyAccounts, updateAccount, type AccountUpdate } from "./accounts";
import { notifyApprovers, notifyInvoiceIssued, notifyReceipt, sendInvoiceReminder } from "./notices";
import { parentAccountIds } from "./accounts";
import { dubaiDayNumber, leaverCredit, prorataFraction } from "./money";
import { loadFinanceConfig } from "./config";

export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A calendar day in Dubai (midnight local time). */
const dayAt = (key: string) => new Date(`${key}T00:00:00+04:00`);
const actorOf = (ctx: Ctx): Actor => ({ membershipId: ctx.membershipId, userId: ctx.user.id });

async function guard(p: Permission): Promise<Ctx | null> {
  const ctx = await getCtx();
  return ctx.isStaff && ctx.can(p) ? ctx : null;
}

async function run<T>(ctx: Ctx, fn: (ec: ReturnType<typeof execCtx>) => Promise<T>, timeout = 60_000): Promise<T> {
  const effects: Effect[] = [];
  const out = await tenantTx(ctx.orgId, (tx) => fn(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId })), { timeout });
  await flushEffects(effects);
  return out;
}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof FeeError) return { ok: false, error: e.code };
  if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") return { ok: false, error: "DUPLICATE" };
  throw e;
}

function done<T extends object = object>(extra?: T): Result<T> {
  revalidatePath("/", "layout");
  return { ok: true, ...(extra ?? ({} as T)) };
}

// ---------------------------------------------------------------------------------------------
// Setup (fees.manage)
// ---------------------------------------------------------------------------------------------

export type FeeItemForm = { id: string | null; academicYearId: string; code: string; kind: FeeItemKind; nameEn: string; nameAr: string; amountFils: number; gradeLevels: number[]; zone: string; recurring: boolean; proRata: boolean; discountable: boolean; autoBill: boolean; vatTreatment: VatTreatment; active: boolean };

export async function saveFeeItemAction(input: FeeItemForm): Promise<Result> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, (ec) => saveFeeItem(ec.tx, ctx.orgId, { ...input, zone: input.zone || null }, actorOf(ctx)));
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function deleteFeeItemAction(id: string): Promise<Result<{ deleted: boolean }>> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    const r = await run(ctx, (ec) => deleteFeeItem(ec.tx, ctx.orgId, id, actorOf(ctx)));
    return done(r);
  } catch (e) {
    return fail(e);
  }
}

export async function copyScheduleAction(input: { fromYearId: string; toYearId: string; changeBp: number }): Promise<Result<{ items: number; plans: number }>> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    const r = await run(ctx, (ec) => copySchedule(ec.tx, ctx.orgId, input, actorOf(ctx)));
    return done(r);
  } catch (e) {
    return fail(e);
  }
}

export type PlanForm = { id: string | null; academicYearId: string; key: string; nameEn: string; nameAr: string; kind: InstalmentPlanKind; isDefault: boolean; active: boolean; parts: Array<{ labelEn: string; labelAr: string; dueDate: string; periodStart: string; periodEnd: string; shareBp: number }> };

export async function savePlanAction(input: PlanForm): Promise<Result> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  if (input.parts.some((p) => !KEY_RE.test(p.dueDate) || !KEY_RE.test(p.periodStart) || !KEY_RE.test(p.periodEnd))) return { ok: false, error: "INVALID_DATES" };
  try {
    await run(ctx, (ec) =>
      savePlan(ec.tx, ctx.orgId, { ...input, parts: input.parts.map((p) => ({ labelEn: p.labelEn, labelAr: p.labelAr, shareBp: p.shareBp, dueDate: dayAt(p.dueDate), periodStart: dayAt(p.periodStart), periodEnd: dayAt(p.periodEnd) })) }, actorOf(ctx)),
    );
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Suggested instalments for a plan kind from the year's terms (fills the plan dialog). */
export async function suggestPartsAction(input: { academicYearId: string; kind: InstalmentPlanKind }): Promise<Result<{ parts: PlanForm["parts"] }>> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const year = await ctx.db.academicYear.findFirst({ where: { id: input.academicYearId }, include: { terms: true } });
  if (!year) return { ok: false, error: "YEAR_NOT_FOUND" };
  const key = (d: Date) => new Date(d.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
  const parts = suggestParts(input.kind, year, year.terms).map((p) => ({ labelEn: p.labelEn, labelAr: p.labelAr, shareBp: p.shareBp, dueDate: key(p.dueDate), periodStart: key(p.periodStart), periodEnd: key(p.periodEnd) }));
  return { ok: true, parts };
}

export type DiscountForm = { id: string | null; code: string; kind: FeeDiscountKind; nameEn: string; nameAr: string; method: DiscountMethod; percentBp: number | null; amountFils: number | null; requiresApproval: boolean; active: boolean };

export async function saveDiscountAction(input: DiscountForm): Promise<Result> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, (ec) => saveDiscount(ec.tx, ctx.orgId, input, actorOf(ctx)));
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function saveFinanceSettingsAction(input: SettingsInput): Promise<Result> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, (ec) => saveFinanceSettings(ec.tx, ctx.orgId, input, actorOf(ctx)));
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function syncAccountsAction(): Promise<Result<{ created: number; attached: number }>> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    const r = await run(ctx, (ec) => syncFamilyAccounts(ec.tx, ctx.orgId, actorOf(ctx)), 180_000);
    return done(r);
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Family accounts (fees.manage)
// ---------------------------------------------------------------------------------------------

export async function updateAccountAction(accountId: string, input: AccountUpdate & { payerType: FeePayerType }): Promise<Result> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, (ec) => updateAccount(ec.tx, ctx.orgId, accountId, input, actorOf(ctx)));
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function setStudentProfileAction(input: { studentId: string; accountId: string; transportZone: string | null }): Promise<Result> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, (ec) => setStudentProfile(ec.tx, ctx.orgId, input, actorOf(ctx)));
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function addChargeAction(input: { accountId: string; studentId: string | null; feeItemId: string; quantity: number; unitFils: number; descriptionEn: string; descriptionAr: string; invoiceNow: boolean }): Promise<Result<{ invoiceId?: string }>> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100 || !Number.isSafeInteger(input.unitFils) || input.unitFils <= 0) return { ok: false, error: "AMOUNT_INVALID" };
  try {
    const r = await run(ctx, async (ec) => {
      const [acc, item] = await Promise.all([ec.tx.feeAccount.findFirst({ where: { id: input.accountId, orgId: ctx.orgId } }), ec.tx.feeItem.findFirst({ where: { id: input.feeItemId, orgId: ctx.orgId, active: true } })]);
      if (!acc || !item) throw new FeeError("NOT_FOUND");
      if (input.studentId && !(await ec.tx.studentFeeProfile.findFirst({ where: { orgId: ctx.orgId, studentId: input.studentId, accountId: acc.id } }))) throw new FeeError("NOT_FOUND");
      const charge = await ec.tx.feeCharge.create({ data: { orgId: ctx.orgId, accountId: acc.id, studentId: input.studentId, feeItemId: item.id, quantity: input.quantity, unitFils: input.unitFils, descriptionEn: input.descriptionEn.trim() || null, descriptionAr: input.descriptionAr.trim() || null, createdById: ctx.membershipId } });
      await ec.tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "fees.charge.add", entityType: "FeeCharge", entityId: charge.id, meta: { item: item.code, quantity: input.quantity, unitFils: input.unitFils } } });
      if (!input.invoiceNow) return {};
      const student = input.studentId ? await ec.tx.student.findFirst({ where: { id: input.studentId, orgId: ctx.orgId } }) : null;
      const cfg = await loadFinanceConfig(ec.tx, ctx.orgId);
      const who = student ? { en: `: ${student.firstNameEn} ${student.lastNameEn}`, ar: `: ${student.firstNameAr} ${student.lastNameAr}` } : { en: "", ar: "" };
      const inv = await issueInvoice(
        ec.tx,
        ctx.orgId,
        {
          kind: "TAX",
          accountId: acc.id,
          academicYearId: item.academicYearId,
          issueDate: ec.now,
          dueDate: new Date(ec.now.getTime() + cfg.paymentTermsDays * 86_400_000),
          lines: [{ studentId: input.studentId, feeItemId: item.id, kind: item.kind, descriptionEn: `${input.descriptionEn.trim() || item.nameEn}${who.en}`, descriptionAr: `${input.descriptionAr.trim() || item.nameAr}${who.ar}`, quantity: input.quantity, unitFils: input.unitFils, vatTreatment: item.vatTreatment }],
          chargeIds: [charge.id],
        },
        actorOf(ctx),
        cfg,
      );
      await notifyInvoiceIssued(ec, inv);
      return { invoiceId: inv.id };
    });
    return done(r);
  } catch (e) {
    return fail(e);
  }
}

export async function removeChargeAction(chargeId: string): Promise<Result> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, async (ec) => {
      const c = await ec.tx.feeCharge.findFirst({ where: { id: chargeId, orgId: ctx.orgId, invoiceId: null } });
      if (!c) throw new FeeError("NOT_FOUND");
      await ec.tx.feeCharge.delete({ where: { id: c.id } });
      await ec.tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "fees.charge.remove", entityType: "FeeCharge", entityId: c.id, meta: { unitFils: c.unitFils, quantity: c.quantity } } });
    });
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Bill one family for one instalment now (for example a family that joined after the billing run). */
export async function billFamilyAction(input: { accountId: string; partId: string; dueDate: string }): Promise<Result<{ invoiceId: string | null }>> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  if (!KEY_RE.test(input.dueDate)) return { ok: false, error: "INVALID_DATES" };
  try {
    const r = await run(ctx, async (ec) => {
      const { part, plan } = await partWithShare(ec.tx, ctx.orgId, input.partId);
      const already = await ec.tx.invoice.findFirst({ where: { orgId: ctx.orgId, accountId: input.accountId, planPartId: part.id, kind: "TAX", status: { not: "CREDITED" } } });
      if (already) throw new FeeError("ALREADY_BILLED");
      const inv = await billAccount(ec.tx, ctx.orgId, { accountId: input.accountId, part, issueDate: ec.now, dueDate: dayAt(input.dueDate), includeCharges: true, academicYearId: plan.academicYearId }, actorOf(ctx));
      if (inv) await notifyInvoiceIssued(ec, inv);
      return { invoiceId: inv?.id ?? null };
    });
    if (!r.invoiceId) return { ok: false, error: "NOTHING_TO_BILL" };
    return done(r);
  } catch (e) {
    return fail(e);
  }
}

export async function requestAwardAction(input: { studentId: string; discountId: string; academicYearId: string; reason: string }): Promise<Result> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, async (ec) => {
      const a = await requestAward(ec.tx, ctx.orgId, input, actorOf(ctx));
      if (a.status === "PENDING") {
        const d = await ec.tx.feeDiscount.findFirstOrThrow({ where: { id: a.discountId, orgId: ctx.orgId } });
        await notifyApprovers(ec, { kind: "award", id: a.id, requesterId: ctx.membershipId, amountFils: d.amountFils, what: { en: d.nameEn, ar: d.nameAr } });
      }
    });
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function revokeAwardAction(awardId: string): Promise<Result> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, (ec) => revokeAward(ec.tx, ctx.orgId, awardId, actorOf(ctx)));
    return done();
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Billing runs (fees.manage)
// ---------------------------------------------------------------------------------------------

export async function startBillingRunAction(input: { partId: string; issueDate: string; dueDate: string; includeCharges: boolean }): Promise<Result<{ runId: string }>> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  if (!KEY_RE.test(input.issueDate) || !KEY_RE.test(input.dueDate)) return { ok: false, error: "INVALID_DATES" };
  if (dubaiDayNumber(dayAt(input.dueDate)) < dubaiDayNumber(dayAt(input.issueDate))) return { ok: false, error: "DUE_BEFORE_ISSUE" };
  try {
    const { run: r, effect } = await tenantTx(ctx.orgId, (tx) => createBillingRun(tx, ctx.orgId, { partId: input.partId, issueDate: dayAt(input.issueDate), dueDate: dayAt(input.dueDate), includeCharges: input.includeCharges }, actorOf(ctx)));
    await kickBillingRun(ctx.orgId, r.id, effect);
    return done({ runId: r.id });
  } catch (e) {
    return fail(e);
  }
}

export async function cancelBillingRunAction(runId: string): Promise<Result> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const n = await tenantTx(ctx.orgId, async (tx) => {
    const res = await tx.billingRun.updateMany({ where: { id: runId, orgId: ctx.orgId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED", finishedAt: new Date() } });
    if (res.count) await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "fees.billing_run.cancel", entityType: "BillingRun", entityId: runId } });
    return res.count;
  });
  if (!n) return { ok: false, error: "NOT_RUNNING" };
  return done();
}

// ---------------------------------------------------------------------------------------------
// Invoices and credit notes
// ---------------------------------------------------------------------------------------------

export async function issueCreditNoteAction(input: { invoiceId: string; reasonKind: "CORRECTION" | "DISCOUNT" | "LEAVER" | "CANCELLATION"; reasonEn: string; reasonAr: string; lines: Array<{ invoiceLineId: string; netFils: number }> | null }): Promise<Result<{ creditNoteId: string }>> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    const cn = await run(ctx, (ec) => issueCreditNote(ec.tx, ctx.orgId, { invoiceId: input.invoiceId, reasonKind: input.reasonKind, reasonEn: input.reasonEn, reasonAr: input.reasonAr, lines: input.lines ?? undefined, issueDate: ec.now }, actorOf(ctx)));
    return done({ creditNoteId: cn.id });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Leaver credit: for a child leaving on a date, credit the unused part of every pro rata line on their open-period
 * invoices (worked out with the school's pro rata rule).
 */
export async function leaverCreditAction(input: { studentId: string; leftOn: string }): Promise<Result<{ notes: number; totalFils: number }>> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  if (!KEY_RE.test(input.leftOn)) return { ok: false, error: "INVALID_DATES" };
  const left = dayAt(input.leftOn);
  try {
    const r = await run(ctx, async (ec) => {
      const cfg = await loadFinanceConfig(ec.tx, ctx.orgId);
      const student = await ec.tx.student.findFirst({ where: { id: input.studentId, orgId: ctx.orgId } });
      if (!student) throw new FeeError("NOT_FOUND");
      const lines = await ec.tx.invoiceLine.findMany({ where: { orgId: ctx.orgId, studentId: student.id, kind: { in: ["TUITION", "TRANSPORT"] }, invoice: { kind: "TAX", periodEnd: { gte: left } } }, include: { invoice: true } });
      const items = await ec.tx.feeItem.findMany({ where: { orgId: ctx.orgId, id: { in: lines.map((l) => l.feeItemId).filter((x): x is string => Boolean(x)) } } });
      const byInvoice = new Map<string, Array<{ invoiceLineId: string; netFils: number }>>();
      for (const l of lines) {
        const item = items.find((i) => i.id === l.feeItemId);
        if (!item?.proRata || !l.invoice.periodStart || !l.invoice.periodEnd) continue;
        const kept = prorataFraction({ start: l.invoice.periodStart, end: l.invoice.periodEnd }, student.enrolledOn, left, { basis: cfg.proRataBasis, cutoffDay: cfg.proRataCutoffDay });
        // Compare on the line's own scale: kept units out of the units it was billed for.
        const keptOnLine = kept.den === l.prorataDen ? kept.num : Math.round((kept.num * l.prorataDen) / kept.den);
        const credit = leaverCredit(l.netFils, l.prorataNum, keptOnLine);
        const left2 = (await creditableLines(ec.tx, ctx.orgId, l.invoiceId)).lines.find((x) => x.line.id === l.id)?.netLeft ?? 0;
        const amount = Math.min(credit, left2);
        if (amount <= 0) continue;
        if (!byInvoice.has(l.invoiceId)) byInvoice.set(l.invoiceId, []);
        byInvoice.get(l.invoiceId)!.push({ invoiceLineId: l.id, netFils: amount });
      }
      let total = 0;
      for (const [invoiceId, cl] of byInvoice) {
        const cn = await issueCreditNote(ec.tx, ctx.orgId, { invoiceId, reasonKind: "LEAVER", reasonEn: `Pro rata credit: ${student.firstNameEn} ${student.lastNameEn} leaves on ${input.leftOn}`, reasonAr: `رصيد بالتناسب: مغادرة ${student.firstNameAr} ${student.lastNameAr} بتاريخ ${input.leftOn}`, lines: cl, issueDate: ec.now }, actorOf(ctx));
        total += cn.totalFils;
      }
      return { notes: byInvoice.size, totalFils: total };
    });
    if (!r.notes) return { ok: false, error: "NOTHING_TO_CREDIT" };
    return done(r);
  } catch (e) {
    return fail(e);
  }
}

export async function cancelProformaAction(invoiceId: string): Promise<Result> {
  const ctx = await guard("fees.manage");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, (ec) => cancelProforma(ec.tx, ctx.orgId, invoiceId, actorOf(ctx)));
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function sendReminderAction(invoiceId: string): Promise<Result> {
  const ctx = await guard("fees.collect");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    const sent = await run(ctx, (ec) => sendInvoiceReminder(ec, invoiceId, `manual-${new Date(ec.now.getTime() + 4 * 3_600_000).toISOString().slice(0, 10)}`, { manual: true }));
    if (!sent) return { ok: false, error: "REMINDER_NOT_SENT" };
    return done();
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Payments (fees.collect)
// ---------------------------------------------------------------------------------------------

export type PaymentForm = { accountId: string; method: FeePaymentMethod; amountFils: number; receivedOn: string; reference: string; chequeNumber: string; chequeBank: string; chequeDate: string; payerName: string; notes: string; idempotencyKey: string; invoiceId: string | null; takeEarlyDiscount: boolean };

export async function recordPaymentAction(input: PaymentForm): Promise<Result<{ paymentId: string; held: boolean; duplicate: boolean }>> {
  const ctx = await guard("fees.collect");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  if (!KEY_RE.test(input.receivedOn) || (input.chequeDate && !KEY_RE.test(input.chequeDate))) return { ok: false, error: "INVALID_DATES" };
  const today = new Date();
  const received = dayAt(input.receivedOn);
  if (dubaiDayNumber(received) > dubaiDayNumber(today)) return { ok: false, error: "RECEIVED_IN_FUTURE" };
  // Payments received today keep the time; earlier dates are recorded at Dubai noon of that day.
  const receivedAt = dubaiDayNumber(received) === dubaiDayNumber(today) ? today : new Date(received.getTime() + 12 * 3_600_000);
  try {
    const r = await run(ctx, async (ec) => {
      const res = await recordManualPayment(
        ec.tx,
        ctx.orgId,
        {
          accountId: input.accountId,
          method: input.method,
          amountFils: input.amountFils,
          receivedAt,
          reference: input.reference,
          chequeNumber: input.method === "CHEQUE" ? input.chequeNumber : null,
          chequeBank: input.method === "CHEQUE" ? input.chequeBank : null,
          chequeDate: input.method === "CHEQUE" && input.chequeDate ? dayAt(input.chequeDate) : null,
          payerName: input.payerName,
          notes: input.notes,
          idempotencyKey: `manual:${input.idempotencyKey}`,
          invoiceIds: input.invoiceId ? [input.invoiceId] : [],
          earlyDiscountInvoiceId: input.takeEarlyDiscount ? input.invoiceId : null,
        },
        actorOf(ctx),
        ec.effects,
      );
      if (!res.duplicate && res.payment.status === "CLEARED") await notifyReceipt(ec, res.payment);
      return { paymentId: res.payment.id, held: res.payment.status === "HELD", duplicate: res.duplicate };
    });
    return done(r);
  } catch (e) {
    return fail(e);
  }
}

export async function clearChequeAction(paymentId: string, clearedOn: string): Promise<Result> {
  const ctx = await guard("fees.collect");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  if (!KEY_RE.test(clearedOn)) return { ok: false, error: "INVALID_DATES" };
  try {
    await run(ctx, async (ec) => {
      const p = await clearCheque(ec.tx, ctx.orgId, paymentId, new Date(dayAt(clearedOn).getTime() + 12 * 3_600_000), actorOf(ctx), ec.effects);
      await notifyReceipt(ec, p);
    });
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function bounceChequeAction(paymentId: string, reason: string): Promise<Result> {
  const ctx = await guard("fees.collect");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, (ec) => bouncePayment(ec.tx, ctx.orgId, paymentId, reason, ec.now, actorOf(ctx)));
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function applyCreditAction(accountId: string): Promise<Result<{ appliedFils: number }>> {
  const ctx = await guard("fees.collect");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    const appliedFils = await run(ctx, (ec) => applyAccountCredit(ec.tx, ctx.orgId, accountId, actorOf(ctx)));
    if (!appliedFils) return { ok: false, error: "NOTHING_TO_APPLY" };
    return done({ appliedFils });
  } catch (e) {
    return fail(e);
  }
}

export async function requestRefundAction(input: { paymentId: string; amountFils: number; reason: string }): Promise<Result> {
  const ctx = await guard("fees.collect");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, async (ec) => {
      const r = await requestRefund(ec.tx, ctx.orgId, input, actorOf(ctx));
      await notifyApprovers(ec, { kind: "refund", id: r.id, requesterId: ctx.membershipId, amountFils: r.amountFils, what: { en: "a refund", ar: "استردادًا" } });
    });
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function markRefundPaidAction(input: { refundId: string; method: FeePaymentMethod; reference: string; paidOn: string }): Promise<Result> {
  const ctx = await guard("fees.collect");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  if (!KEY_RE.test(input.paidOn)) return { ok: false, error: "INVALID_DATES" };
  try {
    await run(ctx, (ec) => markRefundPaid(ec.tx, ctx.orgId, input.refundId, { method: input.method, reference: input.reference, paidAt: new Date(dayAt(input.paidOn).getTime() + 12 * 3_600_000) }, actorOf(ctx)));
    return done();
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Approvals (fees.refund.approve): refunds, scholarships and bursaries. Never your own request.
// ---------------------------------------------------------------------------------------------

export async function decideRefundAction(refundId: string, approve: boolean, note: string): Promise<Result> {
  const ctx = await guard("fees.refund.approve");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, (ec) => decideRefund(ec.tx, ctx.orgId, refundId, approve, note, ec.now, actorOf(ctx)));
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function decideAwardAction(awardId: string, approve: boolean, note: string): Promise<Result> {
  const ctx = await guard("fees.refund.approve");
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, (ec) => decideAward(ec.tx, ctx.orgId, awardId, approve, note, ec.now, actorOf(ctx)));
    return done();
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Parents: pay online, and the built-in test checkout
// ---------------------------------------------------------------------------------------------

async function parentInvoice(ctx: Ctx, invoiceId: string) {
  if (!ctx.isParent || !ctx.can("family.portal")) return null;
  const ids = await parentAccountIds(ctx.db, ctx);
  const inv = await ctx.db.invoice.findFirst({ where: { id: invoiceId, accountId: { in: ids } } });
  return inv;
}

export async function payOnlineAction(invoiceId: string): Promise<Result<{ url: string; test: boolean }>> {
  const ctx = await getCtx();
  const inv = await parentInvoice(ctx, invoiceId);
  if (!inv) return { ok: false, error: "FORBIDDEN" };
  const h = await headers();
  const base = process.env.APP_URL || process.env.AUTH_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const res = await createPaymentLink(ctx.orgId, { invoiceId: inv.id, locale: ctx.locale, baseUrl: base, createdById: ctx.membershipId });
  if (!res.ok) return res;
  return { ok: true, url: res.url, test: res.test };
}

/** Test checkout result: signed like a provider webhook and handled by the same webhook code. */
export async function completeTestPaymentAction(linkId: string, outcome: "paid" | "failed"): Promise<Result<{ result: string }>> {
  const ctx = await getCtx();
  if (!ctx.isParent || !testCheckoutAllowed(ctx.org.isDemo)) return { ok: false, error: "FORBIDDEN" };
  const link = await ctx.db.paymentLink.findFirst({ where: { id: String(linkId), provider: "console", status: "OPEN" } });
  if (!link || !link.invoiceId || !(await parentInvoice(ctx, link.invoiceId))) return { ok: false, error: "NOT_FOUND" };
  const now = new Date();
  const { body, signature } = consoleSignedEvent({ type: outcome === "paid" ? "payment.succeeded" : "payment.failed", orgId: ctx.orgId, linkId: link.id, amountFils: link.amountFils, currency: link.currency }, now);
  const res = await handlePaymentWebhook("console", body, new Headers({ "x-horizon-signature": signature }), now);
  if (res.status !== 200) return { ok: false, error: "PROVIDER_ERROR" };
  return done({ result: res.body.result });
}
