// Inspection mapping, date ranges, evidence formatting, career event and partner validation (pure logic).
import { describe, expect, it } from "vitest";
import { CHECK_NOTE, defaultMapping, EVIDENCE_HEADINGS, FRAMEWORKS, mappingForHeading, resolveMapping } from "@/server/inspection/mapping";
import { dubaiDayKey, lastDays, parseDayRange } from "@/server/inspection/range";
import { median } from "@/server/inspection/evidence";
import { evidenceCsv, metricValue } from "@/server/inspection/format";
import { closesAt, gradeEligible, normalizeEventInput, registrationState } from "@/server/career-events/service";
import { normalizePartner, viewerAudience } from "@/server/partners/service";

describe("inspection mapping", () => {
  it("has one default row per heading and framework, each with a check note", () => {
    const rows = defaultMapping();
    expect(rows).toHaveLength(EVIDENCE_HEADINGS.length * FRAMEWORKS.length);
    for (const h of EVIDENCE_HEADINGS) for (const f of FRAMEWORKS) expect(rows.filter((r) => r.headingKey === h && r.framework === f)).toHaveLength(1);
    for (const r of rows) {
      expect(r.areaEn.length).toBeGreaterThan(5);
      expect(/[؀-ۿ]/.test(r.areaAr)).toBe(true);
      expect(r.noteEn).toBeTruthy();
      expect(r.noteAr).toBeTruthy();
    }
    expect(rows.filter((r) => r.framework !== "SPEA").every((r) => r.noteEn === CHECK_NOTE.en)).toBe(true);
  });

  it("never claims compliance and has no em dashes", () => {
    for (const r of defaultMapping()) {
      const text = `${r.areaEn} ${r.noteEn} ${r.areaAr} ${r.noteAr}`;
      expect(text).not.toMatch(/compliant|complies|certif/i);
      expect(text).not.toContain("—");
    }
  });

  it("stored rows override defaults; unknown headings and frameworks are ignored", () => {
    const resolved = resolveMapping([
      { headingKey: "safeguarding", framework: "KHDA", areaEn: "Edited area", areaAr: "مجال معدل", customized: true },
      { headingKey: "nonsense", framework: "KHDA", areaEn: "x", areaAr: "س" },
      { headingKey: "parents", framework: "OTHER", areaEn: "x", areaAr: "س" },
    ]);
    expect(resolved).toHaveLength(defaultMapping().length);
    const sg = resolved.find((r) => r.headingKey === "safeguarding" && r.framework === "KHDA")!;
    expect(sg.areaEn).toBe("Edited area");
    expect(sg.customized).toBe(true);
    expect(resolved.some((r) => r.headingKey === "nonsense" || r.framework === "OTHER")).toBe(false);
  });

  it("lists the school's own regulator first", () => {
    const rows = mappingForHeading(defaultMapping(), "careers", "ADEK");
    expect(rows.map((r) => r.framework)).toEqual(["ADEK", "KHDA", "SPEA", "MOE"]);
    expect(mappingForHeading(defaultMapping(), "careers", "OTHER").map((r) => r.framework)).toEqual(["KHDA", "ADEK", "SPEA", "MOE"]);
  });
});

describe("evidence ranges and formatting", () => {
  it("parses whole Dubai days with an exclusive end", () => {
    const r = parseDayRange("2026-09-01", "2026-09-30")!;
    expect(r.from.toISOString()).toBe("2026-08-31T20:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-30T20:00:00.000Z");
    expect(parseDayRange("2026-09-30", "2026-09-01")).toBeNull();
    expect(parseDayRange("bad", "2026-09-01")).toBeNull();
  });

  it("last N days ends today in Dubai", () => {
    const now = new Date("2026-10-06T22:30:00Z"); // 02:30 on 7 October in Dubai
    const r = lastDays(now, 30);
    expect(r.toKey).toBe("2026-10-07");
    expect(r.fromKey).toBe("2026-09-08");
    expect(dubaiDayKey(now)).toBe("2026-10-07");
  });

  it("median and value text", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(metricValue({ key: "x", value: 3, of: 4, unit: "ratio" }, "en")).toBe("3 of 4");
    expect(metricValue({ key: "x", value: 3, of: 4, unit: "ratio" }, "ar")).toBe("3 من 4");
    expect(metricValue({ key: "x", value: null, unit: "count", note: "notRecorded" }, "en")).toBe("Not recorded in Horizon");
    expect(metricValue({ key: "x", value: 1.5, unit: "hours" }, "en")).toBe("1.5 h");
  });

  it("CSV is bilingual, guards formulas and carries no case references", () => {
    const csv = evidenceCsv({
      from: "2026-08-31T20:00:00.000Z",
      to: "2026-09-30T20:00:00.000Z",
      generatedAt: "2026-10-01T00:00:00.000Z",
      regulator: "KHDA",
      sections: [{ key: "safeguarding", metrics: [{ key: "opened", value: 2, unit: "count", breakdown: [{ key: "OPEN", value: 2 }] }], references: [{ number: "SG-1", status: "OPEN", openedAt: "", firstResponseHours: 1, closedAt: null }], mapping: [] }],
    });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Safeguarding");
    expect(csv).toContain("حماية الطفل");
    expect(csv).toContain("2026-09-30");
    expect(csv).not.toContain("SG-1");
  });
});

