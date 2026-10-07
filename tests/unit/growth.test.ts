import { describe, expect, it } from "vitest";
import {
  clampAssumptions,
  computeRoi,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PRICING,
  normalizePricing,
  parseOfferInputs,
  priceQuote,
  pricingVisible,
  withCore,
  type PricingConfig,
} from "@/lib/roi";
import { csvCell, parseLeadContact, toCsv } from "@/lib/leads";
import { areaExplanation, cleanAnswers, scoreTaster, TASTER_QUESTIONS, teaser } from "@/server/marketing/taster";
import { leadIdFromToken, resultToken } from "@/server/marketing/leads";
import { composeLeadEmail } from "@/server/marketing/lead-email";
import { normalizeReferralCode } from "@/server/platform/referrals";
import { isPlatformAdminEmail } from "@/server/platform/catalog-db";
import { allUp, heartbeatFresh, overallUptime, slotStart, type DayStatus } from "@/server/status/status";

describe("ROI estimate", () => {
  it("adds up hours saved per school month from the documented defaults", () => {
    // 600 students, defaults:
    // letters 600*1/10*10 = 600 min, absence 600*0.5*3 = 900, meetings 600*2/10*6 = 720, messages 600*1*2 = 1200.
    const r = computeRoi({ students: 600, staffCostPerHour: 60, assumptions: DEFAULT_ASSUMPTIONS });
    expect(r.hours).toEqual({ letters: 10, absence: 15, meetings: 12, communication: 20 });
    expect(r.totalHoursMonth).toBe(57);
    expect(r.valueMonth).toBe(3420);
    expect(r.valueYear).toBe(34200);
  });

  it("follows edited assumptions and the staff cost", () => {
    const r = computeRoi({ students: 100, staffCostPerHour: 100, assumptions: { ...DEFAULT_ASSUMPTIONS, minutesPerMessage: 0, minutesPerAbsence: 0, minutesPerMeeting: 0, minutesPerLetter: 60, lettersPerStudentYear: 1.2, schoolMonthsPerYear: 12 } });
    // 100 * 1.2 / 12 = 10 letters a month, an hour each.
    expect(r.totalHoursMonth).toBe(10);
    expect(r.valueMonth).toBe(1000);
    expect(r.valueYear).toBe(12000);
  });

  it("is zero for zero students and clamps nonsense input", () => {
    expect(computeRoi({ students: 0, staffCostPerHour: 60, assumptions: DEFAULT_ASSUMPTIONS }).totalHoursMonth).toBe(0);
    const a = clampAssumptions({ minutesPerLetter: 9999, schoolMonthsPerYear: 0, lettersPerStudentYear: -3 });
    expect(a.minutesPerLetter).toBe(120);
    expect(a.schoolMonthsPerYear).toBe(1);
    expect(a.lettersPerStudentYear).toBe(0);
    expect(computeRoi({ students: 100, staffCostPerHour: Number.NaN, assumptions: DEFAULT_ASSUMPTIONS }).valueMonth).toBe(0);
  });
});

