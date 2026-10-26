// Fee setup for an academic year: fee items, instalment plans, discounts, awards and finance settings.
// Changes apply to invoices issued afterwards; issued invoices never change. Every change is audited.
import type { DiscountMethod, FeeDiscountKind, FeeItemKind, InstalmentPlanKind, ProRataBasis, DiscountStacking, VatTreatment } from "@prisma/client";
import type { Tx } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { FeeError, type Actor } from "./ledger";
import { equalShares, instalmentAmount, roundDiv } from "./money";
import { validTrn } from "./config";

const log = (tx: Tx, orgId: string, actor: Actor, action: string, entityType: string, entityId: string | null, meta: Record<string, unknown>) =>
  audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action, entityType, entityId, meta });

/** Default VAT treatment per kind. The school's accountant must confirm each item (see docs/decisions.md). */
export const DEFAULT_VAT: Record<FeeItemKind, VatTreatment> = {
  TUITION: "ZERO_RATED",
  REGISTRATION: "ZERO_RATED",
  REENROLLMENT: "ZERO_RATED",
  SEAT_DEPOSIT: "ZERO_RATED",
  BOOKS: "ZERO_RATED",
  TRANSPORT: "STANDARD",
  UNIFORM: "STANDARD",
  TRIP: "STANDARD",
  EXAM: "STANDARD",
  OTHER: "STANDARD",
};

/** How an item is billed by default: recurring items are split by the instalment plan. */
export const DEFAULT_BEHAVIOUR: Record<FeeItemKind, { recurring: boolean; proRata: boolean; discountable: boolean; autoBill: boolean }> = {
  TUITION: { recurring: true, proRata: true, discountable: true, autoBill: true },
  TRANSPORT: { recurring: true, proRata: true, discountable: false, autoBill: true },
  REGISTRATION: { recurring: false, proRata: false, discountable: false, autoBill: false },
  REENROLLMENT: { recurring: false, proRata: false, discountable: false, autoBill: false },
  SEAT_DEPOSIT: { recurring: false, proRata: false, discountable: false, autoBill: false },
  BOOKS: { recurring: false, proRata: false, discountable: false, autoBill: false },
  UNIFORM: { recurring: false, proRata: false, discountable: false, autoBill: false },
  TRIP: { recurring: false, proRata: false, discountable: false, autoBill: false },
  EXAM: { recurring: false, proRata: false, discountable: false, autoBill: false },
  OTHER: { recurring: false, proRata: false, discountable: false, autoBill: false },
};

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,23}$/;

export type FeeItemInput = {
  id?: string | null;
  academicYearId: string;
  code: string;
  kind: FeeItemKind;
  nameEn: string;
  nameAr: string;
  amountFils: number;
  gradeLevels: number[];
  zone: string | null;
  recurring: boolean;
  proRata: boolean;
  discountable: boolean;
  autoBill: boolean;
  vatTreatment: VatTreatment;
  active: boolean;
};

