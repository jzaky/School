"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { getCtx } from "@/server/context";
import { generateAi } from "@/server/ai/provider";
import { EngineAccessError, actorFromCtx, canViewStudent } from "./access";
import { approvePlan, computeMatches, generatePlan, getCurrentPlan, requestPlanChanges, runWhatIf, savePlanItems, submitPlan, type WhatIfInput } from "./service";
import type { MatchStatus } from "./types";

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const done = () => revalidatePath("/", "layout");

async function run<T extends object>(fn: () => Promise<T>): Promise<Ok<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof EngineAccessError) return { ok: false, error: e.code };
    throw e;
  }
}

const goalInput = z.object({
  studentId: z.string().min(1),
  careerKey: z.string().max(60).nullable(),
  fieldKeys: z.array(z.string().max(60)).max(10).default([]),
  countries: z.array(z.string().length(2)).max(12).default([]),
});

export async function generatePlanAction(raw: z.input<typeof goalInput>): Promise<Ok<{ planId: string; items: number; warnings: number }>> {
  const parsed = goalInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await getCtx();
  const actor = await actorFromCtx(ctx);
  const g = parsed.data;
  const res = await run(async () => {
    const out = await generatePlan(actor, g.studentId, { careerKey: g.careerKey, fieldKeys: g.fieldKeys, countries: g.countries });
    return { planId: out.planId, items: out.output.items.length, warnings: out.output.warnings.length };
  });
  done();
  return res;
}

const itemsInput = z.object({ planId: z.string().min(1), items: z.array(z.object({ schoolCourseId: z.string().min(1), gradeLevel: z.number().int().min(6).max(13), locked: z.boolean().optional() })).max(60) });

export async function savePlanItemsAction(raw: z.infer<typeof itemsInput>): Promise<Ok> {
  const parsed = itemsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const actor = await actorFromCtx(await getCtx());
  const res = await run(async () => {
    await savePlanItems(actor, parsed.data.planId, parsed.data.items);
    return {};
  });
  done();
  return res;
}

export async function submitPlanAction(planId: string): Promise<Ok> {
  const actor = await actorFromCtx(await getCtx());
  const res = await run(async () => {
    await submitPlan(actor, planId);
    return {};
  });
  done();
  return res;
}

export async function approvePlanAction(input: { planId: string; note: string | null }): Promise<Ok> {
  const actor = await actorFromCtx(await getCtx());
  const res = await run(async () => {
    await approvePlan(actor, input.planId, input.note);
    return {};
  });
  done();
  return res;
}

export async function requestPlanChangesAction(input: { planId: string; note: string }): Promise<Ok> {
  const actor = await actorFromCtx(await getCtx());
  const res = await run(async () => {
    await requestPlanChanges(actor, input.planId, input.note);
    return {};
  });
  done();
  return res;
}

const changeInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_course"), schoolCourseId: z.string().min(1), gradeLevel: z.number().int().optional(), predictedGrade: z.string().max(8).nullable().optional() }),
  z.object({ type: z.literal("drop_course"), courseRef: z.string().min(1) }),
  z.object({ type: z.literal("set_grade"), courseRef: z.string().min(1), predictedGrade: z.string().max(8).nullable() }),
  z.object({ type: z.literal("set_test"), kind: z.string().min(2).max(20), score: z.number() }),
]);
const whatIfInput = z.object({ studentId: z.string().min(1), planId: z.string().nullable(), changes: z.array(changeInput).max(20) });

export type WhatIfRow = { programId: string; nameEn: string; nameAr: string; uniEn: string; uniAr: string; before: MatchStatus; after: MatchStatus; direction: number; missingBefore: number; missingAfter: number; changed: Array<{ kind: string; keys?: string[]; before: string; after: string }> };

