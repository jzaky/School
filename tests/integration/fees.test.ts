// Fees and invoicing against real Postgres through the RLS-restricted app role: gapless numbering under
// concurrency, invoice maths end to end, allocation of partial payments and overpayments, credit notes,
// post-dated and bounced cheques, refunds with four eyes, billing runs in batches, webhook idempotency,
// immutability of issued invoices and tenant isolation of every fee table.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { accountBalance, bouncePayment, clearCheque, decideRefund, earlyPaymentOffer, FeeError, issueCreditNote, issueInvoice, markRefundPaid, recordPayment, requestRefund } from "@/server/fees/ledger";
import { billAccount, createBillingRun, partWithShare, processBillingBatch } from "@/server/fees/billing";
import { saveFeeItem, savePlan } from "@/server/fees/schedule";
import { syncFamilyAccounts, parentAccountIds } from "@/server/fees/accounts";
import { sendDueFeeReminders } from "@/server/fees/notices";
import { createSeatBookingCharge, feesSeatBookingProvider } from "@/server/fees/seat-booking";
import { registerSeatPaidHandler } from "@/server/fees/hooks";
import { handlePaymentWebhook } from "@/server/payments/links";
import { consoleSecret, consoleSignedEvent } from "@/server/payments/providers";
import { signPayload } from "@/server/payments/signature";
import type { OnlineProvider } from "@/server/payments/types";
import { ownerClient, uid } from "./helpers";

let owner: PrismaClient;
const A = { orgId: "", yearId: "", accountId: "", guardianId: "", guardianMember: "", staff1: "", staff2: "", kids: [] as string[], termPart: "" };
let otherOrg = "";
const actor = () => ({ membershipId: A.staff1, userId: null });
const tx = <T>(fn: Parameters<typeof tenantTx<T>>[1]) => tenantTx(A.orgId, fn, { timeout: 60_000 });
const DAY = 86_400_000;
const now = new Date();

async function makeSchool(label: string) {
  const org = await owner.organization.create({ data: { slug: uid(`fees-${label}`), nameEn: `Fees School ${label}`, nameAr: `مدرسة الرسوم ${label}`, emirate: "Sharjah" } });
  return org.id;
}