describe("career events (pure)", () => {
  const now = new Date("2026-10-06T08:00:00Z");
  const base = { kind: "FAIR" as const, titleEn: "UAE fair", titleAr: "", descEn: "", descAr: "", universityIds: [], otherUniversities: [" A ", "A", ""], startsAt: new Date("2026-10-20T06:00:00Z"), endsAt: new Date("2026-10-20T09:00:00Z"), locationEn: "Hall", locationAr: "", onlineUrl: "", gradeLevels: [12, 11, 11], capacity: 40, registrationDeadline: null };

  it("normalizes input", () => {
    const n = normalizeEventInput(base, now);
    expect(n.gradeLevels).toEqual([11, 12]);
    expect(n.titleAr).toBe("UAE fair");
    expect(n.otherUniversities).toEqual(["A"]);
  });

  it("rejects bad input", () => {
    expect(() => normalizeEventInput({ ...base, gradeLevels: [] }, now)).toThrow("GRADES_REQUIRED");
    expect(() => normalizeEventInput({ ...base, startsAt: new Date("2026-10-01T00:00:00Z") }, now)).toThrow();
    expect(() => normalizeEventInput({ ...base, locationEn: "", onlineUrl: "" }, now)).toThrow("PLACE_REQUIRED");
    expect(() => normalizeEventInput({ ...base, onlineUrl: "http://insecure.example" }, now)).toThrow("INVALID_URL");
    expect(() => normalizeEventInput({ ...base, registrationDeadline: new Date("2026-10-21T00:00:00Z") }, now)).toThrow("DEADLINE_AFTER_START");
  });

  it("registration state, deadline and grade eligibility", () => {
    const ev = { status: "PUBLISHED" as const, startsAt: new Date("2026-10-20T06:00:00Z"), registrationDeadline: new Date("2026-10-18T19:59:00Z"), capacity: 2, gradeLevels: [11, 12] };
    expect(registrationState(ev, 1, now)).toBe("open");
    expect(registrationState(ev, 2, now)).toBe("full");
    expect(registrationState(ev, 0, new Date("2026-10-19T00:00:00Z"))).toBe("closed");
    expect(registrationState(ev, 0, new Date("2026-10-21T00:00:00Z"))).toBe("past");
    expect(registrationState({ ...ev, status: "CANCELLED" }, 0, now)).toBe("cancelled");
    expect(closesAt(ev)).toEqual(ev.registrationDeadline);
    expect(gradeEligible(ev, 11)).toBe(true);
    expect(gradeEligible(ev, 9)).toBe(false);
  });
});

describe("partner resources (pure)", () => {
  const input = { nameEn: "Example partner", nameAr: "", descEn: "A useful program.", descAr: "", category: "test_prep", url: "https://example.com/x", audience: ["student", "x"], active: true };
  it("accepts https links and known audiences only", () => {
    const n = normalizePartner(input);
    expect(n.audience).toEqual(["student"]);
    expect(n.nameAr).toBe("Example partner");
    expect(() => normalizePartner({ ...input, url: "http://example.com" })).toThrow("INVALID_URL");
    expect(() => normalizePartner({ ...input, url: "javascript:alert(1)" })).toThrow("INVALID_URL");
    expect(() => normalizePartner({ ...input, audience: [] })).toThrow("AUDIENCE_REQUIRED");
    expect(() => normalizePartner({ ...input, category: "bogus" })).toThrow("INVALID_CATEGORY");
  });
  it("staff are not counted as an audience", () => {
    expect(viewerAudience({ isStudent: true, isParent: false })).toBe("student");
    expect(viewerAudience({ isStudent: false, isParent: true })).toBe("parent");
    expect(viewerAudience({ isStudent: false, isParent: false })).toBeNull();
  });
});
