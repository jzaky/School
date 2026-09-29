// Transcript import: parsing (CSV, XLSX, PDF text), name normalization, course matching confidence,
// grade suggestions from the Grades module and the before/after match diff.
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CURRICULUM_COURSES } from "../../prisma/seed/catalog/courses";
import { coreTokens, matchCourse, nameSimilarity, normalizeName, qualificationOf, type CandidateCourse } from "@/server/transcripts/match";
import { inferStatus, parseCsv, parseGradeLevel, parseTranscriptText, rowsFromTable } from "@/server/transcripts/parse";
import { readXlsx } from "@/server/transcripts/xlsx";
import { suggestFromAverage } from "@/server/transcripts/suggest";
import { diffMatches } from "@/server/transcripts/service";
import { TEMPLATE_CSV } from "@/server/transcripts/types";
import { DEFAULT_BANDS } from "@/server/grades/calc";
import type { EvalResult } from "@/server/pathway-engine/types";

const catalog: CandidateCourse[] = CURRICULUM_COURSES.map((c) => ({ id: c.code, curriculum: c.curriculum as CandidateCourse["curriculum"], code: c.code, nameEn: c.en, nameAr: c.ar, qualification: c.qualification, gradeLevel: c.gradeLevel }));
const match = (name: string, curriculum: CandidateCourse["curriculum"] | null, gradeLevel: number | null, code?: string) => matchCourse({ name, code, curriculum, gradeLevel }, catalog);

describe("CSV parsing", () => {
  it("reads the downloadable template", () => {
    const { rows, problems } = parseCsv(TEMPLATE_CSV);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ name: "IGCSE Mathematics", code: "IGCSE_MATH", curriculum: null, gradeLevel: 10, schoolYear: "2024-2025", status: "COMPLETED", finalGrade: "A*", predictedGrade: null, gradeScale: "IGCSE_LETTER" });
    expect(rows[2]).toMatchObject({ status: "IN_PROGRESS", predictedGrade: "A", finalGrade: null });
  });

  it("accepts loose and Arabic headers, semicolons, quotes and a BOM", () => {
    const csv = "﻿المادة;الصف;النتيجة;Board\n\"Physics, Honours\";Year 11;a-;cbse\nChemistry;Class XI;;\n";
    const { rows, problems } = parseCsv(csv);
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ name: "Physics, Honours", gradeLevel: 10, finalGrade: "A-", curriculum: "CBSE" });
    expect(rows[1]).toMatchObject({ name: "Chemistry", gradeLevel: 11, finalGrade: null });
  });

  it("reports rows without a name, bad grade levels and files without a course column", () => {
    const res = parseCsv("course_name,grade_level\n,10\nBiology,42\n");
    expect(res.problems.map((p) => p.code)).toEqual(["no_name", "bad_grade_level"]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].gradeLevel).toBeNull();
    expect(parseCsv("foo,bar\n1,2\n").problems[0].code).toBe("no_header");
    expect(parseCsv("").problems[0].code).toBe("no_rows");
  });

  it("parses grade levels in several notations and infers status", () => {
    expect(parseGradeLevel("Grade 9")).toBe(9);
    expect(parseGradeLevel("Year 12")).toBe(11);
    expect(parseGradeLevel("Class XII")).toBe(12);
    expect(parseGradeLevel("الصف العاشر")).toBe(10);
    expect(parseGradeLevel("")).toBeNull();
    expect(inferStatus({ status: null, finalGrade: "A", predictedGrade: null })).toBe("COMPLETED");
    expect(inferStatus({ status: null, finalGrade: null, predictedGrade: "B" })).toBe("IN_PROGRESS");
    expect(inferStatus({ status: null, finalGrade: null, predictedGrade: null })).toBe("PLANNED");
  });
});