beforeAll(async () => {
  owner = ownerClient();
  A.orgId = await makeSchool("a");
  otherOrg = await makeSchool("b");
  const y0 = new Date(now.getTime() - 60 * DAY);
  const year = await owner.academicYear.create({ data: { orgId: A.orgId, nameEn: "This year", nameAr: "هذا العام", startsOn: y0, endsOn: new Date(y0.getTime() + 300 * DAY), isCurrent: true } });
  A.yearId = year.id;
  await owner.financeSettings.create({ data: { orgId: A.orgId, legalNameEn: "Fees School A LLC", legalNameAr: "مدرسة الرسوم أ ذ.م.م", addressEn: "Al Qasimia, Sharjah", addressAr: "القاسمية، الشارقة", trn: "100000000000003", earlyPaymentBp: 200, earlyPaymentDays: 7 } });
  const mkUser = async (n: string) => owner.user.create({ data: { email: `${uid(n)}@fees.test`, nameEn: n } });
  const s1 = await owner.membership.create({ data: { orgId: A.orgId, userId: (await mkUser("staff1")).id } });
  const s2 = await owner.membership.create({ data: { orgId: A.orgId, userId: (await mkUser("staff2")).id } });
  const gm = await owner.membership.create({ data: { orgId: A.orgId, userId: (await mkUser("parent")).id } });
  A.staff1 = s1.id;
  A.staff2 = s2.id;
  A.guardianMember = gm.id;
  const g = await owner.guardian.create({ data: { orgId: A.orgId, membershipId: gm.id, firstNameEn: "Rana", lastNameEn: "Test", firstNameAr: "رنا", lastNameAr: "اختبار", email: "rana@fees.test" } });
  A.guardianId = g.id;
  for (const [i, grade] of [9, 4, -1].entries()) {
    const s = await owner.student.create({ data: { orgId: A.orgId, studentNo: uid("S"), firstNameEn: `Kid${i}`, lastNameEn: "Test", firstNameAr: `طفل${i}`, lastNameAr: "اختبار", gradeLevel: grade, dateOfBirth: new Date(Date.UTC(2010 + i * 4, 0, 1)), enrolledOn: new Date(y0.getTime() - 400 * DAY) } });
    await owner.guardianLink.create({ data: { orgId: A.orgId, guardianId: g.id, studentId: s.id, isPrimary: true } });
    A.kids.push(s.id);
  }
  // Fee items: tuition for grades 9, 4 and KG1, transport zone A.
  await tx(async (t) => {
    for (const [code, g, amount] of [["T9", 9, 3_000_000], ["T4", 4, 2_200_000], ["TKG1", -1, 1_600_000]] as const) {
      await saveFeeItem(t, A.orgId, { academicYearId: A.yearId, code, kind: "TUITION", nameEn: `Tuition ${code}`, nameAr: `رسوم ${code}`, amountFils: amount, gradeLevels: [g], zone: null, recurring: true, proRata: true, discountable: true, autoBill: true, vatTreatment: "ZERO_RATED", active: true }, actor());
    }
    await saveFeeItem(t, A.orgId, { academicYearId: A.yearId, code: "BUS-A", kind: "TRANSPORT", nameEn: "Bus zone A", nameAr: "حافلة أ", amountFils: 600_000, gradeLevels: [], zone: "A", recurring: true, proRata: true, discountable: false, autoBill: true, vatTreatment: "STANDARD", active: true }, actor());
    const p0 = new Date(now.getTime() - 30 * DAY);
    await savePlan(
      t,
      A.orgId,
      {
        academicYearId: A.yearId,
        key: "termly",
        nameEn: "Termly",
        nameAr: "فصلي",
        kind: "TERMLY",
        isDefault: true,
        active: true,
        parts: [
          { labelEn: "Term 1", labelAr: "الفصل 1", dueDate: new Date(now.getTime() + 20 * DAY), periodStart: p0, periodEnd: new Date(p0.getTime() + 100 * DAY), shareBp: 4000 },
          { labelEn: "Term 2", labelAr: "الفصل 2", dueDate: new Date(now.getTime() + 120 * DAY), periodStart: new Date(p0.getTime() + 101 * DAY), periodEnd: new Date(p0.getTime() + 190 * DAY), shareBp: 3000 },
          { labelEn: "Term 3", labelAr: "الفصل 3", dueDate: new Date(now.getTime() + 200 * DAY), periodStart: new Date(p0.getTime() + 191 * DAY), periodEnd: new Date(p0.getTime() + 280 * DAY), shareBp: 3000 },
        ],
      },
      actor(),
    );
    const res = await syncFamilyAccounts(t, A.orgId, actor());
    expect(res).toEqual({ created: 1, attached: 3 });
  });
  const acc = await owner.feeAccount.findFirstOrThrow({ where: { orgId: A.orgId } });
  A.accountId = acc.id;
  await owner.studentFeeProfile.update({ where: { studentId: A.kids[0] }, data: { transportZone: "A" } });
  const plan = await owner.instalmentPlan.findFirstOrThrow({ where: { orgId: A.orgId }, include: { parts: { orderBy: { seq: "asc" } } } });
  A.termPart = plan.parts[0].id;
}, 120_000);

afterAll(async () => {
  await owner.$disconnect();
});