export async function saveFeeItem(tx: Tx, orgId: string, input: FeeItemInput, actor: Actor) {
  const code = input.code.trim().toUpperCase();
  if (!CODE_RE.test(code)) throw new FeeError("CODE_INVALID");
  if (!input.nameEn.trim() || !input.nameAr.trim()) throw new FeeError("NAME_REQUIRED");
  if (!Number.isSafeInteger(input.amountFils) || input.amountFils < 0 || input.amountFils > 100_000_000_00) throw new FeeError("AMOUNT_INVALID");
  if (input.gradeLevels.some((g) => !Number.isInteger(g) || g < -1 || g > 12)) throw new FeeError("GRADES_INVALID");
  if (input.kind === "TUITION" && input.gradeLevels.length !== 1) throw new FeeError("TUITION_ONE_GRADE");
  if (input.kind === "TRANSPORT" && !input.zone?.trim()) throw new FeeError("ZONE_REQUIRED");
  const year = await tx.academicYear.findFirst({ where: { id: input.academicYearId, orgId } });
  if (!year) throw new FeeError("YEAR_NOT_FOUND");
  const clash = await tx.feeItem.findFirst({ where: { orgId, academicYearId: year.id, code, ...(input.id ? { id: { not: input.id } } : {}) } });
  if (clash) throw new FeeError("CODE_TAKEN");
  if (input.kind === "TUITION" && input.active) {
    const other = await tx.feeItem.findFirst({ where: { orgId, academicYearId: year.id, kind: "TUITION", active: true, gradeLevels: { has: input.gradeLevels[0] }, ...(input.id ? { id: { not: input.id } } : {}) } });
    if (other) throw new FeeError("TUITION_GRADE_TAKEN");
  }
  const data = {
    code,
    kind: input.kind,
    nameEn: input.nameEn.trim().slice(0, 120),
    nameAr: input.nameAr.trim().slice(0, 120),
    amountFils: input.amountFils,
    gradeLevels: [...new Set(input.gradeLevels)].sort((a, b) => a - b),
    zone: input.kind === "TRANSPORT" ? input.zone!.trim().toUpperCase().slice(0, 24) : null,
    recurring: input.recurring,
    proRata: input.recurring && input.proRata,
    discountable: input.discountable,
    autoBill: input.autoBill,
    vatTreatment: input.vatTreatment,
    active: input.active,
  };
  if (input.id) {
    const before = await tx.feeItem.findFirst({ where: { id: input.id, orgId } });
    if (!before) throw new FeeError("NOT_FOUND");
    const item = await tx.feeItem.update({ where: { id: before.id }, data });
    await log(tx, orgId, actor, "fees.item.update", "FeeItem", item.id, { code, from: { amountFils: before.amountFils, vat: before.vatTreatment }, to: { amountFils: item.amountFils, vat: item.vatTreatment } });
    return item;
  }
  const item = await tx.feeItem.create({ data: { orgId, academicYearId: year.id, ...data } });
  await log(tx, orgId, actor, "fees.item.create", "FeeItem", item.id, { code, amountFils: item.amountFils, vat: item.vatTreatment });
  return item;
}

/** Remove an item that was never billed; an item already on an invoice can only be switched off. */
export async function deleteFeeItem(tx: Tx, orgId: string, id: string, actor: Actor) {
  const item = await tx.feeItem.findFirst({ where: { id, orgId } });
  if (!item) throw new FeeError("NOT_FOUND");
  const used = (await tx.invoiceLine.count({ where: { orgId, feeItemId: id } })) + (await tx.feeCharge.count({ where: { orgId, feeItemId: id } }));
  if (used) {
    await tx.feeItem.update({ where: { id }, data: { active: false } });
    await log(tx, orgId, actor, "fees.item.deactivate", "FeeItem", id, { code: item.code });
    return { deleted: false };
  }
  await tx.feeItem.delete({ where: { id } });
  await log(tx, orgId, actor, "fees.item.delete", "FeeItem", id, { code: item.code });
  return { deleted: true };
}

/**
 * Copy a year's fee schedule (items, plans shifted by whole years, nothing else) to another year, optionally with a
 * percentage change in basis points (for example an approved fee increase). Items whose code already exists in the
 * target year are left alone, so copying twice changes nothing.
 */
