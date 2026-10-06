// Integrations: API key format and hashing, scopes, column mapping, API body to import records, schedule
// slots and the address guard for sync sources.
import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, keyFromHeaders, looksLikeApiKey } from "@/server/integrations/key-format";
import { allows, choiceFromScopes, cleanScopes, levelOf, scopesFromChoice } from "@/lib/integrations/scopes";
import { applyMapping, cleanMapping, missingAfterMapping, suggestMapping } from "@/lib/integrations/mapping";
import { PayloadError, itemsOf, studentPasses, toApiIssues, toCell, toRecords, unknownFields } from "@/lib/integrations/api-records";
import { dueSlot, localParts, runStatus } from "@/lib/integrations/schedule";
import { checkSourceUrl, isBlockedAddress } from "@/server/integrations/fetch-export";
import { tableToSheet } from "@/lib/imports/table";
import { STUDENT_COLUMNS } from "@/lib/people-csv";
import { STAFF_COLUMNS } from "@/lib/imports/staff";

describe("API keys", () => {
  it("generates a random key, keeps a short prefix and stores only a stable hash", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).not.toBe(b.key);
    expect(looksLikeApiKey(a.key)).toBe(true);
    expect(a.prefix).toBe(a.key.slice(0, 12));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(a.hash).not.toContain(a.key.slice(4));
    expect(hashApiKey(`  ${a.key} `)).toBe(a.hash);
  });

  it("reads the key from a Bearer or X-API-Key header and ignores junk", () => {
    const { key } = generateApiKey();
    expect(keyFromHeaders(new Headers({ authorization: `Bearer ${key}` }))).toBe(key);
    expect(keyFromHeaders(new Headers({ "x-api-key": key }))).toBe(key);
    expect(keyFromHeaders(new Headers({ authorization: "Bearer nope" }))).toBeNull();
    expect(keyFromHeaders(new Headers({ authorization: `Basic ${key}` }))).toBeNull();
    expect(keyFromHeaders(new Headers())).toBeNull();
  });
});

describe("scopes", () => {
  it("turns choices into scopes and back; write includes read", () => {
    const scopes = scopesFromChoice({ students: "write", staff: "read", classes: "none" });
    expect(scopes).toEqual(["students:write", "staff:read"]);
    expect(choiceFromScopes(scopes)).toEqual({ students: "write", staff: "read", classes: "none", attendance: "none" });
    expect(allows(scopes, "students", "read")).toBe(true);
    expect(allows(scopes, "students", "write")).toBe(true);
    expect(allows(scopes, "staff", "write")).toBe(false);
    expect(allows(scopes, "classes", "read")).toBe(false);
  });

  it("drops unknown or malformed scopes and keeps the strongest level per area", () => {
    expect(cleanScopes(["students:read", "students:write", "admin:write", "staff:delete", 7, "classes:read"])).toEqual(["students:write", "classes:read"]);
    expect(levelOf(["attendance:read"], "attendance")).toBe("read");
  });
});

describe("column mapping", () => {
  const headers = ["Pupil ID", "Forename", "Surname", "Year Group", "Tutor"];
  it("suggests columns with the Import center header resolution", () => {
    const s = suggestMapping(headers, STUDENT_COLUMNS);
    expect(s.find((x) => x.header === "Year Group")?.key).toBe("grade");
    expect(s.find((x) => x.header === "Pupil ID")?.key).toBeNull();
  });

  it("applies a mapping to the header row so an export in another layout reads like the template", () => {
    const mapping = cleanMapping({ "Pupil ID": "student_no", Forename: "first_name_en", Surname: "last_name_en", Tutor: "", Bogus: "not_a_column" }, STUDENT_COLUMNS);
    expect(mapping).toEqual({ "pupil id": "student_no", forename: "first_name_en", surname: "last_name_en", tutor: "" });
    expect(missingAfterMapping(headers, {}, STUDENT_COLUMNS)).toEqual(["student_no", "first_name_en"]);
    expect(missingAfterMapping(headers, mapping, STUDENT_COLUMNS)).toEqual([]);
    const table = [[], headers, ["S-1", "Maya", "Haddad", "10", "Mr X"]];
    const sheet = tableToSheet(applyMapping(table, mapping), STUDENT_COLUMNS);
    expect(sheet.missing).toEqual([]);
    expect(sheet.unknownHeaders).toEqual([]);
    expect(sheet.records).toEqual([{ row: 3, values: { student_no: "S-1", first_name_en: "Maya", last_name_en: "Haddad", grade: "10" } }]);
  });

  it("leaves a template file untouched with an empty mapping", () => {
    const table = [["Email", "Name (English)", "Roles"]];
    expect(applyMapping(table, {})).toBe(table);
    expect(tableToSheet(table, STAFF_COLUMNS).missing).toEqual([]);
  });
});

