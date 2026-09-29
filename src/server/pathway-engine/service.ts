// Pathway engine server layer: loads profiles, programmes and the school catalog through the
// tenant-scoped client, runs the pure engine, caches results (RequirementMatch and
// CourseImpactAnalysis keyed by inputsHash) and manages course plans with audit events.
// Every exported function takes an EngineActor (see access.ts) and checks access first.
import { createHash } from "node:crypto";
import type { CoursePlanStatus, Prisma, SchoolCurriculum } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { catalogScope } from "@/server/pathways/scope";
import { OVERALL } from "@/server/pathways/types";
import { EngineAccessError, assertView, canApprovePlan, canEditPlan, type EngineActor } from "./access";
import { evaluate, statusCounts } from "./evaluate";
import { scaleFor } from "./grade-scales";
import { stableStringify } from "./hash";
import { planCourses, findTargetPrograms, type Goal, type PlannerOutput, type PlannerProgram } from "./planner";
import { rankUnlocks, type UnlockResult } from "./unlock";
import { whatIf, type WhatIfChange } from "./whatif";
import {
  ENGINE_VERSION,
  LEVEL_RANK,
  type CatalogCourse,
  type CourseMapping,
  type Curriculum,
  type EvalResult,
  type MatchStatus,
  type ProgramForEval,
  type RequirementRow,
  type StudentCourseInput,
  type StudentProfile,
  type SubjectLevel,
} from "./types";

const sha = (v: unknown) => createHash("sha256").update(stableStringify(v)).digest("hex").slice(0, 40);

// ---------------------------------------------------------------------------------------------
// Legacy results (StudentSubjectResult) as courses

const LEGACY_KEYS: Record<string, string[]> = {
  MATH: ["mathematics"],
  FURTHER_MATH: ["further_mathematics", "mathematics"],
  PHYS: ["physics", "science"],
  CHEM: ["chemistry", "science"],
  BIO: ["biology", "science"],
  CS: ["computer_science"],
  ENG: ["english_language"],
  ENG_LIT: ["english_literature", "english_language"],
  ECON: ["economics"],
  BUS: ["business"],
  GEO: ["geography"],
  HIST: ["history"],
  PSY: ["psychology"],
  ART: ["art"],
  DT: ["design_technology"],
  FR: ["french", "second_language"],
  ARAB: ["arabic"],
};
const LEGACY_LEVEL: Record<string, { level: SubjectLevel; scale: string; rigor: number; label: string }> = {
  A_LEVEL: { level: "ADVANCED", scale: "A_LEVEL", rigor: 5, label: "A-Level" },
  AS_LEVEL: { level: "STANDARD", scale: "A_LEVEL", rigor: 4, label: "AS" },
  GCSE: { level: "STANDARD", scale: "GCSE_9", rigor: 3, label: "GCSE" },
  HL: { level: "HIGHER", scale: "IB_7", rigor: 5, label: "HL" },
  SL: { level: "STANDARD", scale: "IB_7", rigor: 4, label: "SL" },
  AP: { level: "ADVANCED", scale: "AP_5", rigor: 5, label: "AP" },
  HONORS: { level: "STANDARD", scale: "US_LETTER", rigor: 3, label: "Honors" },
};

// ---------------------------------------------------------------------------------------------
// Profile

export type StudentSummary = { id: string; firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string; gradeLevel: number; section: string | null; curriculum: SchoolCurriculum };
export type LoadedProfile = { student: StudentSummary; profile: StudentProfile; hash: string };

type MappingRow = { courseId: string; orgId: string | null; canonicalSubjectKey: string; level: SubjectLevel; rigorScore: number; confidence: number };

/** Mappings per curriculum course: global rows, overridden by the school's own rows for the same subject. */
async function mappingsFor(db: TenantDb, orgId: string, courseIds: string[]): Promise<Map<string, CourseMapping[]>> {
  const out = new Map<string, CourseMapping[]>();
  if (!courseIds.length) return out;
  const rows: MappingRow[] = await db.curriculumCourseMapping.findMany({ where: { courseId: { in: courseIds }, ...catalogScope(orgId) } });
  const byCourse = new Map<string, Map<string, MappingRow>>();
  for (const r of rows.sort((a, b) => (a.orgId === null ? -1 : 1) - (b.orgId === null ? -1 : 1))) {
    const m = byCourse.get(r.courseId) ?? new Map<string, MappingRow>();
    m.set(r.canonicalSubjectKey, r);
    byCourse.set(r.courseId, m);
  }
  for (const [cid, m] of byCourse) out.set(cid, [...m.values()].map((r) => ({ subjectKey: r.canonicalSubjectKey, level: r.level, rigor: r.rigorScore, confidence: r.confidence })));
  return out;
}

