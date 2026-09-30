// Classes and enrollments import: columns, templates and row validation. Classes are identified by the
// school's own class code (for example 10A-MATH); see src/server/imports/classes.ts for how a code maps to a
// class without a code column. Lookups are passed in so the rules are pure and unit-tested.
import { isEmail, parseGrade } from "@/lib/people-csv";
import { parseYesNo, splitCodes, templateCsv, type ColumnSpec } from "./headers";
import { matchByName } from "./staff";
import type { SheetRecord } from "./table";
import type { RowIssue } from "./types";

export const CLASS_COLUMNS: ColumnSpec[] = [
  { key: "class_code", en: "Class code", ar: "رمز الفصل", required: true, aliases: ["code", "class id", "class", "section code", "كود الفصل", "الرمز"] },
  { key: "name_en", en: "Class name (English)", ar: "اسم الفصل بالإنجليزية", aliases: ["class name", "name", "name english", "اسم الفصل"] },
  { key: "name_ar", en: "Class name (Arabic)", ar: "اسم الفصل بالعربية", aliases: ["name arabic", "arabic name"] },
  { key: "subject", en: "Subject", ar: "المادة", aliases: ["subject code", "subject name", "رمز المادة"] },
  { key: "grade", en: "Grade", ar: "الصف", required: true, aliases: ["grade level", "year", "year group", "الصف الدراسي"] },
  { key: "section", en: "Section", ar: "الشعبة", aliases: ["class section"] },
  { key: "teacher_email", en: "Teacher email", ar: "بريد المعلم", aliases: ["teacher", "teacher e-mail", "المعلم", "البريد الإلكتروني للمعلم"] },
  { key: "room", en: "Room", ar: "القاعة", aliases: ["classroom", "الغرفة"] },
  { key: "capacity", en: "Capacity", ar: "السعة", aliases: ["max students", "seats"] },
  { key: "homeroom", en: "Homeroom", ar: "فصل الرعاية", aliases: ["is homeroom", "form class", "registration class", "form group"] },
  { key: "option_block", en: "Option block", ar: "مجموعة الاختيار", aliases: ["block", "option", "مجموعة المواد الاختيارية"] },
  { key: "students", en: "Student numbers", ar: "أرقام الطلاب", aliases: ["students", "student list", "roster", "الطلاب"] },
];

export const ENROLLMENT_COLUMNS: ColumnSpec[] = [
  { key: "class_code", en: "Class code", ar: "رمز الفصل", required: true, aliases: ["code", "class id", "class", "كود الفصل"] },
  { key: "student_no", en: "Student number", ar: "رقم الطالب", required: true, aliases: ["student no", "student id", "studentno", "الرقم المدرسي"] },
];

export const CLASS_EXAMPLES: Array<Record<string, string>> = [
  { class_code: "10A-MATH", name_en: "Mathematics 10A", name_ar: "الرياضيات 10A", subject: "MATH", grade: "10", section: "A", teacher_email: "hana.karimi@school.example", room: "B-204", capacity: "26", homeroom: "no", option_block: "", students: "S-10001; S-10002; S-10003" },
  { class_code: "10A-HR", name_en: "Homeroom 10A", name_ar: "فصل الرعاية 10A", subject: "", grade: "10", section: "A", teacher_email: "yousef.darwish@school.example", room: "B-101", capacity: "28", homeroom: "yes", option_block: "", students: "" },
];

export const ENROLLMENT_EXAMPLES: Array<Record<string, string>> = [
  { class_code: "10A-MATH", student_no: "S-10004" },
  { class_code: "10A-HR", student_no: "S-10004" },
];

export const classesTemplateCsv = () => templateCsv(CLASS_COLUMNS, CLASS_EXAMPLES);
export const enrollmentsTemplateCsv = () => templateCsv(ENROLLMENT_COLUMNS, ENROLLMENT_EXAMPLES);

/** Class codes compare without case or repeated spaces. */
export function normCode(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}
const CODE = /^[\p{L}\p{N}][\p{L}\p{N} ._/-]{0,39}$/u;
export const isClassCode = (code: string) => CODE.test(code);
export const normStudentNo = (value: string) => value.trim().toUpperCase();

export type ClassLookups = {
  subjects: Array<{ id: string; code: string; nameEn: string; nameAr: string }>;
  /** Staff who can be a class teacher (active or invited), by lower-case email. */
  teachers: Map<string, string>;
  /** Students by upper-case student number. */
  students: Map<string, { id: string; gradeLevel: number; active: boolean }>;
};

export type ClassRow = {
  row: number;
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  subjectId: string | null;
  gradeLevel: number;
  section: string | null;
  teacherId: string | null;
  room: string | null;
  capacity: number | null;
  homeroom: boolean;
  optionBlock: string | null;
  /** Student ids from the student-number column, in file order without repeats. */
  studentIds: string[];
};

/** Checks a list of student numbers. Unknown and inactive numbers are reported by their position in the list. */
export function checkStudentList(value: string, lookups: ClassLookups, grade: number | null, row: number, field: string) {
  const ids: string[] = [];
  const unknown: number[] = [];
  const inactive: number[] = [];
  const otherGrade: number[] = [];
  splitCodes(value).forEach((raw, i) => {
    const s = lookups.students.get(normStudentNo(raw));
    if (!s) return unknown.push(i + 1);
    if (!s.active) return inactive.push(i + 1);
    if (grade !== null && s.gradeLevel !== grade) otherGrade.push(i + 1);
    if (!ids.includes(s.id)) ids.push(s.id);
  });
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  if (unknown.length) errors.push({ row, field, code: "unknownStudent", items: unknown });
  if (inactive.length) errors.push({ row, field, code: "inactiveStudent", items: inactive });
  if (otherGrade.length) warnings.push({ row, field, code: "gradeMismatch", items: otherGrade });
  return { ids, errors, warnings };
}

