"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { flushEffects } from "@/server/queue";
import { DEFAULT_BANDS, type Band } from "./calc";
import { viewerFromCtx } from "./queries";
import { createAssessment, deleteAssessment, saveBands, saveGrades, setPublished, updateAssessment, type AssessmentInput, type CellInput } from "./service";
import { generateReportCard } from "./report-card";

async function viewer() {
  const ctx = await getCtx();
  return { ctx, v: viewerFromCtx(ctx) };
}

export async function createAssessmentAction(classId: string, input: AssessmentInput) {
  const { v } = await viewer();
  const res = await createAssessment(v, classId, input);
  if (res.ok) revalidatePath("/grades");
  return res;
}

export async function updateAssessmentAction(assessmentId: string, input: AssessmentInput) {
  const { v } = await viewer();
  const res = await updateAssessment(v, assessmentId, input);
  if (res.ok) revalidatePath("/grades");
  return res;
}

export async function deleteAssessmentAction(assessmentId: string) {
  const { v } = await viewer();
  const res = await deleteAssessment(v, assessmentId);
  if (res.ok) revalidatePath("/grades");
  return res;
}

/** Autosave from the grid. Does not revalidate: the grid holds the state and only needs the result. */
export async function saveGradesAction(classId: string, cells: CellInput[]) {
  const { ctx, v } = await viewer();
  try {
    return await saveGrades(v, classId, cells, ctx.locale);
  } catch {
    return { ok: false as const, error: "generic" };
  }
}

export async function setPublishedAction(assessmentId: string, publish: boolean) {
  const { v } = await viewer();
  const res = await setPublished(v, assessmentId, publish);
  if (!res.ok) return res;
  await flushEffects(res.effects);
  revalidatePath("/grades");
  return { ok: true as const, notified: res.notified };
}

export async function saveBandsAction(bands: Band[]) {
  const { v } = await viewer();
  const res = await saveBands(v, bands);
  if (res.ok) revalidatePath("/grades");
  return res;
}

export async function resetBandsAction() {
  return saveBandsAction(DEFAULT_BANDS);
}

export async function generateReportCardAction(studentId: string, termId: string) {
  const { v } = await viewer();
  const res = await generateReportCard(v, studentId, termId);
  if (res.ok) revalidatePath("/documents");
  return res;
}