export async function loadStudentProfile(actor: EngineActor, studentId: string, opts: { planId?: string | null } = {}): Promise<LoadedProfile> {
  assertView(actor, studentId);
  const { db, orgId } = actor;
  const student = await db.student.findFirst({ where: { id: studentId, orgId }, select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, section: true, curriculum: true } });
  if (!student) throw new EngineAccessError("not_found");
  const [courses, legacy, scores, planItems] = await Promise.all([
    db.studentCourse.findMany({ where: { orgId, studentId }, orderBy: [{ gradeLevel: "asc" }, { localName: "asc" }] }),
    db.studentSubjectResult.findMany({ where: { orgId, studentId, curriculum: student.curriculum }, orderBy: { subjectCode: "asc" } }),
    db.studentTestScore.findMany({ where: { orgId, studentId }, orderBy: { createdAt: "asc" } }),
    opts.planId ? db.studentCoursePlanItem.findMany({ where: { orgId, planId: opts.planId }, orderBy: { gradeLevel: "asc" } }) : Promise.resolve([]),
  ]);
  const planCourseIds = planItems.map((i) => i.courseId).filter((x): x is string => !!x);
  const courseIds = [...new Set([...courses.map((c) => c.courseId).filter((x): x is string => !!x), ...planCourseIds])];
  const [catalogRows, maps] = await Promise.all([
    courseIds.length ? db.curriculumCourse.findMany({ where: { id: { in: courseIds } } }) : Promise.resolve([]),
    mappingsFor(db, orgId, courseIds),
  ]);
  const cc = new Map(catalogRows.map((c) => [c.id, c]));

  const list: StudentCourseInput[] = courses.map((c) => {
    const course = c.courseId ? cc.get(c.courseId) : undefined;
    return {
      id: c.id,
      courseId: c.courseId,
      code: course?.code ?? null,
      nameEn: course?.nameEn ?? c.localName,
      nameAr: course?.nameAr ?? c.localName,
      gradeLevel: c.gradeLevel,
      status: c.status,
      finalGrade: c.finalGrade,
      predictedGrade: c.predictedGrade,
      gradeScale: c.gradeScale ?? course?.gradeScale ?? null,
      mappingStatus: c.mappingStatus,
      mappings: c.courseId ? (maps.get(c.courseId) ?? []) : [],
    };
  });

  // Legacy results fill gaps (a subject at a level not already on the course record).
  const has = (key: string, level: SubjectLevel) => list.some((c) => c.mappings.some((m) => m.subjectKey === key && LEVEL_RANK[m.level] >= LEVEL_RANK[level]));
  const overall: StudentProfile["overall"] = {};
  let stream: string | null = null;
  for (const r of legacy) {
    const value = (r.achieved ?? "").trim() || (r.predicted ?? "").trim();
    const final = !!(r.achieved ?? "").trim();
    if (r.subjectCode === OVERALL) {
      const n = Number.parseFloat(value);
      if (student.curriculum === "UAE_MOE" || student.curriculum === "JORDAN_TAWJIHI") stream = r.level;
      if (!Number.isFinite(n)) continue;
      if (student.curriculum === "AMERICAN") overall.gpa = { value: n, final };
      else if (student.curriculum === "IB") overall.points = { value: n, final };
      else overall.percent = { value: n, final };
      continue;
    }
    const keys = LEGACY_KEYS[r.subjectCode];
    const lv = r.level ? LEGACY_LEVEL[r.level] : undefined;
    if (!keys || !lv || has(keys[0], lv.level)) continue;
    const extra = r.subjectCode === "MATH" && lv.level !== "STANDARD" ? ["calculus"] : [];
    list.push({
      id: `legacy:${r.id}`,
      courseId: null,
      code: `${r.subjectCode}_${r.level}`,
      nameEn: `${lv.label} ${r.subjectCode}`,
      nameAr: `${lv.label} ${r.subjectCode}`,
      gradeLevel: student.gradeLevel,
      status: final ? "COMPLETED" : "IN_PROGRESS",
      finalGrade: final ? value : null,
      predictedGrade: final ? null : value || null,
      gradeScale: lv.scale,
      mappingStatus: "CONFIRMED",
      mappings: [...keys, ...extra].map((k, i) => ({ subjectKey: k, level: lv.level, rigor: i === 0 ? lv.rigor : lv.rigor - 1, confidence: 1 })),
    });
  }
  // IB points from subject grades when no total is recorded.
  if (student.curriculum === "IB" && !overall.points) {
    const ib = list.filter((c) => c.gradeScale === "IB_7").map((c) => Number(c.finalGrade ?? c.predictedGrade)).filter((n) => Number.isFinite(n)).sort((a, b) => b - a);
    if (ib.length >= 6) overall.points = { value: ib.slice(0, 6).reduce((s, n) => s + n, 0), final: false };
  }
  // Plan items become planned courses.
  const taken = new Set(list.map((c) => c.courseId).filter(Boolean));
  for (const i of planItems) {
    if (!i.courseId || taken.has(i.courseId)) continue;
    const course = cc.get(i.courseId);
    if (!course) continue;
    taken.add(i.courseId);
    list.push({ id: `plan:${i.id}`, courseId: i.courseId, code: course.code, nameEn: course.nameEn, nameAr: course.nameAr, gradeLevel: i.gradeLevel, status: "PLANNED", finalGrade: null, predictedGrade: null, gradeScale: course.gradeScale, mappingStatus: "CONFIRMED", mappings: maps.get(i.courseId) ?? [] });
  }
  const tests: StudentProfile["tests"] = [];
  for (const s of scores) {
    const i = tests.findIndex((t) => t.kind === s.kind);
    if (i < 0) tests.push({ kind: s.kind, score: s.score });
    else if (s.score > tests[i].score) tests[i] = { kind: s.kind, score: s.score };
  }
  const profile: StudentProfile = { curriculum: student.curriculum as Curriculum, gradeLevel: student.gradeLevel, stream, courses: list, overall, tests };
  return { student, profile, hash: sha(profile) };
}

// ---------------------------------------------------------------------------------------------
// Programmes

