// Government reporting, pure parts: small-number merging, nationality matching, the checks before sending,
// census counts, reminder stages, grade shifts for earlier census dates, the data checksum and the workbook.
import { describe, expect, it } from "vitest";
import { bandsAreSafe, mergeSmall, safeCount, SMALL } from "@/server/govreports/suppress";
import { nationalityCode, nationalityOf, nationalityOptions } from "@/server/govreports/nationality";
import { studentProblems } from "@/server/govreports/validate";
import { aggregateCensus } from "@/server/govreports/build";
import { claimKey, stageFor } from "@/server/govreports/reminders";
import { gradeShift, type RollStudent } from "@/server/govreports/roll";
import { cellValue, dataHash, type Table } from "@/server/govreports/table";
import { workbook } from "@/server/govreports/xlsx";
import { readZip } from "@/lib/zip";
import { todayKey } from "@/server/govreports/kinds";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("small-number protection", () => {
  it("shows zero and counts of at least 5, hides 1 to 4", () => {
    expect(SMALL).toBe(5);
    expect([0, 1, 4, 5, 12].map((n) => safeCount(n))).toEqual([0, null, null, 5, 12]);
  });

  it("merges neighbouring grades until each group has at least 5", () => {
    const bands = mergeSmall([
      { key: 6, n: 1 },
      { key: 7, n: 2 },
      { key: 8, n: 3 },
      { key: 9, n: 6 },
      { key: 10, n: 1 },
    ]);
    expect(bands).toEqual([
      { keys: [6, 7, 8], n: 6 },
      { keys: [9, 10], n: 7 },
    ]);
    expect(bandsAreSafe(bands)).toBe(true);
  });

  it("keeps a trailing run of zeros, and hides a whole school total below 5", () => {
    expect(mergeSmall([{ key: 1, n: 5 }, { key: 2, n: 0 }, { key: 3, n: 0 }])).toEqual([
      { keys: [1], n: 5 },
      { keys: [2, 3], n: 0 },
    ]);
    expect(mergeSmall([{ key: 1, n: 1 }, { key: 2, n: 2 }])).toEqual([{ keys: [1, 2], n: null }]);
  });

  it("never prints a number between 1 and 4 for any mix of counts", () => {
    for (let seed = 1; seed < 200; seed++) {
      const cells = Array.from({ length: 14 }, (_, i) => ({ key: i, n: (seed * (i + 3)) % 7 === 0 ? 0 : ((seed * 31 + i * 17) % 6) }));
      const bands = mergeSmall(cells);
      expect(bandsAreSafe(bands)).toBe(true);
      expect(bands.flatMap((b) => b.keys)).toEqual(cells.map((c) => c.key));
    }
  });
});

describe("nationality", () => {
  it("recognises demonyms and country names in English and Arabic", () => {
    expect(nationalityCode("Jordanian")).toBe("JO");
    expect(nationalityCode("Jordan")).toBe("JO");
    expect(nationalityCode("الأردن")).toBe("JO");
    expect(nationalityCode("France")).toBe("FR");
    expect(nationalityCode("Saudi Arabia")).toBe("SA");
    expect(nationalityCode("ae")).toBe("AE");
  });

  it("marks Emiratis however the record spells it", () => {
    for (const [en, ar] of [["Emirati", "إماراتي"], ["United Arab Emirates", null], ["UAE", null], [null, "إماراتية"]]) expect(nationalityOf(en, ar)?.emirati).toBe(true);
    expect(nationalityOf("Indian", "هندي")?.emirati).toBe(false);
    expect(nationalityOf(null, "")).toBeNull();
  });

  it("keeps unrecognised text as its own group", () => {
    const n = nationalityOf("Atlantean", null);
    expect(n).toMatchObject({ code: null, en: "Atlantean", emirati: false });
  });

  it("offers Emirati first in the picker", () => {
    expect(nationalityOptions()[0]).toMatchObject({ code: "AE", en: "Emirati", ar: "إماراتي" });
  });
});

