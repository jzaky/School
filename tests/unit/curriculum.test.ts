import { describe, expect, it } from "vitest";
import { computeCoverage, heatLevel, termOf, type CoveragePlan } from "@/server/curriculum/coverage";
import { parseStandardsCsv, parseStandardsText } from "@/server/curriculum/parse";
import { draftLesson, draftUnitFallback, isProposedLesson, shortPhrase } from "@/server/curriculum/drafter";
import { isActivity, readBilingualText, sessionTimeline, totalMinutes, writeBilingualText } from "@/server/curriculum/types";

const std = (id: string, strand = "Algorithms") => ({ id, code: id.toUpperCase(), strandEn: strand, strandAr: `${strand} ar` });
const terms = [
  { id: "t1", startsOn: new Date("2026-08-24"), endsOn: new Date("2026-12-12") },
  { id: "t2", startsOn: new Date("2027-01-05"), endsOn: new Date("2027-03-27") },
];
const plan = (id: string, standardIds: string[], extra: Partial<CoveragePlan> = {}): CoveragePlan => ({ id, status: "DRAFT", termId: null, plannedFor: null, standardIds, ...extra });

describe("computeCoverage", () => {
  const standards = [std("a1"), std("a2"), std("a3"), std("p1", "Programming"), std("p2", "Programming")];

  it("classifies standards as missing, once or covered", () => {
    const r = computeCoverage(standards, [plan("x", ["a1", "a2"]), plan("y", ["a1"]), plan("z", ["p1"])], terms);
    expect(r.byId.get("a1")!.status).toBe("covered");
    expect(r.byId.get("a2")!.status).toBe("once");
    expect(r.byId.get("a3")!.status).toBe("missing");
    expect(r.missing).toEqual(["a3", "p2"]);
    expect(r.once).toEqual(["a2", "p1"]);
    expect(r.summary).toMatchObject({ total: 5, missing: 2, once: 2, covered: 1, percent: 60 });
  });

  it("reports approved coverage separately and ignores unknown or repeated standards", () => {
    const r = computeCoverage(standards, [plan("x", ["a1", "a1", "zzz"], { status: "APPROVED" }), plan("y", ["a1"], { status: "SUBMITTED" })], terms);
    expect(r.byId.get("a1")).toMatchObject({ count: 2, approvedCount: 1, approved: true });
    expect(r.summary.approved).toBe(1);
  });

  it("builds the strand by term heatmap from plan terms and dates", () => {
    const r = computeCoverage(standards, [plan("x", ["a1", "a2"], { termId: "t1" }), plan("y", ["a3"], { plannedFor: new Date("2027-02-01") }), plan("z", ["p1"], { plannedFor: new Date("2026-12-12T08:00:00Z") })], terms);
    const alg = r.strands.find((s) => s.strandEn === "Algorithms")!;
    expect(alg).toMatchObject({ total: 3, covered: 3, byTerm: { t1: 2, t2: 1 } });
    const prog = r.strands.find((s) => s.strandEn === "Programming")!;
    expect(prog).toMatchObject({ total: 2, covered: 1, byTerm: { t1: 1, t2: 0 } });
  });

  it("handles an empty framework", () => {
    const r = computeCoverage([], [plan("x", ["a1"])]);
    expect(r.summary).toMatchObject({ total: 0, percent: 0 });
  });

  it("finds the term of a plan", () => {
    expect(termOf({ termId: null, plannedFor: new Date("2026-09-01") }, terms)).toBe("t1");
    expect(termOf({ termId: "t2", plannedFor: new Date("2026-09-01") }, terms)).toBe("t2");
    expect(termOf({ termId: null, plannedFor: new Date("2026-12-25") }, terms)).toBeNull();
  });

  it("scales heat levels", () => {
    expect([heatLevel(0, 4), heatLevel(1, 8), heatLevel(1, 4), heatLevel(2, 4), heatLevel(4, 4)]).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("parseStandardsText", () => {
  it("splits numbered and bulleted lines, using headings as strands", () => {
    const rows = parseStandardsText(
      ["Algorithms", "1. Decompose a problem into smaller parts", "2. Represent algorithms with flowcharts", "   and pseudocode", "", "Data", "- Convert between binary and denary", "* Explain how text is stored"].join("\n"),
      { prefix: "CS9" },
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ code: "CS9.1", strandEn: "Algorithms", descEn: "Decompose a problem into smaller parts" });
    expect(rows[1].descEn).toBe("Represent algorithms with flowcharts and pseudocode");
    expect(rows[2]).toMatchObject({ strandEn: "Data", descEn: "Convert between binary and denary" });
    expect(new Set(rows.map((r) => r.code)).size).toBe(4);
  });

  it("keeps source codes and hierarchical numbers", () => {
    const rows = parseStandardsText("MA9.N.1 Use the laws of indices\n2.3 Solve linear equations", { prefix: "MA9" });
    expect(rows.map((r) => r.code)).toEqual(["MA9.N.1", "MA9.2.3"]);
    expect(rows[0].descEn).toBe("Use the laws of indices");
  });

  it("puts Arabic statements in the Arabic field", () => {
    const rows = parseStandardsText("1. تجزئة المشكلة إلى أجزاء أصغر");
    expect(rows[0].descAr).toBe("تجزئة المشكلة إلى أجزاء أصغر");
  });

  it("reads plain lines when there are no list markers", () => {
    const rows = parseStandardsText("Students describe the water cycle and its stages.\nStudents explain how plants make food.");
    expect(rows).toHaveLength(2);
  });
});

describe("parseStandardsCsv", () => {
  it("reads headed CSV with synonyms and reports rows without a description", () => {
    const res = parseStandardsCsv('Code,Strand,Strand_ar,Description,Description_ar\nX.1,Number,الأعداد,"Use indices, including negative ones",استخدام الأسس\nX.2,Number,,,\n,Algebra,,Expand brackets,', { prefix: "X" });
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ code: "X.1", strandAr: "الأعداد", descEn: "Use indices, including negative ones", descAr: "استخدام الأسس" });
    expect(res.rows[1].code).toMatch(/^X\.\d+$/);
    expect(res.errors).toEqual([{ line: 3, code: "missing_description" }]);
  });

  it("reads positional CSV without a header", () => {
    const res = parseStandardsCsv("A1,Algebra,Solve equations");
    expect(res.rows[0]).toMatchObject({ code: "A1", strandEn: "Algebra", descEn: "Solve equations" });
  });
});

describe("fallback drafters", () => {
  const standards = [
    { id: "s1", code: "CS9.DC.1", strandEn: "Safety", strandAr: "السلامة", descEn: "Identify common cyber threats such as phishing and malware.", descAr: "التعرف على التهديدات الإلكترونية الشائعة." },
    { id: "s2", code: "CS9.DC.2", strandEn: "Safety", strandAr: "السلامة", descEn: "Explain responsible use of personal data.", descAr: "شرح الاستخدام المسؤول للبيانات الشخصية." },
    { id: "s3", code: "CS9.SN.1", strandEn: "Systems", strandAr: "الأنظمة", descEn: "Describe the fetch-execute cycle.", descAr: "وصف دورة الجلب والتنفيذ." },
  ];
  const ctx = { subjectCode: "CS", subjectEn: "Computer Science", subjectAr: "علوم الحاسوب", gradeLevel: 9, durationMin: 50 };

  it("drafts a structured lesson whose timings fill the lesson", () => {
    const l = draftLesson([standards[0]], ctx);
    expect(isProposedLesson(l)).toBe(true);
    expect(l.activities.every(isActivity)).toBe(true);
    expect(totalMinutes(l.activities)).toBe(50);
    expect(l.activities.map((a) => a.phase)).toEqual(["starter", "main", "main", "main", "plenary"]);
    expect(l.titleEn).toContain("Safety");
    expect(l.titleAr).toContain("السلامة");
    expect(l.objectivesEn).toContain("CS9.DC.1");
    expect(l.materials.some((m) => m.en.includes("Laptops"))).toBe(true);
    expect(l.standardIds).toEqual(["s1"]);
  });

  it("scales timings to other lesson lengths", () => {
    expect(totalMinutes(draftLesson([standards[0]], { ...ctx, durationMin: 75 }).activities)).toBe(75);
  });

  it("drafts a unit that covers every standard, with a review lesson that revisits them", () => {
    const unit = draftUnitFallback(standards, ctx);
    expect(unit).toHaveLength(4);
    const covered = new Set(unit.flatMap((l) => l.standardIds));
    expect(covered).toEqual(new Set(["s1", "s2", "s3"]));
    expect(unit[3].standardIds).toEqual(["s1", "s2", "s3"]);
    expect(unit[3].titleEn).toMatch(/^Review and assess/);
  });

  it("respects the lesson cap without dropping standards", () => {
    const unit = draftUnitFallback(standards, ctx, { maxLessons: 1 });
    expect(unit).toHaveLength(1);
    expect(new Set(unit[0].standardIds)).toEqual(new Set(["s1", "s2", "s3"]));
    expect(draftUnitFallback([], ctx)).toEqual([]);
  });

  it("cuts long statements into short title phrases", () => {
    expect(shortPhrase("Identify common cyber threats such as phishing and malware and ways to prevent them", 30).length).toBeLessThanOrEqual(30);
  });
});

describe("session plan helpers", () => {
  it("lays activities out minute by minute in phase order", () => {
    const rows = sessionTimeline([
      { phase: "plenary", minutes: 5, titleEn: "Exit", titleAr: "", detailEn: "", detailAr: "" },
      { phase: "starter", minutes: 10, titleEn: "Hook", titleAr: "", detailEn: "", detailAr: "" },
      { phase: "main", minutes: 30, titleEn: "Task", titleAr: "", detailEn: "", detailAr: "" },
    ]);
    expect(rows.map((r) => [r.titleEn, r.start, r.end])).toEqual([
      ["Hook", 0, 10],
      ["Task", 10, 40],
      ["Exit", 40, 45],
    ]);
  });

  it("round-trips bilingual text and reads plain text", () => {
    expect(readBilingualText(writeBilingualText({ en: "Support", ar: "دعم" }))).toEqual({ en: "Support", ar: "دعم" });
    expect(readBilingualText("plain")).toEqual({ en: "plain", ar: "plain" });
    expect(writeBilingualText({ en: " ", ar: "" })).toBeNull();
  });
});