describe("price quote", () => {
  const priced: PricingConfig = {
    ...DEFAULT_PRICING,
    published: true,
    perStudent: { core: 100, safeguarding: 20, academics: 40, career: 30, applications: null },
    pilotDiscountPct: 50,
    pilotMonths: 3,
    minimumAnnual: 20000,
    minimumPerCampus: 15000,
  };

  it("shows no price by default", () => {
    expect(pricingVisible(DEFAULT_PRICING)).toBe(false);
    expect(priceQuote(DEFAULT_PRICING, { students: 500, campuses: 1, modules: ["core"], plan: "year" })).toBeNull();
  });

  it("prices a full year per student and module, core always included", () => {
    const q = priceQuote(priced, { students: 500, campuses: 1, modules: ["safeguarding"], plan: "year" })!;
    expect(q.lines.map((l) => l.module)).toEqual(["core", "safeguarding"]);
    expect(q.annualList).toBe(60000);
    expect(q.total).toBe(60000);
    expect(q.minimumApplied).toBe(false);
  });

  it("prices a pilot pro rata with the discount, and applies the minimum", () => {
    const q = priceQuote(priced, { students: 500, campuses: 1, modules: [], plan: "pilot" })!;
    // 50,000 a year, 3 months = 12,500, half off = 6,250; minimum 20,000 a year pro rata = 5,000.
    expect(q.subtotal).toBe(6250);
    expect(q.discount).toBe(6250);
    expect(q.total).toBe(6250);
    const small = priceQuote(priced, { students: 50, campuses: 2, modules: [], plan: "year" })!;
    // 5,000 list; minimum is max(20,000, 2 * 15,000) = 30,000.
    expect(small.minimumApplied).toBe(true);
    expect(small.total).toBe(30000);
  });

  it("falls back to an offer when a chosen module has no price or prices are unpublished", () => {
    expect(priceQuote(priced, { students: 500, campuses: 1, modules: ["applications"], plan: "year" })).toBeNull();
    expect(priceQuote({ ...priced, published: false }, { students: 500, campuses: 1, modules: [], plan: "year" })).toBeNull();
  });

  it("normalizes stored settings", () => {
    const n = normalizePricing({ currency: "usd", perStudent: { core: -5, career: "x", academics: 12.345 }, pilotDiscountPct: 300, pilotMonths: 40, published: "yes" });
    expect(n.currency).toBe("AED");
    expect(n.perStudent.core).toBeNull();
    expect(n.perStudent.career).toBeNull();
    expect(n.perStudent.academics).toBe(12.35);
    expect(n.pilotDiscountPct).toBe(100);
    expect(n.pilotMonths).toBe(12);
    expect(n.published).toBe(false);
    expect(withCore(["career", "core"])).toEqual(["core", "career"]);
  });

  it("validates offer inputs", () => {
    expect(parseOfferInputs({ students: 400, campuses: 2, modules: ["career", "bogus"], plan: "pilot", staffCostPerHour: 75 })).toMatchObject({ students: 400, campuses: 2, modules: ["core", "career"], plan: "pilot", staffCostPerHour: 75 });
    expect(parseOfferInputs({ students: 0, campuses: 1, modules: [], plan: "year" })).toBeNull();
    expect(parseOfferInputs({ students: 10.5, campuses: 1, modules: [], plan: "year" })).toBeNull();
    expect(parseOfferInputs({ students: 10, campuses: 1, modules: [], plan: "forever" })).toBeNull();
  });
});

describe("lead validation", () => {
  const base = { name: "Lina Haddad", email: " Lina@Example.com ", role: "PARENT", schoolName: "", consent: true, locale: "ar" };

  it("accepts a valid contact and normalizes it", () => {
    const r = parseLeadContact(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.email).toBe("lina@example.com");
      expect(r.data.schoolName).toBeNull();
      expect(r.data.locale).toBe("ar");
    }
  });

  it("names the first bad field", () => {
    expect(parseLeadContact({ ...base, consent: false })).toEqual({ ok: false, field: "consent" });
    expect(parseLeadContact({ ...base, email: "not-an-email" })).toEqual({ ok: false, field: "email" });
    expect(parseLeadContact({ ...base, role: "TEACHER" })).toEqual({ ok: false, field: "role" });
    expect(parseLeadContact({ ...base, name: "A" })).toEqual({ ok: false, field: "name" });
    expect(parseLeadContact(base, { requireSchool: true })).toEqual({ ok: false, field: "schoolName" });
    expect(parseLeadContact({ ...base, schoolName: "Al Noor School" }, { requireSchool: true }).ok).toBe(true);
  });

  it("writes CSV cells that spreadsheets will not run", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell('Say "hi"')).toBe(`"Say ""hi"""`);
    expect(toCsv(["a", "b"], [[1, null]])).toBe(`"a","b"\r\n"1",""\r\n`);
  });
});

