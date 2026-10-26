import { describe, expect, it } from "vitest";
import {
  agingBucket,
  allocateFifo,
  applyDiscounts,
  bpOf,
  computeLine,
  equalShares,
  formatAed,
  instalmentAmount,
  invoiceStatusFor,
  leaverCredit,
  parseAedToFils,
  prorataFraction,
  roundDiv,
  siblingBp,
  siblingOrder,
  totalsOf,
  vatOf,
  type DiscountRule,
} from "@/server/fees/money";
import { reminderStage } from "@/server/fees/notices";
import { suggestParts, validatePlanParts, validateSettings, type SettingsInput } from "@/server/fees/schedule";
import { verifySignatureHeader, signPayload } from "@/server/payments/signature";

const d = (s: string) => new Date(`${s}T00:00:00+04:00`);
const S = { vatRegistered: true, standardVatBp: 500, discountStacking: "STACK" as const };

describe("rounding in fils", () => {
  it("rounds half away from zero", () => {
    expect(roundDiv(5, 10)).toBe(1);
    expect(roundDiv(4, 10)).toBe(0);
    expect(roundDiv(-5, 10)).toBe(-1);
    expect(roundDiv(15, 10)).toBe(2);
    expect(roundDiv(14, 10)).toBe(1);
  });
  it("takes VAT per line at 5% rounded to the fils", () => {
    expect(vatOf(10_000, 500)).toBe(500);
    expect(vatOf(1_010, 500)).toBe(51); // 50.5 fils rounds up
    expect(vatOf(1_009, 500)).toBe(50); // 50.45 fils rounds down
    expect(vatOf(33_333, 500)).toBe(1_667);
    expect(bpOf(1_850_000, 500)).toBe(92_500);
  });
  it("formats and parses AED", () => {
    expect(formatAed(1_850_000)).toBe("AED 18,500.00");
    expect(formatAed(-1_234_505, "ar")).toBe("-12,345.05 د.إ");
    expect(parseAedToFils("18,500.5")).toBe(1_850_050);
    expect(parseAedToFils("12.345")).toBeNull();
    expect(parseAedToFils("-1")).toBeNull();
  });
});

describe("instalments", () => {
  it("split an annual fee so the parts add up exactly", () => {
    const annual = 2_345_671;
    const shares = [4000, 3000, 3000];
    let cum = 0;
    const parts = shares.map((s) => {
      const a = instalmentAmount(annual, cum, s);
      cum += s;
      return a;
    });
    expect(parts.reduce((a, b) => a + b, 0)).toBe(annual);
    expect(parts[0]).toBe(938_268);
  });
  it("equal monthly shares add up to 100%", () => {
    const s = equalShares(10);
    expect(s.reduce((a, b) => a + b, 0)).toBe(10_000);
    const t = equalShares(3);
    expect(t).toEqual([3333, 3333, 3334]);
    let cum = 0;
    const amounts = t.map((x) => {
      const a = instalmentAmount(1_000_000, cum, x);
      cum += x;
      return a;
    });
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(1_000_000);
  });
  it("suggests 40/30/30 for three terms and validates plans", () => {
    const year = { startsOn: d("2026-08-24"), endsOn: d("2027-07-02") };
    const terms = [
      { nameEn: "Autumn term", nameAr: "الفصل الأول", startsOn: d("2026-08-24"), endsOn: d("2026-12-12") },
      { nameEn: "Spring term", nameAr: "الفصل الثاني", startsOn: d("2027-01-05"), endsOn: d("2027-03-27") },
      { nameEn: "Summer term", nameAr: "الفصل الثالث", startsOn: d("2027-04-13"), endsOn: d("2027-07-02") },
    ];
    const parts = suggestParts("TERMLY", year, terms);
    expect(parts.map((p) => p.shareBp)).toEqual([4000, 3000, 3000]);
    expect(validatePlanParts(parts)).toBeNull();
    expect(validatePlanParts([{ ...parts[0], shareBp: 9000 }])).toBe("SHARES_TOTAL");
    expect(suggestParts("MONTHLY", year, terms)).toHaveLength(10);
  });
});

