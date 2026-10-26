// Kindergarten grades everywhere: parsing what people type in imports and forms, labels in English and Arabic,
// export codes, legacy letter templates, and grade lists.
import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../messages/en.json";
import ar from "../../messages/ar.json";
import { ALL_GRADE_LEVELS, gradeCode, gradeLabel, gradeLevelValues, isGradeLevel, KG1, KG2, parseGradeLevel, type GradeTranslator } from "@/lib/grade-levels";
import { parseGrade } from "@/lib/people-csv";
import { parseGradeList } from "@/lib/imports/types";
import { gradeBiText, gradeTextIn, upgradeGradeMergeFields } from "@/server/common/grade-text";
import { applyMerge } from "@/server/documents/merge";
import { cleanClaim } from "@/server/access/join";

const tEn = createTranslator({ locale: "en", messages: en, namespace: "gradeLevel" }) as unknown as GradeTranslator;
const tAr = createTranslator({ locale: "ar", messages: ar, namespace: "gradeLevel" }) as unknown as GradeTranslator;

describe("grade level values", () => {
  it("runs from KG1 (-1) to Grade 12", () => {
    expect(ALL_GRADE_LEVELS[0]).toBe(KG1);
    expect(ALL_GRADE_LEVELS).toContain(KG2);
    expect(ALL_GRADE_LEVELS.at(-1)).toBe(12);
    expect(ALL_GRADE_LEVELS).toHaveLength(14);
    expect(gradeLevelValues(-1)).toEqual({ level: "kg1", grade: -1 });
    expect(gradeLevelValues(0)).toEqual({ level: "kg2", grade: 0 });
    expect(gradeLevelValues(9)).toEqual({ level: "n", grade: 9 });
    expect(isGradeLevel(-1)).toBe(true);
    expect(isGradeLevel(-2)).toBe(false);
    expect(isGradeLevel(13)).toBe(false);
    expect(isGradeLevel(2.5)).toBe(false);
  });
});

describe("labels", () => {
  it("never prints a negative or zero grade", () => {
    for (const g of ALL_GRADE_LEVELS) {
      for (const t of [tEn, tAr]) {
        for (const label of [gradeLabel(t, g), gradeLabel(t, g, "A"), gradeLabel(t, g, null, { short: true }), gradeLabel(t, g, "B", { short: true })]) {
          expect(label).not.toMatch(/-1|\b0\b|undefined|gradeLevel\./);
        }
      }
    }
  });

  it("reads KG1 and KG2 in English", () => {
    expect(gradeLabel(tEn, -1)).toBe("KG1");
    expect(gradeLabel(tEn, 0)).toBe("KG2");
    expect(gradeLabel(tEn, 9)).toBe("Grade 9");
    expect(gradeLabel(tEn, -1, "A")).toBe("KG1 A");
    expect(gradeLabel(tEn, 9, "A")).toBe("Grade 9A");
    expect(gradeLabel(tEn, 9, "A", { short: true })).toBe("9A");
    expect(gradeLabel(tEn, 0, "C", { short: true })).toBe("KG2 C");
  });

  it("reads the Arabic names of the kindergarten years", () => {
    expect(gradeLabel(tAr, -1)).toBe("الروضة الأولى");
    expect(gradeLabel(tAr, 0)).toBe("الروضة الثانية");
    expect(gradeLabel(tAr, 9)).toBe("الصف 9");
    expect(gradeLabel(tAr, -1, "A")).toBe("الروضة الأولى A");
    expect(gradeLabel(tAr, -1, null, { short: true })).toBe("روضة 1");
    expect(gradeLabel(tAr, 10, "B", { short: true })).toBe("10B");
  });

  it("builds bilingual text for PDFs, letters and emails", () => {
    expect(gradeBiText(-1)).toEqual({ en: "KG1", ar: "الروضة الأولى" });
    expect(gradeTextIn("en", 11, "B")).toBe("Grade 11B");
    expect(gradeTextIn("ar", 0)).toBe("الروضة الثانية");
  });

  it("exports a code that imports accept again", () => {
    for (const g of ALL_GRADE_LEVELS) expect(parseGradeLevel(gradeCode(g))).toBe(g);
    expect(gradeCode(-1)).toBe("KG1");
    expect(gradeCode(0)).toBe("KG2");
    expect(gradeCode(7)).toBe("7");
  });
});

