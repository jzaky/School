"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { flushEffects } from "@/server/queue";
import { DEFAULT_BANDS, type Band } from "./calc";
import { viewerFromCtx } from "./queries";
import { createAssessment, deleteAssessment, saveBands, saveGrades, setPublished, updateAssessment, type AssessmentInput, type CellInput } from "./service";
import { generateReportCard } from "./report-card";
import { publishReady, releaseReportCards, setPublishMode, setReady, unpublishByPublisher, withdrawReportCard } from "./publishing";

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

// --- Publishing by a publisher (src/server/grades/publishing.ts) -------------------------------------------

export async function setPublishModeAction(mode: "TEACHER" | "PUBLISHER") {
  const { v } = await viewer();
  const res = await setPublishMode(v, mode);
  if (res.ok) {
    revalidatePath("/grades");
    revalidatePath("/grades/publish");
  }
  return res;
}

export async function setReadyAction(assessmentId: string, ready: boolean) {
  const { v } = await viewer();
  const res = await setReady(v, String(assessmentId), Boolean(ready));
  if (res.ok) revalidatePath("/grades");
  return res;
}

export async function publishReadyAction(input: { ids?: string[]; all?: { classId?: string | null; teacherId?: string | null } }) {
  const { v } = await viewer();
  const ids = Array.isArray(input.ids) ? input.ids.map(String).slice(0, 200) : undefined;
  const all = input.all ? { classId: input.all.classId ? String(input.all.classId) : null, teacherId: input.all.teacherId ? String(input.all.teacherId) : null } : undefined;
  const res = await publishReady(v, { ids, all });
  if (!res.ok) return res;
  await flushEffects(res.effects);
  revalidatePath("/grades/publish");
  return { ok: true as const, published: res.published, notified: res.notified, remaining: res.remaining };
}

export async function unpublishByPublisherAction(assessmentId: string) {
  const { v } = await viewer();
  const res = await unpublishByPublisher(v, String(assessmentId));
  if (res.ok) revalidatePath("/grades/publish");
  return res;
}

export async function releaseReportCardsAction(input: { ids?: string[]; all?: boolean }) {
  const { v } = await viewer();
  const res = await releaseReportCards(v, { ids: Array.isArray(input.ids) ? input.ids.map(String).slice(0, 200) : undefined, all: Boolean(input.all) });
  if (!res.ok) return res;
  await flushEffects(res.effects);
  revalidatePath("/grades/publish");
  return { ok: true as const, released: res.released, remaining: res.remaining };
}

export async function withdrawReportCardAction(documentId: string) {
  const { v } = await viewer();
  const res = await withdrawReportCard(v, String(documentId));
  if (res.ok) revalidatePath("/grades/publish");
  return res;
}