describe("pro rata", () => {
  const term = { start: d("2026-09-01"), end: d("2026-12-31") };
  it("charges whole months from the joining month when joining on or before the cutoff", () => {
    expect(prorataFraction(term, d("2026-10-10"), null, { basis: "MONTH", cutoffDay: 15 })).toEqual({ num: 3, den: 4 });
    expect(prorataFraction(term, d("2026-10-20"), null, { basis: "MONTH", cutoffDay: 15 })).toEqual({ num: 2, den: 4 });
    expect(prorataFraction(term, d("2026-08-20"), null, { basis: "MONTH", cutoffDay: 15 })).toEqual({ num: 4, den: 4 });
    expect(prorataFraction(term, d("2027-01-20"), null, { basis: "MONTH", cutoffDay: 15 })).toEqual({ num: 0, den: 1 });
  });
  it("charges leavers up to the leaving month after the cutoff", () => {
    expect(prorataFraction(term, null, d("2026-10-10"), { basis: "MONTH", cutoffDay: 15 })).toEqual({ num: 1, den: 4 });
    expect(prorataFraction(term, null, d("2026-10-20"), { basis: "MONTH", cutoffDay: 15 })).toEqual({ num: 2, den: 4 });
  });
  it("supports days and whole terms", () => {
    expect(prorataFraction(term, d("2026-12-02"), null, { basis: "DAY", cutoffDay: 15 })).toEqual({ num: 30, den: 122 });
    expect(prorataFraction(term, d("2026-12-02"), null, { basis: "TERM", cutoffDay: 15 })).toEqual({ num: 1, den: 1 });
    expect(prorataFraction(term, d("2027-02-02"), null, { basis: "TERM", cutoffDay: 15 })).toEqual({ num: 0, den: 1 });
  });
  it("credits leavers for the unused part of a pro rata line", () => {
    expect(leaverCredit(740_000, 4, 2)).toBe(370_000);
    expect(leaverCredit(740_000, 3, 1)).toBe(740_000 - 246_667);
    expect(leaverCredit(740_000, 4, 4)).toBe(0);
  });
});

describe("discount stacking", () => {
  const sib: DiscountRule = { kind: "SIBLING", method: "PERCENT", percentBp: 1000, labelEn: "Sibling", labelAr: "أخوة" };
  const staff: DiscountRule = { kind: "STAFF_CHILD", method: "PERCENT", percentBp: 5000, labelEn: "Staff", labelAr: "موظف" };
  const bursary: DiscountRule = { kind: "BURSARY", method: "FIXED", amountFils: 100_000, labelEn: "Bursary", labelAr: "منحة" };
  it("applies staff, then awards, then sibling, each on what is left", () => {
    const r = applyDiscounts(1_000_000, [sib, bursary, staff], "STACK");
    // staff 50% of 10,000 = 5,000; bursary 1,000 of 5,000 left; sibling 10% of 4,000 = 400
    expect(r.applied.map((a) => [a.kind, a.amountFils])).toEqual([
      ["STAFF_CHILD", 500_000],
      ["BURSARY", 100_000],
      ["SIBLING", 40_000],
    ]);
    expect(r.discountFils).toBe(640_000);
  });
  it("never takes a line below zero", () => {
    const big: DiscountRule = { kind: "SCHOLARSHIP", method: "PERCENT", percentBp: 10_000, labelEn: "Full", labelAr: "كاملة" };
    expect(applyDiscounts(500_000, [big, sib, bursary], "STACK").discountFils).toBe(500_000);
  });
  it("BEST_ONLY applies the single largest discount", () => {
    const r = applyDiscounts(1_000_000, [sib, staff], "BEST_ONLY");
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].kind).toBe("STAFF_CHILD");
  });
  it("orders siblings eldest first and gives 2nd 5%, 3rd and later 10% by default", () => {
    const kids = [
      { id: "a", gradeLevel: 3, dateOfBirth: d("2019-01-01"), studentNo: "1" },
      { id: "b", gradeLevel: 9, dateOfBirth: d("2012-01-01"), studentNo: "2" },
      { id: "c", gradeLevel: -1, dateOfBirth: d("2022-01-01"), studentNo: "3" },
    ];
    expect(siblingOrder(kids).map((k) => k.id)).toEqual(["b", "a", "c"]);
    const cfg = { siblingSecondBp: 500, siblingThirdBp: 1000, siblingFourthBp: 1000 };
    expect([1, 2, 3, 4].map((p) => siblingBp(p, cfg))).toEqual([0, 500, 1000, 1000]);
  });
});

