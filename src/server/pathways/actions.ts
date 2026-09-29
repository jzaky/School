"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { getCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { generateAi } from "@/server/ai/provider";
import { canConfirm, canEditFor, resolvePathwayStudent } from "./access";
import { CONFIRM_RESULT, CONFIRM_SCORE, RESULT_ENTITY, SCORE_ENTITY, checkProgram, loadStudentPathway } from "./profile";
import { addProgramToShortlist } from "./shortlist";
import { PATHWAY_SUBJECTS } from "./subjects";
import { runScorecardImport, scorecardKey, ScorecardError } from "./scorecard";
import { universityStore } from "./us-data";
import { APPLY_ROUTES, CURRICULA, DEGREES, FIELDS, OVERALL, RESULT_LEVELS, TAWJIHI_STREAMS, TEST_KINDS, TEST_RANGE, UAE_STREAMS, type ProgramRequirements } from "./types";

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const done = () => revalidatePath("/", "layout");

// ---------------------------------------------------------------------------------------------
// Results and test scores (students, parents and advising staff)

const resultInput = z.object({
  studentId: z.string().min(1),
  subjectCode: z.enum([...PATHWAY_SUBJECTS, OVERALL] as [string, ...string[]]),
  level: z.string().max(20).nullable(),
  predicted: z.string().trim().max(8).nullable(),
  achieved: z.string().trim().max(8).nullable(),
});

function validLevel(curriculum: string, subjectCode: string, level: string | null) {
  if (subjectCode === OVERALL) {
    if (curriculum === "UAE_MOE") return level !== null && (UAE_STREAMS as readonly string[]).includes(level);
    if (curriculum === "JORDAN_TAWJIHI") return level !== null && (TAWJIHI_STREAMS as readonly string[]).includes(level);
    if (curriculum === "AMERICAN") return level === "GPA";
    return level === null;
  }
  const levels = RESULT_LEVELS[curriculum as keyof typeof RESULT_LEVELS] ?? [];
  return levels.length ? level !== null && levels.includes(level) : level === null;
}

export async function saveResultAction(raw: z.infer<typeof resultInput>): Promise<Ok> {
  const ctx = await getCtx();
  const parsed = resultInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const input = parsed.data;
  if (!(await canEditFor(ctx, input.studentId))) return { ok: false, error: "forbidden" };
  const student = await resolvePathwayStudent(ctx, input.studentId);
  if (!student || student.id !== input.studentId) return { ok: false, error: "forbidden" };
  if (!validLevel(student.curriculum, input.subjectCode, input.level)) return { ok: false, error: "invalid" };
  if (!input.predicted && !input.achieved) return { ok: false, error: "empty" };
  const { db, orgId } = ctx;
  const existing = await db.studentSubjectResult.findFirst({ where: { studentId: student.id, subjectCode: input.subjectCode, level: input.level } });
  const data = { predicted: input.predicted || null, achieved: input.achieved || null, curriculum: student.curriculum, updatedById: ctx.membershipId };
  const row = existing
    ? await db.studentSubjectResult.update({ where: { id: existing.id }, data })
    : await db.studentSubjectResult.create({ data: { orgId, studentId: student.id, subjectCode: input.subjectCode, level: input.level, ...data } });
  await audit(db, orgId, { actorId: ctx.membershipId, action: "pathways.result.save", entityType: RESULT_ENTITY, entityId: row.id, meta: { studentId: student.id, subjectCode: input.subjectCode } });
  // Advising staff entering a result confirm it at the same time.
  if (canConfirm(ctx)) await audit(db, orgId, { actorId: ctx.membershipId, action: CONFIRM_RESULT, entityType: RESULT_ENTITY, entityId: row.id, meta: { studentId: student.id } });
  done();
  return { ok: true };
}