describe("XLSX and PDF text", () => {
  /** A minimal xlsx (stored and deflated entries) with a shared string table and one sheet. */
  function makeXlsx(): Buffer {
    const files: Array<[string, string, boolean]> = [
      ["xl/workbook.xml", '<workbook><sheets><sheet name="Grades" sheetId="1" r:id="rId1"/></sheets></workbook>', false],
      ["xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>', true],
      ["xl/sharedStrings.xml", "<sst><si><t>Course Name</t></si><si><t>Grade Level</t></si><si><t>Final Grade</t></si><si><r><t>AP Calculus </t></r><r><t>AB</t></r></si><si><t>A &amp; B</t></si></sst>", true],
      ["xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>11</v></c><c r="C2" t="inlineStr"><is><t>5</t></is></c></row><row r="3"><c r="A3" t="s"><v>4</v></c><c r="C3"><v>4</v></c></row></sheetData></worksheet>', true],
    ];
    const locals: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, text, deflate] of files) {
      const raw = Buffer.from(text, "utf8");
      const data = deflate ? deflateRawSync(raw) : raw;
      const n = Buffer.from(name, "utf8");
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(deflate ? 8 : 0, 8);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(n.length, 26);
      locals.push(local, n, data);
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(deflate ? 8 : 0, 10);
      c.writeUInt32LE(data.length, 20);
      c.writeUInt32LE(raw.length, 24);
      c.writeUInt16LE(n.length, 28);
      c.writeUInt32LE(offset, 42);
      central.push(c, n);
      offset += 30 + n.length + data.length;
    }
    const cd = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(cd.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
  }

  it("reads the first sheet of an xlsx file", () => {
    const table = readXlsx(makeXlsx());
    expect(table).toEqual([
      ["Course Name", "Grade Level", "Final Grade"],
      ["AP Calculus AB", "11", "5"],
      ["A & B", "", "4"],
    ]);
    expect(rowsFromTable(table).rows[0]).toMatchObject({ name: "AP Calculus AB", gradeLevel: 11, finalGrade: "5", status: null });
    expect(() => readXlsx(Buffer.from("not a zip at all, just text"))).toThrow();
  });

  it("reads course lines from transcript text with grade and year context", () => {
    const text = ["Horizon International School", "Academic Transcript", "Grade 10  2024-2025", "IGCSE Mathematics A*", "IGCSE Physics ........ A", "Grade 11", "A-Level Chemistry B (predicted)", "Total 3"].join("\n");
    const { rows } = parseTranscriptText(text);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ name: "IGCSE Mathematics", gradeLevel: 10, schoolYear: "2024-2025", finalGrade: "A*", status: "COMPLETED" });
    expect(rows[1]).toMatchObject({ name: "IGCSE Physics", finalGrade: "A" });
    expect(rows[2]).toMatchObject({ name: "A-Level Chemistry", gradeLevel: 11, predictedGrade: "B", finalGrade: null, status: "IN_PROGRESS" });
    expect(parseTranscriptText("nothing to see here").problems[0].code).toBe("no_rows");
    // Delimited text goes through the table parser.
    expect(parseTranscriptText("course,grade_level,final_grade\nBiology,9,B+\nChemistry,9,A").rows).toHaveLength(2);
  });
});

describe("name normalization", () => {
  it("expands abbreviations, folds Arabic letters and drops curriculum markers", () => {
    expect(normalizeName("Maths & Comp. Sci.")).toBe("mathematics and computer science");
    expect(normalizeName("ENGLISH LNG & LIT.")).toBe("english language and literature");
    expect(normalizeName("A-Level Further Maths")).toBe("alevel further mathematics");
    expect(normalizeName("الرياضيّات")).toBe(normalizeName("الرياضيات"));
    expect(coreTokens("CBSE Class 10 Mathematics (Standard)")).toEqual(["mathematics", "standard"]);
    expect(coreTokens("Algebra II Honors")).toEqual(["algebra", "2"]);
    expect(coreTokens("English as a Second Language")).toContain("as");
    expect(qualificationOf("AS Physics")).toBe("AS_LEVEL");
    expect(qualificationOf("IB Chemistry HL")).toBe("HL");
    expect(qualificationOf("English as a Second Language")).toBeNull();
  });

  it("scores similar names high and different subjects low", () => {
    expect(nameSimilarity("Maths", "IGCSE Mathematics")).toBe(1);
    expect(nameSimilarity("Intro to Comp Sci", "Introduction to Computer Science")).toBe(1);
    expect(nameSimilarity("Physics", "Chemistry")).toBeLessThan(0.4);
    expect(nameSimilarity("English Language and Literature", "English")).toBeGreaterThan(0.6);
  });
});

