// Fee arithmetic in integer fils (1 AED = 100 fils). No floats touch an amount.
// Pure functions only: invoice lines, VAT, discount stacking, instalment shares and pro rata. The worker, the
// seed and the tests import this module directly, so it has no "server-only" marker.
import type { DiscountMethod, DiscountStacking, FeeDiscountKind, FeeItemKind, ProRataBasis, VatTreatment } from "@prisma/client";

const DAY = 86_400_000;

/** Integer division rounded half away from zero (5 fils and up round up), exact for safe integers. */
export function roundDiv(num: number, den: number): number {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den === 0) throw new Error("roundDiv needs safe integers");
  const sign = Math.sign(num) * Math.sign(den);
  const n = Math.abs(num);
  const d = Math.abs(den);
  const q = Math.floor(n / d);
  const r = n - q * d;
  return sign * (r * 2 >= d ? q + 1 : q);
}

/** A percentage in basis points (500 = 5%) of an amount, rounded to the fils. */
export function bpOf(amountFils: number, bp: number): number {
  return roundDiv(amountFils * bp, 10_000);
}

/** VAT rate in basis points for a treatment. Only standard-rated lines carry VAT, and only when registered. */
export function vatRateFor(treatment: VatTreatment, s: { vatRegistered: boolean; standardVatBp: number }): number {
  return treatment === "STANDARD" && s.vatRegistered ? s.standardVatBp : 0;
}

/** VAT on a line's taxable amount, rounded per line to the fils. */
export function vatOf(netFils: number, rateBp: number): number {
  return bpOf(netFils, rateBp);
}

/** "AED 1,234.50" style text from fils (sign kept). */
export function formatAed(fils: number, locale: "en" | "ar" = "en", opts: { currency?: boolean } = {}): string {
  const neg = fils < 0;
  const abs = Math.abs(fils);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const num = `${neg ? "-" : ""}${grouped}.${frac}`;
  if (opts.currency === false) return num;
  return locale === "ar" ? `${num} د.إ` : `AED ${num}`;
}

/** Plain decimal text for exports ("1234.50", "-12.00"). */
export function filsToDecimal(fils: number): string {
  const neg = fils < 0;
  const abs = Math.abs(fils);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Parse "1,234.5" or "1234.50" (AED) into fils. Returns null for anything that is not a plain amount. */
export function parseAedToFils(text: string): number | null {
  const t = text.trim().replace(/,/g, "").replace(/^AED\s*/i, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

// ---------------------------------------------------------------------------------------------
// Instalment shares
// ---------------------------------------------------------------------------------------------

/**
 * The amount of an annual fee that falls in one instalment. Shares are cumulative, so the parts of a plan always
 * add up to the annual amount exactly (the rounding difference lands on the part where it occurs, never lost).
 */
export function instalmentAmount(annualFils: number, cumBpBefore: number, shareBp: number): number {
  return roundDiv(annualFils * (cumBpBefore + shareBp), 10_000) - roundDiv(annualFils * cumBpBefore, 10_000);
}

/** Equal basis-point shares that add up to 10000 (the last part takes the remainder). */
export function equalShares(n: number): number[] {
  if (n < 1) return [];
  const base = Math.floor(10_000 / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 10_000 - base * (n - 1) : base));
}

// ---------------------------------------------------------------------------------------------
// Pro rata
// ---------------------------------------------------------------------------------------------

export type ProRataRule = { basis: ProRataBasis; cutoffDay: number };
export type Fraction = { num: number; den: number };

/** Calendar day number (days since epoch) of a date in Dubai (UTC+4, no daylight saving). */
/** A date as YYYY-MM-DD in Dubai time, for date inputs and links (pure, safe on server and client). */
export const dayInput = (d: Date | string | null | undefined) => (d ? new Date(new Date(d).getTime() + 4 * 3_600_000).toISOString().slice(0, 10) : "");
export const todayInput = () => dayInput(new Date());

export function dubaiDayNumber(d: Date): number {
  return Math.floor((d.getTime() + 4 * 3_600_000) / DAY);
}

function dubaiParts(d: Date) {
  const x = new Date(d.getTime() + 4 * 3_600_000);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), day: x.getUTCDate() };
}

