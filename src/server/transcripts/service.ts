// Transcript import and the student course record. Every function takes an EngineActor (see
// src/server/pathway-engine/access.ts), checks access first and goes through the tenant-scoped client.
// Commit is idempotent: each row remembers the StudentCourse it wrote, so committing again updates
// those rows instead of adding new ones. Audit events never carry grades or names.
import type { MappingStatus, Prisma, SchoolCurriculum, StudentCourseStatus } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { catalogScope } from "@/server/pathways/scope";
import { EngineAccessError, type EngineActor } from "@/server/pathway-engine/access";
import { computeMatches, getCurrentPlan } from "@/server/pathway-engine/service";
import { scaleFor } from "@/server/pathway-engine/grade-scales";
import type { Curriculum, EvalResult, MatchStatus } from "@/server/pathway-engine/types";
import { weightedAverage } from "@/server/grades/calc";
import { loadBands } from "@/server/grades/queries";
import { canManageRecord, canUpload, canViewRecord } from "./access";
import { matchCourse, type CandidateCourse } from "./match";
import { inferStatus } from "./parse";
import { suggestFromAverage } from "./suggest";
import type { CommitSummary, ImportKind, ImportPayload, ImportRow, ParseProblem, ParsedRow, ProgramChange, RowDecision } from "./types";

const fail = (code: "forbidden" | "not_found" | "invalid" | "conflict"): never => {
  throw new EngineAccessError(code);
};

// ---------------------------------------------------------------------------------------------
// Catalog candidates

const COURSE_SELECT = { id: true, orgId: true, curriculum: true, code: true, nameEn: true, nameAr: true, qualification: true, gradeLevel: true, gradeScale: true } as const;

async function candidatesFor(db: TenantDb, orgId: string, curricula: SchoolCurriculum[]): Promise<{ candidates: CandidateCourse[]; offered: Set<string>; scale: Map<string, string> }> {
  const [rows, school] = await Promise.all([
    db.curriculumCourse.findMany({ where: { ...catalogScope(orgId), curriculum: { in: [...new Set(curricula)] } }, select: COURSE_SELECT }),
    db.schoolCourse.findMany({ where: { orgId, active: true }, select: { courseId: true } }),
  ]);
  return {
    candidates: rows.map((r) => ({ id: r.id, curriculum: r.curriculum as Curriculum, code: r.code, nameEn: r.nameEn, nameAr: r.nameAr, qualification: r.qualification, gradeLevel: r.gradeLevel })),
    offered: new Set(school.map((s) => s.courseId)),
    scale: new Map(rows.map((r) => [r.id, r.gradeScale || scaleFor(r.curriculum, r.qualification)])),
  };
}

/** Catalog courses for the searchable picker (global catalog plus the school's own). */
export async function searchCourses(db: TenantDb, orgId: string, q: string, curriculum?: SchoolCurriculum | null, take = 20) {
  const needle = q.trim().slice(0, 60);
  const where: Prisma.CurriculumCourseWhereInput = {
    AND: [
      catalogScope(orgId),
      ...(curriculum ? [{ curriculum }] : []),
      ...(needle ? [{ OR: [{ nameEn: { contains: needle, mode: "insensitive" as const } }, { nameAr: { contains: needle } }, { code: { contains: needle, mode: "insensitive" as const } }] }] : []),
    ],
  };
  return db.curriculumCourse.findMany({ where, select: COURSE_SELECT, orderBy: [{ curriculum: "asc" }, { gradeLevel: "asc" }, { nameEn: "asc" }], take });
}

async function assertCourse(db: TenantDb, orgId: string, courseId: string) {
  const c = await db.curriculumCourse.findFirst({ where: { id: courseId, ...catalogScope(orgId) }, select: COURSE_SELECT });
  if (!c) fail("invalid");
  return c!;
}

// ---------------------------------------------------------------------------------------------
// Imports

export type CreateImportInput = {
  studentId: string;
  fileName: string;
  kind: ImportKind;
  /** The curriculum the transcript comes from (rows may override it). */
  curriculum: Curriculum;
  /** Used for rows that do not say which grade they belong to. */
  defaultGradeLevel: number;
  rows: ParsedRow[];
  problems: ParseProblem[];
};

