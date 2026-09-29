// "Classes that open the most doors": simulate adding each course the school offers and count how
// many target programmes change. Pure and deterministic, with a visible score breakdown.
import { applicableRows, evaluate } from "./evaluate";
import { plannedCourse } from "./whatif";
import { LEVEL_RANK, type CatalogCourse, type EvalResult, type MatchStatus, type ProgramForEval, type StudentProfile } from "./types";

export const UNLOCK_WEIGHTS = { unlock: 100, improve: 20, requiredBy: 5, recommendedBy: 1 } as const;
const OPEN: MatchStatus[] = ["ON_TRACK", "ELIGIBLE"];

export type UnlockResult = {
  course: CatalogCourse;
  /** The earliest grade the student could take it. */
  gradeLevel: number;
  unlocks: number;
  improves: number;
  requiredBy: number;
  recommendedBy: number;
  score: number;
  breakdown: Array<{ part: keyof typeof UNLOCK_WEIGHTS; count: number; points: number }>;
  programs: { unlocked: string[]; improved: string[]; requiredBy: string[] };
};

/** The earliest grade at or after the student's current grade in which the course is offered, or null. */
export function earliestGrade(course: CatalogCourse, fromGrade: number): number | null {
  const g = [...course.gradeLevels].sort((a, b) => a - b).find((x) => x >= fromGrade);
  return g ?? null;
}

/** Which programmes list a subject line this course could fill (at the needed level). */
function linesFilledBy(course: CatalogCourse, program: ProgramForEval, curriculum: string): { required: boolean; recommended: boolean } {
  const { rows } = applicableRows(program, curriculum);
  let required = false;
  let recommended = false;
  for (const row of rows) {
    for (const s of row.subjects) {
      const keys = [...s.keys, ...(s.alternatives ?? [])];
      const fits = course.mappings.some((m) => keys.includes(m.subjectKey) && (!s.minimumLevel || LEVEL_RANK[m.level] >= LEVEL_RANK[s.minimumLevel]));
      if (!fits) continue;
      if (s.type === "REQUIRED" || s.type === "ONE_OF" || s.type === "TWO_OF") required = true;
      else recommended = true;
    }
  }
  return { required, recommended };
}

export function rankUnlocks(
  profile: StudentProfile,
  programs: ProgramForEval[],
  catalog: CatalogCourse[],
  opts: { limit?: number; baseline?: EvalResult[] } = {},
): UnlockResult[] {
  const taken = new Set(profile.courses.map((c) => c.courseId).filter(Boolean) as string[]);
  const baseline = opts.baseline ?? programs.map((p) => evaluate(profile, p));
  const out: UnlockResult[] = [];
  for (const course of catalog) {
    if (taken.has(course.courseId)) continue;
    const gradeLevel = earliestGrade(course, profile.gradeLevel);
    if (gradeLevel === null) continue;
    const next = { ...profile, courses: [...profile.courses, plannedCourse(course, gradeLevel)] };
    const unlocked: string[] = [];
    const improved: string[] = [];
    const requiredBy: string[] = [];
    let recommendedBy = 0;
    programs.forEach((p, i) => {
      const before = baseline[i];
      const after = evaluate(next, p);
      if (OPEN.includes(after.status) && !OPEN.includes(before.status)) unlocked.push(p.id);
      else if (after.counts.requiredMissing < before.counts.requiredMissing) improved.push(p.id);
      const f = linesFilledBy(course, p, profile.curriculum);
      if (f.required) requiredBy.push(p.id);
      else if (f.recommended) recommendedBy++;
    });
    const parts = [
      { part: "unlock" as const, count: unlocked.length },
      { part: "improve" as const, count: improved.length },
      { part: "requiredBy" as const, count: requiredBy.length },
      { part: "recommendedBy" as const, count: recommendedBy },
    ].map((x) => ({ ...x, points: x.count * UNLOCK_WEIGHTS[x.part] }));
    const score = parts.reduce((s, x) => s + x.points, 0);
    if (score === 0) continue;
    out.push({ course, gradeLevel, unlocks: unlocked.length, improves: improved.length, requiredBy: requiredBy.length, recommendedBy, score, breakdown: parts, programs: { unlocked, improved, requiredBy } });
  }
  out.sort((a, b) => b.score - a.score || (a.course.code < b.course.code ? -1 : a.course.code > b.course.code ? 1 : 0));
  return opts.limit ? out.slice(0, opts.limit) : out;
}
