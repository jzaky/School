// CSV import of students with guardians: headers, row normalization and validation.
// Shared by the browser preview and the server import, so both apply the same rules.
// Error entries carry only the row number, the field name and an error code, never the cell value.

export const CSV_HEADERS = [
  "student_no",
  "first_name_en",
  "last_name_en",
  "first_name_ar",
  "last_name_ar",
  "grade",
  "section",
  "date_of_birth",
  "emirates_id",
  "passport_no",
  "guardian_first_name_en",
  "guardian_last_name_en",
  "guardian_first_name_ar",
  "guardian_last_name_ar",
  "guardian_email",
  "guardian_phone",
  "relationship",
] as const;

export type CsvField = (typeof CSV_HEADERS)[number];
export type CsvRow = Record<CsvField, string>;

export const REQUIRED_HEADERS: CsvField[] = ["student_no", "first_name_en", "last_name_en", "grade"];
export const MAX_IMPORT_ROWS = 2000;
export const MIN_GRADE = 1;
export const MAX_GRADE = 13;

export const RELATIONSHIPS: Record<string, { en: string; ar: string }> = {
  mother: { en: "Mother", ar: "الأم" },
  father: { en: "Father", ar: "الأب" },
  guardian: { en: "Guardian", ar: "ولي الأمر" },
  grandmother: { en: "Grandmother", ar: "الجدة" },
  grandfather: { en: "Grandfather", ar: "الجد" },
  aunt: { en: "Aunt", ar: "العمة" },
  uncle: { en: "Uncle", ar: "العم" },
  other: { en: "Other", ar: "أخرى" },
};

export type RowErrorCode =
  | "required"
  | "grade"
  | "date"
  | "email"
  | "duplicate"
  | "emiratesId"
  | "passport"
  | "relationship"
  | "section"
  | "tooLong"
  | "failed";

export type RowError = { row: number; field: string; code: RowErrorCode };

export type CleanRow = {
  studentNo: string;
  firstNameEn: string;
  lastNameEn: string;
  firstNameAr: string;
  lastNameAr: string;
  gradeLevel: number;
  section: string | null;
  dateOfBirth: string | null; // YYYY-MM-DD
  emiratesId: string | null; // 784-YYYY-NNNNNNN-C
  passportNo: string | null;
  guardian: {
    firstNameEn: string;
    lastNameEn: string;
    firstNameAr: string;
    lastNameAr: string;
    email: string;
    phone: string | null;
    relationship: { en: string; ar: string };
  } | null;
};

/** Spreadsheet row number for a data row index (row 1 is the header). */
export const rowNumber = (index: number) => index + 2;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Lower-cases and trims header names and fills every known column with a trimmed string. */
export function normalizeRow(raw: Record<string, unknown>): CsvRow {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) lower[k.trim().toLowerCase().replace(/\s+/g, "_")] = v === null || v === undefined ? "" : String(v).trim();
  const row = {} as CsvRow;
  for (const h of CSV_HEADERS) row[h] = lower[h] ?? "";
  return row;
}