export type ProgramMeta = {
  id: string;
  key: string;
  nameEn: string;
  nameAr: string;
  degree: string;
  degreeType: string | null;
  durationYears: number;
  fieldKeys: string[];
  tuitionPerYear: number | null;
  tuitionCurrency: string | null;
  teachingLanguage: string | null;
  sourceUrl: string | null;
  university: { id: string; nameEn: string; nameAr: string; countryCode: string; cityEn: string; cityAr: string; worldRank: number | null };
  isGlobal: boolean;
};
export type LoadedProgram = { meta: ProgramMeta; program: ProgramForEval };

let metaCache: { orgId: string; at: number; data: ProgramMeta[] } | null = null;

/** Every programme a school can see (global plus own), with university facts. Cached for a minute. */
export async function loadProgramMeta(db: TenantDb, orgId: string): Promise<ProgramMeta[]> {
  if (metaCache && metaCache.orgId === orgId && Date.now() - metaCache.at < 60_000) return metaCache.data;
  const [programs, unis] = await Promise.all([
    db.universityProgram.findMany({ where: catalogScope(orgId), select: { id: true, orgId: true, key: true, nameEn: true, nameAr: true, degree: true, degreeType: true, durationYears: true, fieldKeys: true, tuitionPerYear: true, tuitionCurrency: true, teachingLanguage: true, sourceUrl: true, universityId: true } }),
    db.university.findMany({ where: { ...catalogScope(orgId), programsEn: { isEmpty: false } }, select: { id: true, nameEn: true, nameAr: true, countryCode: true, cityEn: true, cityAr: true, worldRank: true } }),
  ]);
  const uniById = new Map(unis.map((u) => [u.id, u]));
  const data: ProgramMeta[] = [];
  for (const p of programs) {
    const u = uniById.get(p.universityId);
    if (!u) continue;
    data.push({ id: p.id, key: p.key, nameEn: p.nameEn, nameAr: p.nameAr, degree: p.degree, degreeType: p.degreeType, durationYears: p.durationYears, fieldKeys: p.fieldKeys, tuitionPerYear: p.tuitionPerYear, tuitionCurrency: p.tuitionCurrency, teachingLanguage: p.teachingLanguage, sourceUrl: p.sourceUrl, university: u, isGlobal: p.orgId === null });
  }
  data.sort((a, b) => (a.university.worldRank ?? 9999) - (b.university.worldRank ?? 9999) || a.key.localeCompare(b.key));
  metaCache = { orgId, at: Date.now(), data };
  return data;
}

/** Current requirement rows (with lines, source and checked date) for some programmes. */
export async function loadRequirements(db: TenantDb, orgId: string, programIds: string[]): Promise<Map<string, RequirementRow[]>> {
  const out = new Map<string, RequirementRow[]>(programIds.map((id) => [id, []]));
  if (!programIds.length) return out;
  const rows = await db.programRequirement.findMany({
    where: { programId: { in: programIds }, isCurrent: true, ...catalogScope(orgId) },
    include: { subjects: true, languages: true, tests: true, additional: true },
    orderBy: [{ curriculum: "asc" }, { version: "desc" }],
  });
  const lineSourceIds = rows.flatMap((r) => [...r.subjects, ...r.languages, ...r.tests, ...r.additional].map((x) => x.sourceId));
  const sourceIds = [...new Set([...rows.map((r) => r.sourceId), ...lineSourceIds].filter((x): x is string => !!x))];
  const sources = sourceIds.length ? await db.requirementSource.findMany({ where: { id: { in: sourceIds } }, select: { id: true, url: true, retrievedAt: true } }) : [];
  const src = new Map(sources.map((s) => [s.id, s]));
  const lineUrl = (id: string | null) => (id ? (src.get(id)?.url ?? null) : null);
  // A school's own row for a programme and curriculum replaces the global one.
  const picked = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = `${r.programId}|${r.curriculum ?? ""}`;
    const cur = picked.get(k);
    if (!cur || (cur.orgId === null && r.orgId !== null)) picked.set(k, r);
  }
  for (const r of picked.values()) {
    const s = r.sourceId ? src.get(r.sourceId) : undefined;
    const checked = r.verifiedAt ?? s?.retrievedAt ?? null;
    out.get(r.programId)!.push({
      id: r.id,
      curriculum: r.curriculum as Curriculum | null,
      intakeYear: r.intakeYear,
      version: r.version,
      confidence: r.confidence,
      minimumGPA: r.minimumGPA,
      minimumPercent: r.minimumPercent,
      minimumPoints: r.minimumPoints,
      gradeProfile: r.gradeProfile,
      stream: r.stream,
      notesEn: r.notesEn,
      notesAr: r.notesAr,
      evidenceLocator: r.evidenceLocator,
      sourceUrl: s?.url ?? null,
      checkedAt: checked ? checked.toISOString() : null,
      subjects: r.subjects.map((x) => ({ id: x.id, type: x.type, keys: x.canonicalSubjectKeys, minimumLevel: x.minimumLevel, minimumGrade: x.minimumGrade, alternatives: x.alternatives, noteEn: x.noteEn, noteAr: x.noteAr, evidenceQuote: x.evidenceQuote, sourceUrl: lineUrl(x.sourceId) })),
      languages: r.languages.map((x) => ({ id: x.id, test: x.test, minOverall: x.minOverall, minComponent: x.minComponent, waiverNoteEn: x.waiverNoteEn, evidenceQuote: x.evidenceQuote, sourceUrl: lineUrl(x.sourceId) })),
      tests: r.tests.map((x) => ({ id: x.id, test: x.test, policy: x.policy, minScore: x.minScore, noteEn: x.noteEn, evidenceQuote: x.evidenceQuote, sourceUrl: lineUrl(x.sourceId) })),
      additional: r.additional.map((x) => ({ id: x.id, kind: x.kind, required: x.required, noteEn: x.noteEn, noteAr: x.noteAr, evidenceQuote: x.evidenceQuote, sourceUrl: lineUrl(x.sourceId) })),
    });
  }
  return out;
}

