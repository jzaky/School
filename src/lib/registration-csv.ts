// CSV import of the "which student takes which subject" sheet.
// One row per student, identified by student_no. Every other column is a subject, matched by code,
// English name or Arabic name. A cell marked x, yes, 1, true or نعم means the student takes it.
// Core subjects are registered for everyone anyway, so the sheet only needs the options.
// Error entries carry only the row number, a field (column or block) and a code, never cell values.

export const MAX_REG_IMPORT_ROWS = 2000;
export const STUDENT_NO_HEADERS = ["student_no", "student no", "student number", "studentno", "رقم الطالب"];
export const INFO_HEADERS = ["name", "student_name", "student name", "grade", "section", "class", "الاسم", "اسم الطالب", "الصف"];

const TRUE_MARKS = new Set(["x", "✓", "✔", "yes", "y", "1", "true", "نعم", "*"]);

export type RegRowErrorCode = "required" | "student" | "duplicate" | "notOffered" | "sameBlock" | "missingBlock" | "prerequisite" | "noOfferings" | "failed";
export type RegRowError = { row: number; field: string; code: RegRowErrorCode };

export const norm = (h: string) => h.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");

/** A header and, for bilingual headers such as "Student number / رقم الطالب", each side of it. */
export const headerParts = (h: string) => {
  const n = norm(h);
  return [n, ...n.split(/\s*[/|]\s*/).filter(Boolean)];
};
const isStudentNoHeader = (h: string) => headerParts(h).some((p) => STUDENT_NO_HEADERS.includes(p) || STUDENT_NO_HEADERS.includes(p.replace(/_/g, " ")));
const isInfoHeader = (h: string) => headerParts(h).some((p) => INFO_HEADERS.includes(p) || INFO_HEADERS.includes(p.replace(/_/g, " ")));

export function isMarked(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return TRUE_MARKS.has(String(value).trim().toLowerCase());
}

/** Spreadsheet row number for a data row index (header is row 1). */
export const regRowNumber = (index: number) => index + 2;

export function studentNoOf(row: Record<string, unknown>): string {
  for (const [k, v] of Object.entries(row)) if (isStudentNoHeader(k)) return String(v ?? "").trim();
  return "";
}

export function hasStudentNoHeader(headers: string[]) {
  return headers.some(isStudentNoHeader);
}

/** Headers that should name a subject (everything except the student number and info columns). */
export function subjectHeaders(headers: string[]) {
  return headers.filter((h) => h && !isStudentNoHeader(h) && !isInfoHeader(h));
}

/** Build a template: student number, name, grade, then one column per subject code. */
export function registrationTemplateCsv(subjectCodes: string[], sample?: Array<{ studentNo: string; name: string; grade: number; marks: string[] }>) {
  const head = ["student_no", "student_name", "grade", ...subjectCodes];
  const lines = [head.join(",")];
  for (const s of sample ?? []) lines.push([s.studentNo, `"${s.name.replace(/"/g, '""')}"`, String(s.grade), ...subjectCodes.map((c) => (s.marks.includes(c) ? "x" : ""))].join(","));
  return lines.join("\n") + "\n";
}

/** Column guide for the subject choices file (the subject columns are the school's option subjects). */
export const REGISTRATION_COLUMNS = [
  { key: "student_no", en: "Student number", ar: "رقم الطالب", required: true },
  { key: "student_name", en: "Student name", ar: "اسم الطالب" },
  { key: "grade", en: "Grade", ar: "الصف" },
  { key: "subjects", en: "One column per option subject, marked x", ar: "عمود لكل مادة اختيارية، مع علامة x" },
];