export async function deleteResultAction(id: string): Promise<Ok> {
  const ctx = await getCtx();
  const row = await ctx.db.studentSubjectResult.findUnique({ where: { id } });
  if (!row || !(await canEditFor(ctx, row.studentId))) return { ok: false, error: "forbidden" };
  await ctx.db.studentSubjectResult.delete({ where: { id } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: "pathways.result.delete", entityType: RESULT_ENTITY, entityId: id, meta: { studentId: row.studentId } });
  done();
  return { ok: true };
}

const scoreInput = z.object({ studentId: z.string().min(1), kind: z.enum(TEST_KINDS), score: z.number(), takenAt: z.string().nullable() });

export async function saveScoreAction(raw: z.infer<typeof scoreInput>): Promise<Ok> {
  const ctx = await getCtx();
  const parsed = scoreInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const input = parsed.data;
  const range = TEST_RANGE[input.kind];
  if (input.score < range.min || input.score > range.max) return { ok: false, error: "range" };
  if (!(await canEditFor(ctx, input.studentId))) return { ok: false, error: "forbidden" };
  const takenAt = input.takenAt ? new Date(input.takenAt) : null;
  if (takenAt && (Number.isNaN(takenAt.getTime()) || takenAt.getTime() > Date.now() + 86400_000)) return { ok: false, error: "date" };
  const row = await ctx.db.studentTestScore.create({ data: { orgId: ctx.orgId, studentId: input.studentId, kind: input.kind, score: input.score, takenAt } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: "pathways.score.save", entityType: SCORE_ENTITY, entityId: row.id, meta: { studentId: input.studentId, kind: input.kind } });
  if (canConfirm(ctx)) await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: CONFIRM_SCORE, entityType: SCORE_ENTITY, entityId: row.id, meta: { studentId: input.studentId } });
  done();
  return { ok: true };
}

export async function deleteScoreAction(id: string): Promise<Ok> {
  const ctx = await getCtx();
  const row = await ctx.db.studentTestScore.findUnique({ where: { id } });
  if (!row || !(await canEditFor(ctx, row.studentId))) return { ok: false, error: "forbidden" };
  await ctx.db.studentTestScore.delete({ where: { id } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: "pathways.score.delete", entityType: SCORE_ENTITY, entityId: id, meta: { studentId: row.studentId } });
  done();
  return { ok: true };
}

export async function confirmAction(input: { studentId: string; resultIds: string[]; scoreIds: string[] }): Promise<Ok<{ count: number }>> {
  const ctx = await getCtx();
  if (!canConfirm(ctx) || !(await canEditFor(ctx, input.studentId))) return { ok: false, error: "forbidden" };
  const [results, scores] = await Promise.all([
    ctx.db.studentSubjectResult.findMany({ where: { id: { in: input.resultIds }, studentId: input.studentId }, select: { id: true } }),
    ctx.db.studentTestScore.findMany({ where: { id: { in: input.scoreIds }, studentId: input.studentId }, select: { id: true } }),
  ]);
  for (const r of results) await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: CONFIRM_RESULT, entityType: RESULT_ENTITY, entityId: r.id, meta: { studentId: input.studentId } });
  for (const s of scores) await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: CONFIRM_SCORE, entityType: SCORE_ENTITY, entityId: s.id, meta: { studentId: input.studentId } });
  done();
  return { ok: true, count: results.length + scores.length };
}

