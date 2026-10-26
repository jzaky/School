// Admissions rules without a database: stage moves, age check, waitlist order, seats, money, admission numbers,
// document types and upload checks.
import { describe, expect, it } from "vitest";
import { boardStages, checkMove, familyCan, familyStatus, nextMoves, phaseOf, seatFeeRequired, stageConfig } from "@/server/admissions/stages";
import { aedToFils, ageFlag, ageOnCutoff, birthRangeFor, canOffer, capacityOf, compareWaitlist, eidDigits, expectedAge, filsToAed, nameDobKey, normName, orderWaitlist, priorityScore, seatsAvailable, validCutoff } from "@/server/admissions/rules";
import { formatAdmissionNo, patternProblem, sequenceKey } from "@/server/admissions/numbers";
import { DEFAULT_DOC_TYPES, docTypes, docTypesFor, missingDocs } from "@/server/admissions/config";
import { checkUpload, hasActivePdfContent, safeFileName, sniff } from "@/server/admissions/files";
import { canSetStatus, defaultAuthority, schoolAuthority } from "@/server/admissions/registration";
import { KG1, KG2 } from "@/lib/grade-levels";

const cfg = stageConfig(null);
const noFee = { seatFeeRequired: false };

describe("stages", () => {
  it("has every system stage in board order with NEW first", () => {
    expect(cfg.map((s) => s.key)).toEqual(["NEW", "DOCUMENTS_PENDING", "ASSESSMENT_BOOKED", "ASSESSED", "OFFER_MADE", "OFFER_ACCEPTED", "SEAT_PAID", "ENROLLED", "WAITLISTED", "DECLINED", "WITHDRAWN"]);
  });

  it("review stages move freely; offers, payment and enrollment need their own action", () => {
    expect(checkMove("NEW", "ASSESSED", cfg, noFee)).toEqual({ ok: true, action: null });
    expect(checkMove("ASSESSED", "NEW", cfg, noFee)).toEqual({ ok: true, action: null });
    expect(checkMove("ASSESSED", "OFFER_MADE", cfg, noFee)).toEqual({ ok: true, action: "offer" });
    expect(checkMove("WAITLISTED", "OFFER_MADE", cfg, noFee)).toEqual({ ok: true, action: "offer" });
    expect(checkMove("OFFER_ACCEPTED", "SEAT_PAID", cfg, noFee)).toEqual({ ok: true, action: "paid" });
    expect(checkMove("SEAT_PAID", "ENROLLED", cfg, noFee)).toEqual({ ok: true, action: "enroll" });
    expect(checkMove("NEW", "DECLINED", cfg, noFee)).toEqual({ ok: true, action: "reason" });
  });

  it("refuses skipping the offer, enrolling without payment when a fee is due, and leaving Enrolled", () => {
    expect(checkMove("NEW", "OFFER_ACCEPTED", cfg, noFee)).toEqual({ ok: false, error: "INVALID" });
    expect(checkMove("NEW", "ENROLLED", cfg, noFee)).toEqual({ ok: false, error: "INVALID" });
    expect(checkMove("OFFER_ACCEPTED", "ENROLLED", cfg, { seatFeeRequired: true })).toEqual({ ok: false, error: "NEEDS_PAYMENT" });
    expect(checkMove("OFFER_ACCEPTED", "ENROLLED", cfg, noFee)).toEqual({ ok: true, action: "enroll" });
    expect(checkMove("ENROLLED", "WITHDRAWN", cfg, noFee)).toEqual({ ok: false, error: "INVALID" });
    expect(checkMove("DRAFT", "NEW", cfg, noFee)).toEqual({ ok: false, error: "INVALID" });
    expect(checkMove("NEW", "NEW", cfg, noFee)).toEqual({ ok: false, error: "SAME" });
    expect(checkMove("OFFER_ACCEPTED", "NEW", cfg, noFee)).toEqual({ ok: false, error: "INVALID" });
  });

  it("closed applications can be reopened into review, not straight into an offer", () => {
    expect(checkMove("WITHDRAWN", "NEW", cfg, noFee).ok).toBe(true);
    expect(checkMove("DECLINED", "OFFER_MADE", cfg, noFee).ok).toBe(false);
    expect(checkMove("DECLINED", "WITHDRAWN", cfg, noFee).ok).toBe(false);
  });

  it("schools rename, hide optional stages and add review stages; required stages cannot be hidden", () => {
    const c = stageConfig([
      { key: "NEW", labelEn: "Inbox", labelAr: "الوارد" },
      { key: "C_PRINCIPAL", labelEn: "Principal interview", labelAr: "مقابلة المدير" },
      { key: "ASSESSED", hidden: true },
      { key: "OFFER_MADE", hidden: true },
      { key: "BOGUS", labelEn: "x" },
      { key: "C_BAD-KEY", labelEn: "x" },
      { key: "C_NOLABEL" },
    ]);
    expect(c.find((s) => s.key === "NEW")?.labelEn).toBe("Inbox");
    expect(c.find((s) => s.key === "C_PRINCIPAL")).toMatchObject({ phase: "review", custom: true });
    expect(c.find((s) => s.key === "ASSESSED")?.hidden).toBe(true);
    expect(c.find((s) => s.key === "OFFER_MADE")?.hidden).toBe(false);
    expect(c.some((s) => s.key === "BOGUS" || s.key === "C_NOLABEL")).toBe(false);
    expect(c.findIndex((s) => s.key === "C_PRINCIPAL")).toBeLessThan(c.findIndex((s) => s.key === "OFFER_MADE"));
    expect(checkMove("NEW", "ASSESSED", c, noFee)).toEqual({ ok: false, error: "HIDDEN" });
    expect(checkMove("NEW", "C_PRINCIPAL", c, noFee)).toEqual({ ok: true, action: null });
    expect(checkMove("C_PRINCIPAL", "OFFER_MADE", c, noFee)).toEqual({ ok: true, action: "offer" });
    // A hidden stage that still holds applications stays on the board.
    expect(boardStages(c, ["ASSESSED"]).some((s) => s.key === "ASSESSED")).toBe(true);
    expect(boardStages(c, []).some((s) => s.key === "ASSESSED")).toBe(false);
  });

  it("seat payment is required only with an amount and a visible Seat booking paid stage", () => {
    expect(seatFeeRequired(cfg, 150000)).toBe(true);
    expect(seatFeeRequired(cfg, 0)).toBe(false);
    expect(seatFeeRequired(stageConfig([{ key: "SEAT_PAID", hidden: true }]), 150000)).toBe(false);
  });

  it("families can only submit drafts, answer open offers before the deadline and withdraw open applications", () => {
    const now = new Date("2026-10-26T08:00:00Z");
    expect(familyCan("DRAFT", "submit", { now })).toBe(true);
    expect(familyCan("NEW", "submit", { now })).toBe(false);
    expect(familyCan("OFFER_MADE", "accept", { now, offerDeadline: new Date("2026-11-01T00:00:00Z") })).toBe(true);
    expect(familyCan("OFFER_MADE", "accept", { now, offerDeadline: new Date("2026-10-20T00:00:00Z") })).toBe(false);
    expect(familyCan("ENROLLED", "withdraw", { now })).toBe(false);
    expect(familyStatus("ASSESSED")).toBe("received");
    expect(familyStatus("SEAT_PAID")).toBe("accepted");
    expect(phaseOf("C_ANYTHING")).toBe("review");
    expect(nextMoves("OFFER_MADE", cfg, noFee).map((m) => m.key)).toEqual(expect.arrayContaining(["OFFER_ACCEPTED", "WAITLISTED", "DECLINED", "WITHDRAWN"]));
  });
});