describe("gapless numbering", () => {
  it("gives consecutive invoice numbers under concurrency, with no gap after a rolled back issue", async () => {
    const line = { studentId: null, feeItemId: null, kind: "OTHER" as const, descriptionEn: "Test", descriptionAr: "اختبار", quantity: 1, unitFils: 1000, vatTreatment: "ZERO_RATED" as const };
    const issue = () => tx((t) => issueInvoice(t, A.orgId, { kind: "TAX", accountId: A.accountId, issueDate: now, dueDate: now, lines: [line], applyCredit: false }, actor()));
    // One issue fails after taking its number: the whole transaction, counter included, rolls back.
    await expect(
      tx(async (t) => {
        await issueInvoice(t, A.orgId, { kind: "TAX", accountId: A.accountId, issueDate: now, dueDate: now, lines: [line], applyCredit: false }, actor());
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const made = await Promise.all(Array.from({ length: 12 }, () => issue()));
    const nums = made.map((m) => Number(m.number.split("-").pop())).sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(new Set(made.map((m) => m.number)).size).toBe(12);
    // Tidy up with credit notes (invoices are never deleted).
    for (const m of made) await tx((t) => issueCreditNote(t, A.orgId, { invoiceId: m.id, reasonKind: "CANCELLATION", reasonEn: "Test invoice", issueDate: now }, actor()));
  });
});

describe("billing one family", () => {
  let invoiceId = "";
  it("bills tuition per grade with sibling discounts, transport with VAT, eldest child first", async () => {
    const inv = await tx(async (t) => {
      const { part } = await partWithShare(t, A.orgId, A.termPart);
      return billAccount(t, A.orgId, { accountId: A.accountId, part, issueDate: now, dueDate: new Date(now.getTime() + 20 * DAY), includeCharges: true, academicYearId: A.yearId }, actor());
    });
    expect(inv).not.toBeNull();
    invoiceId = inv!.id;
    const lines = await owner.invoiceLine.findMany({ where: { invoiceId }, orderBy: { seq: "asc" } });
    const byKid = (i: number, kind: string) => lines.find((l) => l.studentId === A.kids[i] && l.kind === kind)!;
    // Term 1 = 40% of the annual fee. Grade 9 is the eldest: no sibling discount; grade 4 gets 5%; KG1 gets 10%.
    expect(byKid(0, "TUITION")).toMatchObject({ grossFils: 1_200_000, discountFils: 0, vatFils: 0 });
    expect(byKid(1, "TUITION")).toMatchObject({ grossFils: 880_000, discountFils: 44_000, netFils: 836_000 });
    expect(byKid(2, "TUITION")).toMatchObject({ grossFils: 640_000, discountFils: 64_000, netFils: 576_000 });
    expect(byKid(0, "TRANSPORT")).toMatchObject({ grossFils: 240_000, vatRateBp: 500, vatFils: 12_000, totalFils: 252_000 });
    expect(inv!.totalFils).toBe(1_200_000 + 836_000 + 576_000 + 252_000);
    expect(inv!.vatFils).toBe(12_000);
    expect(inv!.number).toMatch(/^INV-\d{4}-\d{5}$/);
  });

  it("refuses to change an issued invoice and the app role cannot delete it", async () => {
    await expect(tx((t) => t.invoice.update({ where: { id: invoiceId }, data: { totalFils: 1 } }))).rejects.toThrow();
    await expect(tx((t) => t.invoice.delete({ where: { id: invoiceId } }))).rejects.toThrow();
    await expect(tx((t) => t.invoiceLine.updateMany({ where: { invoiceId }, data: { netFils: 1 } }))).rejects.toThrow();
  });

  it("offers the early payment discount and takes it when the payment settles the invoice", async () => {
    const offer = await tx((t) => earlyPaymentOffer(t, A.orgId, invoiceId, now));
    expect(offer).not.toBeNull();
    // 2% of the tuition net (1,200,000 + 836,000 + 576,000), tuition is zero rated.
    expect(offer!.discountFils).toBe(52_240);
    const inv = await owner.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(offer!.payNowFils).toBe(inv.totalFils - 52_240);
  });

  it("allocates a partial payment, then an overpayment leaves credit that a refund can return (four eyes)", async () => {
    const r1 = await tx((t) => recordPayment(t, A.orgId, { accountId: A.accountId, method: "CASH", amountFils: 1_000_000, receivedAt: now, idempotencyKey: uid("pay") }, actor()));
    expect(r1.payment.number).toMatch(/^RCT-/);
    let inv = await owner.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.status).toBe("PARTIAL");
    expect(inv.paidFils).toBe(1_000_000);
    // The same idempotency key never records twice.
    const key = uid("pay");
    const first = await tx((t) => recordPayment(t, A.orgId, { accountId: A.accountId, method: "BANK_TRANSFER", reference: "FT-123", amountFils: 2_000_000, receivedAt: now, idempotencyKey: key }, actor()));
    const again = await tx((t) => recordPayment(t, A.orgId, { accountId: A.accountId, method: "BANK_TRANSFER", reference: "FT-123", amountFils: 2_000_000, receivedAt: now, idempotencyKey: key }, actor()));
    expect(again.duplicate).toBe(true);
    expect(again.payment.id).toBe(first.payment.id);
    inv = await owner.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.status).toBe("PAID");
    const bal = await tx((t) => accountBalance(t, A.orgId, A.accountId));
    const overpaid = 3_000_000 - inv.totalFils;
    expect(bal).toEqual({ owedFils: 0, creditFils: overpaid, balanceFils: -overpaid });
    // Refund: more than the credit is refused; the requester cannot approve their own request.
    await expect(tx((t) => requestRefund(t, A.orgId, { paymentId: first.payment.id, amountFils: overpaid + 1, reason: "Overpaid" }, actor()))).rejects.toThrow(FeeError);
    const refund = await tx((t) => requestRefund(t, A.orgId, { paymentId: first.payment.id, amountFils: overpaid, reason: "Overpaid" }, actor()));
    await expect(tx((t) => decideRefund(t, A.orgId, refund.id, true, null, now, actor()))).rejects.toThrow("FOUR_EYES");
    await tx((t) => decideRefund(t, A.orgId, refund.id, true, "OK", now, { membershipId: A.staff2, userId: null }));
    await tx((t) => markRefundPaid(t, A.orgId, refund.id, { method: "BANK_TRANSFER", reference: "RF-OUT-1", paidAt: now }, actor()));
    const r = await owner.feeRefund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(r.status).toBe("PAID");
    expect(r.number).toMatch(/^RF-/);
    expect((await tx((t) => accountBalance(t, A.orgId, A.accountId))).balanceFils).toBe(0);
  });

  it("a credit note on a paid invoice releases the paid part as credit and never exceeds the invoice", async () => {
    const lines = await owner.invoiceLine.findMany({ where: { invoiceId }, orderBy: { seq: "asc" } });
    const bus = lines.find((l) => l.kind === "TRANSPORT")!;
    const cn = await tx((t) => issueCreditNote(t, A.orgId, { invoiceId, reasonKind: "CORRECTION", reasonEn: "Bus not used in September", lines: [{ invoiceLineId: bus.id, netFils: 60_000 }], issueDate: now }, actor()));
    expect(cn).toMatchObject({ netFils: 60_000, vatFils: 3_000, totalFils: 63_000 });
    expect(cn.number).toMatch(/^CN-/);
    const inv = await owner.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.creditedFils).toBe(63_000);
    expect(inv.paidFils + inv.creditedFils).toBe(inv.totalFils);
    expect((await tx((t) => accountBalance(t, A.orgId, A.accountId))).creditFils).toBe(63_000);
    await expect(tx((t) => issueCreditNote(t, A.orgId, { invoiceId, reasonKind: "CORRECTION", reasonEn: "Too much", lines: [{ invoiceLineId: bus.id, netFils: 180_001 }], issueDate: now }, actor()))).rejects.toThrow("MORE_THAN_INVOICED");
    // Crediting the rest of the line takes exactly the rest of its VAT.
    const rest = await tx((t) => issueCreditNote(t, A.orgId, { invoiceId, reasonKind: "CORRECTION", reasonEn: "Bus cancelled", lines: [{ invoiceLineId: bus.id, netFils: 180_000 }], issueDate: now }, actor()));
    expect(rest.vatFils).toBe(12_000 - 3_000);
  });

  it("holds a post-dated cheque until it clears, and a bounced cheque re-opens the invoice", async () => {
    const extra = await tx((t) =>
      issueInvoice(t, A.orgId, { kind: "TAX", accountId: A.accountId, issueDate: now, dueDate: now, lines: [{ studentId: A.kids[0], feeItemId: null, kind: "EXAM", descriptionEn: "AP exam", descriptionAr: "اختبار", quantity: 2, unitFils: 50_000, vatTreatment: "STANDARD" }], applyCredit: false }, actor()),
    );
    const pdc = await tx((t) => recordPayment(t, A.orgId, { accountId: A.accountId, method: "CHEQUE", chequeNumber: "000123", chequeBank: "Test Bank", chequeDate: new Date(now.getTime() + 30 * DAY), amountFils: 105_000, receivedAt: now, idempotencyKey: uid("pdc"), invoiceIds: [extra.id] }, actor()));
    expect(pdc.payment.status).toBe("HELD");
    expect(pdc.payment.number).toBeNull();
    expect((await owner.invoice.findUniqueOrThrow({ where: { id: extra.id } })).paidFils).toBe(0);
    const cleared = await tx((t) => clearCheque(t, A.orgId, pdc.payment.id, new Date(now.getTime() + 30 * DAY), actor()));
    expect(cleared.number).toMatch(/^RCT-/);
    let inv = await owner.invoice.findUniqueOrThrow({ where: { id: extra.id } });
    expect(inv.status).toBe("PAID");
    await tx((t) => bouncePayment(t, A.orgId, pdc.payment.id, "Insufficient funds", now, actor()));
    inv = await owner.invoice.findUniqueOrThrow({ where: { id: extra.id } });
    expect(inv.status).toBe("OPEN");
    expect(inv.paidFils).toBe(0);
    const allocs = await owner.feeAllocation.findMany({ where: { paymentId: pdc.payment.id } });
    expect(allocs.reduce((s, a) => s + a.amountFils, 0)).toBe(0);
  });
});

