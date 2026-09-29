// Loads what the requirements checker needs for one student: curriculum, current subjects,
// results and test scores with their confirmation state. Takes a tenant-scoped client.
import type { SchoolCurriculum, UniversityProgram } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";
import { checkRequirements } from "./checker";
import type { CheckResult, EnglishReq, ProgramForCheck, ProgramRequirements, StudentForCheck } from "./types";

type Db = TenantDb;

export const RESULT_ENTITY = "StudentSubjectResult";
export const SCORE_ENTITY = "StudentTestScore";
export const CONFIRM_RESULT = "pathways.result.confirm";
export const CONFIRM_SCORE = "pathways.score.confirm";

export type LoadedResult = { id: string; subjectCode: string; level: string | null; curriculum: SchoolCurriculum; predicted: string | null; achieved: string | null; updatedAt: Date; confirmed: boolean; confirmedAt: Date | null; confirmedById: string | null };
export type LoadedScore = { id: string; kind: string; score: number; takenAt: Date | null; createdAt: Date; confirmed: boolean; confirmedAt: Date | null; confirmedById: string | null };

export type StudentPathwayData = {
  studentId: string;
  curriculum: SchoolCurriculum;
  subjects: string[];
  offered: string[];
  results: LoadedResult[];
  scores: LoadedScore[];
  forCheck: StudentForCheck;
};

export async function loadStudentPathway(db: Db, orgId: string, studentId: string): Promise<StudentPathwayData | null> {
  const student = await db.student.findFirst({ where: { id: studentId, orgId }, select: { id: true, curriculum: true } });
  if (!student) return null;
  const [enrollments, registrations, subjects, results, scores] = await Promise.all([
    db.enrollment.findMany({ where: { orgId, studentId, status: "ACTIVE" }, select: { class: { select: { subject: { select: { code: true } } } } } }),
    db.subjectRegistration.findMany({ where: { orgId, studentId, status: { not: "DROPPED" } }, select: { subjectId: true } }),
    db.subject.findMany({ where: { orgId }, select: { id: true, code: true } }),
    db.studentSubjectResult.findMany({ where: { orgId, studentId }, orderBy: { subjectCode: "asc" } }),
    db.studentTestScore.findMany({ where: { orgId, studentId }, orderBy: [{ kind: "asc" }, { createdAt: "desc" }] }),
  ]);
  const codeById = new Map(subjects.map((s) => [s.id, s.code]));
  const taking = new Set<string>();
  for (const e of enrollments) if (e.class.subject?.code) taking.add(e.class.subject.code);
  for (const r of registrations) {
    const code = codeById.get(r.subjectId);
    if (code) taking.add(code);
  }
  const ids = [...results.map((r) => r.id), ...scores.map((s) => s.id)];
  const confirmations = ids.length
    ? await db.auditEvent.findMany({ where: { orgId, entityType: { in: [RESULT_ENTITY, SCORE_ENTITY] }, action: { in: [CONFIRM_RESULT, CONFIRM_SCORE] }, entityId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { entityId: true, createdAt: true, actorId: true } })
    : [];
  const latest = new Map<string, { at: Date; by: string | null }>();
  for (const c of confirmations) if (c.entityId && !latest.has(c.entityId)) latest.set(c.entityId, { at: c.createdAt, by: c.actorId });

  const loadedResults: LoadedResult[] = results.map((r) => {
    const c = latest.get(r.id);
    // A later edit by anyone invalidates the confirmation.
    const confirmed = !!c && c.at.getTime() >= r.updatedAt.getTime() - 1000;
    return { id: r.id, subjectCode: r.subjectCode, level: r.level, curriculum: r.curriculum, predicted: r.predicted, achieved: r.achieved, updatedAt: r.updatedAt, confirmed, confirmedAt: confirmed ? c!.at : null, confirmedById: confirmed ? c!.by : null };
  });
  const loadedScores: LoadedScore[] = scores.map((s) => {
    const c = latest.get(s.id);
    return { id: s.id, kind: s.kind, score: s.score, takenAt: s.takenAt, createdAt: s.createdAt, confirmed: !!c, confirmedAt: c?.at ?? null, confirmedById: c?.by ?? null };
  });
  const offered = subjects.map((s) => s.code);
  return {
    studentId,
    curriculum: student.curriculum,
    subjects: [...taking],
    offered,
    results: loadedResults,
    scores: loadedScores,
    forCheck: {
      curriculum: student.curriculum,
      subjects: [...taking],
      offered,
      results: loadedResults.filter((r) => r.curriculum === student.curriculum).map((r) => ({ subjectCode: r.subjectCode, level: r.level, predicted: r.predicted, achieved: r.achieved, confirmed: r.confirmed })),
      tests: loadedScores.map((s) => ({ kind: s.kind, score: s.score, confirmed: s.confirmed })),
    },
  };
}

export function programForCheck(p: Pick<UniversityProgram, "requiredSubjects" | "recommendedSubjects" | "requirements" | "englishReq">): ProgramForCheck {
  return {
    requiredSubjects: p.requiredSubjects,
    recommendedSubjects: p.recommendedSubjects,
    requirements: (p.requirements ?? {}) as ProgramRequirements,
    englishReq: (p.englishReq ?? null) as EnglishReq | null,
  };
}

export function checkProgram(p: Pick<UniversityProgram, "requiredSubjects" | "recommendedSubjects" | "requirements" | "englishReq">, data: StudentPathwayData): CheckResult {
  return checkRequirements(programForCheck(p), data.forCheck);
}

/** Next date for a month/day deadline, relative to now. */
export function nextOccurrence(month: number, day = 15, now = new Date()): Date {
  const year = now.getUTCFullYear();
  let d = new Date(Date.UTC(year, month - 1, day, 8));
  if (d.getTime() < now.getTime()) d = new Date(Date.UTC(year + 1, month - 1, day, 8));
  return d;
}

/** The nearest listed deadline for a programme, falling back to the university's usual month. */
export function programDeadline(req: ProgramRequirements, uniDeadlineMonth: number | null, now = new Date()): Date | null {
  const all = req.route?.deadlines ?? [];
  // Early rounds are optional; the main deadline is what the shortlist tracks.
  const main = all.filter((d) => d.kind !== "early");
  const dates = (main.length ? main : all).map((d) => nextOccurrence(d.month, d.day ?? 15, now));
  if (dates.length) return dates.sort((a, b) => a.getTime() - b.getTime())[0];
  return uniDeadlineMonth ? nextOccurrence(uniDeadlineMonth, 15, now) : null;
}