const student = (id: string, over: Partial<RollStudent> = {}): RollStudent => ({
  id,
  studentNo: id.toUpperCase(),
  firstNameEn: `First${id}`,
  lastNameEn: "Test",
  firstNameAr: "اسم",
  lastNameAr: "اختبار",
  grade: 9,
  section: "A",
  gender: "F",
  dateOfBirth: d("2012-03-01"),
  nationalityEn: "Emirati",
  nationalityAr: "إماراتي",
  hasEid: true,
  hasSen: false,
  enrolledOn: d("2024-08-25"),
  curriculum: "AMERICAN",
  status: "ACTIVE",
  ...over,
});

describe("checks before sending", () => {
  const base = { entryYear: 2026, cutoff: { month: 12, day: 31 } };

  it("finds missing fields, age outside the grade, and a missing reference", () => {
    const students = [
      student("a"),
      student("b", { hasEid: false, nationalityEn: null, nationalityAr: null }),
      student("c", { dateOfBirth: null, gender: null }),
      student("d", { dateOfBirth: d("2010-02-01") }),
    ];
    const problems = studentProblems({ ...base, students, withReference: new Set(["a", "b", "c"]), eidHashes: new Map() });
    const rules = problems.map((p) => `${p.rule}:${p.studentId}`).sort();
    expect(rules).toEqual(["age_grade:d", "missing_dob:c", "missing_eid:b", "missing_gender:c", "missing_nationality:b", "no_reference:d"]);
    const age = problems.find((p) => p.rule === "age_grade")!;
    expect(age.values).toEqual({ age: 16, expected: 14, direction: "over" });
    expect(age.severity).toBe("warning");
  });

  it("finds duplicates by Emirates ID and by name and date of birth, once per pair", () => {
    const students = [student("a"), student("b"), student("c", { firstNameEn: "Firsta" }), student("e")];
    const problems = studentProblems({ ...base, students, withReference: new Set(["a", "b", "c", "e"]), eidHashes: new Map([["a", "h1"], ["b", "h1"], ["e", "h2"]]) });
    expect(problems.filter((p) => p.rule === "duplicate_eid")).toEqual([expect.objectContaining({ studentId: "a", otherStudentId: "b" })]);
    // a and c share name and birth date; a and b are already reported as the same ID.
    expect(problems.filter((p) => p.rule === "duplicate_name_dob")).toEqual([expect.objectContaining({ studentId: "a", otherStudentId: "c" })]);
  });

  it("never carries an identifier value", () => {
    const problems = studentProblems({ ...base, students: [student("a"), student("b")], withReference: new Set(), eidHashes: new Map([["a", "secret-hash"], ["b", "secret-hash"]]) });
    expect(JSON.stringify(problems)).not.toContain("secret-hash");
    expect(JSON.stringify(problems)).not.toMatch(/784/);
  });
});

describe("census counts", () => {
  it("counts by grade, section, gender and nationality, with age and people of determination", () => {
    const students = [
      student("a", { grade: 9, section: "A", gender: "F" }),
      student("b", { grade: 9, section: "B", gender: "M", nationalityEn: "Indian", nationalityAr: "هندي", hasSen: true }),
      student("c", { grade: 9, section: "B", gender: "M", nationalityEn: "India", nationalityAr: null }),
      student("d", { grade: 10, section: "A", gender: null, nationalityEn: null, nationalityAr: null, dateOfBirth: d("2011-05-05"), hasSen: true }),
      student("e", { grade: 10, section: "A", gender: "F", dateOfBirth: null, hasSen: true }),
    ];
    const c = aggregateCensus(students, { joined: [{ grade: 9 }], left: [{ grade: 10 }, { grade: 10 }] }, { entryYear: 2026, cutoff: { month: 12, day: 31 } });
    expect(c.total).toMatchObject({ students: 5, M: 2, F: 2, X: 1, emirati: 2, other: 2, unknownNat: 1, joined: 1, left: 2, sections: 3, sen: 3, noDob: 1 });
    const g9 = c.rows.find((r) => r.grade === 9)!;
    expect(g9.sections.get("B")).toMatchObject({ M: 2, other: 2 });
    expect(c.nationalities).toEqual([expect.objectContaining({ key: "AE", n: 2 }), expect.objectContaining({ key: "IN", n: 2 })]);
    // Grade 10 born 2011: 15 on 31 December 2026, the usual age.
    expect(c.rows.find((r) => r.grade === 10)).toMatchObject({ expected: 1, noDob: 1 });
    // Three people of determination: never printed.
    expect(c.senTotal).toBeNull();
    expect(c.senBands).toEqual([{ keys: [9, 10], n: null }]);
  });
});

