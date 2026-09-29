// What-if: apply changes to a student profile and compare programme results before and after. Pure.
import { evaluate } from "./evaluate";
import { STATUS_RANK, type CatalogCourse, type EvalResult, type LineStatus, type MatchStatus, type ProgramForEval, type StudentCourseInput, type StudentProfile } from "./types";

export type WhatIfChange =
  | { type: "add_course"; course: CatalogCourse; gradeLevel: number; predictedGrade?: string | null }
  | { type: "drop_course"; courseRef: string }
  | { type: "set_grade"; courseRef: string; predictedGrade: string | null }
  | { type: "set_test"; kind: string; score: number }
  | { type: "set_overall"; metric: "gpa" | "percent" | "points"; value: number };

export type LineChange = { lineId: string; kind: string; keys?: string[]; before: LineStatus | "absent"; after: LineStatus | "absent" };
export type ProgramDelta = {
  programId: string;
  before: MatchStatus;
  after: MatchStatus;
  /** 1 better, -1 worse, 0 same status. */
  direction: 1 | 0 | -1;
  missingBefore: number;
  missingAfter: number;
  changedLines: LineChange[];
};

/** Turn a catalog course into a planned course on the student's record. */
export function plannedCourse(course: CatalogCourse, gradeLevel: number, predictedGrade?: string | null, id?: string): StudentCourseInput {
  return {
    id: id ?? `plan:${course.id}:${gradeLevel}`,
    courseId: course.courseId,
    code: course.code,
    nameEn: course.nameEn,
    nameAr: course.nameAr,
    gradeLevel,
    status: "PLANNED",
    predictedGrade: predictedGrade ?? null,
    finalGrade: null,
    gradeScale: course.gradeScale,
    mappingStatus: "CONFIRMED",
    mappings: course.mappings,
  };
}

/** courseRef matches a course id, a curriculum course id or a code. */
const matches = (c: StudentCourseInput, ref: string) => c.id === ref || c.courseId === ref || (!!c.code && c.code === ref);

export function applyChanges(profile: StudentProfile, changes: WhatIfChange[]): StudentProfile {
  const next: StudentProfile = { ...profile, courses: profile.courses.map((c) => ({ ...c })), tests: [...profile.tests], overall: { ...profile.overall } };
  for (const ch of changes) {
    if (ch.type === "add_course") {
      if (!next.courses.some((c) => c.courseId === ch.course.courseId)) next.courses.push(plannedCourse(ch.course, ch.gradeLevel, ch.predictedGrade, `whatif:${ch.course.id}`));
    } else if (ch.type === "drop_course") {
      next.courses = next.courses.filter((c) => !matches(c, ch.courseRef));
    } else if (ch.type === "set_grade") {
      next.courses = next.courses.map((c) => (matches(c, ch.courseRef) ? { ...c, predictedGrade: ch.predictedGrade, ...(c.status === "COMPLETED" ? { finalGrade: ch.predictedGrade } : {}) } : c));
    } else if (ch.type === "set_test") {
      next.tests = [...next.tests.filter((t) => t.kind !== ch.kind), { kind: ch.kind, score: ch.score }];
    } else if (ch.type === "set_overall") {
      next.overall[ch.metric] = { value: ch.value, final: false };
    }
  }
  return next;
}

export function diffResults(before: EvalResult, after: EvalResult): ProgramDelta {
  const b = new Map(before.lines.map((l) => [l.id, l]));
  const a = new Map(after.lines.map((l) => [l.id, l]));
  const changedLines: LineChange[] = [];
  for (const id of [...new Set([...b.keys(), ...a.keys()])].sort()) {
    const lb = b.get(id);
    const la = a.get(id);
    const sb = lb?.status ?? "absent";
    const sa = la?.status ?? "absent";
    if (sb !== sa) changedLines.push({ lineId: id, kind: (la ?? lb)!.kind, keys: (la ?? lb)!.keys, before: sb, after: sa });
  }
  const d = STATUS_RANK[after.status] - STATUS_RANK[before.status];
  return {
    programId: before.programId,
    before: before.status,
    after: after.status,
    direction: d > 0 ? 1 : d < 0 ? -1 : 0,
    missingBefore: before.counts.requiredMissing,
    missingAfter: after.counts.requiredMissing,
    changedLines,
  };
}

/** Before and after per programme for a list of changes. */
export function whatIf(profile: StudentProfile, programs: ProgramForEval[], changes: WhatIfChange[]): { profile: StudentProfile; deltas: ProgramDelta[]; after: EvalResult[] } {
  const next = applyChanges(profile, changes);
  const after = programs.map((p) => evaluate(next, p));
  const deltas = programs.map((p, i) => diffResults(evaluate(profile, p), after[i]));
  return { profile: next, deltas, after };
}