/** Match every row against the catalog and store the import for review. Nothing touches the course record yet. */
export async function createImport(actor: EngineActor, input: CreateImportInput): Promise<{ id: string; rows: number; needsReview: number }> {
  if (!canUpload(actor, input.studentId)) fail("forbidden");
  const student = await actor.db.student.findFirst({ where: { id: input.studentId, orgId: actor.orgId }, select: { id: true } });
  if (!student) fail("not_found");
  if (!input.rows.length || input.defaultGradeLevel < 6 || input.defaultGradeLevel > 13) fail("invalid");
  const curricula = [input.curriculum, ...input.rows.map((r) => r.curriculum).filter((c): c is Curriculum => !!c)] as SchoolCurriculum[];
  const { candidates, offered } = await candidatesFor(actor.db, actor.orgId, curricula);
  const rows: ImportRow[] = input.rows.map((r, i) => {
    const curriculum = r.curriculum ?? input.curriculum;
    const gradeLevel = r.gradeLevel ?? input.defaultGradeLevel;
    const match = matchCourse({ name: r.name, code: r.code, curriculum, gradeLevel }, candidates, offered);
    return { ...r, i, curriculum, gradeLevel, status: inferStatus(r), match, decision: match.auto ? "AUTO" : "NEEDS_REVIEW", courseId: match.courseId };
  });
  const payload: ImportPayload = { v: 1, curriculum: input.curriculum, rows, lastCommit: null };
  const row = await actor.db.transcriptImport.create({
    data: {
      orgId: actor.orgId,
      studentId: input.studentId,
      fileName: input.fileName.slice(0, 160) || "transcript",
      kind: input.kind,
      status: "PENDING",
      rows: payload as unknown as Prisma.InputJsonValue,
      errors: input.problems as unknown as Prisma.InputJsonValue,
      createdById: actor.membershipId,
    },
  });
  const needsReview = rows.filter((r) => r.decision === "NEEDS_REVIEW").length;
  await audit(actor.db, actor.orgId, { actorId: actor.membershipId, action: "transcripts.import.create", entityType: "TranscriptImport", entityId: row.id, meta: { studentId: input.studentId, kind: input.kind, rows: rows.length, needsReview } });
  return { id: row.id, rows: rows.length, needsReview };
}

export const payloadOf = (json: unknown): ImportPayload => {
  const p = json as ImportPayload | null;
  return p && Array.isArray(p.rows) ? p : { v: 1, curriculum: "OTHER", rows: [], lastCommit: null };
};

async function importFor(actor: EngineActor, id: string) {
  const imp = await actor.db.transcriptImport.findFirst({ where: { id, orgId: actor.orgId } });
  if (!imp || !imp.studentId) fail("not_found");
  return imp! as typeof imp & { studentId: string };
}

export type CourseInfo = { id: string; code: string; nameEn: string; nameAr: string; curriculum: string; qualification: string; gradeLevel: number | null; isGlobal: boolean; subjects: string[] };

async function courseInfo(db: TenantDb, orgId: string, ids: string[]): Promise<Map<string, CourseInfo>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const [rows, maps] = await Promise.all([
    db.curriculumCourse.findMany({ where: { id: { in: uniq }, ...catalogScope(orgId) }, select: COURSE_SELECT }),
    db.curriculumCourseMapping.findMany({ where: { courseId: { in: uniq }, ...catalogScope(orgId) }, select: { courseId: true, canonicalSubjectKey: true, rigorScore: true }, orderBy: { rigorScore: "desc" } }),
  ]);
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, code: r.code, nameEn: r.nameEn, nameAr: r.nameAr, curriculum: r.curriculum, qualification: r.qualification, gradeLevel: r.gradeLevel, isGlobal: r.orgId === null, subjects: [...new Set(maps.filter((m) => m.courseId === r.id).map((m) => m.canonicalSubjectKey))] },
    ]),
  );
}

export type ImportView = {
  id: string;
  studentId: string;
  fileName: string;
  kind: string;
  status: string;
  createdAt: Date;
  createdById: string;
  payload: ImportPayload;
  problems: ParseProblem[];
  courses: Map<string, CourseInfo>;
  canManage: boolean;
};