const monthIndex = (p: { y: number; m: number }) => p.y * 12 + p.m;

/**
 * Share of a billing period a student is billed for, given when they joined and when they left (either may be null).
 * MONTH: whole months. A student who joins on or before the cutoff day pays for the joining month, after it from the
 *        next month. A leaver pays for the leaving month when they leave after the cutoff day.
 * DAY:   calendar days in the period from the joining day to the leaving day, inclusive.
 * TERM:  the whole period when the student attends any part of it (no pro rata inside a term).
 * NONE:  as TERM.
 */
export function prorataFraction(period: { start: Date; end: Date }, joined: Date | null, left: Date | null, rule: ProRataRule): Fraction {
  const ps = dubaiDayNumber(period.start);
  const pe = dubaiDayNumber(period.end);
  if (pe < ps) return { num: 0, den: 1 };
  const js = joined ? dubaiDayNumber(joined) : null;
  const ls = left ? dubaiDayNumber(left) : null;
  // Not at school at all during the period.
  if ((js !== null && js > pe) || (ls !== null && ls < ps)) return { num: 0, den: 1 };

  if (rule.basis === "DAY") {
    const from = Math.max(ps, js ?? ps);
    const to = Math.min(pe, ls ?? pe);
    return { num: Math.max(0, to - from + 1), den: pe - ps + 1 };
  }
  if (rule.basis === "MONTH") {
    const first = monthIndex(dubaiParts(period.start));
    const last = monthIndex(dubaiParts(period.end));
    const den = last - first + 1;
    let from = first;
    let to = last;
    if (joined && js !== null && js > ps) {
      const j = dubaiParts(joined);
      from = Math.max(first, monthIndex(j) + (j.day <= rule.cutoffDay ? 0 : 1));
    }
    if (left && ls !== null && ls < pe) {
      const l = dubaiParts(left);
      to = Math.min(last, monthIndex(l) - (l.day > rule.cutoffDay ? 0 : 1));
    }
    return { num: Math.max(0, to - from + 1), den };
  }
  return { num: 1, den: 1 };
}

export function applyFraction(amountFils: number, f: Fraction): number {
  if (f.den === f.num) return amountFils;
  return roundDiv(amountFils * f.num, f.den);
}

// ---------------------------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------------------------

export type DiscountRule = {
  kind: FeeDiscountKind;
  method: DiscountMethod;
  /** Percent in basis points (PERCENT). */
  percentBp?: number | null;
  /** Amount in fils already scaled to this line (FIXED). */
  amountFils?: number | null;
  labelEn: string;
  labelAr: string;
};

export type AppliedDiscount = { kind: FeeDiscountKind; labelEn: string; labelAr: string; amountFils: number };

/**
 * Discount stacking order (documented in docs/guides/fees.md and tested):
 *   1. staff child, 2. scholarship, 3. bursary, 4. other awards, 5. sibling.
 * Within a kind, percentage discounts come before fixed amounts. Each discount is worked out on what is left after
 * the ones before it, and no discount takes a line below zero. With BEST_ONLY the single largest discount applies.
 * Early payment discounts are not part of a line: they are given as a credit note when an invoice is paid early.
 */
export const DISCOUNT_ORDER: FeeDiscountKind[] = ["STAFF_CHILD", "SCHOLARSHIP", "BURSARY", "OTHER", "SIBLING"];

