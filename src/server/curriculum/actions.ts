"use server";

import { revalidatePath } from "next/cache";
import { getCtx, type Ctx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { generateAi, reviewAi } from "@/server/ai/provider";
import { canEditPlan, canUseCurriculum, currentTerms, inScope, reviewScope } from "./access";
import { codePrefix, isDraftStandard, parseStandardsCsv, parseStandardsText, type DraftStandard } from "./parse";
import { draftUnitFallback, isProposedLesson, type ProposedLesson } from "./drafter";
import { isActivity, isMaterial, writeBilingualText, type Activity, type Bilingual, type Material } from "./types";
import { PlanError, reviewPlan, submitPlan } from "./review";
import { extractPdfText } from "./pdf-text";
import { termOf } from "./coverage";

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");

function refresh() {
  revalidatePath("/[locale]/curriculum", "layout");
}

async function managerCtx() {
  const ctx = await getCtx();
  return ctx.isStaff && ctx.can("curriculum.manage") ? ctx : null;
}

// ---------------------------------------------------------------------------
// Frameworks and standards
// ---------------------------------------------------------------------------

export async function saveFrameworkAction(input: { id?: string; nameEn: string; nameAr: string; subjectId: string; gradeLevel: number; sourceEn?: string }) {
  const ctx = await managerCtx();
  if (!ctx) return fail("FORBIDDEN");
  const nameEn = clip(input.nameEn, 160);
  const nameAr = clip(input.nameAr, 160) || nameEn;
  const grade = Math.round(Number(input.gradeLevel));
  if (!nameEn) return fail("NAME");
  if (!Number.isFinite(grade) || grade < 1 || grade > 13) return fail("GRADE");
  const subject = await ctx.db.subject.findUnique({ where: { id: input.subjectId } });
  if (!subject) return fail("SUBJECT");
  const data = { nameEn, nameAr, subjectId: subject.id, gradeLevel: grade, sourceEn: clip(input.sourceEn, 200) || null };
  if (input.id) {
    const existing = await ctx.db.curriculumFramework.findUnique({ where: { id: input.id } });
    if (!existing) return fail("NOT_FOUND");
    await ctx.db.curriculumFramework.update({ where: { id: existing.id }, data });
    await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "curriculum.framework_update", entityType: "CurriculumFramework", entityId: existing.id });
    refresh();
    return { ok: true as const, id: existing.id };
  }
  const key = `${subject.code.toLowerCase()}-g${grade}-${Date.now().toString(36)}`;
  const row = await ctx.db.curriculumFramework.create({ data: { orgId: ctx.orgId, key, createdById: ctx.membershipId, ...data } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "curriculum.framework_create", entityType: "CurriculumFramework", entityId: row.id });
  refresh();
  return { ok: true as const, id: row.id };
}

export async function deleteFrameworkAction(id: string) {
  const ctx = await managerCtx();
  if (!ctx) return fail("FORBIDDEN");
  const fw = await ctx.db.curriculumFramework.findUnique({ where: { id } });
  if (!fw) return fail("NOT_FOUND");
  const used = await ctx.db.lessonPlanStandard.count({ where: { standard: { frameworkId: id } } });
  if (used) return fail("IN_USE");
  await ctx.db.curriculumFramework.delete({ where: { id } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "curriculum.framework_delete", entityType: "CurriculumFramework", entityId: id, meta: { name: fw.nameEn } });
  refresh();
  return { ok: true as const };
}

function cleanStandard(s: DraftStandard): DraftStandard | null {
  const code = clip(s.code, 40);
  const descEn = clip(s.descEn, 600);
  const descAr = clip(s.descAr, 600) || descEn;
  const strandEn = clip(s.strandEn, 120) || "General";
  const strandAr = clip(s.strandAr, 120) || strandEn;
  if (!code || !descEn) return null;
  return { code, descEn, descAr, strandEn, strandAr };
}