export async function getImport(actor: EngineActor, id: string): Promise<ImportView> {
  const imp = await importFor(actor, id);
  if (!canViewRecord(actor, imp.studentId)) fail("forbidden");
  const payload = payloadOf(imp.rows);
  const ids = payload.rows.flatMap((r) => [r.courseId, r.match.courseId, ...r.match.alternatives.map((a) => a.courseId)]).filter((x): x is string => !!x);
  return {
    id: imp.id,
    studentId: imp.studentId,
    fileName: imp.fileName,
    kind: imp.kind,
    status: imp.status,
    createdAt: imp.createdAt,
    createdById: imp.createdById,
    payload,
    problems: (imp.errors as ParseProblem[] | null) ?? [],
    courses: await courseInfo(actor.db, actor.orgId, ids),
    canManage: canManageRecord(actor, imp.studentId),
  };
}

export async function listImports(actor: EngineActor, opts: { studentId?: string | null; take?: number } = {}) {
  if (actor.isParent) return [];
  let ids: string[] | null = actor.visibleStudentIds;
  if (actor.isStudent) ids = actor.visibleStudentIds ?? [];
  else if (!actor.can("pathways.manage") && !actor.can("planner.approve")) return [];
  if (opts.studentId) ids = ids === null ? [opts.studentId] : ids.filter((s) => s === opts.studentId);
  const where: Prisma.TranscriptImportWhereInput = { orgId: actor.orgId, ...(ids ? { studentId: { in: ids } } : {}) };
  const rows = await actor.db.transcriptImport.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.take ?? 50 });
  return rows.map((r) => {
    const p = payloadOf(r.rows);
    return { id: r.id, studentId: r.studentId, fileName: r.fileName, kind: r.kind, status: r.status, createdAt: r.createdAt, createdById: r.createdById, rows: p.rows.length, needsReview: p.rows.filter((x) => x.decision === "NEEDS_REVIEW").length, committedAt: p.lastCommit?.at ?? null };
  });
}

export type RowAction = { type: "confirm" } | { type: "choose"; courseId: string } | { type: "local" } | { type: "reset" };

/** The reviewer settles one row: confirm the suggestion, pick another course, or keep it as a local course. */
export async function setRowDecision(actor: EngineActor, importId: string, rowIndex: number, action: RowAction) {
  const imp = await importFor(actor, importId);
  if (!canManageRecord(actor, imp.studentId)) fail("forbidden");
  const payload = payloadOf(imp.rows);
  const row = payload.rows.find((r) => r.i === rowIndex);
  if (!row) fail("not_found");
  const r = row!;
  let decision: RowDecision = r.decision;
  let courseId = r.courseId;
  if (action.type === "confirm") {
    if (!r.courseId) fail("invalid");
    decision = "CONFIRMED";
  } else if (action.type === "choose") {
    await assertCourse(actor.db, actor.orgId, action.courseId);
    courseId = action.courseId;
    decision = "CONFIRMED";
  } else if (action.type === "local") {
    courseId = null;
    decision = "LOCAL";
  } else {
    courseId = r.match.courseId;
    decision = r.match.auto ? "AUTO" : "NEEDS_REVIEW";
  }
  r.decision = decision;
  r.courseId = courseId;
  await actor.db.transcriptImport.update({ where: { id: imp.id }, data: { rows: payload as unknown as Prisma.InputJsonValue } });
  await audit(actor.db, actor.orgId, { actorId: actor.membershipId, action: "transcripts.import.map", entityType: "TranscriptImport", entityId: imp.id, meta: { studentId: imp.studentId, row: rowIndex, decision, courseId } });
  return r;
}

const MAPPING: Record<RowDecision, MappingStatus> = { AUTO: "AUTO", CONFIRMED: "CONFIRMED", LOCAL: "CONFIRMED", NEEDS_REVIEW: "NEEDS_REVIEW" };