describe("age check (cut-off 31 December, UAE Ministry of Education, for admissions from 2026-27)", () => {
  const cutoff = { month: 12, day: 31 };
  it("expects KG1 at 4, KG2 at 5 and Grade 1 at 6", () => {
    expect(expectedAge(KG1)).toBe(4);
    expect(expectedAge(KG2)).toBe(5);
    expect(expectedAge(1)).toBe(6);
    expect(expectedAge(12)).toBe(17);
  });

  it("counts age on the cut-off date of the entry year", () => {
    expect(ageOnCutoff(new Date("2023-12-31T00:00:00Z"), 2027, 12, 31)).toBe(4);
    expect(ageOnCutoff(new Date("2024-01-01T00:00:00Z"), 2027, 12, 31)).toBe(3);
    expect(ageOnCutoff(new Date("2023-03-31T00:00:00Z"), 2027, 3, 31)).toBe(4);
    expect(ageOnCutoff(new Date("2023-04-01T00:00:00Z"), 2027, 3, 31)).toBe(3);
  });

  it("flags under and over age without blocking", () => {
    expect(ageFlag(new Date("2023-06-15T00:00:00Z"), KG1, 2027, cutoff).flag).toBeNull();
    expect(ageFlag(new Date("2024-02-01T00:00:00Z"), KG1, 2027, cutoff).flag).toBe("UNDER");
    expect(ageFlag(new Date("2022-06-15T00:00:00Z"), KG1, 2027, cutoff).flag).toBe("OVER");
    expect(ageFlag(null, 3, 2027, cutoff).flag).toBeNull();
    const r = birthRangeFor(KG1, 2027, cutoff);
    expect(r.to.toISOString().slice(0, 10)).toBe("2023-12-31");
    expect(r.from.toISOString().slice(0, 10)).toBe("2022-12-31");
  });

  it("validates cut-off dates", () => {
    expect(validCutoff(12, 31)).toBe(true);
    expect(validCutoff(3, 31)).toBe(true);
    expect(validCutoff(2, 29)).toBe(true);
    expect(validCutoff(2, 30)).toBe(false);
    expect(validCutoff(13, 1)).toBe(false);
  });
});