describe("billing runs", () => {
  it("bills every family in batches, resumes from its cursor and never bills twice", async () => {
    // Two more families so the run needs several batches of one account each.
    for (const n of ["Two", "Three"]) {
      const g = await owner.guardian.create({ data: { orgId: A.orgId, firstNameEn: "P", lastNameEn: n, firstNameAr: "و", lastNameAr: n } });
      const s = await owner.student.create({ data: { orgId: A.orgId, studentNo: uid("S"), firstNameEn: "K", lastNameEn: n, firstNameAr: "ط", lastNameAr: n, gradeLevel: 9 } });
      await owner.guardianLink.create({ data: { orgId: A.orgId, guardianId: g.id, studentId: s.id, isPrimary: true } });
    }
    await tx((t) => syncFamilyAccounts(t, A.orgId, actor()));
    const plan = await owner.instalmentPlan.findFirstOrThrow({ where: { orgId: A.orgId }, include: { parts: { orderBy: { seq: "asc" } } } });
    const part2 = plan.parts[1];
    const { run } = await tx((t) => createBillingRun(t, A.orgId, { partId: part2.id, issueDate: now, dueDate: part2.dueDate, includeCharges: true }, actor()));
    expect(run.totalAccounts).toBe(3);
    const effects: Effect[] = [];
    const step = () => tx((t) => processBillingBatch(execCtx(t, A.orgId, { effects, now, quiet: true }), run.id, { batchSize: 1 }));
    expect((await step()).done).toBe(false);
    // A repeated batch (for example a retried job) picks up after the cursor and bills nobody twice.
    expect((await step()).done).toBe(false);
    expect((await step()).done).toBe(false);
    expect((await step()).done).toBe(true);
    expect((await step()).done).toBe(true);
    const done = await owner.billingRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(done).toMatchObject({ status: "COMPLETED", processed: 3, invoicesCreated: 3 });
    expect(await owner.invoice.count({ where: { billingRunId: run.id } })).toBe(3);
    // Each family was told once.
    expect(await owner.notification.count({ where: { orgId: A.orgId, kind: "fee_invoice", recipientId: A.guardianMember } })).toBe(1);
  });
});