export async function loadPrograms(db: TenantDb, orgId: string, programIds: string[]): Promise<LoadedProgram[]> {
  const meta = new Map((await loadProgramMeta(db, orgId)).map((m) => [m.id, m]));
  const reqs = await loadRequirements(db, orgId, programIds);
  return programIds.filter((id) => meta.has(id)).map((id) => ({ meta: meta.get(id)!, program: { id, requirements: reqs.get(id) ?? [] } }));
}

/** Programme, university, intakes and current requirement rows for one programme page. */
export async function getProgramDetail(db: TenantDb, orgId: string, programId: string) {
  const [loaded] = await loadPrograms(db, orgId, [programId]);
  if (!loaded) return null;
  const intakes = await db.programIntake.findMany({ where: { programId, isCurrent: true, ...catalogScope(orgId) }, orderBy: { intakeYear: "asc" }, select: { intakeYear: true, cycleLabel: true, applicationOpens: true } });
  return { ...loaded, intakes };
}

// ---------------------------------------------------------------------------------------------
// Goals and target programmes

export type StudentGoal = { careerKey: string | null; fieldKeys: string[]; countries: string[]; source: "plan" | "career" | "none" };

export async function getGoal(actor: EngineActor, studentId: string): Promise<StudentGoal> {
  assertView(actor, studentId);
  const plan = await currentPlanRow(actor.db, actor.orgId, studentId);
  if (plan && (plan.goalCareerKey || plan.goalFieldKeys.length)) return { careerKey: plan.goalCareerKey, fieldKeys: plan.goalFieldKeys, countries: plan.targetCountries, source: "plan" };
  const profile = await actor.db.careerProfile.findFirst({ where: { studentId, orgId: actor.orgId } });
  if (profile?.chosenCareerId) {
    const career = await actor.db.career.findFirst({ where: { id: profile.chosenCareerId, orgId: actor.orgId }, select: { key: true } });
    if (career) return { careerKey: career.key, fieldKeys: [], countries: profile.preferredCountries, source: "career" };
  }
  return { careerKey: null, fieldKeys: [], countries: profile?.preferredCountries ?? [], source: "none" };
}

export async function loadCareerFields(db: TenantDb) {
  return db.careerField.findMany({ select: { careerKey: true, fieldKey: true, weight: true } });
}

/** Target programmes for a goal (explicit programme ids on the plan come first). */
export async function targetProgramIds(actor: EngineActor, goal: Goal, extraIds: string[] = [], max = 24): Promise<string[]> {
  const metas = await loadProgramMeta(actor.db, actor.orgId);
  const careerFields = await loadCareerFields(actor.db);
  const light: PlannerProgram[] = metas.map((m) => ({ id: m.id, nameEn: m.nameEn, nameAr: m.nameAr, universityEn: m.university.nameEn, universityAr: m.university.nameAr, countryCode: m.university.countryCode, fieldKeys: m.fieldKeys, worldRank: m.university.worldRank, program: { id: m.id, requirements: [] } }));
  const found = findTargetPrograms(goal, careerFields, light, max).map((t) => t.p.id);
  return [...new Set([...extraIds, ...found])].slice(0, max);
}

// ---------------------------------------------------------------------------------------------
// Matches (cached)

export type ProgramMatch = { meta: ProgramMeta; result: EvalResult; cached: boolean };

function programFingerprint(p: ProgramForEval) {
  return p.requirements.map((r) => `${r.id}:${r.version}:${r.confidence}`).sort().join(",");
}

/**
 * Evaluate a student against programmes and cache the results in RequirementMatch. A stored row is
 * reused when its inputsHash matches (same profile, same requirement versions, same engine).
 */
export async function computeMatches(actor: EngineActor, studentId: string, opts: { planId?: string | null; programIds?: string[] } = {}): Promise<{ profile: LoadedProfile; matches: ProgramMatch[]; counts: Record<MatchStatus, number> }> {
  const planId = opts.planId ?? null;
  const loaded = await loadStudentProfile(actor, studentId, { planId });
  const ids = opts.programIds ?? (await targetProgramIds(actor, await goalOrPlan(actor, studentId, planId)));
  const programs = await loadPrograms(actor.db, actor.orgId, ids);
  const existing = await actor.db.requirementMatch.findMany({ where: { orgId: actor.orgId, studentId, planId, programId: { in: ids } } });
  const byProgram = new Map(existing.map((e) => [e.programId, e]));
  const matches: ProgramMatch[] = [];
  for (const { meta, program } of programs) {
    const inputsHash = sha([ENGINE_VERSION, loaded.hash, programFingerprint(program)]);
    const prev = byProgram.get(program.id);
    if (prev && prev.inputsHash === inputsHash) {
      matches.push({ meta, result: prev.detail as unknown as EvalResult, cached: true });
      continue;
    }
    const result = evaluate(loaded.profile, program);
    const data = {
      status: result.status,
      requiredSatisfied: result.counts.requiredSatisfied,
      requiredMissing: result.counts.requiredMissing,
      recommendedSatisfied: result.counts.recommendedSatisfied,
      detail: result as unknown as Prisma.InputJsonValue,
      inputsHash,
      computedAt: new Date(),
    };
    if (prev) await actor.db.requirementMatch.update({ where: { id: prev.id }, data });
    else await actor.db.requirementMatch.create({ data: { orgId: actor.orgId, studentId, programId: program.id, planId, ...data } });
    matches.push({ meta, result, cached: false });
  }
  return { profile: loaded, matches, counts: statusCounts(matches.map((m) => m.result)) };
}