export async function saveStandardAction(input: DraftStandard & { id?: string; frameworkId: string }) {
  const ctx = await managerCtx();
  if (!ctx) return fail("FORBIDDEN");
  const fw = await ctx.db.curriculumFramework.findUnique({ where: { id: input.frameworkId } });
  if (!fw) return fail("NOT_FOUND");
  const s = cleanStandard(input);
  if (!s) return fail("STANDARD_FIELDS");
  const clash = await ctx.db.curriculumStandard.findFirst({ where: { frameworkId: fw.id, code: s.code, ...(input.id ? { id: { not: input.id } } : {}) } });
  if (clash) return fail("CODE_TAKEN");
  if (input.id) {
    const existing = await ctx.db.curriculumStandard.findFirst({ where: { id: input.id, frameworkId: fw.id } });
    if (!existing) return fail("NOT_FOUND");
    await ctx.db.curriculumStandard.update({ where: { id: existing.id }, data: s });
  } else {
    const last = await ctx.db.curriculumStandard.findFirst({ where: { frameworkId: fw.id }, orderBy: { sortOrder: "desc" } });
    await ctx.db.curriculumStandard.create({ data: { orgId: ctx.orgId, frameworkId: fw.id, sortOrder: (last?.sortOrder ?? 0) + 1, ...s } });
  }
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: input.id ? "curriculum.standard_update" : "curriculum.standard_create", entityType: "CurriculumFramework", entityId: fw.id, meta: { code: s.code } });
  refresh();
  return { ok: true as const };
}

export async function deleteStandardAction(id: string) {
  const ctx = await managerCtx();
  if (!ctx) return fail("FORBIDDEN");
  const s = await ctx.db.curriculumStandard.findUnique({ where: { id }, include: { _count: { select: { lessons: true } } } });
  if (!s) return fail("NOT_FOUND");
  if (s._count.lessons) return fail("IN_USE");
  await ctx.db.curriculumStandard.delete({ where: { id } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "curriculum.standard_delete", entityType: "CurriculumFramework", entityId: s.frameworkId, meta: { code: s.code } });
  refresh();
  return { ok: true as const };
}

async function frameworkWithSubject(ctx: Ctx, frameworkId: string) {
  const fw = await ctx.db.curriculumFramework.findUnique({ where: { id: frameworkId } });
  if (!fw) return null;
  const subject = fw.subjectId ? await ctx.db.subject.findUnique({ where: { id: fw.subjectId } }) : null;
  return { fw, subject };
}

/** Read a PDF or text file into plain text for the importer. Nothing is stored. */
export async function extractDocumentTextAction(form: FormData) {
  const ctx = await managerCtx();
  if (!ctx) return fail("FORBIDDEN");
  const file = form.get("file");
  if (!(file instanceof File)) return fail("NO_FILE");
  if (file.size > 8 * 1024 * 1024) return fail("TOO_LARGE");
  const buf = Buffer.from(await file.arrayBuffer());
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  let text = "";
  try {
    text = isPdf ? extractPdfText(buf) : buf.toString("utf8");
  } catch {
    text = "";
  }
  text = text.replace(/\u0000/g, "").trim();
  if (text.length < 10) return fail(isPdf ? "PDF_NO_TEXT" : "EMPTY");
  return { ok: true as const, text: text.slice(0, 60_000) };
}

const isStandardList = (v: unknown): v is { standards: DraftStandard[] } => {
  const o = v as { standards: unknown };
  return Boolean(o) && Array.isArray(o.standards) && o.standards.length > 0 && o.standards.every(isDraftStandard);
};