export function parseClassRecords(records: SheetRecord[], lookups: ClassLookups): { rows: ClassRow[]; errors: RowIssue[]; warnings: RowIssue[] } {
  const rows: ClassRow[] = [];
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    const v = (k: string) => (rec.values[k] ?? "").trim();
    const n = rec.row;
    const errs: RowIssue[] = [];
    const err = (field: string, code: string) => errs.push({ row: n, field, code });

    const code = normCode(v("class_code"));
    if (!code) err("class_code", "required");
    else if (!isClassCode(code)) err("class_code", "code");
    else if (seen.has(code)) err("class_code", "duplicate");
    if (code) seen.add(code);

    for (const f of ["name_en", "name_ar", "room"]) if (v(f).length > 120) err(f, "tooLong");

    const grade = v("grade") ? parseGrade(v("grade")) : null;
    if (!v("grade")) err("grade", "required");
    else if (grade === null) err("grade", "grade");

    const section = v("section") ? v("section").toUpperCase() : null;
    if (section && !/^[A-Z0-9]{1,3}$/.test(section)) err("section", "section");

    const homeroom = parseYesNo(v("homeroom"));
    if (homeroom === undefined) err("homeroom", "yesNo");

    let subjectId: string | null = null;
    if (v("subject")) {
      const s = matchByName(lookups.subjects, v("subject"), (x) => x.code);
      if (!s) err("subject", "unknownSubject");
      else if (homeroom) warnings.push({ row: n, field: "subject", code: "homeroomSubject" });
      else subjectId = s.id;
    } else if (!homeroom) err("subject", "required");

    let teacherId: string | null = null;
    const email = v("teacher_email").toLowerCase();
    if (email) {
      if (!isEmail(email)) err("teacher_email", "email");
      else {
        teacherId = lookups.teachers.get(email) ?? null;
        if (!teacherId) err("teacher_email", "unknownTeacher");
      }
    }

    let capacity: number | null = null;
    if (v("capacity")) {
      capacity = /^\d{1,3}$/.test(v("capacity")) ? Number(v("capacity")) : NaN;
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) err("capacity", "capacity");
    }

    const block = v("option_block") ? v("option_block").toUpperCase() : null;
    if (block && !/^[A-Z0-9]{1,4}$/.test(block)) err("option_block", "block");

    const list = checkStudentList(v("students"), lookups, grade, n, "students");
    errs.push(...list.errors);
    warnings.push(...list.warnings);

    errors.push(...errs);
    if (errs.length || grade === null) continue;
    rows.push({
      row: n,
      code,
      nameEn: v("name_en") || null,
      nameAr: v("name_ar") || null,
      subjectId,
      gradeLevel: grade,
      section,
      teacherId,
      room: v("room") || null,
      capacity,
      homeroom: homeroom === true,
      optionBlock: block,
      studentIds: list.ids,
    });
  }
  return { rows, errors, warnings };
}

export type EnrollmentRow = { row: number; code: string; studentId: string };

/**
 * Enrollment rows (class code and student number). `classExists` says whether a code names a class of the
 * current year (from the database or from a classes file imported in the same step).
 */
export function parseEnrollmentRecords(records: SheetRecord[], lookups: Pick<ClassLookups, "students">, classExists: (code: string) => boolean) {
  const rows: EnrollmentRow[] = [];
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    const n = rec.row;
    const code = normCode(rec.values.class_code);
    const no = normStudentNo(rec.values.student_no ?? "");
    const errs: RowIssue[] = [];
    if (!code) errs.push({ row: n, field: "class_code", code: "required" });
    else if (!classExists(code)) errs.push({ row: n, field: "class_code", code: "unknownClass" });
    const s = no ? lookups.students.get(no) : undefined;
    if (!no) errs.push({ row: n, field: "student_no", code: "required" });
    else if (!s) errs.push({ row: n, field: "student_no", code: "unknownStudent" });
    else if (!s.active) errs.push({ row: n, field: "student_no", code: "inactiveStudent" });
    if (errs.length) {
      errors.push(...errs);
      continue;
    }
    const key = `${code}|${s!.id}`;
    if (seen.has(key)) {
      warnings.push({ row: n, field: "student_no", code: "duplicate" });
      continue;
    }
    seen.add(key);
    rows.push({ row: n, code, studentId: s!.id });
  }
  return { rows, errors, warnings };
}

/** Default class names when the file leaves them empty. */
export function defaultClassName(row: { homeroom: boolean; gradeLevel: number; section: string | null }, subject: { nameEn: string; nameAr: string } | null) {
  const tag = `${row.gradeLevel}${row.section ?? ""}`;
  if (row.homeroom || !subject) return { en: `Homeroom ${tag}`, ar: `فصل الرعاية ${tag}` };
  return { en: `${subject.nameEn} ${tag}`, ar: `${subject.nameAr} ${tag}` };
}