async function goalOrPlan(actor: EngineActor, studentId: string, planId: string | null): Promise<Goal> {
  if (planId) {
    const plan = await actor.db.studentCoursePlan.findFirst({ where: { id: planId, orgId: actor.orgId, studentId } });
    if (plan && (plan.goalCareerKey || plan.goalFieldKeys.length)) return { careerKey: plan.goalCareerKey, fieldKeys: plan.goalFieldKeys, countries: plan.targetCountries };
  }
  const g = await getGoal(actor, studentId);
  return { careerKey: g.careerKey, fieldKeys: g.fieldKeys, countries: g.countries };
}

// ---------------------------------------------------------------------------------------------
// School catalog, unlock ranking and what-if

/** Courses the school offers for the student's curriculum, as engine catalog courses. */
export async function loadSchoolCatalog(db: TenantDb, orgId: string, curriculum?: SchoolCurriculum): Promise<CatalogCourse[]> {
  const rows = await db.schoolCourse.findMany({ where: { orgId, active: true } });
  if (!rows.length) return [];
  const courses = await db.curriculumCourse.findMany({ where: { id: { in: rows.map((r) => r.courseId) }, ...(curriculum ? { curriculum } : {}) } });
  const maps = await mappingsFor(db, orgId, courses.map((c) => c.id));
  const byId = new Map(courses.map((c) => [c.id, c]));
  return rows
    .filter((r) => byId.has(r.courseId))
    .map((r) => {
      const c = byId.get(r.courseId)!;
      return { id: r.id, courseId: c.id, code: c.code, nameEn: c.nameEn, nameAr: c.nameAr, gradeLevels: [...r.gradeLevels].sort((a, b) => a - b), gradeScale: c.gradeScale || scaleFor(c.curriculum, c.qualification), mappings: maps.get(c.id) ?? [] };
    })
    .sort((a, b) => a.gradeLevels[0] - b.gradeLevels[0] || a.code.localeCompare(b.code));
}

/** "Classes that open the most doors", cached in CourseImpactAnalysis by inputsHash. */
export async function computeCourseImpact(actor: EngineActor, studentId: string, opts: { planId?: string | null; limit?: number } = {}): Promise<{ results: UnlockResult[]; programs: ProgramMeta[]; cached: boolean }> {
  const planId = opts.planId ?? null;
  const loaded = await loadStudentProfile(actor, studentId, { planId });
  const ids = await targetProgramIds(actor, await goalOrPlan(actor, studentId, planId));
  const [programs, catalog] = await Promise.all([loadPrograms(actor.db, actor.orgId, ids), loadSchoolCatalog(actor.db, actor.orgId, loaded.student.curriculum)]);
  const inputsHash = sha([ENGINE_VERSION, loaded.hash, programs.map((p) => programFingerprint(p.program)), catalog.map((c) => [c.id, c.gradeLevels, c.mappings])]);
  const metas = programs.map((p) => p.meta);
  const existing = await actor.db.courseImpactAnalysis.findMany({ where: { orgId: actor.orgId, studentId, planId } });
  if (existing.length && existing.every((e) => e.inputsHash === inputsHash)) {
    const byId = new Map(catalog.map((c) => [c.id, c]));
    const results = existing
      .map((e) => ({ ...(e.detail as unknown as Omit<UnlockResult, "course">), course: byId.get(e.courseId)! }))
      .filter((r) => r.course && r.score > 0)
      .sort((a, b) => b.score - a.score || a.course.code.localeCompare(b.course.code));
    return { results: opts.limit ? results.slice(0, opts.limit) : results, programs: metas, cached: true };
  }
  const results = rankUnlocks(loaded.profile, programs.map((p) => p.program), catalog);
  await actor.db.courseImpactAnalysis.deleteMany({ where: { orgId: actor.orgId, studentId, planId } });
  const rows = results.length ? results : [];
  if (rows.length) {
    await actor.db.courseImpactAnalysis.createMany({
      data: rows.map((r) => {
        const { course, ...detail } = r;
        return { orgId: actor.orgId, studentId, planId, courseId: course.id, unlocks: r.unlocks, improves: r.improves, requiredBy: r.requiredBy, detail: detail as unknown as Prisma.InputJsonValue, inputsHash };
      }),
    });
  } else {
    // Remember that nothing ranked, so the next request is a cache hit.
    await actor.db.courseImpactAnalysis.create({ data: { orgId: actor.orgId, studentId, planId, courseId: "none", detail: { score: 0 } as Prisma.InputJsonValue, inputsHash } });
  }
  return { results: opts.limit ? results.slice(0, opts.limit) : results, programs: metas, cached: false };
}

/** Changes as sent by the what-if panel (ids, not engine objects). */
export type WhatIfInput =
  | { type: "add_course"; schoolCourseId: string; gradeLevel?: number; predictedGrade?: string | null }
  | { type: "drop_course"; courseRef: string }
  | { type: "set_grade"; courseRef: string; predictedGrade: string | null }
  | { type: "set_test"; kind: string; score: number };