describe("duplicates", () => {
  it("normalises names and builds the name and date of birth key", () => {
    expect(normName("  José  Al-Hashimi ")).toBe("jose al hashimi");
    expect(nameDobKey("Omar", "Haddad", new Date("2020-05-01T00:00:00Z"))).toBe("omar|haddad|2020-05-01");
    expect(nameDobKey("Omar", "", new Date())).toBeNull();
  });

  it("accepts only well-formed Emirates ID numbers", () => {
    expect(eidDigits("784-2019-1234567-8")).toBe("784201912345678");
    expect(eidDigits("123-2019-1234567-8")).toBeNull();
    expect(eidDigits("784-2019-12345")).toBeNull();
  });
});

describe("waitlist order and seats", () => {
  const base = { siblingStudentIds: [] as string[], staffChildVerified: false, priorityBoost: 0, submittedAt: null, createdAt: new Date("2026-01-01T00:00:00Z") };
  it("orders by priority (siblings, staff children, staff adjustment), then by date", () => {
    const rows = [
      { ...base, id: "a", number: "ADM-1", waitlistedAt: new Date("2026-02-01T00:00:00Z") },
      { ...base, id: "b", number: "ADM-2", waitlistedAt: new Date("2026-03-01T00:00:00Z"), siblingStudentIds: ["s1"] },
      { ...base, id: "c", number: "ADM-3", waitlistedAt: new Date("2026-01-15T00:00:00Z") },
      { ...base, id: "d", number: "ADM-4", waitlistedAt: new Date("2026-04-01T00:00:00Z"), staffChildVerified: true, siblingStudentIds: ["s2"] },
      { ...base, id: "e", number: "ADM-5", waitlistedAt: new Date("2026-01-01T00:00:00Z"), priorityBoost: -1 },
    ];
    expect(orderWaitlist(rows).map((r) => r.id)).toEqual(["d", "b", "c", "a", "e"]);
    expect(orderWaitlist(rows)[0]).toMatchObject({ position: 1, score: 2 });
    expect(priorityScore({ siblingStudentIds: ["x", "y"], staffChildVerified: false, priorityBoost: 0 })).toBe(1);
    expect(compareWaitlist(rows[0], rows[0])).toBe(0);
  });

  it("counts free seats and allows an offer only while one is free", () => {
    expect(capacityOf([24, 24, 20])).toBe(68);
    expect(capacityOf([])).toBeNull();
    const full = { capacity: 10, enrolled: 7, holding: 2, offered: 1, waitlisted: 4 };
    expect(seatsAvailable(full)).toBe(0);
    expect(canOffer(full)).toBe(false);
    expect(canOffer({ ...full, offered: 0 })).toBe(true);
    expect(canOffer({ ...full, capacity: null })).toBe(true);
  });

  it("keeps money in integer fils", () => {
    expect(aedToFils("1,500")).toBe(150000);
    expect(aedToFils("2500.5")).toBe(250050);
    expect(aedToFils("0.07")).toBe(7);
    expect(aedToFils("-5")).toBeNull();
    expect(aedToFils("12.345")).toBeNull();
    expect(filsToAed(150000)).toBe("1,500.00");
    expect(filsToAed(7)).toBe("0.07");
  });
});

describe("admission numbers", () => {
  it("fills the pattern tokens", () => {
    expect(formatAdmissionNo("{YYYY}-{SEQ:4}", { year: 2027, seq: 42, short: "Al Durrah" })).toBe("2027-0042");
    expect(formatAdmissionNo("{SHORT}{YY}{SEQ:5}", { year: 2027, seq: 7, short: "Al Durrah" })).toBe("ALDURR2700007");
    expect(sequenceKey("{YY}{SEQ:4}", 2027)).toBe("admno:{YY}#:2027");
  });

  it("rejects patterns without exactly one counter or with unsafe characters", () => {
    expect(patternProblem("{YYYY}-{SEQ:4}")).toBeNull();
    expect(patternProblem("{YYYY}")).toBe("NO_SEQ");
    expect(patternProblem("{SEQ:4}{SEQ:4}")).toBe("NO_SEQ");
    expect(patternProblem("A B{SEQ:4}")).toBe("CHARS");
    expect(patternProblem("")).toBe("EMPTY");
  });
});