describe("reminders", () => {
  it("sends the 14-day reminder from 14 to 4 days before, the 3-day one from 3 to 0", () => {
    expect([20, 15, 14, 4, 3, 1, 0, -1].map(stageFor)).toEqual([null, null, 14, 14, 3, 3, 3, null]);
  });

  it("claims per due date, stage and date, so a moved date is reminded again", () => {
    expect(claimKey("due1", 14, "2026-11-07")).not.toBe(claimKey("due1", 14, "2026-11-08"));
    expect(claimKey("due1", 3, "2026-11-07")).not.toBe(claimKey("due1", 14, "2026-11-07"));
  });

  it("uses the UAE calendar date", () => {
    expect(todayKey(new Date("2026-10-26T21:30:00Z"))).toBe("2026-10-27");
    expect(todayKey(new Date("2026-10-26T19:30:00Z"))).toBe("2026-10-26");
  });
});

describe("earlier census dates", () => {
  it("shifts grades back one per school year", () => {
    const start = d("2026-08-24");
    expect(gradeShift(d("2026-10-01"), start)).toBe(0);
    expect(gradeShift(d("2026-05-31"), start)).toBe(1);
    expect(gradeShift(d("2025-09-01"), start)).toBe(1);
    expect(gradeShift(d("2025-08-20"), start)).toBe(2);
    expect(gradeShift(d("2026-05-31"), null)).toBe(0);
  });
});

describe("data checksum and cells", () => {
  const t = (present: boolean): Table => ({ key: "x", title: { en: "X", ar: "س" }, columns: [{ key: "a", label: { en: "A", ar: "أ" } }], rows: [[{ eid: "s1", present }], [{ en: "Grade 9", ar: "الصف 9" }]] });

  it("is stable, and depends on whether an ID is on file but never on its value", () => {
    expect(dataHash({ kind: "CENSUS" }, [t(true)])).toBe(dataHash({ kind: "CENSUS" }, [t(true)]));
    expect(dataHash({ kind: "CENSUS" }, [t(true)])).not.toBe(dataHash({ kind: "CENSUS" }, [t(false)]));
    expect(dataHash({ kind: "CENSUS" }, [t(true)])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("shows an Emirates ID as on file or missing unless the value is supplied", () => {
    const cell = { eid: "s1", present: true };
    expect(cellValue(cell, "en", undefined, { present: "On file", missing: "Missing" })).toBe("On file");
    expect(cellValue({ eid: "s2", present: false }, "ar", undefined, { present: "مسجّل", missing: "غير موجود" })).toBe("غير موجود");
    expect(cellValue(cell, "en", new Map([["s1", "784-2012-1234567-1"]]))).toBe("784-2012-1234567-1");
    expect(cellValue({ en: "Grade 9", ar: "الصف 9" }, "ar")).toBe("الصف 9");
  });
});

describe("workbook", () => {
  it("writes one sheet per table with bold English and Arabic header rows, right to left in Arabic", () => {
    const buf = workbook([
      { name: "About", headers: [["Field", "Value"], ["الحقل", "القيمة"]], rows: [["Version", 2]], warnRows: [0] },
      { name: "Students by grade", headers: [["Grade"], ["الصف"]], rows: [["=cmd()"], [5]], rtl: true },
    ]);
    const files = readZip(buf);
    const s1 = files.get("xl/worksheets/sheet1.xml")!.toString("utf8");
    const s2 = files.get("xl/worksheets/sheet2.xml")!.toString("utf8");
    expect(files.get("xl/workbook.xml")!.toString("utf8")).toContain('name="Students by grade"');
    expect(s1).toContain('ySplit="2"');
    expect(s1).toMatch(/<c r="A1" t="inlineStr" s="1">/);
    expect(s1).toMatch(/<c r="A3" t="inlineStr" s="3">/);
    expect(s2).toContain('rightToLeft="1"');
    expect(s2).toContain("الصف");
    // A formula-looking value stays text.
    expect(s2).toContain('t="inlineStr"');
    expect(s2).not.toContain("<f>");
  });
});