export async function runWhatIf(actor: EngineActor, studentId: string, input: { planId?: string | null; changes: WhatIfInput[]; programIds?: string[] }) {
  const planId = input.planId ?? null;
  const loaded = await loadStudentProfile(actor, studentId, { planId });
  const ids = input.programIds?.length ? input.programIds : await targetProgramIds(actor, await goalOrPlan(actor, studentId, planId));
  const [programs, catalog] = await Promise.all([loadPrograms(actor.db, actor.orgId, ids), loadSchoolCatalog(actor.db, actor.orgId, loaded.student.curriculum)]);
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const changes: WhatIfChange[] = [];
  for (const ch of input.changes.slice(0, 20)) {
    if (ch.type === "add_course") {
      const c = byId.get(ch.schoolCourseId);
      if (!c) throw new EngineAccessError("invalid");
      const grade = ch.gradeLevel ?? c.gradeLevels.find((g) => g >= loaded.profile.gradeLevel) ?? c.gradeLevels[c.gradeLevels.length - 1];
      if (!c.gradeLevels.includes(grade)) throw new EngineAccessError("invalid");
      changes.push({ type: "add_course", course: c, gradeLevel: grade, predictedGrade: ch.predictedGrade ?? null });
    } else if (ch.type === "set_test") {
      if (!Number.isFinite(ch.score) || ch.score < 0 || ch.score > 3600) throw new EngineAccessError("invalid");
      changes.push({ type: "set_test", kind: ch.kind.toUpperCase().slice(0, 20), score: ch.score });
    } else changes.push(ch);
  }
  const res = whatIf(loaded.profile, programs.map((p) => p.program), changes);
  const metas = new Map(programs.map((p) => [p.meta.id, p.meta]));
  return { deltas: res.deltas.map((d) => ({ ...d, meta: metas.get(d.programId)! })), after: res.after };
}

// ---------------------------------------------------------------------------------------------
// Plans

const ACTIVE_PLAN: CoursePlanStatus[] = ["DRAFT", "PROPOSED", "APPROVED"];

async function currentPlanRow(db: TenantDb, orgId: string, studentId: string) {
  return db.studentCoursePlan.findFirst({ where: { orgId, studentId, status: { in: ACTIVE_PLAN } }, orderBy: { updatedAt: "desc" } });
}

export type PlanView = {
  id: string;
  name: string;
  status: CoursePlanStatus;
  goalCareerKey: string | null;
  goalFieldKeys: string[];
  targetCountries: string[];
  counselorNote: string | null;
  proposedById: string | null;
  approvedById: string | null;
  approvedAt: Date | null;
  updatedAt: Date;
  items: Array<{ id: string; gradeLevel: number; schoolCourseId: string | null; courseId: string | null; code: string | null; nameEn: string; nameAr: string; reasonEn: string | null; reasonAr: string | null; locked: boolean }>;
};

export async function getCurrentPlan(actor: EngineActor, studentId: string): Promise<PlanView | null> {
  assertView(actor, studentId);
  const plan = await currentPlanRow(actor.db, actor.orgId, studentId);
  if (!plan) return null;
  return planView(actor, plan.id);
}

async function planView(actor: EngineActor, planId: string): Promise<PlanView | null> {
  const plan = await actor.db.studentCoursePlan.findFirst({ where: { id: planId, orgId: actor.orgId }, include: { items: { orderBy: [{ gradeLevel: "asc" }] } } });
  if (!plan) return null;
  const courseIds = plan.items.map((i) => i.courseId).filter((x): x is string => !!x);
  const courses = courseIds.length ? await actor.db.curriculumCourse.findMany({ where: { id: { in: courseIds } }, select: { id: true, code: true, nameEn: true, nameAr: true } }) : [];
  const cc = new Map(courses.map((c) => [c.id, c]));
  return {
    id: plan.id,
    name: plan.name,
    status: plan.status,
    goalCareerKey: plan.goalCareerKey,
    goalFieldKeys: plan.goalFieldKeys,
    targetCountries: plan.targetCountries,
    counselorNote: plan.counselorNote,
    proposedById: plan.proposedById,
    approvedById: plan.approvedById,
    approvedAt: plan.approvedAt,
    updatedAt: plan.updatedAt,
    items: plan.items
      .map((i) => {
        const c = i.courseId ? cc.get(i.courseId) : undefined;
        return { id: i.id, gradeLevel: i.gradeLevel, schoolCourseId: i.schoolCourseId, courseId: i.courseId, code: c?.code ?? null, nameEn: c?.nameEn ?? "", nameAr: c?.nameAr ?? "", reasonEn: i.reasonEn, reasonAr: i.reasonAr, locked: i.locked };
      })
      .sort((a, b) => a.gradeLevel - b.gradeLevel || (a.code ?? "").localeCompare(b.code ?? "")),
  };
}

async function planFor(actor: EngineActor, planId: string) {
  const plan = await actor.db.studentCoursePlan.findFirst({ where: { id: planId, orgId: actor.orgId } });
  if (!plan) throw new EngineAccessError("not_found");
  assertView(actor, plan.studentId);
  return plan;
}

