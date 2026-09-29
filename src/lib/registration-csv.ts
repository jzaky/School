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

export function isMarked(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return TRUE_MARKS.has(String(value).trim().toLowerCase());
}

/** Spreadsheet row number for a data row index (header is row 1). */
export const regRowNumber = (index: number) => index + 2;

export function studentNoOf(row: Record<string, unknown>): string {
  for (const [k, v] of Object.entries(row)) if (STUDENT_NO_HEADERS.includes(norm(k))) return String(v ?? "").trim();
  return "";
}

export function hasStudentNoHeader(headers: string[]) {
  return headers.some((h) => STUDENT_NO_HEADERS.includes(norm(h)));
}

/** Headers that should name a subject (everything except the student number and info columns). */
export function subjectHeaders(headers: string[]) {
  return headers.filter((h) => h && !STUDENT_NO_HEADERS.includes(norm(h)) && !INFO_HEADERS.includes(norm(h)));
}

/** Build a template: student number, name, grade, then one column per subject code. */
export function registrationTemplateCsv(subjectCodes: string[], sample?: Array<{ studentNo: string; name: string; grade: number; marks: string[] }>) {
  const head = ["student_no", "student_name", "grade", ...subjectCodes];
  const lines = [head.join(",")];
  for (const s of sample ?? []) lines.push([s.studentNo, `"${s.name.replace(/"/g, '""')}"`, String(s.grade), ...subjectCodes.map((c) => (s.marks.includes(c) ? "x" : ""))].join(","));
  return lines.join("\n") + "\n";
}