/** Programmes whose status or number of missing lines changed, and which rows newly meet a line. */
export function diffMatches(
  before: Array<{ meta: { id: string; nameEn: string; nameAr: string; university: { nameEn: string; nameAr: string } }; result: EvalResult }>,
  after: Array<{ meta: { id: string; nameEn: string; nameAr: string; university: { nameEn: string; nameAr: string } }; result: EvalResult }>,
  rowOfCourse: Map<string, number>,
): { programs: ProgramChange[]; rowEffects: Record<string, string[]> } {
  const prev = new Map(before.map((m) => [m.meta.id, m.result]));
  const programs: ProgramChange[] = [];
  const rowEffects: Record<string, string[]> = {};
  for (const m of after) {
    const b = prev.get(m.meta.id);
    const a = m.result;
    const beforeStatus: MatchStatus = b?.status ?? "UNKNOWN_DATA";
    if (!b || b.status !== a.status || b.counts.requiredMissing !== a.counts.requiredMissing) {
      programs.push({ programId: m.meta.id, nameEn: m.meta.nameEn, nameAr: m.meta.nameAr, uniEn: m.meta.university.nameEn, uniAr: m.meta.university.nameAr, before: beforeStatus, after: a.status, missingBefore: b?.counts.requiredMissing ?? 0, missingAfter: a.counts.requiredMissing });
    }
    const prevLines = new Map((b?.lines ?? []).map((l) => [l.id, l.status]));
    for (const l of a.lines) {
      if (l.status !== "met" || prevLines.get(l.id) === "met") continue;
      for (const s of l.satisfiedBy ?? []) {
        const i = rowOfCourse.get(s.courseId);
        if (i === undefined) continue;
        const k = String(i);
        rowEffects[k] = rowEffects[k] ?? [];
        if (!rowEffects[k].includes(m.meta.id)) rowEffects[k].push(m.meta.id);
      }
    }
  }
  return { programs, rowEffects };
}

/**
 * Write the reviewed rows to the student's course record (StudentCourse, source IMPORT) and report what
 * changed in their programme matches. Safe to run again: rows already written are updated, not duplicated,
 * and a course the student already has on record from another source is skipped.
 */
export async function commitImport(actor: EngineActor, importId: string): Promise<CommitSummary> {
  const imp = await importFor(actor, importId);
  const studentId = imp.studentId;
  if (!canManageRecord(actor, studentId)) fail("forbidden");
  const payload = payloadOf(imp.rows);
  if (!payload.rows.length) fail("invalid");
  const { db, orgId } = actor;
  const plan = await getCurrentPlan(actor, studentId);
  const planId = plan?.id ?? null;
  const before = await computeMatches(actor, studentId, { planId });
  const scales = await candidatesFor(db, orgId, [...new Set(payload.rows.map((r) => r.curriculum))] as SchoolCurriculum[]);
  const chosen = payload.rows.map((r) => (r.decision === "LOCAL" ? null : r.courseId)).filter((x): x is string => !!x);
  const extra = chosen.filter((id) => !scales.scale.has(id));
  if (extra.length) {
    const more = await db.curriculumCourse.findMany({ where: { id: { in: extra }, ...catalogScope(orgId) }, select: COURSE_SELECT });
    for (const c of more) scales.scale.set(c.id, c.gradeScale || scaleFor(c.curriculum, c.qualification));
  }
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const rowOfCourse = new Map<string, number>();
  for (const r of payload.rows) {
    const courseId = r.decision === "LOCAL" ? null : r.courseId;
    const data = {
      courseId,
      localName: r.name,
      gradeLevel: r.gradeLevel,
      schoolYear: r.schoolYear,
      status: r.status as StudentCourseStatus,
      finalGrade: r.finalGrade,
      predictedGrade: r.predictedGrade,
      gradeScale: r.gradeScale ?? (courseId ? (scales.scale.get(courseId) ?? null) : scaleFor(r.curriculum)),
      source: "IMPORT",
      mappingStatus: MAPPING[r.decision],
      importId: imp.id,
    };
    const existing =
      (r.studentCourseId ? await db.studentCourse.findFirst({ where: { id: r.studentCourseId, orgId, studentId }, select: { id: true } }) : null) ??
      (await db.studentCourse.findFirst({ where: { orgId, studentId, importId: imp.id, localName: r.name, gradeLevel: r.gradeLevel }, select: { id: true } }));
    if (existing) {
      await db.studentCourse.update({ where: { id: existing.id }, data });
      r.studentCourseId = existing.id;
      r.duplicateOf = null;
      rowOfCourse.set(existing.id, r.i);
      updated++;
      continue;
    }
    const other = courseId
      ? await db.studentCourse.findFirst({ where: { orgId, studentId, courseId, gradeLevel: r.gradeLevel, OR: [{ importId: null }, { importId: { not: imp.id } }] }, select: { id: true } })
      : await db.studentCourse.findFirst({ where: { orgId, studentId, courseId: null, localName: r.name, gradeLevel: r.gradeLevel, OR: [{ importId: null }, { importId: { not: imp.id } }] }, select: { id: true } });
    if (other) {
      r.studentCourseId = null;
      r.duplicateOf = other.id;
      skipped++;
      continue;
    }
    const sc = await db.studentCourse.create({ data: { orgId, studentId, ...data } });
    r.studentCourseId = sc.id;
    r.duplicateOf = null;
    rowOfCourse.set(sc.id, r.i);
    created++;
  }
  const after = await computeMatches(actor, studentId, { planId });
  const diff = diffMatches(before.matches, after.matches, rowOfCourse);
  const summary: CommitSummary = { at: new Date().toISOString(), byId: actor.membershipId, created, updated, skipped, ...diff };
  payload.lastCommit = summary;
  await db.transcriptImport.update({ where: { id: imp.id }, data: { status: "COMPLETED", rows: payload as unknown as Prisma.InputJsonValue } });
  await audit(db, orgId, { actorId: actor.membershipId, action: "transcripts.import.commit", entityType: "TranscriptImport", entityId: imp.id, meta: { studentId, created, updated, skipped, programsChanged: diff.programs.length } });
  return summary;
}