/** Turn pasted text, a CSV or a curriculum document into a list of standards to review. Nothing is saved. */
export async function previewImportAction(input: { frameworkId: string; mode: "paste" | "csv" | "ai"; text: string }) {
  const ctx = await managerCtx();
  if (!ctx) return fail("FORBIDDEN");
  const found = await frameworkWithSubject(ctx, input.frameworkId);
  if (!found) return fail("NOT_FOUND");
  const text = typeof input.text === "string" ? input.text.slice(0, 60_000) : "";
  if (!text.trim()) return fail("EMPTY");
  const prefix = codePrefix(found.subject?.code, found.fw.gradeLevel);
  if (input.mode === "csv") {
    const res = parseStandardsCsv(text, { prefix });
    if (!res.rows.length) return fail("NOTHING_FOUND");
    return { ok: true as const, rows: res.rows, csvErrors: res.errors, interactionId: null, provider: null };
  }
  if (input.mode === "paste") {
    const rows = parseStandardsText(text, { prefix });
    if (!rows.length) return fail("NOTHING_FOUND");
    return { ok: true as const, rows, csvErrors: [], interactionId: null, provider: null };
  }
  const ai = await generateAi(ctx, {
    feature: "curriculum_import",
    sensitive: false,
    subjectType: "CurriculumFramework",
    subjectId: found.fw.id,
    instructions:
      "Read this curriculum document and list every distinct learning outcome or standard it contains. Keep each statement faithful to the source. " +
      `Use the source codes when present, otherwise number them ${prefix}.1, ${prefix}.2 and so on. Group them into the strands or domains the document uses. ` +
      "Every field ending in En must be in British English and every field ending in Ar in Modern Standard Arabic, translating where needed.",
    facts: { subject: found.subject?.nameEn ?? null, grade: found.fw.gradeLevel, framework: found.fw.nameEn, document: text.slice(0, 24_000) },
    outputShape: '{"standards":[{"code":"string","strandEn":"string","strandAr":"string","descEn":"string","descAr":"string"}]}',
    fallback: () => ({ standards: parseStandardsText(text, { prefix }) }),
    validate: isStandardList,
  });
  if (ai.status === "blocked") return fail(ai.reason === "disabled" ? "AI_DISABLED" : "AI_BLOCKED");
  // Keep empty Arabic fields empty so the reviewer sees what still needs translating.
  const rows = ai.output.standards.map((s) => ({ code: clip(s.code, 40), strandEn: clip(s.strandEn, 120), strandAr: clip(s.strandAr, 120), descEn: clip(s.descEn, 600), descAr: clip(s.descAr, 600) })).filter((s) => s.code && (s.descEn || s.descAr));
  if (!rows.length) return fail("NOTHING_FOUND");
  return { ok: true as const, rows, csvErrors: [], interactionId: ai.interactionId, provider: ai.provider };
}

/** Save the reviewed standards. Existing codes are updated, new codes are added. */
export async function acceptImportAction(input: { frameworkId: string; rows: DraftStandard[]; interactionId?: string | null }) {
  const ctx = await managerCtx();
  if (!ctx) return fail("FORBIDDEN");
  const fw = await ctx.db.curriculumFramework.findUnique({ where: { id: input.frameworkId } });
  if (!fw) return fail("NOT_FOUND");
  const rows = (Array.isArray(input.rows) ? input.rows : []).filter(isDraftStandard).map(cleanStandard).filter((s): s is DraftStandard => s !== null).slice(0, 400);
  if (!rows.length) return fail("NOTHING_FOUND");
  const unique = [...new Map(rows.map((r) => [r.code, r])).values()];
  const result = await tenantTx(ctx.orgId, async (tx) => {
    const existing = await tx.curriculumStandard.findMany({ where: { frameworkId: fw.id } });
    let order = existing.reduce((m, s) => Math.max(m, s.sortOrder), 0);
    let created = 0;
    let updated = 0;
    for (const r of unique) {
      const match = existing.find((s) => s.code === r.code);
      if (match) {
        await tx.curriculumStandard.update({ where: { id: match.id }, data: r });
        updated++;
      } else {
        await tx.curriculumStandard.create({ data: { orgId: ctx.orgId, frameworkId: fw.id, sortOrder: ++order, ...r } });
        created++;
      }
    }
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "curriculum.standards_import", entityType: "CurriculumFramework", entityId: fw.id, meta: { created, updated, ai: Boolean(input.interactionId) } });
    return { created, updated };
  });
  if (input.interactionId) await reviewAi(ctx, input.interactionId, true);
  refresh();
  return { ok: true as const, ...result };
}