describe("document types", () => {
  it("defaults to the UAE registration documents", () => {
    expect(DEFAULT_DOC_TYPES.map((d) => d.key)).toEqual(["emirates_id", "passport", "residence_visa", "birth_certificate", "vaccination_record", "previous_report", "transfer_certificate", "photo"]);
    expect(docTypes([{ key: "x" }]).length).toBe(DEFAULT_DOC_TYPES.length);
  });

  it("asks only what applies to the child", () => {
    const kg1Emirati = docTypesFor(DEFAULT_DOC_TYPES, KG1, "AE").map((d) => d.key);
    expect(kg1Emirati).not.toContain("residence_visa");
    expect(kg1Emirati).not.toContain("previous_report");
    expect(docTypesFor(DEFAULT_DOC_TYPES, 5, "JO").map((d) => d.key)).toContain("previous_report");
    const missing = missingDocs(DEFAULT_DOC_TYPES, 5, "JO", [{ typeKey: "passport", status: "RECEIVED" }, { typeKey: "emirates_id", status: "REJECTED" }]).map((d) => d.key);
    expect(missing).toContain("emirates_id");
    expect(missing).not.toContain("passport");
    expect(missing).not.toContain("transfer_certificate");
  });
});

describe("uploads", () => {
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48]);
  const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64)]);
  it("recognises documents and photos by content", () => {
    expect(sniff(pdf)?.mime).toBe("application/pdf");
    expect(sniff(png)?.mime).toBe("image/png");
    expect(sniff(exe)).toBeNull();
    expect(sniff(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
  });

  it("refuses executables, renamed files, double extensions, empty and large files, and active PDFs", () => {
    expect(checkUpload("passport.pdf", pdf)).toMatchObject({ ok: true, fileName: "passport.pdf" });
    expect(checkUpload("setup.exe", exe)).toEqual({ ok: false, problem: "TYPE" });
    expect(checkUpload("report.pdf.exe", pdf)).toEqual({ ok: false, problem: "EXTENSION" });
    expect(checkUpload("photo.png", pdf)).toEqual({ ok: false, problem: "EXTENSION" });
    expect(checkUpload("a.pdf", Buffer.alloc(0))).toEqual({ ok: false, problem: "EMPTY" });
    expect(checkUpload("a.pdf", pdf, 10)).toEqual({ ok: false, problem: "TOO_LARGE" });
    const js = Buffer.from("%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>");
    expect(checkUpload("form.pdf", js)).toEqual({ ok: false, problem: "ACTIVE_CONTENT" });
    expect(hasActivePdfContent(Buffer.from("%PDF-1.4 /J#61vaScript"))).toBe(true);
    expect(safeFileName("شهادة الميلاد (نسخة).PDF", "pdf")).toBe("شهادة-الميلاد-نسخة.pdf");
  });
});

describe("government registration", () => {
  it("picks the authority from the regulator unless the school chose one", () => {
    expect(defaultAuthority("SPEA")).toBe("SPEA_DALEEL");
    expect(defaultAuthority("MOE")).toBe("MOE_MANHAL");
    expect(defaultAuthority("KHDA")).toBe("KHDA");
    expect(defaultAuthority(null)).toBe("OTHER");
    expect(schoolAuthority({ authority: "ADEK", authorityLabelEn: null, authorityLabelAr: null }, "SPEA").key).toBe("ADEK");
    expect(schoolAuthority(null, "SPEA").key).toBe("SPEA_DALEEL");
  });

  it("runs not submitted, submitted, then approved or rejected; a rejection can be resubmitted", () => {
    expect(canSetStatus("NOT_SUBMITTED", "SUBMITTED")).toBe(true);
    expect(canSetStatus("NOT_SUBMITTED", "APPROVED")).toBe(false);
    expect(canSetStatus("SUBMITTED", "APPROVED")).toBe(true);
    expect(canSetStatus("SUBMITTED", "REJECTED")).toBe(true);
    expect(canSetStatus("REJECTED", "SUBMITTED")).toBe(true);
    expect(canSetStatus("APPROVED", "REJECTED")).toBe(false);
    expect(canSetStatus("APPROVED", "APPROVED")).toBe(true);
  });
});