// ---------------------------------------------------------------------------------------------
// Course record

export type RecordRow = {
  id: string;
  courseId: string | null;
  localName: string;
  gradeLevel: number;
  schoolYear: string | null;
  status: StudentCourseStatus;
  finalGrade: string | null;
  predictedGrade: string | null;
  gradeScale: string | null;
  source: string;
  mappingStatus: MappingStatus;
  importId: string | null;
  course: CourseInfo | null;
  /** Grades module link: the current published average in the matching school subject. */
  average: { percent: number; suggestion: string | null; subjectEn: string; subjectAr: string } | null;
};

export async function getCourseRecord(actor: EngineActor, studentId: string): Promise<{ rows: RecordRow[]; canManage: boolean; imports: Map<string, string> }> {
  if (!canViewRecord(actor, studentId)) fail("forbidden");
  const { db, orgId } = actor;
  const rows = await db.studentCourse.findMany({ where: { orgId, studentId }, orderBy: [{ gradeLevel: "desc" }, { localName: "asc" }] });
  const [courses, averages, imports] = await Promise.all([
    courseInfo(db, orgId, rows.map((r) => r.courseId).filter((x): x is string => !!x)),
    subjectAverages(db, orgId, studentId),
    db.transcriptImport.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.importId).filter((x): x is string => !!x))] } }, select: { id: true, fileName: true } }),
  ]);
  const { bands } = await loadBands(db);
  const out: RecordRow[] = rows.map((r) => {
    const avg = r.courseId && r.status === "IN_PROGRESS" ? averages.byCourse.get(r.courseId) : undefined;
    return {
      id: r.id,
      courseId: r.courseId,
      localName: r.localName,
      gradeLevel: r.gradeLevel,
      schoolYear: r.schoolYear,
      status: r.status,
      finalGrade: r.finalGrade,
      predictedGrade: r.predictedGrade,
      gradeScale: r.gradeScale,
      source: r.source,
      mappingStatus: r.mappingStatus,
      importId: r.importId,
      course: r.courseId ? (courses.get(r.courseId) ?? null) : null,
      average: avg ? { percent: Math.round(avg.percent * 10) / 10, suggestion: suggestFromAverage(r.gradeScale, avg.percent, bands), subjectEn: avg.subjectEn, subjectAr: avg.subjectAr } : null,
    };
  });
  return { rows: out, canManage: canManageRecord(actor, studentId), imports: new Map(imports.map((i) => [i.id, i.fileName])) };
}

/**
 * Current averages from the Grades module for school subjects that a school course is linked to
 * (SchoolCourse.subjectId). Published assessments only, so the student sees the same figure as staff.
 */