describe("invoice lines", () => {
  it("works out gross, discount, net, VAT per line and totals", () => {
    const tuition = computeLine({ studentId: "s", feeItemId: "f", kind: "TUITION", descriptionEn: "Tuition", descriptionAr: "رسوم", quantity: 1, unitFils: 740_000, vatTreatment: "ZERO_RATED", discounts: [{ kind: "SIBLING", method: "PERCENT", percentBp: 500, labelEn: "S", labelAr: "س" }] }, 1, S);
    expect(tuition).toMatchObject({ grossFils: 740_000, discountFils: 37_000, netFils: 703_000, vatRateBp: 0, vatFils: 0, totalFils: 703_000 });
    const bus = computeLine({ studentId: "s", feeItemId: "t", kind: "TRANSPORT", descriptionEn: "Bus", descriptionAr: "حافلة", quantity: 1, unitFils: 200_001, vatTreatment: "STANDARD", prorata: { num: 3, den: 4 } }, 2, S);
    expect(bus).toMatchObject({ grossFils: 150_001, netFils: 150_001, vatRateBp: 500, vatFils: 7_500, totalFils: 157_501 });
    const uniform = computeLine({ studentId: null, feeItemId: "u", kind: "UNIFORM", descriptionEn: "Uniform", descriptionAr: "زي", quantity: 3, unitFils: 9_550, vatTreatment: "STANDARD" }, 3, S);
    expect(uniform).toMatchObject({ grossFils: 28_650, vatFils: 1_433, totalFils: 30_083 });
    expect(totalsOf([tuition, bus, uniform])).toEqual({ subtotalFils: 918_651, discountFils: 37_000, netFils: 881_651, vatFils: 8_933, totalFils: 890_584 });
  });
  it("charges no VAT when the school is not VAT registered", () => {
    const l = computeLine({ studentId: null, feeItemId: null, kind: "UNIFORM", descriptionEn: "U", descriptionAr: "ز", quantity: 1, unitFils: 10_000, vatTreatment: "STANDARD" }, 1, { ...S, vatRegistered: false });
    expect(l.vatFils).toBe(0);
  });
  it("rejects fractional amounts and quantities", () => {
    expect(() => computeLine({ studentId: null, feeItemId: null, kind: "OTHER", descriptionEn: "x", descriptionAr: "x", quantity: 1.5, unitFils: 100, vatTreatment: "STANDARD" }, 1, S)).toThrow();
    expect(() => computeLine({ studentId: null, feeItemId: null, kind: "OTHER", descriptionEn: "x", descriptionAr: "x", quantity: 1, unitFils: 10.5, vatTreatment: "STANDARD" }, 1, S)).toThrow();
  });
});