describe("reminders", () => {
  it("are sent once per stage and held for a student with an open safeguarding case", async () => {
    const overdue = await tx((t) =>
      issueInvoice(t, A.orgId, { kind: "TAX", accountId: A.accountId, issueDate: new Date(now.getTime() - 40 * DAY), dueDate: new Date(now.getTime() - 22 * DAY), lines: [{ studentId: null, feeItemId: null, kind: "BOOKS", descriptionEn: "Books", descriptionAr: "كتب", quantity: 1, unitFils: 45_000, vatTreatment: "ZERO_RATED" }], applyCredit: false }, actor()),
    );
    const run = () => tx((t) => sendDueFeeReminders(execCtx(t, A.orgId, { now, quiet: true })));
    const first = await run();
    expect(first.sent).toBeGreaterThanOrEqual(1);
    expect((await run()).sent).toBe(0);
    expect((await owner.invoice.findUniqueOrThrow({ where: { id: overdue.id } })).remindersSent).toBe(1);
    const c = await owner.case.create({ data: { orgId: A.orgId, number: uid("CASE"), type: "SAFEGUARDING", sensitivity: "SAFEGUARDING", studentId: A.kids[1], titleEn: "Concern", titleAr: "قلق" } });
    const later = await tx((t) => sendDueFeeReminders(execCtx(t, A.orgId, { now: new Date(now.getTime() + 30 * DAY), quiet: true })));
    expect(later.sent).toBe(0);
    expect(later.held).toBeGreaterThanOrEqual(1);
    await owner.case.delete({ where: { id: c.id } });
  });
});