export function sortDiscounts(rules: DiscountRule[]): DiscountRule[] {
  const rank = (r: DiscountRule) => DISCOUNT_ORDER.indexOf(r.kind) * 2 + (r.method === "PERCENT" ? 0 : 1);
  return [...rules].map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

function oneDiscount(rule: DiscountRule, base: number): number {
  const raw = rule.method === "PERCENT" ? bpOf(base, rule.percentBp ?? 0) : rule.amountFils ?? 0;
  return Math.max(0, Math.min(base, raw));
}

export function applyDiscounts(grossFils: number, rules: DiscountRule[], stacking: DiscountStacking): { discountFils: number; applied: AppliedDiscount[] } {
  if (grossFils <= 0 || rules.length === 0) return { discountFils: 0, applied: [] };
  if (stacking === "BEST_ONLY") {
    let best: { rule: DiscountRule; amount: number } | null = null;
    for (const rule of sortDiscounts(rules)) {
      const amount = oneDiscount(rule, grossFils);
      if (amount > 0 && (!best || amount > best.amount)) best = { rule, amount };
    }
    return best ? { discountFils: best.amount, applied: [{ kind: best.rule.kind, labelEn: best.rule.labelEn, labelAr: best.rule.labelAr, amountFils: best.amount }] } : { discountFils: 0, applied: [] };
  }
  let remaining = grossFils;
  const applied: AppliedDiscount[] = [];
  for (const rule of sortDiscounts(rules)) {
    if (remaining <= 0) break;
    const amount = oneDiscount(rule, remaining);
    if (amount <= 0) continue;
    remaining -= amount;
    applied.push({ kind: rule.kind, labelEn: rule.labelEn, labelAr: rule.labelAr, amountFils: amount });
  }
  return { discountFils: grossFils - remaining, applied };
}

/** Sibling discount for the nth child (1-based) on the family account. */
export function siblingBp(position: number, s: { siblingSecondBp: number; siblingThirdBp: number; siblingFourthBp: number }): number {
  if (position <= 1) return 0;
  if (position === 2) return s.siblingSecondBp;
  if (position === 3) return s.siblingThirdBp;
  return s.siblingFourthBp;
}

/**
 * Order of children for the sibling discount: the eldest child is the first child and pays the full fee.
 * Highest grade first, then date of birth, then student number, so the order is stable.
 */
export function siblingOrder<T extends { id: string; gradeLevel: number; dateOfBirth: Date | null; studentNo: string }>(students: T[]): T[] {
  return [...students].sort(
    (a, b) =>
      b.gradeLevel - a.gradeLevel ||
      (a.dateOfBirth && b.dateOfBirth ? a.dateOfBirth.getTime() - b.dateOfBirth.getTime() : a.dateOfBirth ? -1 : b.dateOfBirth ? 1 : 0) ||
      a.studentNo.localeCompare(b.studentNo),
  );
}

// ---------------------------------------------------------------------------------------------
// Invoice lines
// ---------------------------------------------------------------------------------------------

export type LineInput = {
  studentId: string | null;
  feeItemId: string | null;
  kind: FeeItemKind;
  descriptionEn: string;
  descriptionAr: string;
  quantity: number;
  unitFils: number;
  vatTreatment: VatTreatment;
  prorata?: Fraction;
  discounts?: DiscountRule[];
};

export type ComputedLine = {
  seq: number;
  studentId: string | null;
  feeItemId: string | null;
  kind: FeeItemKind;
  descriptionEn: string;
  descriptionAr: string;
  quantity: number;
  unitFils: number;
  grossFils: number;
  discountFils: number;
  netFils: number;
  vatTreatment: VatTreatment;
  vatRateBp: number;
  vatFils: number;
  totalFils: number;
  prorataNum: number;
  prorataDen: number;
  discounts: AppliedDiscount[];
};

export type Totals = { subtotalFils: number; discountFils: number; netFils: number; vatFils: number; totalFils: number };

export type VatSettings = { vatRegistered: boolean; standardVatBp: number; discountStacking: DiscountStacking };

/** Work out one line: gross (quantity x unit, then pro rata), discounts in order, VAT per line on the net amount. */
export function computeLine(input: LineInput, seq: number, s: VatSettings): ComputedLine {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error("quantity must be a positive integer");
  if (!Number.isInteger(input.unitFils) || input.unitFils < 0) throw new Error("unit price must be whole fils");
  const fraction = input.prorata ?? { num: 1, den: 1 };
  const gross = applyFraction(input.quantity * input.unitFils, fraction);
  const { discountFils, applied } = applyDiscounts(gross, input.discounts ?? [], s.discountStacking);
  const net = gross - discountFils;
  const rate = vatRateFor(input.vatTreatment, s);
  const vat = vatOf(net, rate);
  return {
    seq,
    studentId: input.studentId,
    feeItemId: input.feeItemId,
    kind: input.kind,
    descriptionEn: input.descriptionEn,
    descriptionAr: input.descriptionAr,
    quantity: input.quantity,
    unitFils: input.unitFils,
    grossFils: gross,
    discountFils,
    netFils: net,
    vatTreatment: input.vatTreatment,
    vatRateBp: rate,
    vatFils: vat,
    totalFils: net + vat,
    prorataNum: fraction.num,
    prorataDen: fraction.den,
    discounts: applied,
  };
}

export function totalsOf(lines: Array<Pick<ComputedLine, "grossFils" | "discountFils" | "netFils" | "vatFils" | "totalFils">>): Totals {
  return lines.reduce<Totals>(
    (t, l) => ({
      subtotalFils: t.subtotalFils + l.grossFils,
      discountFils: t.discountFils + l.discountFils,
      netFils: t.netFils + l.netFils,
      vatFils: t.vatFils + l.vatFils,
      totalFils: t.totalFils + l.totalFils,
    }),
    { subtotalFils: 0, discountFils: 0, netFils: 0, vatFils: 0, totalFils: 0 },
  );
}

/** Credit note line for part of an invoice line's net amount, with VAT at the line's own rate. */
export function creditLine(netFils: number, vatRateBp: number) {
  const vat = vatOf(netFils, vatRateBp);
  return { netFils, vatFils: vat, totalFils: netFils + vat };
}

/**
 * Credit for a leaver: the part of a pro rata line no longer used. The line was billed for `billed` units out of
 * `den`; after leaving, the student uses `kept` units. The credit is the line's net amount for the difference.
 */
export function leaverCredit(lineNetFils: number, billed: number, kept: number): number {
  if (billed <= 0 || kept >= billed) return 0;
  return lineNetFils - roundDiv(lineNetFils * Math.max(0, kept), billed);
}

// ---------------------------------------------------------------------------------------------
// Allocation of money to invoices
// ---------------------------------------------------------------------------------------------

export type OpenInvoice = { id: string; dueDate: Date; issueDate: Date; number: string; balanceFils: number };

/**
 * Oldest-due-first allocation (FIFO): money goes to the invoice due first, then the next. Ties go to the earlier
 * issue date, then the invoice number. Returns what each invoice receives and what is left over as credit.
 */
export function allocateFifo(amountFils: number, invoices: OpenInvoice[]): { allocations: Array<{ invoiceId: string; amountFils: number }>; leftoverFils: number } {
  let left = amountFils;
  const allocations: Array<{ invoiceId: string; amountFils: number }> = [];
  const sorted = [...invoices]
    .filter((i) => i.balanceFils > 0)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.issueDate.getTime() - b.issueDate.getTime() || a.number.localeCompare(b.number));
  for (const inv of sorted) {
    if (left <= 0) break;
    const take = Math.min(left, inv.balanceFils);
    allocations.push({ invoiceId: inv.id, amountFils: take });
    left -= take;
  }
  return { allocations, leftoverFils: left };
}