describe("API bodies to import records", () => {
  it("accepts {kind: [...]}, {items: [...]} or a bare array, within the batch limit", () => {
    expect(itemsOf({ staff: [{ email: "a@b.co" }] }, "staff", 5)).toHaveLength(1);
    expect(itemsOf({ items: [{}] }, "staff", 5)).toHaveLength(1);
    expect(itemsOf([{}, {}], "staff", 5)).toHaveLength(2);
    expect(() => itemsOf({ staff: [] }, "staff", 5)).toThrow(PayloadError);
    expect(() => itemsOf({ staff: [1] }, "staff", 5)).toThrow(PayloadError);
    expect(() => itemsOf([{}, {}, {}], "staff", 2)).toThrow(/TOO_MANY_ITEMS/);
    expect(() => itemsOf("x", "staff", 2)).toThrow(/INVALID_BODY/);
  });

  it("turns lists, booleans and numbers into cells", () => {
    expect(toCell(["teacher", "counselor"])).toBe("teacher; counselor");
    expect(toCell(true)).toBe("yes");
    expect(toCell(10)).toBe("10");
    expect(toCell(null)).toBe("");
    expect(toCell({ a: 1 })).toBe("");
    const recs = toRecords("classes", [{ class_code: "10A-MATH", grade: 10, homeroom: false, students: ["S-1", "S-2"] }]);
    expect(recs[0]).toMatchObject({ row: 1, values: { class_code: "10A-MATH", grade: "10", homeroom: "no", students: "S-1; S-2" } });
    expect(unknownFields([{ class_code: "x", colour: "red" }], "classes")).toEqual(["colour"]);
  });

  it("splits students with several guardians into passes, one guardian per pass", () => {
    const passes = studentPasses([
      { student_no: "S-1", first_name_en: "Adam", last_name_en: "Nasser", grade: 9, guardians: [{ first_name_en: "Rania", last_name_en: "Nasser", email: "r@x.test", relationship: "mother" }, { first_name_en: "Sami", last_name_en: "Nasser", email: "s@x.test" }] },
      { student_no: "S-2", first_name_en: "Lina", last_name_en: "Nasser", grade: 6, guardian_email: "r@x.test", guardian_first_name_en: "Rania", guardian_last_name_en: "Nasser" },
      { student_no: "S-3", first_name_en: "Omar", last_name_en: "Saleh", grade: 10 },
    ]);
    expect(passes).toHaveLength(2);
    expect(passes[0].map((r) => [r.row, r.values.student_no, r.values.guardian_email])).toEqual([
      [1, "S-1", "r@x.test"],
      [2, "S-2", "r@x.test"],
      [3, "S-3", ""],
    ]);
    expect(passes[1].map((r) => [r.row, r.values.guardian_email, r.values.relationship])).toEqual([[1, "s@x.test", ""]]);
  });

  it("reports issues by 0-based index and names guardian fields inside the list", () => {
    expect(toApiIssues([{ row: 2, field: "guardian_email", code: "email" }, { row: 1, field: "grade", code: "grade" }], 1)).toEqual([
      { index: 1, field: "guardians[1].email", code: "email" },
      { index: 0, field: "grade", code: "grade" },
    ]);
  });
});

describe("schedule", () => {
  // 2026-10-06 21:30 UTC is 2026-10-07 01:30 in Dubai.
  const now = new Date("2026-10-06T21:30:00Z");
  it("uses the school's time zone", () => {
    expect(localParts(now, "Asia/Dubai")).toEqual({ date: "2026-10-07", hour: 1 });
    expect(localParts(now, "Not/AZone")).toEqual({ date: "2026-10-06", hour: 21 });
  });

  it("gives one slot per hour or per day, and nothing before a daily source's hour", () => {
    const base = { enabled: true, lastSlot: null, hour: 2 };
    expect(dueSlot({ ...base, schedule: "HOURLY" }, now, "Asia/Dubai")).toBe("h:2026-10-07T01");
    expect(dueSlot({ ...base, schedule: "DAILY" }, now, "Asia/Dubai")).toBeNull();
    expect(dueSlot({ ...base, schedule: "DAILY", hour: 1 }, now, "Asia/Dubai")).toBe("d:2026-10-07");
    expect(dueSlot({ ...base, schedule: "DAILY", hour: 1, lastSlot: "d:2026-10-07" }, now, "Asia/Dubai")).toBeNull();
    expect(dueSlot({ ...base, schedule: "HOURLY", enabled: false }, now, "Asia/Dubai")).toBeNull();
  });

  it("calls a run failed only when nothing was saved", () => {
    expect(runStatus(10, 10, 0)).toBe("SUCCEEDED");
    expect(runStatus(10, 7, 3)).toBe("PARTIAL");
    expect(runStatus(10, 0, 10)).toBe("FAILED");
  });
});

describe("sync source address guard", () => {
  it("refuses private, loopback, link-local and metadata addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isBlockedAddress(a)).toBe(true);
    for (const a of ["8.8.8.8", "104.16.0.1", "2606:4700::1111"]) expect(isBlockedAddress(a)).toBe(false);
  });

  it("accepts HTTPS addresses without embedded credentials only", () => {
    expect(checkSourceUrl("https://sis.example.com/export/students.csv")).toBeNull();
    expect(checkSourceUrl("ftp://sis.example.com/x.csv")).toBe("URL");
    expect(checkSourceUrl("https://user:pass@sis.example.com/x.csv")).toBe("URL");
    expect(checkSourceUrl("not a url")).toBe("URL");
  });
});
