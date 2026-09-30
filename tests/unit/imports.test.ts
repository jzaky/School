// Import center parsers: headers in English and Arabic, required fields, duplicates, role and subject matching.
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { headerIndex, normHeader, parseYesNo, resolveHeader, splitCodes, splitList } from "@/lib/imports/headers";
import { excelSerialToIso, tableToSheet } from "@/lib/imports/table";
import { parseGradeList } from "@/lib/imports/types";
import { STAFF_COLUMNS, parseStaffRecords, staffTemplateCsv, type StaffLookups } from "@/lib/imports/staff";
import { CLASS_COLUMNS, ENROLLMENT_COLUMNS, classesTemplateCsv, enrollmentsTemplateCsv, parseClassRecords, parseEnrollmentRecords, type ClassLookups } from "@/lib/imports/classes";
import { STUDENT_COLUMNS, missingHeaders, normalizeRow, templateCsv as studentsTemplateCsv, validateRows } from "@/lib/people-csv";
import { headerParts, hasStudentNoHeader, subjectHeaders } from "@/lib/registration-csv";
import { importAccess, canRunKind } from "@/server/imports/access";

const csv = (text: string) => Papa.parse<string[]>(text, { skipEmptyLines: false }).data;

const lookups: StaffLookups = {
  roles: [
    { id: "r-teacher", key: "teacher", nameEn: "Teacher", nameAr: "معلم", family: false, sensitive: false },
    { id: "r-hod", key: "department_head", nameEn: "Head of Department", nameAr: "رئيس القسم", family: false, sensitive: false },
    { id: "r-dsl", key: "dsl", nameEn: "Designated Safeguarding Lead", nameAr: "مسؤول حماية الطفل", family: false, sensitive: true },
    { id: "r-admin", key: "school_admin", nameEn: "School Administrator", nameAr: "مسؤول المدرسة", family: false, sensitive: true },
    { id: "r-parent", key: "parent", nameEn: "Parent", nameAr: "ولي أمر", family: true, sensitive: false },
  ],
  departments: [
    { id: "d-sci", key: "science", nameEn: "Science", nameAr: "العلوم" },
    { id: "d-math", key: "mathematics", nameEn: "Mathematics", nameAr: "الرياضيات" },
  ],
  subjects: [
    { id: "s-math", code: "MATH", nameEn: "Mathematics", nameAr: "الرياضيات" },
    { id: "s-phys", code: "PHYS", nameEn: "Physics", nameAr: "الفيزياء" },
    { id: "s-chem", code: "CHEM", nameEn: "Chemistry", nameAr: "الكيمياء" },
  ],
};
const ALL = { sensitiveRoles: true, adminRole: true };

describe("headers", () => {
  it("every column set has distinct spellings", () => {
    for (const cols of [STAFF_COLUMNS, CLASS_COLUMNS, ENROLLMENT_COLUMNS, STUDENT_COLUMNS]) expect(() => headerIndex(cols)).not.toThrow();
  });

  it("accepts keys, English, Arabic and bilingual headers with spelling variants", () => {
    const idx = headerIndex(STAFF_COLUMNS);
    expect(resolveHeader("email", idx)).toBe("email");
    expect(resolveHeader("E-mail", idx)).toBe("email");
    expect(resolveHeader("  Email Address ", idx)).toBe("email");
    expect(resolveHeader("البريد الإلكتروني", idx)).toBe("email");
    expect(resolveHeader("البريد الالكتروني", idx)).toBe("email"); // without hamza
    expect(resolveHeader("Email / البريد الإلكتروني", idx)).toBe("email");
    expect(resolveHeader("﻿Name (English)", idx)).toBe("name_en");
    expect(resolveHeader("الاسم بالعربية", idx)).toBe("name_ar");
    expect(resolveHeader("المسمى الوظيفي", idx)).toBe("job_title_en");
    expect(resolveHeader("Favourite colour", idx)).toBeNull();
  });

  it("normalizes Arabic diacritics and letter variants", () => {
    expect(normHeader("المادَّة")).toBe(normHeader("الماده"));
    expect(normHeader("إلى")).toBe(normHeader("الى"));
  });

  it("splits lists and reads yes or no in both languages", () => {
    expect(splitList("teacher; Head of Department، counselor")).toEqual(["teacher", "Head of Department", "counselor"]);
    expect(splitCodes("S-1 S-2,S-3\nS-4")).toEqual(["S-1", "S-2", "S-3", "S-4"]);
    expect([parseYesNo("Yes"), parseYesNo("نعم"), parseYesNo("لا"), parseYesNo(""), parseYesNo("maybe")]).toEqual([true, true, false, null, undefined]);
  });

  it("parses grade lists and ranges", () => {
    expect(parseGradeList("9-12")).toEqual([9, 10, 11, 12]);
    expect(parseGradeList("9 to 11")).toEqual([9, 10, 11]);
    expect(parseGradeList("Grade 9; Grade 10")).toEqual([9, 10]);
    expect(parseGradeList("الصف 7، 8")).toEqual([7, 8]);
    expect(parseGradeList("10 11 12")).toEqual([10, 11, 12]);
    expect(parseGradeList("")).toEqual([]);
    expect(parseGradeList("12-9")).toBeNull();
    expect(parseGradeList("KG1")).toBeNull();
  });

  it("converts Excel day numbers to dates", () => {
    expect(excelSerialToIso("40179")).toBe("2010-01-01");
    expect(excelSerialToIso("2010-01-01")).toBeNull();
  });
});