describe("parsing grades typed by people", () => {
  const cases: Array<[string, number | null]> = [
    ["9", 9],
    ["Grade 9", 9],
    ["grade 12", 12],
    ["G10", 10],
    ["Gr 3", 3],
    ["KG1", -1],
    ["kg 1", -1],
    ["KG-1", -1],
    ["KG2", 0],
    ["K2", 0],
    ["PK", -1],
    ["Pre-K", -1],
    ["pre kg", -1],
    ["KG", 0],
    ["K", 0],
    ["Kindergarten", 0],
    ["-1", -1],
    ["0", 0],
    ["الروضة الأولى", -1],
    ["روضة أولى", -1],
    ["روضة 1", -1],
    ["الروضة الثانية", 0],
    ["روضة ٢", 0],
    ["روضة", 0],
    ["الصف 9", 9],
    ["الصف ٩", 9],
    ["الصف التاسع", 9],
    ["الصف الأول", 1],
    ["الحادي عشر", 11],
    ["الصف الثاني عشر", 12],
    ["", null],
    ["Year 9", null],
    ["nine", null],
    ["KG3", null],
  ];
  for (const [text, want] of cases) it(`"${text}"`, () => expect(parseGradeLevel(text)).toBe(want));

  it("checks the range in the student import (KG1 to Grade 13)", () => {
    expect(parseGrade("KG1")).toBe(-1);
    expect(parseGrade("KG2")).toBe(0);
    expect(parseGrade("Grade 13")).toBe(13);
    expect(parseGrade("-2")).toBeNull();
    expect(parseGrade("14")).toBeNull();
  });

  it("reads grade lists with kindergarten ranges", () => {
    expect(parseGradeList("9-12")).toEqual([9, 10, 11, 12]);
    expect(parseGradeList("KG1-2")).toEqual([-1, 0, 1, 2]);
    expect(parseGradeList("KG1, KG2")).toEqual([-1, 0]);
    expect(parseGradeList("KG1 to Grade 3")).toEqual([-1, 0, 1, 2, 3]);
    expect(parseGradeList("Grade 9; Grade 10")).toEqual([9, 10]);
    expect(parseGradeList("الصف 1 إلى الصف 3")).toEqual([1, 2, 3]);
    expect(parseGradeList("Year 9, Year 10")).toEqual([9, 10]);
    expect(parseGradeList("")).toEqual([]);
    expect(parseGradeList("12-9")).toBeNull();
    expect(parseGradeList("KG3")).toBeNull();
  });
});

describe("letter templates", () => {
  it("reads the old Grade {{student.grade}} phrase as the grade name", () => {
    expect(upgradeGradeMergeFields("{{student.fullName}}, Grade {{student.grade}}, is enrolled")).toBe("{{student.fullName}}, {{student.gradeName}}, is enrolled");
    expect(upgradeGradeMergeFields("الطالب في الصف {{student.grade}} حاليًا")).toBe("الطالب في {{student.gradeName}} حاليًا");
    expect(applyMerge("Grade {{student.grade}}", { "student.grade": "KG1", "student.gradeName": "KG1" })).toBe("KG1");
    expect(applyMerge("الصف {{student.grade}}", { "student.grade": "KG1", "student.gradeName": "الروضة الأولى" })).toBe("الروضة الأولى");
    expect(applyMerge("Grade {{student.grade}}", { "student.grade": "9", "student.gradeName": "Grade 9" })).toBe("Grade 9");
  });
});

describe("joining as a parent of a kindergarten child", () => {
  it("accepts KG1 and KG2 as the grade of a claimed child", () => {
    expect(cleanClaim({ grade: KG1, fullName: "Nabil Al Hammadi" })).toEqual({ grade: KG1, fullName: "Nabil Al Hammadi" });
    expect(cleanClaim({ grade: KG2, fullName: "نبيل الحمادي" })).toEqual({ grade: KG2, fullName: "نبيل الحمادي" });
    expect(cleanClaim({ grade: -2, fullName: "Nabil Al Hammadi" })).toBeNull();
  });
});