export async function subjectAverages(db: TenantDb, orgId: string, studentId: string, now = new Date()) {
  const byCourse = new Map<string, { percent: number; subjectEn: string; subjectAr: string }>();
  const links = await db.schoolCourse.findMany({ where: { orgId, subjectId: { not: null } }, select: { courseId: true, subjectId: true } });
  if (!links.length) return { byCourse };
  const subjectIds = [...new Set(links.map((l) => l.subjectId!))];
  const enrollments = await db.enrollment.findMany({
    where: { orgId, studentId, status: "ACTIVE", class: { isHomeroom: false, subjectId: { in: subjectIds }, academicYear: { isCurrent: true } } },
    select: { classId: true, class: { select: { subjectId: true, subject: { select: { nameEn: true, nameAr: true } } } } },
  });
  if (!enrollments.length) return { byCourse };
  const assessments = await db.assessment.findMany({
    where: { orgId, classId: { in: enrollments.map((e) => e.classId) }, publishedAt: { not: null, lte: now } },
    select: { classId: true, maxScore: true, weight: true, grades: { where: { studentId }, select: { score: true, excused: true } } },
  });
  const bySubject = new Map<string, { percent: number; subjectEn: string; subjectAr: string }>();
  for (const e of enrollments) {
    const sid = e.class.subjectId!;
    const items = assessments.filter((a) => a.classId === e.classId).map((a) => ({ score: a.grades[0]?.score ?? null, excused: a.grades[0]?.excused ?? false, maxScore: a.maxScore, weight: a.weight }));
    const avg = weightedAverage(items);
    if (avg !== null) bySubject.set(sid, { percent: avg, subjectEn: e.class.subject?.nameEn ?? "", subjectAr: e.class.subject?.nameAr ?? "" });
  }
  for (const l of links) {
    const a = bySubject.get(l.subjectId!);
    if (a) byCourse.set(l.courseId, a);
  }
  return { byCourse };
}

async function recordRow(actor: EngineActor, id: string) {
  const row = await actor.db.studentCourse.findFirst({ where: { id, orgId: actor.orgId } });
  if (!row) fail("not_found");
  if (!canViewRecord(actor, row!.studentId)) fail("forbidden");
  return row!;
}

export type RecordPatch = { localName?: string; gradeLevel?: number; schoolYear?: string | null; status?: StudentCourseStatus; finalGrade?: string | null; predictedGrade?: string | null };

/** Staff edit any field. Students only change the predicted grade of their own courses that are not finished. */
export async function updateCourseRow(actor: EngineActor, id: string, patch: RecordPatch) {
  const row = await recordRow(actor, id);
  const manage = canManageRecord(actor, row.studentId);
  const data: Prisma.StudentCourseUpdateInput = {};
  if (manage) {
    if (patch.localName !== undefined) data.localName = patch.localName.trim().slice(0, 160) || row.localName;
    if (patch.gradeLevel !== undefined) {
      if (patch.gradeLevel < 6 || patch.gradeLevel > 13) fail("invalid");
      data.gradeLevel = patch.gradeLevel;
    }
    if (patch.schoolYear !== undefined) data.schoolYear = patch.schoolYear?.trim().slice(0, 20) || null;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.finalGrade !== undefined) data.finalGrade = patch.finalGrade?.trim().toUpperCase().slice(0, 8) || null;
  } else {
    if (!actor.isStudent || row.status === "COMPLETED") fail("forbidden");
    const others = Object.keys(patch).filter((k) => k !== "predictedGrade");
    if (others.length) fail("forbidden");
  }
  if (patch.predictedGrade !== undefined) data.predictedGrade = patch.predictedGrade?.trim().toUpperCase().slice(0, 8) || null;
  if (!Object.keys(data).length) return row;
  const updated = await actor.db.studentCourse.update({ where: { id: row.id }, data });
  await audit(actor.db, actor.orgId, { actorId: actor.membershipId, action: "transcripts.course.update", entityType: "StudentCourse", entityId: row.id, meta: { studentId: row.studentId, fields: Object.keys(data) } });
  return updated;
}

/**
 * Fix a course's mapping. Staff: pick a course (CONFIRMED), keep it local (CONFIRMED, no course) or confirm
 * the current one. Students may suggest a course; it stays NEEDS_REVIEW until staff confirm.
 */