/** Run the planner for a goal. Creates a DRAFT plan or refreshes the current one, keeping locked items. */
export async function generatePlan(actor: EngineActor, studentId: string, goal: Goal): Promise<{ planId: string; output: PlannerOutput }> {
  if (!canEditPlan(actor, studentId)) throw new EngineAccessError("forbidden");
  const loaded = await loadStudentProfile(actor, studentId);
  const current = await currentPlanRow(actor.db, actor.orgId, studentId);
  const lockedItems = current ? await actor.db.studentCoursePlanItem.findMany({ where: { planId: current.id, locked: true, orgId: actor.orgId } }) : [];
  const ids = await targetProgramIds(actor, goal);
  const [programs, catalog, careerFields] = await Promise.all([loadPrograms(actor.db, actor.orgId, ids), loadSchoolCatalog(actor.db, actor.orgId, loaded.student.curriculum), loadCareerFields(actor.db)]);
  const output = planCourses({
    profile: loaded.profile,
    goal,
    careerFields,
    programs: programs.map((p) => ({ id: p.meta.id, nameEn: p.meta.nameEn, nameAr: p.meta.nameAr, universityEn: p.meta.university.nameEn, universityAr: p.meta.university.nameAr, countryCode: p.meta.university.countryCode, fieldKeys: p.meta.fieldKeys, worldRank: p.meta.university.worldRank, program: p.program })),
    catalog,
    locked: lockedItems.filter((i) => i.schoolCourseId).map((i) => ({ catalogId: i.schoolCourseId!, gradeLevel: i.gradeLevel, reasonEn: i.reasonEn, reasonAr: i.reasonAr })),
  });
  const planId = await writePlan(actor, studentId, current?.id ?? null, goal, output);
  await audit(actor.db, actor.orgId, { actorId: actor.membershipId, action: "pathways.plan.generate", entityType: "StudentCoursePlan", entityId: planId, meta: { studentId, items: output.items.length, targets: output.targets.length } });
  return { planId, output };
}

async function writePlan(actor: EngineActor, studentId: string, existingId: string | null, goal: Goal, output: PlannerOutput): Promise<string> {
  const data = {
    goalCareerKey: goal.careerKey ?? null,
    goalFieldKeys: goal.fieldKeys ?? [],
    targetCountries: goal.countries ?? [],
    targetProgramIds: output.targets.map((t) => t.id),
    status: "DRAFT" as const,
    approvedById: null,
    approvedAt: null,
  };
  let planId = existingId;
  if (planId) {
    await actor.db.studentCoursePlan.update({ where: { id: planId }, data });
    await actor.db.studentCoursePlanItem.deleteMany({ where: { planId, orgId: actor.orgId } });
  } else {
    const plan = await actor.db.studentCoursePlan.create({ data: { orgId: actor.orgId, studentId, name: "Grade 9 to 12 plan", ...data } });
    planId = plan.id;
  }
  if (output.items.length) {
    await actor.db.studentCoursePlanItem.createMany({
      data: output.items.map((i) => ({ orgId: actor.orgId, planId: planId!, gradeLevel: i.gradeLevel, schoolCourseId: i.catalogId, courseId: i.courseId, reasonEn: i.reasonEn, reasonAr: i.reasonAr, locked: i.locked })),
    });
  }
  return planId;
}