describe("allocation and status", () => {
  const inv = (id: string, due: string, bal: number) => ({ id, dueDate: d(due), issueDate: d("2026-08-01"), number: id, balanceFils: bal });
  it("pays the oldest due invoice first and keeps the rest as credit", () => {
    const r = allocateFifo(500_000, [inv("B", "2026-12-01", 300_000), inv("A", "2026-09-01", 250_000)]);
    expect(r.allocations).toEqual([
      { invoiceId: "A", amountFils: 250_000 },
      { invoiceId: "B", amountFils: 250_000 },
    ]);
    expect(r.leftoverFils).toBe(0);
    expect(allocateFifo(100_000, [inv("A", "2026-09-01", 40_000)]).leftoverFils).toBe(60_000);
  });
  it("derives the invoice status", () => {
    expect(invoiceStatusFor({ kind: "TAX", totalFils: 100, paidFils: 0, creditedFils: 0 })).toBe("OPEN");
    expect(invoiceStatusFor({ kind: "TAX", totalFils: 100, paidFils: 40, creditedFils: 0 })).toBe("PARTIAL");
    expect(invoiceStatusFor({ kind: "TAX", totalFils: 100, paidFils: 60, creditedFils: 40 })).toBe("PAID");
    expect(invoiceStatusFor({ kind: "TAX", totalFils: 100, paidFils: 0, creditedFils: 100 })).toBe("CREDITED");
  });
  it("buckets aging as 0-30, 31-60, 61-90 and 90+", () => {
    const now = d("2026-10-26");
    expect(agingBucket(d("2026-11-01"), now)).toBe("current");
    expect(agingBucket(d("2026-10-26"), now)).toBe("d0_30");
    expect(agingBucket(d("2026-09-26"), now)).toBe("d0_30");
    expect(agingBucket(d("2026-09-25"), now)).toBe("d31_60");
    expect(agingBucket(d("2026-07-28"), now)).toBe("d61_90");
    expect(agingBucket(d("2026-07-27"), now)).toBe("d90p");
  });
});

describe("reminders", () => {
  const cfg = { reminderDaysBefore: 7, reminderDaysAfter: [7, 21, 45] };
  it("sends the latest stage only", () => {
    const due = d("2026-10-20");
    expect(reminderStage(due, d("2026-10-10"), cfg)).toBeNull();
    expect(reminderStage(due, d("2026-10-14"), cfg)).toBe("before");
    expect(reminderStage(due, d("2026-10-22"), cfg)).toBeNull();
    expect(reminderStage(due, d("2026-10-27"), cfg)).toBe("after7");
    expect(reminderStage(due, d("2026-12-20"), cfg)).toBe("after45");
  });
});

describe("settings validation", () => {
  const base: SettingsInput = {
    legalNameEn: "X",
    legalNameAr: "س",
    addressEn: "Sharjah",
    addressAr: "الشارقة",
    trn: "100123456700003",
    vatRegistered: true,
    standardVatBp: 500,
    invoicePrefix: "INV",
    proformaPrefix: "PF",
    creditNotePrefix: "CN",
    receiptPrefix: "RCT",
    refundPrefix: "RF",
    paymentTermsDays: 14,
    siblingSecondBp: 500,
    siblingThirdBp: 1000,
    siblingFourthBp: 1000,
    discountStacking: "STACK",
    earlyPaymentBp: 200,
    earlyPaymentDays: 7,
    proRataBasis: "MONTH",
    proRataCutoffDay: 15,
    remindersEnabled: true,
    reminderDaysBefore: 7,
    reminderDaysAfter: [7, 21],
    holdReportCards: false,
    holdAfterDays: 30,
    onlinePayments: false,
    bankDetailsEn: "",
    bankDetailsAr: "",
  };
  it("accepts a valid setup and rejects bad TRNs and prefixes", () => {
    expect(validateSettings(base)).toBeNull();
    expect(validateSettings({ ...base, trn: "12345" })).toBe("TRN_INVALID");
    expect(validateSettings({ ...base, invoicePrefix: "PF" })).toBe("PREFIX_DUPLICATE");
    expect(validateSettings({ ...base, proRataCutoffDay: 31 })).toBe("CUTOFF_INVALID");
  });
});

describe("webhook signatures", () => {
  it("accepts a fresh valid signature and rejects tampering and replays", () => {
    const now = new Date("2026-10-26T08:00:00Z");
    const body = '{"id":"evt_1"}';
    const header = signPayload("secret", body, Math.floor(now.getTime() / 1000));
    expect(verifySignatureHeader("secret", body, header, now)).toBe(true);
    expect(verifySignatureHeader("secret", body.replace("1", "2"), header, now)).toBe(false);
    expect(verifySignatureHeader("other", body, header, now)).toBe(false);
    expect(verifySignatureHeader("secret", body, header, new Date(now.getTime() + 10 * 60_000))).toBe(false);
    expect(verifySignatureHeader("secret", body, null, now)).toBe(false);
  });
});
