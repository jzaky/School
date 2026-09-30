// Staff import: columns, template and row validation. The database lookups (roles, departments, subjects)
// are passed in, so the rules are pure and unit-tested. Roles and subjects are matched by key or code, or by
// their English or Arabic name. Roles that open sensitive records need roles.manage; the school
// administrator role needs school.manage (the same rule as adding staff by hand).
import { isEmail } from "@/lib/people-csv";
import { normHeader, splitList, templateCsv, type ColumnSpec } from "./headers";
import type { SheetRecord } from "./table";
import { parseGradeList, type RowIssue } from "./types";

export const STAFF_COLUMNS: ColumnSpec[] = [
  { key: "name_en", en: "Name (English)", ar: "الاسم بالإنجليزية", required: true, aliases: ["name", "full name", "staff name", "english name", "name in english", "الاسم", "الاسم الكامل", "الاسم الإنجليزي", "الاسم باللغة الإنجليزية"] },
  { key: "name_ar", en: "Name (Arabic)", ar: "الاسم بالعربية", aliases: ["arabic name", "name in arabic", "الاسم العربي", "الاسم باللغة العربية"] },
  { key: "email", en: "Email", ar: "البريد الإلكتروني", required: true, aliases: ["e-mail", "email address", "work email", "البريد", "الإيميل"] },
  { key: "roles", en: "Roles", ar: "الأدوار", required: true, aliases: ["role", "role keys", "الدور"] },
  { key: "department", en: "Department", ar: "القسم", aliases: ["dept"] },
  { key: "job_title_en", en: "Job title (English)", ar: "المسمى الوظيفي بالإنجليزية", aliases: ["job title", "title", "position", "المسمى الوظيفي"] },
  { key: "job_title_ar", en: "Job title (Arabic)", ar: "المسمى الوظيفي بالعربية", aliases: ["arabic job title", "job title arabic"] },
  { key: "subjects", en: "Subjects taught", ar: "المواد التي يدرّسها", aliases: ["subjects", "subject", "subject codes", "teaches", "المواد", "المادة"] },
  { key: "grades", en: "Grades taught", ar: "الصفوف التي يدرّسها", aliases: ["grades", "grade levels", "year groups", "الصفوف"] },
];

export const STAFF_EXAMPLES: Array<Record<string, string>> = [
  { name_en: "Hana Karimi", name_ar: "هناء كريمي", email: "hana.karimi@school.example", roles: "teacher", department: "Mathematics", job_title_en: "Mathematics Teacher", job_title_ar: "معلمة رياضيات", subjects: "MATH", grades: "9-12" },
  { name_en: "Yousef Darwish", name_ar: "يوسف درويش", email: "yousef.darwish@school.example", roles: "Teacher; Head of Department", department: "Science", job_title_en: "Head of Science", job_title_ar: "رئيس قسم العلوم", subjects: "PHYS; CHEM", grades: "10, 11, 12" },
];

export const staffTemplateCsv = () => templateCsv(STAFF_COLUMNS, STAFF_EXAMPLES);

export type StaffLookups = {
  roles: Array<{ id: string; key: string; nameEn: string; nameAr: string; family: boolean; sensitive: boolean }>;
  departments: Array<{ id: string; key: string; nameEn: string; nameAr: string }>;
  subjects: Array<{ id: string; code: string; nameEn: string; nameAr: string }>;
};

export type StaffPerms = { sensitiveRoles: boolean; adminRole: boolean };

export type StaffRow = {
  row: number;
  email: string;
  nameEn: string;
  nameAr: string | null;
  roleIds: string[];
  roleKeys: string[];
  departmentId: string | null;
  jobTitleEn: string | null;
  jobTitleAr: string | null;
  subjectIds: string[];
  /** Grades from the file; null when the column is empty (the import picks sensible grades). */
  grades: number[] | null;
};

export const ADMIN_ROLE_KEY = "school_admin";
const MAX_TEXT = 120;

/** Finds an item by key/code or by English or Arabic name, ignoring case, spacing and Arabic spelling variants. */
export function matchByName<T extends { nameEn: string; nameAr: string }>(items: T[], value: string, code: (x: T) => string): T | null {
  const v = normHeader(value);
  if (!v) return null;
  return items.find((x) => normHeader(code(x)) === v) ?? items.find((x) => normHeader(x.nameEn) === v || normHeader(x.nameAr) === v) ?? null;
}

export function parseStaffRecords(records: SheetRecord[], lookups: StaffLookups, perms: StaffPerms): { rows: StaffRow[]; errors: RowIssue[] } {
  const rows: StaffRow[] = [];
  const errors: RowIssue[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    const v = (k: string) => (rec.values[k] ?? "").trim();
    const n = rec.row;
    const errs: RowIssue[] = [];
    const err = (field: string, code: string, items?: number[]) => errs.push({ row: n, field, code, ...(items?.length ? { items } : {}) });

    const nameEn = v("name_en").replace(/\s+/g, " ");
    const nameAr = v("name_ar").replace(/\s+/g, " ") || null;
    if (!nameEn) err("name_en", "required");
    else if (nameEn.length < 2) err("name_en", "tooShort");
    for (const f of ["name_en", "name_ar", "job_title_en", "job_title_ar", "department"]) if (v(f).length > MAX_TEXT) err(f, "tooLong");

    const email = v("email").toLowerCase();
    if (!email) err("email", "required");
    else if (!isEmail(email)) err("email", "email");
    else if (seen.has(email)) err("email", "duplicate");
    if (email) seen.add(email);

    const roleIds: string[] = [];
    const roleKeys: string[] = [];
    const roleCells = splitList(v("roles"));
    if (roleCells.length === 0) err("roles", "required");
    const unknown: number[] = [];
    roleCells.forEach((raw, i) => {
      const role = matchByName(lookups.roles, raw, (r) => r.key);
      if (!role) return unknown.push(i + 1);
      if (role.family) return err("roles", "familyRole", [i + 1]);
      if (role.key === ADMIN_ROLE_KEY && !perms.adminRole) return err("roles", "adminRole", [i + 1]);
      if (role.sensitive && !perms.sensitiveRoles) return err("roles", "sensitiveRole", [i + 1]);
      if (!roleIds.includes(role.id)) {
        roleIds.push(role.id);
        roleKeys.push(role.key);
      }
    });
    if (unknown.length) err("roles", "unknownRole", unknown);

    let departmentId: string | null = null;
    if (v("department")) {
      const d = matchByName(lookups.departments, v("department"), (x) => x.key);
      if (!d) err("department", "unknownDepartment");
      else departmentId = d.id;
    }

    const subjectIds: string[] = [];
    const unknownSubjects: number[] = [];
    splitList(v("subjects")).forEach((raw, i) => {
      const s = matchByName(lookups.subjects, raw, (x) => x.code);
      if (!s) unknownSubjects.push(i + 1);
      else if (!subjectIds.includes(s.id)) subjectIds.push(s.id);
    });
    if (unknownSubjects.length) err("subjects", "unknownSubject", unknownSubjects);

    const gradeList = parseGradeList(v("grades"));
    if (gradeList === null) err("grades", "grade");

    errors.push(...errs);
    if (errs.length) continue;
    rows.push({
      row: n,
      email,
      nameEn,
      nameAr,
      roleIds,
      roleKeys,
      departmentId,
      jobTitleEn: v("job_title_en") || null,
      jobTitleAr: v("job_title_ar") || null,
      subjectIds,
      grades: gradeList && gradeList.length ? gradeList : null,
    });
  }
  return { rows, errors };
}