export async function discardAiDraftAction(interactionId: string) {
  const ctx = await getCtx();
  if (!canUseCurriculum(ctx)) return fail("FORBIDDEN");
  await reviewAi(ctx, interactionId, false);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Lesson plans
// ---------------------------------------------------------------------------

export type PlanInput = {
  id?: string;
  subjectId: string;
  gradeLevel: number;
  classId?: string | null;
  termId?: string | null;
  weekNo?: number | null;
  plannedFor?: string | null;
  titleEn: string;
  titleAr: string;
  objectivesEn: string;
  objectivesAr: string;
  activities: Activity[];
  materials: Material[];
  assessmentEn: string;
  assessmentAr: string;
  differentiation: Bilingual;
  durationMin: number;
  standardIds: string[];
};

function cleanActivities(list: unknown): Activity[] {
  return (Array.isArray(list) ? list : [])
    .filter(isActivity)
    .slice(0, 20)
    .map((a) => ({ phase: a.phase, minutes: Math.min(240, Math.max(0, Math.round(a.minutes))), titleEn: clip(a.titleEn, 160), titleAr: clip(a.titleAr, 160), detailEn: clip(a.detailEn, 1500), detailAr: clip(a.detailAr, 1500) }))
    .filter((a) => a.titleEn || a.titleAr || a.detailEn || a.detailAr);
}

function cleanMaterials(list: unknown): Material[] {
  return (Array.isArray(list) ? list : [])
    .filter(isMaterial)
    .slice(0, 40)
    .map((m) => ({ en: clip(m.en, 200), ar: clip(m.ar, 200) }))
    .filter((m) => m.en || m.ar);
}

/** Validate plan fields and resolve the term, class and standards against the plan's subject and grade. */
async function resolvePlan(ctx: Ctx, input: PlanInput) {
  const titleEn = clip(input.titleEn, 200);
  const titleAr = clip(input.titleAr, 200);
  if (!titleEn && !titleAr) return fail("TITLE");
  const grade = Math.round(Number(input.gradeLevel));
  const subject = await ctx.db.subject.findUnique({ where: { id: input.subjectId } });
  if (!subject || !Number.isFinite(grade)) return fail("SUBJECT");
  const duration = Math.round(Number(input.durationMin));
  if (!Number.isFinite(duration) || duration < 10 || duration > 240) return fail("DURATION");
  let classId: string | null = null;
  if (input.classId) {
    const cls = await ctx.db.schoolClass.findUnique({ where: { id: input.classId } });
    if (!cls || cls.subjectId !== subject.id || cls.gradeLevel !== grade) return fail("CLASS");
    classId = cls.id;
  }
  const plannedFor = input.plannedFor ? new Date(`${input.plannedFor.slice(0, 10)}T08:00:00.000Z`) : null;
  if (plannedFor && Number.isNaN(plannedFor.getTime())) return fail("DATE");
  const terms = await currentTerms(ctx);
  const termId = termOf({ termId: input.termId && terms.some((t) => t.id === input.termId) ? input.termId : null, plannedFor }, terms);
  const weekNo = input.weekNo ? Math.min(60, Math.max(1, Math.round(Number(input.weekNo)))) : null;
  const ids = [...new Set((Array.isArray(input.standardIds) ? input.standardIds : []).filter((s) => typeof s === "string"))];
  const standards = ids.length ? await ctx.db.curriculumStandard.findMany({ where: { id: { in: ids } }, include: { framework: true } }) : [];
  if (standards.some((s) => s.framework.subjectId !== subject.id || s.framework.gradeLevel !== grade)) return fail("STANDARDS");
  const differentiation = { en: clip(input.differentiation?.en, 1500), ar: clip(input.differentiation?.ar, 1500) };
  return {
    ok: true as const,
    data: {
      subjectId: subject.id,
      gradeLevel: grade,
      classId,
      termId,
      weekNo,
      plannedFor,
      titleEn: titleEn || titleAr,
      titleAr: titleAr || titleEn,
      objectivesEn: clip(input.objectivesEn, 3000) || null,
      objectivesAr: clip(input.objectivesAr, 3000) || null,
      activities: cleanActivities(input.activities) as never,
      materials: cleanMaterials(input.materials) as never,
      assessmentEn: clip(input.assessmentEn, 2000) || null,
      assessmentAr: clip(input.assessmentAr, 2000) || null,
      differentiation: writeBilingualText(differentiation),
      durationMin: duration,
    },
    standardIds: standards.map((s) => s.id),
  };
}

export async function savePlanAction(input: PlanInput) {
  const ctx = await getCtx();
  if (!ctx.isStaff || !ctx.can("curriculum.plan")) return fail("FORBIDDEN");
  const existing = input.id ? await ctx.db.lessonPlan.findUnique({ where: { id: input.id } }) : null;
  if (input.id && !existing) return fail("NOT_FOUND");
  if (existing && !canEditPlan(ctx, existing)) return fail("LOCKED");
  const r = await resolvePlan(ctx, input);
  if (!r.ok) return r;
  const id = await tenantTx(ctx.orgId, async (tx) => {
    let planId: string;
    if (existing) {
      await tx.lessonPlan.update({ where: { id: existing.id }, data: r.data });
      await tx.lessonPlanStandard.deleteMany({ where: { lessonPlanId: existing.id } });
      planId = existing.id;
    } else {
      const row = await tx.lessonPlan.create({ data: { ...r.data, orgId: ctx.orgId, authorId: ctx.membershipId, status: "DRAFT" } });
      planId = row.id;
    }
    if (r.standardIds.length) await tx.lessonPlanStandard.createMany({ data: r.standardIds.map((standardId) => ({ orgId: ctx.orgId, lessonPlanId: planId, standardId })) });
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: existing ? "lesson_plan.update" : "lesson_plan.create", entityType: "LessonPlan", entityId: planId, meta: { standards: r.standardIds.length } });
    return planId;
  });
  refresh();
  return { ok: true as const, id };
}

