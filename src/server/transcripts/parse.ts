// Transcript parsing: CSV (and XLSX, via xlsx.ts, as a table of cells) and text from text-based PDFs.
// Pure: no database. Headers are matched loosely (English or Arabic, any case or punctuation).
import Papa from "papaparse";
import { CURRICULA, type Curriculum } from "@/server/pathway-engine/types";
import { GRADE_SCALES } from "@/server/pathway-engine/grade-scales";
import { MAX_IMPORT_ROWS, type ParseProblem, type ParseResult, type ParsedRow, type RowStatus } from "./types";

type Field = keyof ParsedRow;

const HEADER_ALIASES: Record<string, Field> = {
  course_name: "name",
  course: "name",
  name: "name",
  subject: "name",
  subject_name: "name",
  course_title: "name",
  المادة: "name",
  اسم_المادة: "name",
  المقرر: "name",
  course_code: "code",
  code: "code",
  subject_code: "code",
  الرمز: "code",
  رمز_المادة: "code",
  grade_level: "gradeLevel",
  grade: "gradeLevel",
  year_group: "gradeLevel",
  class: "gradeLevel",
  الصف: "gradeLevel",
  school_year: "schoolYear",
  academic_year: "schoolYear",
  year: "schoolYear",
  session: "schoolYear",
  العام_الدراسي: "schoolYear",
  status: "status",
  الحالة: "status",
  final_grade: "finalGrade",
  final: "finalGrade",
  result: "finalGrade",
  achieved: "finalGrade",
  marks: "finalGrade",
  mark: "finalGrade",
  الدرجة_النهائية: "finalGrade",
  النتيجة: "finalGrade",
  predicted_grade: "predictedGrade",
  predicted: "predictedGrade",
  forecast: "predictedGrade",
  الدرجة_المتوقعة: "predictedGrade",
  grade_scale: "gradeScale",
  scale: "gradeScale",
  سلم_الدرجات: "gradeScale",
  curriculum: "curriculum",
  board: "curriculum",
  المنهاج: "curriculum",
};

export const normalizeHeader = (h: string) =>
  h
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");

const clean = (v: unknown) => {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length ? s.slice(0, 160) : null;
};

const ROMAN: Record<string, number> = { vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13 };

/** "10", "Grade 10", "Class X", "Year 11" (British years are one above US grades), "الصف العاشر". */
export function parseGradeLevel(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const ar: Record<string, number> = { التاسع: 9, العاشر: 10, "الحادي عشر": 11, "الثاني عشر": 12 };
  for (const [k, v] of Object.entries(ar)) if (s.includes(k)) return v;
  const year = s.match(/^(?:year|yr|y)\s*(\d{1,2})$/);
  if (year) return Number(year[1]) - 1;
  const n = s.match(/(\d{1,2})/);
  if (n) return Number(n[1]);
  const r = s.match(/\b(xiii|xii|xi|x|ix|viii|vii|vi)\b/);
  return r ? ROMAN[r[1]] : null;
}

export function parseStatus(raw: string | null | undefined): RowStatus | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (/^(completed?|done|final|passed|مكتمل|منجز|ناجح)/.test(s)) return "COMPLETED";
  if (/^(in[ _-]?progress|current|ongoing|enrolled|studying|قيد)/.test(s)) return "IN_PROGRESS";
  if (/^(planned|future|plan|مخطط)/.test(s)) return "PLANNED";
  return null;
}

export function parseCurriculum(raw: string | null | undefined): Curriculum | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if ((CURRICULA as readonly string[]).includes(s)) return s as Curriculum;
  if (/IGCSE|GCSE|A_LEVEL|BRITISH|CAMBRIDGE|EDEXCEL/.test(s)) return "BRITISH";
  if (/^IB|BACCALAUREATE/.test(s)) return "IB";
  if (/AMERICAN|^US|^AP$/.test(s)) return "AMERICAN";
  if (/CBSE/.test(s)) return "CBSE";
  if (/MOE|MINISTRY/.test(s)) return "UAE_MOE";
  if (/TAWJIHI/.test(s)) return "JORDAN_TAWJIHI";
  return null;
}

const gradeToken = (v: string | null) => (v ? v.replace(/\s+/g, "").replace(/%$/, "").toUpperCase().slice(0, 8) : null);