/** Replace a plan's items (from the plan builder). Any edit returns the plan to DRAFT. */
export async function savePlanItems(actor: EngineActor, planId: string, items: Array<{ schoolCourseId: string; gradeLevel: number; locked?: boolean }>) {
  const plan = await planFor(actor, planId);
  if (!canEditPlan(actor, plan.studentId)) throw new EngineAccessError("forbidden");
  if (actor.isStudent && plan.status === "PROPOSED") throw new EngineAccessError("conflict");
  const student = await actor.db.student.findFirst({ where: { id: plan.studentId, orgId: actor.orgId }, select: { curriculum: true } });
  const catalog = new Map((await loadSchoolCatalog(actor.db, actor.orgId, student?.curriculum)).map((c) => [c.id, c]));
  const old = await actor.db.studentCoursePlanItem.findMany({ where: { planId, orgId: actor.orgId } });
  const keep = new Map(old.map((o) => [`${o.schoolCourseId}|${o.gradeLevel}`, o]));
  const clean: Prisma.StudentCoursePlanItemCreateManyInput[] = [];
  const seen = new Set<string>();
  for (const it of items.slice(0, 60)) {
    const c = catalog.get(it.schoolCourseId);
    if (!c || !c.gradeLevels.includes(it.gradeLevel)) throw new EngineAccessError("invalid");
    const k = `${c.id}|${it.gradeLevel}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const prev = keep.get(k);
    clean.push({ orgId: actor.orgId, planId, gradeLevel: it.gradeLevel, schoolCourseId: c.id, courseId: c.courseId, reasonEn: prev?.reasonEn ?? "Added to the plan by hand.", reasonAr: prev?.reasonAr ?? "أضيفت إلى الخطة يدويًا.", locked: !!it.locked });
  }
  // Items that are not school catalog courses (for example transferred IB subjects) are kept as they are.
  await actor.db.studentCoursePlanItem.deleteMany({ where: { planId, orgId: actor.orgId, schoolCourseId: { not: null } } });
  if (clean.length) await actor.db.studentCoursePlanItem.createMany({ data: clean });
  await actor.db.studentCoursePlan.update({ where: { id: planId }, data: { status: "DRAFT", approvedById: null, approvedAt: null } });
  await audit(actor.db, actor.orgId, { actorId: actor.membershipId, action: "pathways.plan.update", entityType: "StudentCoursePlan", entityId: planId, meta: { studentId: plan.studentId, items: clean.length, from: plan.status } });
  return planView(actor, planId);
}

export async function setPlanGoal(actor: EngineActor, planId: string, goal: Goal) {
  const plan = await planFor(actor, planId);
  if (!canEditPlan(actor, plan.studentId)) throw new EngineAccessError("forbidden");
  await actor.db.studentCoursePlan.update({ where: { id: planId }, data: { goalCareerKey: goal.careerKey ?? null, goalFieldKeys: goal.fieldKeys ?? [], targetCountries: goal.countries ?? [] } });
  await audit(actor.db, actor.orgId, { actorId: actor.membershipId, action: "pathways.plan.goal", entityType: "StudentCoursePlan", entityId: planId, meta: { studentId: plan.studentId, careerKey: goal.careerKey ?? null, countries: goal.countries ?? [] } });
}

/** Student or staff sends the plan to a counselor. */
export async function submitPlan(actor: EngineActor, planId: string) {
  const plan = await planFor(actor, planId);
  if (!canEditPlan(actor, plan.studentId)) throw new EngineAccessError("forbidden");
  if (plan.status !== "DRAFT") throw new EngineAccessError("conflict");
  await actor.db.studentCoursePlan.update({ where: { id: planId }, data: { status: "PROPOSED", proposedById: actor.membershipId } });
  await audit(actor.db, actor.orgId, { actorId: actor.membershipId, action: "pathways.plan.submit", entityType: "StudentCoursePlan", entityId: planId, meta: { studentId: plan.studentId } });
}

/** Counselor approval (planner.approve). Earlier approved plans for the student are archived. */
export async function approvePlan(actor: EngineActor, planId: string, note: string | null) {
  const plan = await planFor(actor, planId);
  if (!canApprovePlan(actor, plan.studentId)) throw new EngineAccessError("forbidden");
  if (plan.status === "APPROVED" || plan.status === "ARCHIVED") throw new EngineAccessError("conflict");
  await actor.db.studentCoursePlan.updateMany({ where: { orgId: actor.orgId, studentId: plan.studentId, status: "APPROVED", id: { not: planId } }, data: { status: "ARCHIVED" } });
  await actor.db.studentCoursePlan.update({ where: { id: planId }, data: { status: "APPROVED", approvedById: actor.membershipId, approvedAt: new Date(), counselorNote: note?.trim().slice(0, 2000) || null } });
  await audit(actor.db, actor.orgId, { actorId: actor.membershipId, action: "pathways.plan.approve", entityType: "StudentCoursePlan", entityId: planId, meta: { studentId: plan.studentId, withNote: !!note } });
}

/** Counselor sends the plan back with a note. */
export async function requestPlanChanges(actor: EngineActor, planId: string, note: string) {
  const plan = await planFor(actor, planId);
  if (!canApprovePlan(actor, plan.studentId)) throw new EngineAccessError("forbidden");
  const text = note.trim().slice(0, 2000);
  if (!text) throw new EngineAccessError("invalid");
  await actor.db.studentCoursePlan.update({ where: { id: planId }, data: { status: "DRAFT", counselorNote: text, approvedById: null, approvedAt: null } });
  await audit(actor.db, actor.orgId, { actorId: actor.membershipId, action: "pathways.plan.request_changes", entityType: "StudentCoursePlan", entityId: planId, meta: { studentId: plan.studentId } });
}

// ---------------------------------------------------------------------------------------------
// Programme search

export type ProgramSearch = {
  q?: string;
  country?: string;
  field?: string;
  degreeType?: string;
  level?: string;
  language?: string;
  /** Tuition band in the programme's own currency: "low" (under 20,000), "mid" (20,000 to 50,000), "high" (over 50,000). */
  tuition?: "low" | "mid" | "high";
  /** Only programmes with a requirement row for this curriculum. */
  curriculum?: SchoolCurriculum;
  page?: number;
  pageSize?: number;
};

export async function searchPrograms(db: TenantDb, orgId: string, s: ProgramSearch) {
  const where: Prisma.UniversityProgramWhereInput = { AND: [catalogScope(orgId)] };
  const and = where.AND as Prisma.UniversityProgramWhereInput[];
  const q = s.q?.trim().toLowerCase();
  if (q) and.push({ OR: [{ searchText: { contains: q, mode: "insensitive" } }, { nameEn: { contains: q, mode: "insensitive" } }, { nameAr: { contains: q } }] });
  if (s.field) and.push({ fieldKeys: { has: s.field } });
  if (s.degreeType) and.push({ degreeType: s.degreeType });
  if (s.level) and.push({ level: s.level });
  if (s.language) and.push({ teachingLanguage: s.language });
  if (s.tuition === "low") and.push({ tuitionPerYear: { lt: 20000 } });
  if (s.tuition === "mid") and.push({ tuitionPerYear: { gte: 20000, lte: 50000 } });
  if (s.tuition === "high") and.push({ tuitionPerYear: { gt: 50000 } });
  if (s.country) {
    const unis = await db.university.findMany({ where: { ...catalogScope(orgId), countryCode: s.country }, select: { id: true } });
    and.push({ universityId: { in: unis.map((u) => u.id) } });
  }
  if (s.curriculum) {
    const rows = await db.programRequirement.findMany({ where: { ...catalogScope(orgId), isCurrent: true, curriculum: s.curriculum }, select: { programId: true }, distinct: ["programId"] });
    and.push({ id: { in: rows.map((r) => r.programId) } });
  }
  const pageSize = Math.min(100, Math.max(1, s.pageSize ?? 30));
  const page = Math.max(1, s.page ?? 1);
  const [total, rows] = await Promise.all([db.universityProgram.count({ where }), db.universityProgram.findMany({ where, orderBy: [{ nameEn: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true } })]);
  const meta = new Map((await loadProgramMeta(db, orgId)).map((m) => [m.id, m]));
  return { total, page, pageSize, items: rows.map((r) => meta.get(r.id)).filter((m): m is ProgramMeta => !!m) };
}