export async function copySchedule(tx: Tx, orgId: string, input: { fromYearId: string; toYearId: string; changeBp: number }, actor: Actor) {
  if (input.fromYearId === input.toYearId) throw new FeeError("SAME_YEAR");
  if (!Number.isInteger(input.changeBp) || input.changeBp < -5000 || input.changeBp > 5000) throw new FeeError("CHANGE_INVALID");
  const [from, to] = await Promise.all([tx.academicYear.findFirst({ where: { id: input.fromYearId, orgId } }), tx.academicYear.findFirst({ where: { id: input.toYearId, orgId } })]);
  if (!from || !to) throw new FeeError("YEAR_NOT_FOUND");
  const items = await tx.feeItem.findMany({ where: { orgId, academicYearId: from.id } });
  const have = new Set((await tx.feeItem.findMany({ where: { orgId, academicYearId: to.id }, select: { code: true } })).map((i) => i.code));
  const rows = items
    .filter((i) => !have.has(i.code))
    .map((i) => ({
      orgId,
      academicYearId: to.id,
      code: i.code,
      kind: i.kind,
      nameEn: i.nameEn,
      nameAr: i.nameAr,
      amountFils: i.amountFils + roundDiv(i.amountFils * input.changeBp, 10_000),
      gradeLevels: i.gradeLevels,
      zone: i.zone,
      recurring: i.recurring,
      proRata: i.proRata,
      discountable: i.discountable,
      autoBill: i.autoBill,
      vatTreatment: i.vatTreatment,
      active: i.active,
      sortOrder: i.sortOrder,
    }));
  if (rows.length) await tx.feeItem.createMany({ data: rows });
  // Plans: same shape, dates moved by the difference between the two years' start dates.
  const shift = to.startsOn.getTime() - from.startsOn.getTime();
  const plans = await tx.instalmentPlan.findMany({ where: { orgId, academicYearId: from.id }, include: { parts: true } });
  const havePlans = new Set((await tx.instalmentPlan.findMany({ where: { orgId, academicYearId: to.id }, select: { key: true } })).map((p) => p.key));
  let planCount = 0;
  for (const p of plans) {
    if (havePlans.has(p.key)) continue;
    await tx.instalmentPlan.create({
      data: {
        orgId,
        academicYearId: to.id,
        key: p.key,
        nameEn: p.nameEn,
        nameAr: p.nameAr,
        kind: p.kind,
        isDefault: p.isDefault,
        active: p.active,
        parts: { create: p.parts.map((x) => ({ orgId, seq: x.seq, labelEn: x.labelEn, labelAr: x.labelAr, shareBp: x.shareBp, dueDate: new Date(x.dueDate.getTime() + shift), periodStart: new Date(x.periodStart.getTime() + shift), periodEnd: new Date(x.periodEnd.getTime() + shift) })) },
      },
    });
    planCount++;
  }
  await log(tx, orgId, actor, "fees.schedule.copy", "AcademicYear", to.id, { from: from.nameEn, items: rows.length, plans: planCount, changeBp: input.changeBp });
  return { items: rows.length, plans: planCount };
}

// ---------------------------------------------------------------------------------------------
// Instalment plans
// ---------------------------------------------------------------------------------------------

export type PlanPartInput = { labelEn: string; labelAr: string; dueDate: Date; periodStart: Date; periodEnd: Date; shareBp: number };
export type PlanInput = { id?: string | null; academicYearId: string; key: string; nameEn: string; nameAr: string; kind: InstalmentPlanKind; isDefault: boolean; active: boolean; parts: PlanPartInput[] };

export function validatePlanParts(parts: PlanPartInput[]): string | null {
  if (!parts.length || parts.length > 12) return "PARTS_COUNT";
  if (parts.reduce((s, p) => s + p.shareBp, 0) !== 10_000) return "SHARES_TOTAL";
  for (const p of parts) {
    if (!p.labelEn.trim() || !p.labelAr.trim()) return "NAME_REQUIRED";
    if (!Number.isInteger(p.shareBp) || p.shareBp < 0) return "SHARES_TOTAL";
    if (p.periodEnd.getTime() < p.periodStart.getTime()) return "PERIOD_ORDER";
  }
  for (let i = 1; i < parts.length; i++) if (parts[i].periodStart.getTime() <= parts[i - 1].periodStart.getTime()) return "PERIOD_ORDER";
  return null;
}

