import { describe, expect, it } from "vitest";
import { createZip, crc32, readZip, safeEntryName } from "@/lib/zip";
import { csvCell, toCsv } from "@/lib/csv-out";
import { median, parsePeriod, pct } from "@/server/analytics/pilot";
import { displayPlan, retentionDecision, type ErasurePlan } from "@/server/privacy/erase";
import { lastActiveIsStale, LAST_ACTIVE_THROTTLE_MS } from "@/server/identity/last-active";
import { areaOf } from "@/server/privacy/school-export";
import { isSecretField, scrubRow, subjectPointers } from "@/server/privacy/subject";
import { areaLabel, exportLabel } from "@/server/privacy/labels";

describe("zip", () => {
  it("round-trips text and binary entries with Arabic names", () => {
    const bin = Buffer.from([0, 1, 2, 255, 254]);
    const zip = createZip([
      { name: "a.txt", data: "hello ".repeat(100) },
      { name: "مجلد/ملف.txt", data: "مرحبا" },
      { name: "bin.dat", data: bin },
      { name: "a.txt", data: "second" },
    ]);
    const out = readZip(zip);
    expect(out.get("a.txt")!.toString()).toBe("hello ".repeat(100));
    expect(out.get("a-2.txt")!.toString()).toBe("second");
    expect(out.get("مجلد/ملف.txt")!.toString("utf8")).toBe("مرحبا");
    expect(out.get("bin.dat")).toEqual(bin);
  });
  it("never writes paths that escape the archive", () => {
    expect(safeEntryName("../../etc/passwd")).toBe("etc/passwd");
    expect(safeEntryName("/abs\\win\\path")).toBe("abs/win/path");
  });
  it("computes the standard CRC-32", () => {
    expect(crc32(Buffer.from("123456789")).toString(16)).toBe("cbf43926");
  });
});

describe("csv", () => {
  it("quotes cells, neutralises formulas and adds a byte order mark", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=SUM(A1)")).toBe(`"'=SUM(A1)"`);
    expect(csvCell(new Date("2026-01-02T03:04:05Z"))).toBe('"2026-01-02T03:04:05.000Z"');
    const text = toCsv([{ a: 1, b: null }, { a: 2, c: { x: 1 } }]);
    expect(text.startsWith("﻿")).toBe(true);
    expect(text).toContain('"a","b","c"');
    expect(text).toContain('"2","","{""x"":1}"');
  });
});

describe("pilot maths", () => {
  it("median and percentages", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(0, 0)).toBeNull();
  });
  it("parses a period as Dubai days and defaults to the last 7 days", () => {
    const now = new Date("2026-10-06T10:00:00Z");
    const p = parsePeriod("2026-10-01", "2026-10-03", now);
    expect(p.from.toISOString()).toBe("2026-09-30T20:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-10-03T19:59:59.999Z");
    const d = parsePeriod(undefined, undefined, now);
    expect(d.to).toEqual(now);
    expect(Math.round((d.to.getTime() - d.from.getTime()) / 86_400_000)).toBe(7);
    const swapped = parsePeriod("2026-10-05", "2026-10-01", now);
    expect(swapped.from < swapped.to).toBe(true);
  });
});

describe("retention decisions", () => {
  const now = new Date("2026-10-06T00:00:00Z");
  const old = new Date("2010-01-01T00:00:00Z");
  it("keeps records inside the period and deletes expired ones only when the policy says delete", () => {
    expect(retentionDecision({ recordType: "x", retentionDays: 365, action: "DELETE" }, now, now)).toEqual({ action: "retain", reason: "retention_period" });
    expect(retentionDecision({ recordType: "x", retentionDays: 365, action: "DELETE" }, old, now)).toEqual({ action: "delete", reason: "retention_expired" });
    expect(retentionDecision({ recordType: "x", retentionDays: 365, action: "REVIEW" }, old, now)).toEqual({ action: "retain", reason: "retention_period" });
    expect(retentionDecision(undefined, old, now)).toEqual({ action: "retain", reason: "no_policy" });
    expect(retentionDecision({ recordType: "x", retentionDays: 1, action: "DELETE" }, old, now, { safeguarding: true })).toEqual({ action: "retain", reason: "safeguarding_never" });
    expect(retentionDecision({ recordType: "x", retentionDays: 1, action: "DELETE" }, old, now, { openCase: true }).action).toBe("retain");
  });
  it("hides safeguarding reasons from people who cannot see safeguarding records", () => {
    const plan: ErasurePlan = {
      subject: { kind: "student", id: "s", reference: "S1", name: { en: "a", ar: "ب" } },
      items: [
        { model: "Case", action: "retain", reason: "safeguarding_never", policy: "case_safeguarding", count: 1 },
        { model: "Case", action: "retain", reason: "retention_period", policy: "case_standard", count: 2 },
      ],
      files: 0,
      person: "anonymise",
      account: "none",
      hash: "h",
    };
    expect(displayPlan(plan, false).items).toEqual([{ model: "Case", action: "retain", reason: "retention_period", policy: "case", count: 3 }]);
    expect(displayPlan(plan, true)).toBe(plan);
  });
});

describe("last active throttle", () => {
  it("is stale only after 15 minutes", () => {
    const now = new Date("2026-10-06T10:00:00Z");
    expect(lastActiveIsStale(null, now)).toBe(true);
    expect(lastActiveIsStale(new Date(now.getTime() - LAST_ACTIVE_THROTTLE_MS + 1000), now)).toBe(false);
    expect(lastActiveIsStale(new Date(now.getTime() - LAST_ACTIVE_THROTTLE_MS), now)).toBe(true);
  });
});

describe("person data map", () => {
  it("finds a student's rows by student id and by their own membership", () => {
    const specs = subjectPointers({ kind: "student", id: "stu", membershipId: "mem" });
    const req = specs.find((s) => s.model === "Request")!;
    expect(req.or).toEqual(expect.arrayContaining([{ studentId: "stu" }, { requesterId: "mem" }]));
    expect(req.hasCaseId).toBe(true);
    expect(specs.find((s) => s.model === "Notification")!.or).toEqual([{ recipientId: "mem" }]);
    expect(specs.some((s) => s.model === "AuditEvent" || s.model === "Student")).toBe(false);
  });
  it("finds a guardian's rows by guardian id, not by student id", () => {
    const specs = subjectPointers({ kind: "guardian", id: "g", membershipId: null });
    expect(specs.find((s) => s.model === "GuardianLink")!.or).toEqual([{ guardianId: "g" }]);
    expect(specs.find((s) => s.model === "Message")!.or).toEqual([{ toGuardianId: "g" }]);
    expect(specs.some((s) => s.model === "Grade")).toBe(false);
  });
  it("never exports secrets", () => {
    expect(isSecretField("emiratesIdEnc")).toBe(true);
    expect(isSecretField("passwordHash")).toBe(true);
    expect(isSecretField("tokenHash")).toBe(true);
    expect(isSecretField("firstNameEn")).toBe(false);
    expect(scrubRow({ a: 1, passportEnc: "x" })).toEqual({ a: 1 });
  });
  it("groups tables into areas and labels them in both languages", () => {
    expect(areaOf("Student")).toBe("people");
    expect(areaOf("CaseNote")).toBe("cases");
    expect(areaOf("Grade")).toBe("academics");
    expect(areaOf("DataSubjectRequest")).toBe("compliance");
    expect(areaLabel("ar", "Grade")).toBe("الدرجات");
    expect(areaLabel("en", "SomeNewTable")).toBe("Some New Table");
    expect(exportLabel("en", "filesLine", { n: 3 })).toBe("Files included: 3");
  });
});