/** Before and after for a list of changes. Read only: nothing is saved. */
export async function whatIfAction(raw: z.infer<typeof whatIfInput>): Promise<Ok<{ rows: WhatIfRow[] }>> {
  const parsed = whatIfInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const actor = await actorFromCtx(await getCtx());
  return run(async () => {
    const res = await runWhatIf(actor, parsed.data.studentId, { planId: parsed.data.planId, changes: parsed.data.changes as WhatIfInput[] });
    return {
      rows: res.deltas.map((d) => ({
        programId: d.programId,
        nameEn: d.meta.nameEn,
        nameAr: d.meta.nameAr,
        uniEn: d.meta.university.nameEn,
        uniAr: d.meta.university.nameAr,
        before: d.before,
        after: d.after,
        direction: d.direction,
        missingBefore: d.missingBefore,
        missingAfter: d.missingAfter,
        changed: d.changedLines.map((c) => ({ kind: c.kind, keys: c.keys, before: c.before, after: c.after })),
      })),
    };
  });
}

export type PlanSummary = { summary: string; steps: string[] };

/**
 * A short narrative summary of the current plan. The planner already chose the courses and the
 * engine decided the statuses; the AI (or the built-in drafter) only puts them into words, as a draft.
 */
export async function planSummaryAction(studentId: string): Promise<Ok<{ summary: PlanSummary; provider: string }>> {
  const ctx = await getCtx();
  const actor = await actorFromCtx(ctx);
  if (!canViewStudent(actor, studentId)) return { ok: false, error: "forbidden" };
  const plan = await getCurrentPlan(actor, studentId);
  if (!plan) return { ok: false, error: "not_found" };
  const { matches, counts } = await computeMatches(actor, studentId, { planId: plan.id });
  const ar = ctx.locale === "ar";
  const t = await getTranslations("engine.aiSummary");
  // Academic facts only: course names, grades of study and programme statuses. No names or personal data.
  const facts = {
    planStatus: plan.status,
    courses: plan.items.map((i) => ({ grade: i.gradeLevel, course: ar ? i.nameAr : i.nameEn, why: ar ? i.reasonAr : i.reasonEn })),
    statusCounts: counts,
    programmes: matches.slice(0, 8).map((m) => ({ programme: m.meta.nameEn, university: m.meta.university.nameEn, status: m.result.status, missing: m.result.counts.requiredMissing })),
    requirementsAreExamples: true,
  };
  const res = await generateAi<PlanSummary>(ctx, {
    feature: "pathway_advice",
    sensitive: false,
    subjectType: "StudentCoursePlan",
    subjectId: plan.id,
    instructions:
      "Write a short, encouraging draft summary of this Grade 9 to 12 course plan for a secondary student. Use ONLY the facts. Do not add, remove or change any course, grade, status or requirement, and never decide eligibility. " +
      "Mention how many target programmes look open and what is still missing, and remind them that requirement data is example data to confirm with the university and their counselor.",
    facts,
    outputShape: '{ "summary": "2 to 4 sentences", "steps": ["short next step", "..."] }',
    validate: (v): v is PlanSummary => !!v && typeof (v as PlanSummary).summary === "string" && Array.isArray((v as PlanSummary).steps),
    fallback: () => {
      const open = counts.ELIGIBLE + counts.ON_TRACK;
      const years = [...new Set(plan.items.map((i) => i.gradeLevel))].sort((a, b) => a - b);
      const first = plan.items.filter((i) => i.gradeLevel === years[0]).map((i) => (ar ? i.nameAr : i.nameEn));
      return {
        summary: t("summary", { courses: plan.items.length, grades: years.join(ar ? "، " : ", "), open, total: matches.length, missing: counts.MISSING_REQUIREMENTS }),
        steps: [first.length ? t("stepStart", { grade: years[0], courses: first.join(ar ? "، " : ", ") }) : t("stepTalk"), t("stepMissing"), t("stepEnglish")],
      };
    },
  });
  if (res.status !== "ok") return { ok: false, error: res.reason };
  return { ok: true, summary: res.output, provider: res.provider };
}