export async function savePlan(tx: Tx, orgId: string, input: PlanInput, actor: Actor) {
  const key = input.key.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,24}$/.test(key)) throw new FeeError("CODE_INVALID");
  if (!input.nameEn.trim() || !input.nameAr.trim()) throw new FeeError("NAME_REQUIRED");
  const bad = validatePlanParts(input.parts);
  if (bad) throw new FeeError(bad);
  const year = await tx.academicYear.findFirst({ where: { id: input.academicYearId, orgId } });
  if (!year) throw new FeeError("YEAR_NOT_FOUND");
  const clash = await tx.instalmentPlan.findFirst({ where: { orgId, academicYearId: year.id, key, ...(input.id ? { id: { not: input.id } } : {}) } });
  if (clash) throw new FeeError("CODE_TAKEN");
  if (input.isDefault) await tx.instalmentPlan.updateMany({ where: { orgId, academicYearId: year.id, ...(input.id ? { id: { not: input.id } } : {}) }, data: { isDefault: false } });
  const parts = input.parts.map((p, i) => ({ orgId, seq: i + 1, labelEn: p.labelEn.trim(), labelAr: p.labelAr.trim(), dueDate: p.dueDate, periodStart: p.periodStart, periodEnd: p.periodEnd, shareBp: p.shareBp }));
  if (input.id) {
    const plan = await tx.instalmentPlan.findFirst({ where: { id: input.id, orgId }, include: { parts: true } });
    if (!plan) throw new FeeError("NOT_FOUND");
    const billed = await tx.invoice.count({ where: { orgId, planPartId: { in: plan.parts.map((p) => p.id) } } });
    const sameShape = plan.parts.length === parts.length && plan.parts.every((p) => parts.some((q) => q.seq === p.seq && q.shareBp === p.shareBp && q.periodStart.getTime() === p.periodStart.getTime() && q.periodEnd.getTime() === p.periodEnd.getTime()));
    if (billed && !sameShape) throw new FeeError("PLAN_IN_USE");
    await tx.instalmentPlan.update({ where: { id: plan.id }, data: { key, nameEn: input.nameEn.trim(), nameAr: input.nameAr.trim(), kind: input.kind, isDefault: input.isDefault, active: input.active } });
    for (const p of parts) {
      const existing = plan.parts.find((x) => x.seq === p.seq);
      if (existing) await tx.instalmentPart.update({ where: { id: existing.id }, data: { labelEn: p.labelEn, labelAr: p.labelAr, dueDate: p.dueDate, periodStart: p.periodStart, periodEnd: p.periodEnd, shareBp: p.shareBp } });
      else await tx.instalmentPart.create({ data: { ...p, planId: plan.id } });
    }
    const extra = plan.parts.filter((x) => x.seq > parts.length).map((x) => x.id);
    if (extra.length) await tx.instalmentPart.deleteMany({ where: { orgId, id: { in: extra } } });
    await log(tx, orgId, actor, "fees.plan.update", "InstalmentPlan", plan.id, { key, parts: parts.length });
    return plan.id;
  }
  const plan = await tx.instalmentPlan.create({ data: { orgId, academicYearId: year.id, key, nameEn: input.nameEn.trim(), nameAr: input.nameAr.trim(), kind: input.kind, isDefault: input.isDefault, active: input.active, parts: { create: parts } } });
  await log(tx, orgId, actor, "fees.plan.create", "InstalmentPlan", plan.id, { key, parts: parts.length });
  return plan.id;
}

const DAY = 86_400_000;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/**
 * Suggested parts for a plan kind from the academic year and its terms: one instalment (annual), one per term
 * (40%, 30%, 30% for three terms, otherwise equal), or ten monthly instalments from September to June.
 * Each instalment is due two weeks before its period starts.
 */