describe("sheets", () => {
  it("keeps real row numbers when the file has blank rows and reports missing and unknown columns", () => {
    const sheet = tableToSheet(csv("\nEmail,Name (English),Notes\na@x.ae,Aa Bb,hi\n\n,,\nb@x.ae,Cc Dd,\n"), STAFF_COLUMNS);
    expect(sheet.headerRow).toBe(2);
    expect(sheet.records.map((r) => r.row)).toEqual([3, 6]);
    expect(sheet.missing).toEqual(["roles"]);
    expect(sheet.unknownHeaders).toEqual(["Notes"]);
  });

  it("every template parses back with no missing or unknown columns and no errors", () => {
    for (const [text, cols] of [
      [staffTemplateCsv(), STAFF_COLUMNS],
      [classesTemplateCsv(), CLASS_COLUMNS],
      [enrollmentsTemplateCsv(), ENROLLMENT_COLUMNS],
      [studentsTemplateCsv(), STUDENT_COLUMNS],
    ] as const) {
      const sheet = tableToSheet(csv(text), [...cols]);
      expect(sheet.missing).toEqual([]);
      expect(sheet.unknownHeaders).toEqual([]);
      expect(sheet.records).toHaveLength(2);
    }
    const staff = parseStaffRecords(tableToSheet(csv(staffTemplateCsv()), STAFF_COLUMNS).records, lookups, ALL);
    expect(staff.errors).toEqual([]);
    expect(staff.rows[1].roleKeys).toEqual(["teacher", "department_head"]);
    const students = tableToSheet(csv(studentsTemplateCsv()), STUDENT_COLUMNS);
    expect(validateRows(students.records.map((r) => normalizeRow(r.values))).errors).toEqual([]);
  });
});