export async function setCourseMapping(actor: EngineActor, id: string, input: { courseId: string | null; local?: boolean; confirm?: boolean }) {
  const row = await recordRow(actor, id);
  const manage = canManageRecord(actor, row.studentId);
  if (!manage && !actor.isStudent) fail("forbidden");
  let courseId = row.courseId;
  if (input.confirm) {
    if (!manage || !row.courseId) fail(manage ? "invalid" : "forbidden");
  } else if (input.local) {
    if (!manage) fail("forbidden");
    courseId = null;
  } else {
    if (!input.courseId) fail("invalid");
    await assertCourse(actor.db, actor.orgId, input.courseId!);
    courseId = input.courseId;
  }
  const mappingStatus: MappingStatus = manage ? "CONFIRMED" : "NEEDS_REVIEW";
  let gradeScale = row.gradeScale;
  if (courseId && courseId !== row.courseId) {
    const c = await assertCourse(actor.db, actor.orgId, courseId);
    gradeScale = row.gradeScale ?? (c.gradeScale || scaleFor(c.curriculum, c.qualification));
  }
  const updated = await actor.db.studentCourse.update({ where: { id: row.id }, data: { courseId, mappingStatus, gradeScale } });
  await audit(actor.db, actor.orgId, { actorId: actor.membershipId, action: "transcripts.course.map", entityType: "StudentCourse", entityId: row.id, meta: { studentId: row.studentId, courseId, mappingStatus, from: row.courseId } });
  return updated;
}

export async function addCourseRow(actor: EngineActor, studentId: string, input: { courseId: string | null; localName: string; gradeLevel: number; schoolYear?: string | null; status: StudentCourseStatus; finalGrade?: string | null; predictedGrade?: string | null }) {
  if (!canManageRecord(actor, studentId)) fail("forbidden");
  const student = await actor.db.student.findFirst({ where: { id: studentId, orgId: actor.orgId }, select: { id: true, curriculum: true } });
  if (!student) fail("not_found");
  if (input.gradeLevel < 6 || input.gradeLevel > 13) fail("invalid");
  const course = input.courseId ? await assertCourse(actor.db, actor.orgId, input.courseId) : null;
  const localName = (input.localName.trim() || course?.nameEn || "").slice(0, 160);
  if (!localName) fail("invalid");
  const row = await actor.db.studentCourse.create({
    data: {
      orgId: actor.orgId,
      studentId,
      courseId: course?.id ?? null,
      localName,
      gradeLevel: input.gradeLevel,
      schoolYear: input.schoolYear?.trim() || null,
      status: input.status,
      finalGrade: input.finalGrade?.trim().toUpperCase() || null,
      predictedGrade: input.predictedGrade?.trim().toUpperCase() || null,
      gradeScale: course ? course.gradeScale || scaleFor(course.curriculum, course.qualification) : scaleFor(student!.curriculum),
      source: "MANUAL",
      mappingStatus: "CONFIRMED",
    },
  });
  await audit(actor.db, actor.orgId, { actorId: actor.membershipId, action: "transcripts.course.add", entityType: "StudentCourse", entityId: row.id, meta: { studentId, courseId: row.courseId } });
  return row;
}

export async function deleteCourseRow(actor: EngineActor, id: string) {
  const row = await recordRow(actor, id);
  if (!canManageRecord(actor, row.studentId)) fail("forbidden");
  await actor.db.studentCourse.delete({ where: { id: row.id } });
  await audit(actor.db, actor.orgId, { actorId: actor.membershipId, action: "transcripts.course.delete", entityType: "StudentCourse", entityId: row.id, meta: { studentId: row.studentId, courseId: row.courseId, source: row.source } });
}

/** "Use current average": copies the Grades module suggestion into the predicted grade. Never automatic. */
export async function useCurrentAverage(actor: EngineActor, id: string) {
  const row = await recordRow(actor, id);
  if (!row.courseId || row.status !== "IN_PROGRESS") fail("invalid");
  const { byCourse } = await subjectAverages(actor.db, actor.orgId, row.studentId);
  const avg = byCourse.get(row.courseId!);
  const { bands } = await loadBands(actor.db);
  const suggestion = avg ? suggestFromAverage(row.gradeScale, avg.percent, bands) : null;
  if (!suggestion) fail("invalid");
  return updateCourseRow(actor, id, { predictedGrade: suggestion });
}