export async function deletePlanAction(id: string) {
  const ctx = await getCtx();
  const plan = await ctx.db.lessonPlan.findUnique({ where: { id } });
  if (!plan) return fail("NOT_FOUND");
  if (!canEditPlan(ctx, plan)) return fail("FORBIDDEN");
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.lessonPlan.delete({ where: { id } });
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "lesson_plan.delete", entityType: "LessonPlan", entityId: id, meta: { title: plan.titleEn } });
  });
  refresh();
  return { ok: true as const };
}

function planError(e: unknown) {
  if (e instanceof PlanError) return fail(e.code);
  throw e;
}

export async function submitPlanAction(id: string) {
  const ctx = await getCtx();
  if (!ctx.isStaff || !ctx.can("curriculum.plan")) return fail("FORBIDDEN");
  const effects: Effect[] = [];
  try {
    await tenantTx(ctx.orgId, (tx) => submitPlan(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId }), { planId: id, actorId: ctx.membershipId, actorUserId: ctx.user.id }));
  } catch (e) {
    return planError(e);
  }
  await flushEffects(effects);
  refresh();
  return { ok: true as const };
}

export async function reviewPlanAction(input: { id: string; decision: "APPROVED" | "CHANGES_REQUESTED"; comment?: string }) {
  const ctx = await getCtx();
  if (!ctx.isStaff || !ctx.can("curriculum.review")) return fail("FORBIDDEN");
  if (input.decision !== "APPROVED" && input.decision !== "CHANGES_REQUESTED") return fail("DECISION");
  const scope = await reviewScope(ctx);
  const effects: Effect[] = [];
  try {
    await tenantTx(ctx.orgId, (tx) =>
      reviewPlan(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId }), {
        planId: input.id,
        reviewerId: ctx.membershipId,
        reviewerUserId: ctx.user.id,
        decision: input.decision,
        comment: clip(input.comment, 2000),
        allowed: (subjectId) => inScope(scope, subjectId),
      }),
    );
  } catch (e) {
    return planError(e);
  }
  await flushEffects(effects);
  refresh();
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// AI unit planning
// ---------------------------------------------------------------------------

const isUnit = (v: unknown): v is { lessons: ProposedLesson[] } => {
  const o = v as { lessons: unknown };
  return Boolean(o) && Array.isArray(o.lessons) && o.lessons.length > 0 && o.lessons.every((l) => isProposedLesson(l) && l.activities.every(isActivity) && l.materials.every(isMaterial));
};