describe("staff rows", () => {
  const sheet = (text: string) => tableToSheet(csv(text), STAFF_COLUMNS).records;

  it("reads a file with Arabic headers", () => {
    const res = parseStaffRecords(sheet("الاسم بالإنجليزية,الاسم بالعربية,البريد الإلكتروني,الأدوار,القسم,المواد,الصفوف\nHana Karimi,هناء كريمي,Hana@School.ae,معلم,العلوم,الفيزياء,9-10\n"), lookups, ALL);
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toMatchObject({ row: 2, email: "hana@school.ae", nameAr: "هناء كريمي", roleIds: ["r-teacher"], departmentId: "d-sci", subjectIds: ["s-phys"], grades: [9, 10] });
  });

  it("matches roles by key, English name or Arabic name, ignoring case and spelling variants", () => {
    const res = parseStaffRecords(sheet("email,name_en,roles\na@s.ae,Aa Aa,TEACHER\nb@s.ae,Bb Bb,head of department\nc@s.ae,Cc Cc,department_head;رئيس القسم\nd@s.ae,Dd Dd,ولي امر\n"), lookups, ALL);
    expect(res.rows.map((r) => r.roleKeys)).toEqual([["teacher"], ["department_head"], ["department_head"]]);
    expect(res.errors).toEqual([{ row: 5, field: "roles", code: "familyRole", items: [1] }]);
  });

  it("reports required fields, bad emails, duplicates, unknown roles, departments and subjects by position", () => {
    const res = parseStaffRecords(
      sheet("email,name_en,roles,department,subjects\n,X,teacher,,\nnot-an-email,Good Name,teacher,,\nsame@s.ae,Good Name,teacher,,\nSAME@s.ae,Good Name,teacher,,\nz@s.ae,Good Name,teacher;wizard,Alchemy,MATH;Potions;Dance\n"),
      lookups,
      ALL,
    );
    const codes = res.errors.map((e) => `${e.row}:${e.field}:${e.code}${e.items ? `@${e.items.join("|")}` : ""}`);
    expect(codes).toEqual(["2:name_en:tooShort", "2:email:required", "3:email:email", "5:email:duplicate", "6:roles:unknownRole@2", "6:department:unknownDepartment", "6:subjects:unknownSubject@2|3"]);
    expect(res.rows.map((r) => r.row)).toEqual([4]);
    expect(JSON.stringify(res.errors)).not.toContain("same@s.ae");
  });

  it("needs roles.manage for sensitive roles and school.manage for the administrator role", () => {
    const text = "email,name_en,roles\na@s.ae,Aa Aa,dsl\nb@s.ae,Bb Bb,School Administrator\nc@s.ae,Cc Cc,teacher\n";
    const limited = parseStaffRecords(sheet(text), lookups, { sensitiveRoles: false, adminRole: false });
    expect(limited.errors.map((e) => e.code)).toEqual(["sensitiveRole", "adminRole"]);
    expect(limited.rows.map((r) => r.email)).toEqual(["c@s.ae"]);
    const full = parseStaffRecords(sheet(text), lookups, ALL);
    expect(full.errors).toEqual([]);
  });

  it("student importer accepts bilingual and Arabic headers", () => {
    expect(missingHeaders(["Student number / رقم الطالب", "الاسم الأول بالإنجليزية", "Last name (English)", "الصف"])).toEqual([]);
    expect(normalizeRow({ "رقم الطالب": "S-1", "Grade / الصف": "9" })).toMatchObject({ student_no: "S-1", grade: "9" });
    expect(missingHeaders(["student_no", "first_name_en", "last_name_en", "grade"])).toEqual([]);
  });

  it("registration import recognises bilingual student number and subject headers", () => {
    const headers = ["Student number / رقم الطالب", "Student name / اسم الطالب", "Grade / الصف", "BIO / الأحياء"];
    expect(hasStudentNoHeader(headers)).toBe(true);
    expect(subjectHeaders(headers)).toEqual(["BIO / الأحياء"]);
    expect(headerParts("BIO / الأحياء")).toContain("bio");
  });
});