/** Turn a table (first row is the header) into course rows. Used for CSV and XLSX. */
export function rowsFromTable(table: string[][]): ParseResult {
  const problems: ParseProblem[] = [];
  const nonEmpty = table.filter((r) => r.some((c) => String(c ?? "").trim()));
  if (!nonEmpty.length) return { rows: [], problems: [{ line: 0, code: "no_rows" }] };
  const header = nonEmpty[0].map((h) => HEADER_ALIASES[normalizeHeader(String(h ?? ""))] ?? null);
  if (!header.includes("name")) return { rows: [], problems: [{ line: 1, code: "no_header" }] };
  const rows: ParsedRow[] = [];
  const body = nonEmpty.slice(1);
  if (body.length > MAX_IMPORT_ROWS) problems.push({ line: MAX_IMPORT_ROWS + 2, code: "too_many_rows" });
  body.slice(0, MAX_IMPORT_ROWS).forEach((cells, idx) => {
    const line = idx + 2;
    const get = (f: Field) => {
      const i = header.indexOf(f);
      return i < 0 ? null : clean(cells[i]);
    };
    const name = get("name");
    if (!name) {
      problems.push({ line, code: "no_name" });
      return;
    }
    const rawGrade = get("gradeLevel");
    const gradeLevel = parseGradeLevel(rawGrade);
    if (rawGrade && (gradeLevel === null || gradeLevel < 6 || gradeLevel > 13)) problems.push({ line, code: "bad_grade_level" });
    const scale = get("gradeScale")?.toUpperCase().replace(/[\s-]+/g, "_") ?? null;
    rows.push({
      name,
      code: get("code")?.toUpperCase().replace(/\s+/g, "_") ?? null,
      curriculum: parseCurriculum(get("curriculum")),
      gradeLevel: gradeLevel !== null && gradeLevel >= 6 && gradeLevel <= 13 ? gradeLevel : null,
      schoolYear: get("schoolYear"),
      status: parseStatus(get("status")),
      finalGrade: gradeToken(get("finalGrade")),
      predictedGrade: gradeToken(get("predictedGrade")),
      gradeScale: scale && GRADE_SCALES[scale] ? scale : null,
    });
  });
  if (!rows.length && !problems.length) problems.push({ line: 0, code: "no_rows" });
  return { rows, problems };
}

export function parseCsv(text: string): ParseResult {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: true, delimiter: "" });
  return rowsFromTable(res.data);
}

// ---------------------------------------------------------------------------------------------
// Text from a PDF transcript

const GRADE_AT_END = /^(.*?[\p{L})\].])[\s:.\-|]+((?:A\*|[A-G][+-]?)|(?:\d{1,3}(?:\.\d{1,2})?%?))(?:\s*\((predicted|متوقع)\))?$/iu;
const CONTEXT_GRADE = /^(?:grade|class|year|الصف)\s+([\divxl]+|[\p{L} ]+)\b/iu;
const CONTEXT_YEAR = /\b(20\d{2})\s*[-/]\s*(20\d{2}|\d{2})\b/;
const SKIP = /^(subject|course|name|student|school|total|overall|result|page|date|signature|principal|marks? obtained|grade)\b/i;

/**
 * Best effort for text-based PDF transcripts: one course per line ending in a grade, with "Grade 10" or
 * "2024-2025" lines setting the context for the lines below. Comma or tab separated text goes through
 * the table parser instead. Scanned PDFs have no text; the caller asks for manual entry.
 */
export function parseTranscriptText(text: string, defaults: { gradeLevel?: number | null } = {}): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const delimited = lines.filter((l) => l.includes(",") || l.includes("\t")).length;
  if (lines.length > 1 && delimited >= Math.ceil(lines.length * 0.6)) {
    const res = Papa.parse<string[]>(lines.join("\n"), { skipEmptyLines: true, delimiter: "" });
    const table = rowsFromTable(res.data);
    if (table.rows.length) return table;
  }
  let grade = defaults.gradeLevel ?? null;
  let schoolYear: string | null = null;
  const rows: ParsedRow[] = [];
  const problems: ParseProblem[] = [];
  lines.forEach((line, idx) => {
    const ctxGrade = line.match(CONTEXT_GRADE);
    const year = line.match(CONTEXT_YEAR);
    if (year) schoolYear = `${year[1]}-${year[2].length === 2 ? `20${year[2]}` : year[2]}`;
    if (ctxGrade && line.length < 40) {
      const g = parseGradeLevel(line);
      if (g !== null && g >= 6 && g <= 13) grade = g;
      return;
    }
    if (SKIP.test(line)) return;
    const m = line.match(GRADE_AT_END);
    if (!m) return;
    const name = m[1].replace(/[\s:.\-|]+$/, "").trim();
    if (name.length < 3 || /^\d+$/.test(name)) return;
    const predicted = !!m[3];
    const g = gradeToken(m[2]);
    if (rows.length >= MAX_IMPORT_ROWS) return;
    if (grade === null) problems.push({ line: idx + 1, code: "no_grade_level" });
    rows.push({ name: name.slice(0, 160), code: null, curriculum: null, gradeLevel: grade, schoolYear, status: predicted ? "IN_PROGRESS" : "COMPLETED", finalGrade: predicted ? null : g, predictedGrade: predicted ? g : null, gradeScale: null });
  });
  if (!rows.length) problems.push({ line: 0, code: "no_rows" });
  return { rows, problems };
}

/** Default status when the file does not say: a final grade means completed, a prediction means in progress. */
export function inferStatus(r: Pick<ParsedRow, "status" | "finalGrade" | "predictedGrade">): RowStatus {
  if (r.status) return r.status;
  if (r.finalGrade) return "COMPLETED";
  if (r.predictedGrade) return "IN_PROGRESS";
  return "PLANNED";
}