describe("parents", () => {
  it("see the accounts of their own children only", async () => {
    const ids = await parentAccountIds(tenantDb(A.orgId), { isParent: true, orgId: A.orgId, membership: { guardian: { id: A.guardianId, links: A.kids.map((k) => ({ studentId: k, canApprove: true })) } } });
    expect(ids).toEqual([A.accountId]);
    expect(await parentAccountIds(tenantDb(A.orgId), { isParent: true, orgId: A.orgId, membership: { guardian: { id: "nobody", links: [] } } })).toEqual([]);
  });
});

describe("seat booking and webhooks", () => {
  const consoleProvider = (): OnlineProvider => ({
    key: "console",
    ready: true,
    missing: [],
    test: true,
    createLink: async (i) => ({ url: i.testCheckoutPath, externalId: `test_${i.linkId}` }),
    verifyWebhook: async (raw, headers, at) => {
      const { verifySignatureHeader } = await import("@/server/payments/signature");
      if (!verifySignatureHeader(consoleSecret() || "test-secret", raw, headers.get("x-horizon-signature"), at)) return null;
      const e = JSON.parse(raw);
      return { eventId: e.id, type: e.type, outcome: "paid", orgId: e.orgId, linkId: e.linkId, amountFils: e.amountFils, currency: e.currency, externalId: null };
    },
  });

  it("creates one proforma per application and a paid link converts it to a tax invoice exactly once", async () => {
    const r1 = await createSeatBookingCharge(A.orgId, "APP-2027-0042", 250_000, { name: "Applicant Parent", email: "applicant@fees.test" }, { now });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.number).toMatch(/^PF-/);
    const r2 = await createSeatBookingCharge(A.orgId, "APP-2027-0042", 250_000, { name: "Applicant Parent" }, { now });
    expect(r2.ok && r2.reused && r2.invoiceId === r1.invoiceId).toBe(true);

    const link = await owner.paymentLink.create({ data: { orgId: A.orgId, accountId: (await owner.invoice.findUniqueOrThrow({ where: { id: r1.invoiceId } })).accountId, invoiceId: r1.invoiceId, amountFils: 250_000, provider: "console", expiresAt: new Date(now.getTime() + DAY) } });
    const prev = process.env.PAYMENTS_TEST_SECRET;
    process.env.PAYMENTS_TEST_SECRET = "test-secret";
    try {
      const { body, signature } = consoleSignedEvent({ type: "payment.succeeded", orgId: A.orgId, linkId: link.id, amountFils: 250_000, currency: "AED", id: "evt_same" }, now);
      const headers = new Headers({ "x-horizon-signature": signature });
      const noFlush = async () => undefined;
      const res1 = await handlePaymentWebhook("console", body, headers, now, { provider: consoleProvider(), flush: noFlush });
      expect(res1.body.result).toBe("paid");
      // The same event again: nothing happens.
      expect((await handlePaymentWebhook("console", body, headers, now, { provider: consoleProvider(), flush: noFlush })).body.result).toBe("duplicate");
      // A different event for the same link: still one payment.
      const other = consoleSignedEvent({ type: "payment.succeeded", orgId: A.orgId, linkId: link.id, amountFils: 250_000, currency: "AED", id: "evt_other" }, now);
      expect((await handlePaymentWebhook("console", other.body, new Headers({ "x-horizon-signature": other.signature }), now, { provider: consoleProvider(), flush: noFlush })).body.result).toBe("already_paid");
      // A forged signature is rejected before anything is read.
      const forged = new Headers({ "x-horizon-signature": signPayload("wrong", body, Math.floor(now.getTime() / 1000)) });
      expect((await handlePaymentWebhook("console", body, forged, now, { provider: consoleProvider(), flush: noFlush })).status).toBe(400);
    } finally {
      if (prev === undefined) delete process.env.PAYMENTS_TEST_SECRET;
      else process.env.PAYMENTS_TEST_SECRET = prev;
    }
    const pf = await owner.invoice.findUniqueOrThrow({ where: { id: r1.invoiceId } });
    expect(pf.status).toBe("CONVERTED");
    const taxInv = await owner.invoice.findUniqueOrThrow({ where: { id: pf.convertedToId! } });
    expect(taxInv).toMatchObject({ kind: "TAX", status: "PAID", totalFils: 250_000 });
    expect(await owner.feePayment.count({ where: { orgId: A.orgId, idempotencyKey: `link:${link.id}` } })).toBe(1);
  });

  it("as the admissions provider: one charge per application, and paying it in full tells admissions once", async () => {
    const calls: Array<{ applicationId: string; reference: string }> = [];
    registerSeatPaidHandler(async (_ec, input) => {
      calls.push(input);
      return calls.length === 1 ? "paid" : "already";
    });
    try {
      const req = { orgId: A.orgId, applicationId: uid("app"), applicationNumber: "ADM-2027-0007", amountFils: 300_000, currency: "AED" as const, payerEmail: "family@fees.test", description: { en: "Seat booking: Lina Test (ADM-2027-0007)", ar: "حجز مقعد: لينا اختبار (ADM-2027-0007)" }, idempotencyKey: "" };
      req.idempotencyKey = `seat:${req.applicationId}`;
      const charge = (n: number) => tx((t) => feesSeatBookingProvider.createCharge(execCtx(t, A.orgId, { now: new Date(now.getTime() + n) }), req));
      const c1 = await charge(0);
      const c2 = await charge(1000);
      expect(c1.reference).toMatch(/^PF-/);
      expect(c2.reference).toBe(c1.reference);
      expect(c1.payUrl).toBeNull();
      const pf = await owner.invoice.findFirstOrThrow({ where: { orgId: A.orgId, number: c1.reference } });
      expect(pf).toMatchObject({ kind: "PROFORMA", status: "OPEN", totalFils: 300_000, sourceRef: `seat:${req.applicationId}` });
      // A part payment stays as family credit and admissions hears nothing.
      await tx((t) => recordPayment(t, A.orgId, { accountId: pf.accountId, method: "BANK_TRANSFER", amountFils: 100_000, receivedAt: now, reference: "FT-SEAT-1", idempotencyKey: uid("seat-part") }, actor()));
      expect(calls).toHaveLength(0);
      expect((await owner.invoice.findUniqueOrThrow({ where: { id: pf.id } })).status).toBe("OPEN");
      // The rest, chosen against the proforma: it becomes a tax invoice, is paid, and admissions is told once.
      await tx((t) => recordPayment(t, A.orgId, { accountId: pf.accountId, method: "BANK_TRANSFER", amountFils: 200_000, receivedAt: now, reference: "FT-SEAT-2", idempotencyKey: uid("seat-rest"), invoiceIds: [pf.id] }, actor()));
      const converted = await owner.invoice.findUniqueOrThrow({ where: { id: pf.id } });
      expect(converted.status).toBe("CONVERTED");
      // The family's earlier part payment is taken too, so the tax invoice is paid in full.
      const taxInv = await owner.invoice.findUniqueOrThrow({ where: { id: converted.convertedToId! } });
      expect(taxInv).toMatchObject({ kind: "TAX", status: "PAID", totalFils: 300_000, paidFils: 300_000 });
      expect(calls).toEqual([{ applicationId: req.applicationId, reference: taxInv.number }]);
      // Paying more later never calls admissions again for this application.
      await tx((t) => recordPayment(t, A.orgId, { accountId: pf.accountId, method: "CASH", amountFils: 5_000, receivedAt: now, idempotencyKey: uid("seat-extra") }, actor()));
      expect(calls).toHaveLength(1);
    } finally {
      registerSeatPaidHandler(null);
    }
  });
});

describe("tenant isolation of fee tables", () => {
  const models = ["invoice", "invoiceLine", "creditNote", "feePayment", "feeAllocation", "feeAccount", "feeItem", "instalmentPlan", "billingRun", "paymentLink", "paymentEvent", "financeSettings"] as const;
  it("school B sees none of school A's fee rows", async () => {
    const b = tenantDb(otherOrg);
    for (const m of models) {
      const count = await (b as unknown as Record<string, { count: (a?: unknown) => Promise<number> }>)[m].count();
      expect(count, m).toBe(0);
    }
    const a = tenantDb(A.orgId);
    expect(await a.invoice.count()).toBeGreaterThan(0);
  });
  it("a connection with no tenant context sees no fee rows", async () => {
    expect(await prisma.invoice.count()).toBe(0);
    expect(await prisma.feePayment.count()).toBe(0);
  });
});