describe("career taster", () => {
  it("is a 12-statement short form covering all nine strengths", () => {
    expect(TASTER_QUESTIONS).toHaveLength(12);
    expect(new Set(TASTER_QUESTIONS.map((q) => q.dimension)).size).toBe(9);
    for (const q of TASTER_QUESTIONS) expect(q.text.ar).toMatch(/[؀-ۿ]/);
  });

  it("requires every answer to be 1 to 5", () => {
    const all = Object.fromEntries(TASTER_QUESTIONS.map((q) => [q.id, 3]));
    expect(cleanAnswers(all)).not.toBeNull();
    expect(cleanAnswers({ ...all, q1: 6 })).toBeNull();
    expect(cleanAnswers({ ...all, q2: undefined })).toBeNull();
    expect(cleanAnswers({ ...all, extra: 9 })).toEqual(all);
  });

  it("ranks areas deterministically and explains them in both languages", () => {
    const techy = Object.fromEntries(TASTER_QUESTIONS.map((q) => [q.id, ["analytical", "technical", "investigative"].includes(q.dimension) ? 5 : 1]));
    const caring = Object.fromEntries(TASTER_QUESTIONS.map((q) => [q.id, ["social", "verbal"].includes(q.dimension) ? 5 : 1]));
    const a = scoreTaster(techy);
    expect(scoreTaster(techy)).toEqual(a);
    expect(a.areas[0].name.en).toMatch(/Technology|Engineering|Science/);
    expect(scoreTaster(caring).areas[0].name.en).toMatch(/Education|Health/);
    const t = teaser(a, "ar");
    expect(t).toHaveLength(3);
    expect(t[0].explanation).toMatch(/[؀-ۿ]/);
    expect(areaExplanation(a.areas[0], "en")).toContain(a.areas[0].name.en.toLowerCase());
  });

  it("signs result links and rejects forged ones", () => {
    const token = resultToken("clxyz1234567890abcdef");
    expect(leadIdFromToken(token)).toBe("clxyz1234567890abcdef");
    expect(leadIdFromToken(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(leadIdFromToken("clother1234567890abcd." + token.split(".")[1])).toBeNull();
    expect(leadIdFromToken("../../etc")).toBeNull();
  });

  it("composes the result email in the visitor's language with the private link", () => {
    process.env.APP_URL = "https://app.test";
    const answers = Object.fromEntries(TASTER_QUESTIONS.map((q) => [q.id, 4]));
    const mail = composeLeadEmail({ id: "clxyz1234567890abcdef", type: "TASTER", name: "Lina", locale: "ar", payload: { answers } });
    expect(mail.subject).toMatch(/[؀-ۿ]/);
    expect(mail.linkUrl).toBe(`https://app.test/try/result/${resultToken("clxyz1234567890abcdef")}`);
    expect(mail.body).toContain("1. ");
  });
});

describe("referrals and platform admins", () => {
  it("accepts only well-formed referral codes", () => {
    expect(normalizeReferralCode(" abcd2345 ")).toBe("ABCD2345");
    expect(normalizeReferralCode("ABCD1234")).toBeNull(); // 1 is not in the alphabet
    expect(normalizeReferralCode("SHORT")).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });

  it("never treats a demo address as a platform admin in production", () => {
    const prev = process.env.PLATFORM_ADMIN_EMAILS;
    process.env.PLATFORM_ADMIN_EMAILS = "owner@realschool.ae, aisha.rahman@horizon.example";
    expect(isPlatformAdminEmail("Owner@RealSchool.ae", "production")).toBe(true);
    expect(isPlatformAdminEmail("aisha.rahman@horizon.example", "production")).toBe(false);
    expect(isPlatformAdminEmail("aisha.rahman@horizon.example", "development")).toBe(true);
    expect(isPlatformAdminEmail("someone@else.ae", "production")).toBe(false);
    process.env.PLATFORM_ADMIN_EMAILS = prev;
  });
});

describe("status", () => {
  it("buckets times into 5-minute slots", () => {
    expect(slotStart(new Date("2026-10-06T10:07:59Z")).toISOString()).toBe("2026-10-06T10:05:00.000Z");
    expect(slotStart(new Date("2026-10-06T10:10:00Z")).toISOString()).toBe("2026-10-06T10:10:00.000Z");
  });

  it("treats a heartbeat older than three minutes as down", () => {
    const now = new Date("2026-10-06T10:00:00Z");
    expect(heartbeatFresh(String(now.getTime() - 60_000), now)).toBe(true);
    expect(heartbeatFresh(String(now.getTime() - 4 * 60_000), now)).toBe(false);
    expect(heartbeatFresh(null, now)).toBe(false);
    expect(heartbeatFresh("garbage", now)).toBe(false);
  });

  it("counts a component as down, but an unknown web check as up", () => {
    expect(allUp({ web: null, database: true, redis: true, worker: true })).toBe(true);
    expect(allUp({ web: false, database: true, redis: true, worker: true })).toBe(false);
    expect(allUp({ web: true, database: true, redis: true, worker: false })).toBe(false);
  });

  it("computes overall uptime over expected slots", () => {
    const day = (expected: number, up: number): DayStatus => ({ day: "x", expected, samples: up, up, uptime: null, components: { web: 0, database: 0, redis: 0, worker: 0 } });
    expect(overallUptime([day(0, 0)])).toBeNull();
    expect(overallUptime([day(288, 288), day(288, 144)])).toBe(75);
  });
});