export function suggestParts(kind: InstalmentPlanKind, year: { startsOn: Date; endsOn: Date }, terms: Array<{ nameEn: string; nameAr: string; startsOn: Date; endsOn: Date }>): PlanPartInput[] {
  const y0 = new Date(year.startsOn.getTime() + 4 * 3_600_000).getUTCFullYear();
  const due = (start: Date) => new Date(start.getTime() - 14 * DAY);
  if (kind === "ANNUAL" || kind === "CUSTOM") {
    const start = utc(y0, 9, 1);
    return [{ labelEn: "Full year", labelAr: "العام الدراسي كاملًا", dueDate: due(start), periodStart: start, periodEnd: utc(y0 + 1, 6, 30), shareBp: 10_000 }];
  }
  if (kind === "MONTHLY") {
    const shares = equalShares(10);
    const MONTHS_EN = ["September", "October", "November", "December", "January", "February", "March", "April", "May", "June"];
    const MONTHS_AR = ["سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر", "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو"];
    return shares.map((shareBp, i) => {
      const m = ((8 + i) % 12) + 1;
      const yy = i < 4 ? y0 : y0 + 1;
      const start = utc(yy, m, 1);
      const end = new Date(utc(m === 12 ? yy + 1 : yy, m === 12 ? 1 : m + 1, 1).getTime() - DAY);
      return { labelEn: `${MONTHS_EN[i]} ${yy}`, labelAr: `${MONTHS_AR[i]} ${yy}`, dueDate: new Date(start.getTime() - 7 * DAY), periodStart: start, periodEnd: end, shareBp };
    });
  }
  const sorted = [...terms].sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime());
  if (!sorted.length) return suggestParts("ANNUAL", year, []);
  const shares = sorted.length === 3 ? [4000, 3000, 3000] : equalShares(sorted.length);
  // Billing periods cover whole months (first day of the term's month to the day before the next term's month).
  return sorted.map((t, i) => {
    const s = new Date(t.startsOn.getTime() + 4 * 3_600_000);
    const start = i === 0 ? utc(y0, 9, 1) : utc(s.getUTCFullYear(), s.getUTCMonth() + 1, 1);
    const next = sorted[i + 1];
    const n = next ? new Date(next.startsOn.getTime() + 4 * 3_600_000) : null;
    const end = n ? new Date(utc(n.getUTCFullYear(), n.getUTCMonth() + 1, 1).getTime() - DAY) : utc(y0 + 1, 6, 30);
    return { labelEn: t.nameEn, labelAr: t.nameAr, dueDate: due(start), periodStart: start, periodEnd: end, shareBp: shares[i] };
  });
}

// ---------------------------------------------------------------------------------------------
// Discounts and awards
// ---------------------------------------------------------------------------------------------

export type DiscountInput = { id?: string | null; code: string; kind: FeeDiscountKind; nameEn: string; nameAr: string; method: DiscountMethod; percentBp: number | null; amountFils: number | null; requiresApproval: boolean; active: boolean };

export async function saveDiscount(tx: Tx, orgId: string, input: DiscountInput, actor: Actor) {
  const code = input.code.trim().toUpperCase();
  if (!CODE_RE.test(code)) throw new FeeError("CODE_INVALID");
  if (!input.nameEn.trim() || !input.nameAr.trim()) throw new FeeError("NAME_REQUIRED");
  if (input.kind === "SIBLING" || input.kind === "EARLY_PAYMENT") throw new FeeError("KIND_IN_SETTINGS");
  if (input.method === "PERCENT" && (!Number.isInteger(input.percentBp ?? NaN) || input.percentBp! <= 0 || input.percentBp! > 10_000)) throw new FeeError("PERCENT_INVALID");
  if (input.method === "FIXED" && (!Number.isSafeInteger(input.amountFils ?? NaN) || input.amountFils! <= 0)) throw new FeeError("AMOUNT_INVALID");
  // Scholarships and bursaries always need a second person's approval.
  const requiresApproval = input.kind === "SCHOLARSHIP" || input.kind === "BURSARY" ? true : input.requiresApproval;
  const data = { code, kind: input.kind, nameEn: input.nameEn.trim(), nameAr: input.nameAr.trim(), method: input.method, percentBp: input.method === "PERCENT" ? input.percentBp : null, amountFils: input.method === "FIXED" ? input.amountFils : null, requiresApproval, active: input.active };
  const clash = await tx.feeDiscount.findFirst({ where: { orgId, code, ...(input.id ? { id: { not: input.id } } : {}) } });
  if (clash) throw new FeeError("CODE_TAKEN");
  if (input.id) {
    const d = await tx.feeDiscount.findFirst({ where: { id: input.id, orgId } });
    if (!d) throw new FeeError("NOT_FOUND");
    await tx.feeDiscount.update({ where: { id: d.id }, data });
    await log(tx, orgId, actor, "fees.discount.update", "FeeDiscount", d.id, { code, percentBp: data.percentBp, amountFils: data.amountFils });
    return d.id;
  }
  const d = await tx.feeDiscount.create({ data: { orgId, ...data } });
  await log(tx, orgId, actor, "fees.discount.create", "FeeDiscount", d.id, { code, percentBp: data.percentBp, amountFils: data.amountFils });
  return d.id;
}