describe("class and enrollment rows", () => {
  const classLookups: ClassLookups = {
    subjects: lookups.subjects,
    teachers: new Map([["hana@s.ae", "m-hana"]]),
    students: new Map([
      ["S-1", { id: "st-1", gradeLevel: 10, active: true }],
      ["S-2", { id: "st-2", gradeLevel: 10, active: true }],
      ["S-3", { id: "st-3", gradeLevel: 9, active: true }],
      ["S-9", { id: "st-9", gradeLevel: 10, active: false }],
    ]),
  };
  const sheet = (text: string) => tableToSheet(csv(text), CLASS_COLUMNS).records;

  it("reads Arabic headers, homeroom flags and student lists", () => {
    const res = parseClassRecords(
      sheet("رمز الفصل,المادة,الصف,الشعبة,بريد المعلم,فصل الرعاية,أرقام الطلاب\n10a-math,الرياضيات,10,a,Hana@s.ae,لا,S-1 S-2 s-1\n10A-HR,,10,A,,نعم,S-3\n"),
      classLookups,
    );
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toMatchObject({ code: "10A-MATH", subjectId: "s-math", gradeLevel: 10, section: "A", teacherId: "m-hana", homeroom: false, studentIds: ["st-1", "st-2"] });
    expect(res.rows[1]).toMatchObject({ code: "10A-HR", subjectId: null, homeroom: true, studentIds: ["st-3"] });
    expect(res.warnings).toEqual([{ row: 3, field: "students", code: "gradeMismatch", items: [1] }]);
  });

  it("reports unknown teachers, subjects and students by row and position, never by value", () => {
    const res = parseClassRecords(
      sheet("class_code,subject,grade,teacher_email,students,capacity,homeroom\nA1,Alchemy,10,,,,\nA2,MATH,10,ghost@s.ae,,,\nA3,MATH,10,,S-1;S-404;S-9,,\nA3,MATH,10,,,,\nA4,MATH,15,,,500,perhaps\nA5,,10,,,,\n"),
      classLookups,
    );
    const codes = res.errors.map((e) => `${e.row}:${e.field}:${e.code}${e.items ? `@${e.items.join("|")}` : ""}`);
    expect(codes).toEqual([
      "2:subject:unknownSubject",
      "3:teacher_email:unknownTeacher",
      "4:students:unknownStudent@2",
      "4:students:inactiveStudent@3",
      "5:class_code:duplicate",
      "6:grade:grade",
      "6:homeroom:yesNo",
      "6:capacity:capacity",
      "7:subject:required",
    ]);
    expect(JSON.stringify(res.errors)).not.toMatch(/ghost|S-404|Alchemy/);
  });

  it("checks enrollment rows against known classes and students", () => {
    const records = tableToSheet(csv("Class code / رمز الفصل,Student number / رقم الطالب\n10A-MATH,S-1\n10a-math,s-1\nNOPE,S-2\n10A-MATH,S-404\n,S-2\n"), ENROLLMENT_COLUMNS).records;
    const res = parseEnrollmentRecords(records, classLookups, (code) => code === "10A-MATH");
    expect(res.rows).toEqual([{ row: 2, code: "10A-MATH", studentId: "st-1" }]);
    expect(res.warnings).toEqual([{ row: 3, field: "student_no", code: "duplicate" }]);
    expect(res.errors.map((e) => `${e.row}:${e.code}`)).toEqual(["4:unknownClass", "5:unknownStudent", "6:required"]);
  });
});

describe("permissions", () => {
  it("opens the import center only with admin.access and people.manage", () => {
    expect(importAccess(new Set(["admin.access", "people.manage"])).center).toBe(true);
    expect(importAccess(new Set(["people.manage"])).center).toBe(false); // registrar
    expect(importAccess(new Set(["admin.access", "people.invite", "roles.manage"])).center).toBe(false); // principal
    const admin = importAccess(new Set(["admin.access", "people.manage", "roles.manage", "school.manage", "people.invite", "registration.manage"]));
    expect(admin).toEqual({ center: true, sensitiveRoles: true, adminRole: true, invite: true, registrations: true });
    expect(canRunKind(new Set(["admin.access", "people.manage"]), "registrations")).toBe(false);
    expect(canRunKind(new Set(["admin.access", "people.manage"]), "classes")).toBe(true);
  });
});

describe("file reading", () => {
  it("takes the separator from the header, so lists with semicolons stay in one cell", async () => {
    const { parseCsvTable, detectDelimiter, decodeText } = await import("@/server/imports/files");
    expect(parseCsvTable("Class code,Grade,Student numbers\n10A,10,S-1; S-2; S-3\n")[1]).toEqual(["10A", "10", "S-1; S-2; S-3"]);
    expect(detectDelimiter("code;grade;students\n")).toBe(";");
    expect(detectDelimiter("code\tgrade\n")).toBe("\t");
    // Arabic saved by older Excel as Windows-1256 is still read correctly.
    expect(decodeText(Buffer.from([0xc7, 0xe1, 0xd5, 0xdd]))).toBe("الصف");
  });
});
