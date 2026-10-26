// Grade filters come from the grades the school actually has, never from a fixed list: a KG to Grade 12 school
// sees KG1 to Grade 12, a secondary school sees Grades 6 to 12, a new school with no students sees nothing.
import type { Prisma } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";
import { ALL_GRADE_LEVELS, isGradeLevel } from "@/lib/grade-levels";

/** Distinct grades of active students and of this year's classes, ascending. `min` keeps only grades from it up. */
export async function gradesInUse(db: TenantDb, opts: { min?: number } = {}): Promise<number[]> {
  const min: Prisma.IntFilter | undefined = opts.min !== undefined ? { gte: opts.min } : undefined;
  const [students, classes] = await Promise.all([
    db.student.groupBy({ by: ["gradeLevel"], where: { status: "ACTIVE", ...(min ? { gradeLevel: min } : {}) } }),
    db.schoolClass.groupBy({ by: ["gradeLevel"], where: { academicYear: { isCurrent: true }, ...(min ? { gradeLevel: min } : {}) } }),
  ]);
  return [...new Set([...students, ...classes].map((r) => r.gradeLevel))].filter(isGradeLevel).sort((a, b) => a - b);
}

/** Grades to offer when creating something for grades (a trip, an event): the school's grades, or every grade for a new school. */
export async function gradeChoices(db: TenantDb): Promise<number[]> {
  const g = await gradesInUse(db);
  return g.length ? g : [...ALL_GRADE_LEVELS];
}

/** A grade from a URL parameter, only when it is a real grade level ("-1" for KG1, "0" for KG2). */
export function gradeParam(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return isGradeLevel(n) ? n : null;
}

/** Name search over students: every word must match a first or last name (English or Arabic) or the student number. */
export function studentSearchWhere(q: string): Prisma.StudentWhereInput {
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length) return {};
  return {
    AND: words.map((w) => ({
      OR: [
        { firstNameEn: { contains: w, mode: "insensitive" as const } },
        { lastNameEn: { contains: w, mode: "insensitive" as const } },
        { firstNameAr: { contains: w } },
        { lastNameAr: { contains: w } },
        { studentNo: { contains: w, mode: "insensitive" as const } },
        { preferredName: { contains: w, mode: "insensitive" as const } },
      ],
    })),
  };
}