export async function setCurriculumAction(input: { studentId: string; curriculum: string }): Promise<Ok> {
  const ctx = await getCtx();
  if (!canConfirm(ctx) || !(await canEditFor(ctx, input.studentId))) return { ok: false, error: "forbidden" };
  const curriculum = z.enum(CURRICULA).safeParse(input.curriculum);
  if (!curriculum.success) return { ok: false, error: "invalid" };
  await ctx.db.student.update({ where: { id: input.studentId }, data: { curriculum: curriculum.data } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: "pathways.curriculum.set", entityType: "Student", entityId: input.studentId, meta: { curriculum: curriculum.data } });
  done();
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Shortlist and advice

export async function addProgramToShortlistAction(input: { programId: string; studentId: string }): Promise<Ok<{ created: boolean }>> {
  const ctx = await getCtx();
  if (!ctx.can("pathways.view") || ctx.isParent) return { ok: false, error: "forbidden" };
  if (!(await canEditFor(ctx, input.studentId))) return { ok: false, error: "forbidden" };
  const res = await addProgramToShortlist(ctx.db, ctx.orgId, { studentId: input.studentId, programId: input.programId, actorId: ctx.membershipId });
  if (!res.ok) return { ok: false, error: res.error };
  done();
  return { ok: true, created: res.created };
}

export type Advice = { summary: string; steps: string[] };

export async function pathwayAdviceAction(input: { programId: string; studentId: string }): Promise<Ok<{ advice: Advice; provider: string }>> {
  const ctx = await getCtx();
  if (!ctx.can("pathways.view") || !(await canEditFor(ctx, input.studentId))) return { ok: false, error: "forbidden" };
  const program = await ctx.db.universityProgram.findUnique({ where: { id: input.programId } });
  const data = await loadStudentPathway(ctx.db, ctx.orgId, input.studentId);
  if (!program || !data) return { ok: false, error: "not_found" };
  const uni = await ctx.db.university.findUnique({ where: { id: program.universityId } });
  const check = checkProgram(program, data);
  const t = await getTranslations("pathways.advice");
  const ts = await getTranslations("pathways.subject");
  const subj = (c: string) => (ts.has(c) ? ts(c) : c);
  const req = program.requirements as ProgramRequirements;
  // Facts are academic only (no names, no wellbeing, safeguarding or medical data).
  const facts = {
    programme: program.nameEn,
    university: uni?.nameEn ?? "",
    route: req.route?.via ?? null,
    requirementsAreIndicative: program.indicative || !program.lastVerifiedAt,
    curriculum: data.curriculum,
    listedForCurriculum: check.listed,
    items: check.items.map((i) => ({ kind: i.kind, code: i.code ?? null, status: i.status, required: i.required ?? null, have: i.have ?? null, optional: !!i.optional, predicted: !!i.provisional, unconfirmed: !!i.unconfirmed })),
    classesToTake: check.classesToTake,
    scoreGaps: check.scoreGaps,
  };
  const res = await generateAi<Advice>(ctx, {
    feature: "pathway_advice",
    sensitive: false,
    subjectType: "UniversityProgram",
    subjectId: program.id,
    instructions:
      "Write a short, encouraging draft for a secondary student about this university programme. Use ONLY the facts given. Never add a requirement, grade, score, deadline or statistic that is not in the facts. " +
      "Explain which listed requirements look met, which are not met and which are unknown, which classes to take and which scores to improve. Remind them the requirements are indicative and must be confirmed with the university and their counselor.",
    facts,
    outputShape: '{ "summary": "2 to 4 sentences", "steps": ["short next step", "..."] }',
    validate: (v): v is Advice => !!v && typeof (v as Advice).summary === "string" && Array.isArray((v as Advice).steps) && (v as Advice).steps.every((s) => typeof s === "string"),
    fallback: () => {
      const steps: string[] = [];
      for (const c of check.classesToTake) steps.push(t(c.required ? "stepTakeRequired" : "stepTakeRecommended", { subject: subj(c.code) }));
      for (const g of check.scoreGaps) steps.push(t("stepRaise", { test: g.code === OVERALL ? t("overall") : g.code, required: String(g.required), have: String(g.have) }));
      for (const i of check.items) if (i.kind === "admissionsTest" && i.status === "not_met") steps.push(t("stepRegister", { test: i.code ?? "" }));
      for (const i of check.items) if (i.kind === "english" && i.status === "unknown") steps.push(t("stepEnglish"));
      if (check.items.some((i) => i.unconfirmed)) steps.push(t("stepConfirm"));
      steps.push(t("stepVerify"));
      const summary = !check.listed
        ? t("summaryNotListed", { programme: program.nameEn })
        : t("summary", { programme: program.nameEn, met: check.summary.met, notMet: check.summary.notMet, unknown: check.summary.unknown });
      return { summary, steps };
    },
  });
  if (res.status !== "ok") return { ok: false, error: res.reason };
  return { ok: true, advice: res.output, provider: res.provider };
}

// ---------------------------------------------------------------------------------------------
// Counselor admin (pathways.manage)

const uniInput = z.object({
  id: z.string().nullable(),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  countryCode: z.string().trim().length(2).toUpperCase(),
  cityEn: z.string().trim().min(1).max(120),
  cityAr: z.string().trim().min(1).max(120),
  website: z.string().trim().max(200).nullable(),
  applyVia: z.enum(APPLY_ROUTES).nullable(),
  deadlineMonth: z.number().int().min(1).max(12).nullable(),
});

export async function saveUniversityAction(raw: z.infer<typeof uniInput>): Promise<Ok<{ id: string }>> {
  const ctx = await getCtx();
  if (!ctx.can("pathways.manage")) return { ok: false, error: "forbidden" };
  const parsed = uniInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { id, ...d } = parsed.data;
  const data = { ...d, website: d.website ? d.website.replace(/^https?:\/\//i, "").replace(/\/+$/, "") : null };
  const row = id
    ? await ctx.db.university.update({ where: { id }, data })
    : await ctx.db.university.create({ data: { ...data, orgId: ctx.orgId, key: `custom-${d.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`, programsEn: [] } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: id ? "pathways.university.update" : "pathways.university.create", entityType: "University", entityId: row.id });
  done();
  return { ok: true, id: row.id };
}

const subjectCodes = z.array(z.enum(PATHWAY_SUBJECTS)).max(10);
const programInput = z.object({
  id: z.string().nullable(),
  universityId: z.string().min(1),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  field: z.enum(FIELDS),
  degree: z.enum(DEGREES),
  durationYears: z.number().min(1).max(8),
  requiredSubjects: subjectCodes,
  recommendedSubjects: subjectCodes,
  requirementsJson: z.string().max(20000),
  englishJson: z.string().max(4000),
  notesEn: z.string().max(2000).nullable(),
  notesAr: z.string().max(2000).nullable(),
  sourceUrl: z.string().trim().url().max(500).nullable(),
  checkedNow: z.boolean(),
});

const reqSchema = z
  .object({
    route: z.object({ via: z.enum(APPLY_ROUTES), url: z.string().optional(), deadlines: z.array(z.object({ kind: z.string(), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31).optional() })).optional() }).optional(),
    admissionsTests: z.array(z.string()).optional(),
    BRITISH: z.record(z.unknown()).optional(),
    IB: z.record(z.unknown()).optional(),
    AMERICAN: z.record(z.unknown()).optional(),
    UAE_MOE: z.record(z.unknown()).optional(),
    JORDAN_TAWJIHI: z.record(z.unknown()).optional(),
  })
  .strict();
const englishSchema = z.object({ ielts: z.number().min(0).max(9).optional(), ieltsMinBand: z.number().min(0).max(9).optional(), toefl: z.number().min(0).max(120).optional(), emsatEnglish: z.number().min(500).max(2000).optional(), notesEn: z.string().optional(), notesAr: z.string().optional() }).strict();

function parseJson(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function saveProgramAction(raw: z.infer<typeof programInput>): Promise<Ok<{ id: string }>> {
  const ctx = await getCtx();
  if (!ctx.can("pathways.manage")) return { ok: false, error: "forbidden" };
  const parsed = programInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const p = parsed.data;
  const reqJson = parseJson(p.requirementsJson);
  const req = reqSchema.safeParse(reqJson ?? {});
  if (reqJson === undefined || !req.success) return { ok: false, error: "requirementsJson" };
  const enJson = parseJson(p.englishJson);
  const en = enJson === null ? null : englishSchema.safeParse(enJson);
  if (enJson === undefined || (en && !en.success)) return { ok: false, error: "englishJson" };
  const uni = await ctx.db.university.findUnique({ where: { id: p.universityId } });
  if (!uni) return { ok: false, error: "not_found" };
  const now = new Date();
  const data = {
    universityId: uni.id,
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    field: p.field,
    degree: p.degree,
    durationYears: p.durationYears,
    requiredSubjects: p.requiredSubjects,
    recommendedSubjects: p.recommendedSubjects,
    requirements: req.data as never,
    englishReq: (en?.data ?? undefined) as never,
    notesEn: p.notesEn || null,
    notesAr: p.notesAr || null,
    sourceUrl: p.sourceUrl,
    // Any edit makes the programme indicative again unless the editor has just checked the official page.
    indicative: !p.checkedNow,
    lastVerifiedAt: p.checkedNow ? now : null,
  };
  const row = p.id
    ? await ctx.db.universityProgram.update({ where: { id: p.id }, data })
    : await ctx.db.universityProgram.create({ data: { ...data, orgId: ctx.orgId, key: `custom-${p.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Date.now().toString(36)}` } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: p.id ? "pathways.program.update" : "pathways.program.create", entityType: "UniversityProgram", entityId: row.id });
  if (p.checkedNow) await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: "pathways.program.verify", entityType: "UniversityProgram", entityId: row.id, meta: { sourceUrl: p.sourceUrl } });
  done();
  return { ok: true, id: row.id };
}

export async function markProgramCheckedAction(programId: string): Promise<Ok> {
  const ctx = await getCtx();
  if (!ctx.can("pathways.manage")) return { ok: false, error: "forbidden" };
  const row = await ctx.db.universityProgram.findUnique({ where: { id: programId } });
  if (!row) return { ok: false, error: "not_found" };
  if (!row.sourceUrl) return { ok: false, error: "no_source" };
  await ctx.db.universityProgram.update({ where: { id: row.id }, data: { lastVerifiedAt: new Date(), indicative: false } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: "pathways.program.verify", entityType: "UniversityProgram", entityId: row.id, meta: { sourceUrl: row.sourceUrl } });
  done();
  return { ok: true };
}

export async function runScorecardImportAction(): Promise<Ok<{ created: number; updated: number; linked: number; total: number }>> {
  const ctx = await getCtx();
  if (!ctx.can("pathways.manage")) return { ok: false, error: "forbidden" };
  const { db, orgId } = ctx;
  const key = scorecardKey();
  const run = await db.jobRun.create({ data: { orgId, queue: "pathways", name: "scorecard_import", idempotencyKey: `scorecard-import:${Date.now()}`, status: "RUNNING" } });
  try {
    // DEMO_KEY is limited to a few requests an hour, so it imports the first pages only.
    const res = await runScorecardImport({ store: universityStore(db, orgId), apiKey: key, maxPages: key === "DEMO_KEY" ? 5 : undefined });
    await db.jobRun.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date(), result: res as never } });
    await audit(db, orgId, { actorId: ctx.membershipId, action: "pathways.scorecard.import", entityType: "JobRun", entityId: run.id, meta: res });
    done();
    return { ok: true, created: res.created, updated: res.updated, linked: res.linked, total: res.total };
  } catch (e) {
    const code = e instanceof ScorecardError ? e.code : "unreachable";
    await db.jobRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), result: { error: code } as never } });
    await audit(db, orgId, { actorId: ctx.membershipId, action: "pathways.scorecard.import_failed", entityType: "JobRun", entityId: run.id, meta: { error: code } });
    done();
    return { ok: false, error: code };
  }
}