/** Headers the file must contain. Returns the missing ones. */
export function missingHeaders(headers: string[]): CsvField[] {
  const have = new Set(headers.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_")));
  return REQUIRED_HEADERS.filter((h) => !have.has(h));
}

/** Accepts YYYY-MM-DD or DD/MM/YYYY. Returns YYYY-MM-DD or null when invalid. */
export function parseDate(value: string): string | null {
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1990 || date.getTime() > Date.now()) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Emirates ID: 15 digits starting with 784, with or without dashes. Returns the dashed form. */
export function parseEmiratesId(value: string): string | null {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^784\d{12}$/.test(digits)) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 14)}-${digits.slice(14)}`;
}

/** The four clear digits kept next to an encrypted Emirates ID (matches the demo seed and the mask helper). */
export function emiratesIdLast4(dashed: string) {
  return dashed.slice(-9, -2).slice(-4);
}

export function parseGrade(value: string): number | null {
  const v = value.replace(/^(grade|g)\s*/i, "");
  if (!/^\d{1,2}$/.test(v)) return null;
  const n = Number(v);
  return n >= MIN_GRADE && n <= MAX_GRADE ? n : null;
}

export function isEmail(value: string) {
  return EMAIL.test(value) && value.length <= 200;
}

/** Validates one row. `seen` tracks student numbers already used earlier in the file. */
export function validateRow(row: CsvRow, index: number, seen: Set<string>): { data: CleanRow | null; errors: RowError[] } {
  const n = rowNumber(index);
  const errors: RowError[] = [];
  const err = (field: string, code: RowErrorCode) => errors.push({ row: n, field, code });

  for (const f of REQUIRED_HEADERS) if (!row[f]) err(f, "required");
  for (const f of CSV_HEADERS) if (row[f].length > 120) err(f, "tooLong");

  const studentNo = row.student_no.toUpperCase();
  if (studentNo) {
    if (seen.has(studentNo)) err("student_no", "duplicate");
    seen.add(studentNo);
  }
  const grade = row.grade ? parseGrade(row.grade) : null;
  if (row.grade && grade === null) err("grade", "grade");
  const section = row.section ? row.section.toUpperCase() : null;
  if (section && !/^[A-Z0-9]{1,3}$/.test(section)) err("section", "section");
  const dob = row.date_of_birth ? parseDate(row.date_of_birth) : null;
  if (row.date_of_birth && !dob) err("date_of_birth", "date");
  const eid = row.emirates_id ? parseEmiratesId(row.emirates_id) : null;
  if (row.emirates_id && !eid) err("emirates_id", "emiratesId");
  const passport = row.passport_no ? row.passport_no.replace(/\s/g, "").toUpperCase() : null;
  if (passport && !/^[A-Z0-9]{5,12}$/.test(passport)) err("passport_no", "passport");

  const guardianFields: CsvField[] = ["guardian_first_name_en", "guardian_last_name_en", "guardian_first_name_ar", "guardian_last_name_ar", "guardian_email", "guardian_phone", "relationship"];
  const hasGuardian = guardianFields.some((f) => row[f]);
  let guardian: CleanRow["guardian"] = null;
  if (hasGuardian) {
    for (const f of ["guardian_first_name_en", "guardian_last_name_en", "guardian_email"] as const) if (!row[f]) err(f, "required");
    const email = row.guardian_email.toLowerCase();
    if (email && !isEmail(email)) err("guardian_email", "email");
    const relKey = (row.relationship || "guardian").toLowerCase();
    const relationship = RELATIONSHIPS[relKey];
    if (!relationship) err("relationship", "relationship");
    if (row.guardian_first_name_en && row.guardian_last_name_en && email && relationship) {
      guardian = {
        firstNameEn: row.guardian_first_name_en,
        lastNameEn: row.guardian_last_name_en,
        firstNameAr: row.guardian_first_name_ar || row.guardian_first_name_en,
        lastNameAr: row.guardian_last_name_ar || row.guardian_last_name_en,
        email,
        phone: row.guardian_phone || null,
        relationship,
      };
    }
  }

  if (errors.length || grade === null) return { data: null, errors };
  return {
    data: {
      studentNo,
      firstNameEn: row.first_name_en,
      lastNameEn: row.last_name_en,
      firstNameAr: row.first_name_ar || row.first_name_en,
      lastNameAr: row.last_name_ar || row.last_name_en,
      gradeLevel: grade,
      section,
      dateOfBirth: dob,
      emiratesId: eid,
      passportNo: passport,
      guardian,
    },
    errors,
  };
}

export type ValidatedRows = { valid: Array<{ row: number; data: CleanRow }>; errors: RowError[]; total: number };

export function validateRows(rows: CsvRow[]): ValidatedRows {
  const seen = new Set<string>();
  const valid: ValidatedRows["valid"] = [];
  const errors: RowError[] = [];
  rows.forEach((r, i) => {
    const res = validateRow(r, i, seen);
    if (res.data) valid.push({ row: rowNumber(i), data: res.data });
    errors.push(...res.errors);
  });
  return { valid, errors, total: rows.length };
}

/** Template with one fictional example row. */
export function templateCsv() {
  const example: CsvRow = {
    student_no: "HIS-30001",
    first_name_en: "Maya",
    last_name_en: "Haddad",
    first_name_ar: "مايا",
    last_name_ar: "حداد",
    grade: "7",
    section: "A",
    date_of_birth: "2014-03-18",
    emirates_id: "",
    passport_no: "",
    guardian_first_name_en: "Nour",
    guardian_last_name_en: "Haddad",
    guardian_first_name_ar: "نور",
    guardian_last_name_ar: "حداد",
    guardian_email: "nour.haddad@example.com",
    guardian_phone: "+971 50 000 0000",
    relationship: "mother",
  };
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `${CSV_HEADERS.join(",")}\n${CSV_HEADERS.map((h) => esc(example[h])).join(",")}\n`;
}