/** Invoice payment state from its amounts. */
export function invoiceStatusFor(inv: { kind: "PROFORMA" | "TAX"; totalFils: number; paidFils: number; creditedFils: number }): "OPEN" | "PARTIAL" | "PAID" | "CREDITED" {
  const settled = inv.paidFils + inv.creditedFils;
  if (inv.totalFils > 0 && inv.creditedFils >= inv.totalFils) return "CREDITED";
  if (settled >= inv.totalFils) return "PAID";
  if (settled > 0) return "PARTIAL";
  return "OPEN";
}

// ---------------------------------------------------------------------------------------------
// Aging
// ---------------------------------------------------------------------------------------------

export type AgingBucket = "current" | "d0_30" | "d31_60" | "d61_90" | "d90p";
export const AGING_BUCKETS: AgingBucket[] = ["current", "d0_30", "d31_60", "d61_90", "d90p"];

/** Days past due (0 on the due date) bucketed as 0-30, 31-60, 61-90 and 90+; not yet due is "current". */
export function agingBucket(dueDate: Date, now: Date): AgingBucket {
  const days = dubaiDayNumber(now) - dubaiDayNumber(dueDate);
  if (days < 0) return "current";
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90p";
}

export function daysPastDue(dueDate: Date, now: Date): number {
  return dubaiDayNumber(now) - dubaiDayNumber(dueDate);
}