/** Propose a sequence of lessons that covers the chosen standards. Nothing is saved until the teacher accepts. */
export async function draftUnitAction(input: { frameworkId: string; standardIds: string[]; durationMin?: number; maxLessons?: number }) {
  const ctx = await getCtx();
  if (!ctx.isStaff || !ctx.can("curriculum.plan")) return fail("FORBIDDEN");
  const found = await frameworkWithSubject(ctx, input.frameworkId);
  if (!found?.subject) return fail("NOT_FOUND");
  const ids = new Set(Array.isArray(input.standardIds) ? input.standardIds : []);
  const standards = await ctx.db.curriculumStandard.findMany({ where: { frameworkId: found.fw.id, id: { in: [...ids] } }, orderBy: { sortOrder: "asc" } });
  if (!standards.length) return fail("NO_STANDARDS");
  const durationMin = Math.min(120, Math.max(20, Math.round(Number(input.durationMin) || 50)));
  const maxLessons = Math.min(16, Math.max(1, Math.round(Number(input.maxLessons) || 8)));
  const dctx = { subjectCode: found.subject.code, subjectEn: found.subject.nameEn, subjectAr: found.subject.nameAr, gradeLevel: found.fw.gradeLevel ?? 0, durationMin };
  const ai = await generateAi(ctx, {
    feature: "lesson_plan",
    sensitive: false,
    subjectType: "CurriculumFramework",
    subjectId: found.fw.id,
    instructions:
      `Plan a unit of at most ${maxLessons} lessons of ${durationMin} minutes for Grade ${found.fw.gradeLevel} ${found.subject.nameEn} that together cover every listed standard. ` +
      "Order lessons so ideas build on each other. For each lesson give objectives (one per line), the main teaching points, activities with phase starter, main or plenary and minutes that add up to the lesson length, " +
      "materials and resources, assessment for learning, and differentiation (support and stretch). standardIds must only use the ids given. " +
      "Every field ending in En must be in British English and every field ending in Ar in Modern Standard Arabic.",
    facts: { subject: found.subject.nameEn, grade: found.fw.gradeLevel, lessonMinutes: durationMin, standards: standards.map((s) => ({ id: s.id, code: s.code, strand: s.strandEn, statement: s.descEn })) },
    outputShape:
      '{"lessons":[{"titleEn":"string","titleAr":"string","objectivesEn":"string","objectivesAr":"string","mainPointsEn":["string"],"mainPointsAr":["string"],"activities":[{"phase":"starter|main|plenary","minutes":10,"titleEn":"string","titleAr":"string","detailEn":"string","detailAr":"string"}],"materials":[{"en":"string","ar":"string"}],"assessmentEn":"string","assessmentAr":"string","differentiation":{"en":"string","ar":"string"},"standardIds":["string"],"durationMin":50}]}',
    fallback: () => ({ lessons: draftUnitFallback(standards, dctx, { maxLessons }) }),
    validate: isUnit,
  });
  if (ai.status === "blocked") return fail(ai.reason === "disabled" ? "AI_DISABLED" : "AI_BLOCKED");
  const allowed = new Set(standards.map((s) => s.id));
  const lessons = ai.output.lessons.slice(0, maxLessons + 1).map((l) => ({ ...l, durationMin, standardIds: l.standardIds.filter((s) => allowed.has(s)), activities: cleanActivities(l.activities), materials: cleanMaterials(l.materials) }));
  return { ok: true as const, lessons, interactionId: ai.interactionId, provider: ai.provider };
}

/** Save an accepted unit as draft plans marked AI-drafted. They are never submitted automatically. */
export async function acceptUnitAction(input: { frameworkId: string; classId?: string | null; termId?: string | null; startWeek?: number | null; lessons: ProposedLesson[]; interactionId?: string | null }) {
  const ctx = await getCtx();
  if (!ctx.isStaff || !ctx.can("curriculum.plan")) return fail("FORBIDDEN");
  const found = await frameworkWithSubject(ctx, input.frameworkId);
  if (!found?.subject || found.fw.gradeLevel === null) return fail("NOT_FOUND");
  const lessons = (Array.isArray(input.lessons) ? input.lessons : []).filter(isProposedLesson).slice(0, 17);
  if (!lessons.length) return fail("NOTHING_FOUND");
  const resolved: Array<Extract<Awaited<ReturnType<typeof resolvePlan>>, { ok: true }>> = [];
  for (const [i, l] of lessons.entries()) {
    const r = await resolvePlan(ctx, {
      subjectId: found.subject.id,
      gradeLevel: found.fw.gradeLevel,
      classId: input.classId || null,
      termId: input.termId || null,
      weekNo: input.startWeek ? Number(input.startWeek) + i : null,
      titleEn: l.titleEn,
      titleAr: l.titleAr,
      objectivesEn: l.objectivesEn,
      objectivesAr: l.objectivesAr,
      activities: l.activities,
      materials: l.materials,
      assessmentEn: l.assessmentEn,
      assessmentAr: l.assessmentAr,
      differentiation: l.differentiation,
      durationMin: l.durationMin,
      standardIds: l.standardIds,
    });
    if (!r.ok) return r;
    resolved.push(r);
  }
  const ids = await tenantTx(ctx.orgId, async (tx) => {
    const out: string[] = [];
    for (const r of resolved) {
      const row = await tx.lessonPlan.create({ data: { ...r.data, orgId: ctx.orgId, authorId: ctx.membershipId, status: "DRAFT", aiDrafted: true } });
      if (r.standardIds.length) await tx.lessonPlanStandard.createMany({ data: r.standardIds.map((standardId) => ({ orgId: ctx.orgId, lessonPlanId: row.id, standardId })) });
      await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "lesson_plan.create", entityType: "LessonPlan", entityId: row.id, meta: { aiDrafted: true, interactionId: input.interactionId ?? null } });
      out.push(row.id);
    }
    return out;
  });
  if (input.interactionId) await reviewAi(ctx, input.interactionId, true);
  refresh();
  return { ok: true as const, ids };
}