describe("course matching", () => {
  it("matches a known course code exactly", () => {
    expect(match("whatever the file says", "BRITISH", 11, "al_math")).toMatchObject({ courseId: "AL_MATH", confidence: 1, method: "code", auto: true });
  });

  it("matches qualified names automatically and prefers the plain course when no qualification is named", () => {
    expect(match("IGCSE Mathematics", "BRITISH", 10)).toMatchObject({ courseId: "IGCSE_MATH", auto: true, method: "exact" });
    expect(match("A Level Maths", "BRITISH", 11)).toMatchObject({ courseId: "AL_MATH", auto: true });
    expect(match("Chemistry HL", "IB", 12)).toMatchObject({ courseId: "IB_CHEM_HL", auto: true });
    expect(match("Physics", "AMERICAN", 11)).toMatchObject({ courseId: "US_PHYS", auto: true });
    expect(match("Intro to Comp Sci", "AMERICAN", 9)).toMatchObject({ courseId: "US_INTRO_CS", auto: true });
    expect(match("الرياضيات IGCSE", "BRITISH", 10)).toMatchObject({ courseId: "IGCSE_MATH", auto: true });
  });

  it("sends ambiguous or weak matches to review with alternatives", () => {
    const ambiguous = match("Mathematics", "BRITISH", 11);
    expect(ambiguous.auto).toBe(false);
    expect(ambiguous.alternatives.length).toBeGreaterThan(0);
    const english = match("ENGLISH LNG & LIT.", "CBSE", 10);
    expect(english).toMatchObject({ courseId: "CBSE10_ENG", auto: false });
    expect(english.confidence).toBeGreaterThanOrEqual(0.6);
    expect(english.confidence).toBeLessThan(0.8);
    const none = match("Global Perspectives", "BRITISH", 10);
    expect(none).toMatchObject({ courseId: null, method: "none", auto: false });
    expect(none.confidence).toBeLessThan(0.4);
  });

  it("gives the CBSE demo marksheet three automatic and two review rows", () => {
    const rows = ["ENGLISH LNG & LIT.", "MATHEMATICS STANDARD", "SCIENCE", "SOCIAL SCIENCE", "INFORMATION TECHNOLOGY"].map((n) => match(n, "CBSE", 10));
    expect(rows.map((r) => r.courseId)).toEqual(["CBSE10_ENG", "CBSE10_MATH_STD", "CBSE10_SCI", "CBSE10_SST", null]);
    expect(rows.filter((r) => !r.auto)).toHaveLength(2);
  });

  it("penalizes the wrong grade level, qualification and curriculum", () => {
    const g10 = match("IGCSE Physics", "BRITISH", 10).confidence;
    const wrongQual = matchCourse({ name: "IGCSE Physics", curriculum: "BRITISH", gradeLevel: 10 }, catalog.filter((c) => c.code === "AL_PHYS"));
    expect(wrongQual.confidence).toBeLessThan(g10);
    const otherCurriculum = matchCourse({ name: "Physics", curriculum: "IB", gradeLevel: 12 }, catalog.filter((c) => c.code === "US_PHYS"));
    expect(otherCurriculum.confidence).toBeLessThan(0.8);
    expect(otherCurriculum.auto).toBe(false);
  });
});

describe("grade suggestion and match diff", () => {
  it("converts an average only on scales with a school-level conversion", () => {
    expect(suggestFromAverage("US_LETTER", 91.2, DEFAULT_BANDS)).toBe("A-");
    expect(suggestFromAverage("US_LETTER", 55, DEFAULT_BANDS)).toBe("F");
    expect(suggestFromAverage("PERCENT", 88.6, DEFAULT_BANDS)).toBe("89");
    expect(suggestFromAverage("A_LEVEL", 92, DEFAULT_BANDS)).toBe("A*");
    expect(suggestFromAverage("IGCSE_LETTER", 71, DEFAULT_BANDS)).toBe("B");
    expect(suggestFromAverage("AP_5", 95, DEFAULT_BANDS)).toBeNull();
    expect(suggestFromAverage("IB_7", 95, DEFAULT_BANDS)).toBeNull();
    expect(suggestFromAverage("US_LETTER", null, DEFAULT_BANDS)).toBeNull();
  });

  it("reports changed programmes and the rows that newly meet a line", () => {
    const meta = { id: "p1", nameEn: "CS", nameAr: "علوم", university: { nameEn: "U", nameAr: "ج" } };
    const base = { programId: "p1", covered: true, rowIds: [], classesToTake: [], suggestedClasses: [], scoreGaps: [] };
    const before = { ...base, status: "MISSING_REQUIREMENTS", counts: { requiredSatisfied: 0, requiredMissing: 1, requiredUnknown: 0, recommendedSatisfied: 0 }, lines: [{ id: "l1", rowId: "r", kind: "subject", type: "REQUIRED", status: "not_met", advisory: false, confidence: "EXAMPLE" }] } as unknown as EvalResult;
    const after = { ...base, status: "ON_TRACK", counts: { requiredSatisfied: 1, requiredMissing: 0, requiredUnknown: 0, recommendedSatisfied: 0 }, lines: [{ id: "l1", rowId: "r", kind: "subject", type: "REQUIRED", status: "met", advisory: false, confidence: "EXAMPLE", satisfiedBy: [{ courseId: "sc1", nameEn: "", nameAr: "", subjectKey: "mathematics", grade: "A", basis: "predicted" }] }] } as unknown as EvalResult;
    const d = diffMatches([{ meta, result: before }], [{ meta, result: after }], new Map([["sc1", 3]]));
    expect(d.programs).toEqual([expect.objectContaining({ programId: "p1", before: "MISSING_REQUIREMENTS", after: "ON_TRACK", missingBefore: 1, missingAfter: 0 })]);
    expect(d.rowEffects).toEqual({ "3": ["p1"] });
    expect(diffMatches([{ meta, result: after }], [{ meta, result: after }], new Map([["sc1", 3]]))).toEqual({ programs: [], rowEffects: {} });
  });
});