/** Give a student a discount for a year. Scholarships and bursaries wait for approval by someone else. */
export async function requestAward(tx: Tx, orgId: string, input: { studentId: string; discountId: string; academicYearId: string; reason: string }, actor: Actor) {
  const [d, s] = await Promise.all([tx.feeDiscount.findFirst({ where: { id: input.discountId, orgId, active: true } }), tx.student.findFirst({ where: { id: input.studentId, orgId }, select: { id: true } })]);
  if (!d || !s) throw new FeeError("NOT_FOUND");
  if (!input.reason.trim()) throw new FeeError("REASON_REQUIRED");
  const dup = await tx.feeAward.findFirst({ where: { orgId, studentId: s.id, discountId: d.id, academicYearId: input.academicYearId, status: { in: ["PENDING", "APPROVED"] } } });
  if (dup) throw new FeeError("ALREADY_AWARDED");
  const award = await tx.feeAward.create({
    data: { orgId, studentId: s.id, discountId: d.id, academicYearId: input.academicYearId, status: d.requiresApproval ? "PENDING" : "APPROVED", reason: input.reason.trim().slice(0, 500), requestedById: actor.membershipId, ...(d.requiresApproval ? {} : { decidedById: actor.membershipId, decidedAt: new Date() }) },
  });
  await log(tx, orgId, actor, "fees.award.request", "FeeAward", award.id, { discount: d.code, status: award.status });
  return award;
}

export async function decideAward(tx: Tx, orgId: string, awardId: string, approve: boolean, note: string | null, at: Date, actor: Actor) {
  const a = await tx.feeAward.findFirst({ where: { id: awardId, orgId } });
  if (!a) throw new FeeError("NOT_FOUND");
  if (a.status !== "PENDING") throw new FeeError("ALREADY_DECIDED");
  if (actor.membershipId && a.requestedById === actor.membershipId) throw new FeeError("FOUR_EYES");
  await tx.feeAward.update({ where: { id: a.id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: actor.membershipId, decidedAt: at, decisionNote: note?.trim() || null } });
  await log(tx, orgId, actor, approve ? "fees.award.approve" : "fees.award.reject", "FeeAward", a.id, {});
}

