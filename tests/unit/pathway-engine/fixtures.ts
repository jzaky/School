// Small builders for pathway engine tests.
import type { CatalogCourse, CourseMapping, RequirementRow, StudentCourseInput, StudentProfile, SubjectLevel, SubjectLine } from "@/server/pathway-engine/types";

let n = 0;
export const m = (subjectKey: string, level: SubjectLevel = "ADVANCED", rigor = 4, confidence = 1): CourseMapping => ({ subjectKey, level, rigor, confidence });

export function course(p: Partial<StudentCourseInput> & { mappings: CourseMapping[] }): StudentCourseInput {
  n++;
  return {
    id: p.id ?? `c${n}`,
    courseId: p.courseId ?? `cc${n}`,
    code: p.code ?? null,
    nameEn: p.nameEn ?? `Course ${n}`,
    nameAr: p.nameAr ?? `مادة ${n}`,
    gradeLevel: p.gradeLevel ?? 12,
    status: p.status ?? "COMPLETED",
    finalGrade: p.finalGrade ?? null,
    predictedGrade: p.predictedGrade ?? null,
    gradeScale: p.gradeScale ?? "A_LEVEL",
    mappingStatus: p.mappingStatus ?? "CONFIRMED",
    mappings: p.mappings,
  };
}

export function profile(p: Partial<StudentProfile> = {}): StudentProfile {
  return { curriculum: p.curriculum ?? "BRITISH", gradeLevel: p.gradeLevel ?? 12, stream: p.stream ?? null, courses: p.courses ?? [], overall: p.overall ?? {}, tests: p.tests ?? [] };
}

export function row(p: Partial<RequirementRow> = {}): RequirementRow {
  n++;
  return {
    id: p.id ?? `r${n}`,
    curriculum: p.curriculum === undefined ? "BRITISH" : p.curriculum,
    intakeYear: p.intakeYear ?? 2027,
    version: p.version ?? 1,
    confidence: p.confidence ?? "EXAMPLE",
    minimumGPA: p.minimumGPA ?? null,
    minimumPercent: p.minimumPercent ?? null,
    minimumPoints: p.minimumPoints ?? null,
    gradeProfile: p.gradeProfile ?? null,
    stream: p.stream ?? null,
    subjects: p.subjects ?? [],
    languages: p.languages ?? [],
    tests: p.tests ?? [],
    additional: p.additional ?? [],
  };
}

export function subj(type: SubjectLine["type"], keys: string[], minimumLevel: SubjectLevel | null = "ADVANCED", minimumGrade: string | null = null): SubjectLine {
  n++;
  return { id: `s${n}`, type, keys, minimumLevel, minimumGrade };
}

export const program = (...requirements: RequirementRow[]) => ({ id: `p${++n}`, requirements });

export function catalogCourse(code: string, gradeLevels: number[], mappings: CourseMapping[], scale = "US_LETTER"): CatalogCourse {
  return { id: `sc-${code}`, courseId: `cc-${code}`, code, nameEn: code, nameAr: code, gradeLevels, gradeScale: scale, mappings };
}