export async function revokeAward(tx: Tx, orgId: string, awardId: string, actor: Actor) {
  const a = await tx.feeAward.findFirst({ where: { id: awardId, orgId } });
  if (!a || (a.status !== "APPROVED" && a.status !== "PENDING")) throw new FeeError("NOT_FOUND");
  await tx.feeAward.update({ where: { id: a.id }, data: { status: "REVOKED" } });
  await log(tx, orgId, actor, "fees.award.revoke", "FeeAward", a.id, {});
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

export type SettingsInput = {
  legalNameEn: string;
  legalNameAr: string;
  addressEn: string;
  addressAr: string;
  trn: string;
  vatRegistered: boolean;
  standardVatBp: number;
  invoicePrefix: string;
  proformaPrefix: string;
  creditNotePrefix: string;
  receiptPrefix: string;
  refundPrefix: string;
  paymentTermsDays: number;
  siblingSecondBp: number;
  siblingThirdBp: number;
  siblingFourthBp: number;
  discountStacking: DiscountStacking;
  earlyPaymentBp: number;
  earlyPaymentDays: number;
  proRataBasis: ProRataBasis;
  proRataCutoffDay: number;
  remindersEnabled: boolean;
  reminderDaysBefore: number;
  reminderDaysAfter: number[];
  holdReportCards: boolean;
  holdAfterDays: number;
  onlinePayments: boolean;
  bankDetailsEn: string;
  bankDetailsAr: string;
};

const PREFIX_RE = /^[A-Z]{2,5}$/;
const intIn = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;

export function validateSettings(i: SettingsInput): string | null {
  if (i.trn.trim() && !validTrn(i.trn.trim())) return "TRN_INVALID";
  for (const p of [i.invoicePrefix, i.proformaPrefix, i.creditNotePrefix, i.receiptPrefix, i.refundPrefix]) if (!PREFIX_RE.test(p)) return "PREFIX_INVALID";
  if (new Set([i.invoicePrefix, i.proformaPrefix, i.creditNotePrefix, i.receiptPrefix, i.refundPrefix]).size !== 5) return "PREFIX_DUPLICATE";
  if (!intIn(i.standardVatBp, 0, 3000)) return "VAT_INVALID";
  if (!intIn(i.paymentTermsDays, 0, 120)) return "TERMS_INVALID";
  for (const b of [i.siblingSecondBp, i.siblingThirdBp, i.siblingFourthBp, i.earlyPaymentBp]) if (!intIn(b, 0, 10_000)) return "PERCENT_INVALID";
  if (!intIn(i.earlyPaymentDays, 0, 120)) return "DAYS_INVALID";
  if (!intIn(i.proRataCutoffDay, 1, 28)) return "CUTOFF_INVALID";
  if (!intIn(i.reminderDaysBefore, 0, 60)) return "DAYS_INVALID";
  if (i.reminderDaysAfter.length > 6 || i.reminderDaysAfter.some((d) => !intIn(d, 1, 365))) return "DAYS_INVALID";
  if (!intIn(i.holdAfterDays, 0, 365)) return "DAYS_INVALID";
  return null;
}

export async function saveFinanceSettings(tx: Tx, orgId: string, input: SettingsInput, actor: Actor) {
  const bad = validateSettings(input);
  if (bad) throw new FeeError(bad);
  const before = await tx.financeSettings.findUnique({ where: { orgId } });
  const data = {
    legalNameEn: input.legalNameEn.trim() || null,
    legalNameAr: input.legalNameAr.trim() || null,
    addressEn: input.addressEn.trim() || null,
    addressAr: input.addressAr.trim() || null,
    trn: input.trn.trim() || null,
    vatRegistered: input.vatRegistered,
    standardVatBp: input.standardVatBp,
    invoicePrefix: input.invoicePrefix,
    proformaPrefix: input.proformaPrefix,
    creditNotePrefix: input.creditNotePrefix,
    receiptPrefix: input.receiptPrefix,
    refundPrefix: input.refundPrefix,
    paymentTermsDays: input.paymentTermsDays,
    siblingSecondBp: input.siblingSecondBp,
    siblingThirdBp: input.siblingThirdBp,
    siblingFourthBp: input.siblingFourthBp,
    discountStacking: input.discountStacking,
    earlyPaymentBp: input.earlyPaymentBp,
    earlyPaymentDays: input.earlyPaymentDays,
    proRataBasis: input.proRataBasis,
    proRataCutoffDay: input.proRataCutoffDay,
    remindersEnabled: input.remindersEnabled,
    reminderDaysBefore: input.reminderDaysBefore,
    reminderDaysAfter: [...new Set(input.reminderDaysAfter)].sort((a, b) => a - b),
    holdReportCards: input.holdReportCards,
    holdAfterDays: input.holdAfterDays,
    onlinePayments: input.onlinePayments,
    bankDetailsEn: input.bankDetailsEn.trim() || null,
    bankDetailsAr: input.bankDetailsAr.trim() || null,
  };
  await tx.financeSettings.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
  const changed = Object.keys(data).filter((k) => JSON.stringify((before as Record<string, unknown> | null)?.[k] ?? null) !== JSON.stringify((data as Record<string, unknown>)[k]));
  await log(tx, orgId, actor, "fees.settings.update", "FinanceSettings", orgId, { changed });
}

export type ScheduleRowForPreview = { amountFils: number; recurring: boolean };

/** Instalment amounts of an annual fee for a plan (for the setup screen preview). */
export function previewInstalments(annualFils: number, shares: number[]): number[] {
  let cum = 0;
  return shares.map((s) => {
    const a = instalmentAmount(annualFils, cum, s);
    cum += s;
    return a;
  });
}

