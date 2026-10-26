"use server";

// Attendance server actions: thin wrappers that check the session, validate input, call the services (which check
// permissions and audit) and refresh pages. Errors come back as codes the pages translate.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/server/context";
import { flushEffects } from "@/server/queue";
import { attViewer, RegisterError, saveRegister, setRegisterClosed } from "./registers";
import { explainAbsence, logContact, messageFamily, runFollowUp } from "./followup";
import { canConfigure, saveCodes, saveSettings } from "./admin";
import { canManage } from "./registers";

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

async function guard<T>(fn: () => Promise<T>): Promise<T | Fail> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RegisterError) return fail(e.code);
    // Never log the error text: it can hold names or ids from a query.
    console.error(`[attendance] action failed: ${(e as { name?: string })?.name ?? "Error"}`);
    return fail("generic");
  }
}

const ref = z.object({ classId: z.string().min(1).max(40), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodNo: z.number().int().min(0).max(30) });
const marks = z.array(z.object({ studentId: z.string().min(1).max(40), code: z.string().min(1).max(4), minutesLate: z.number().int().min(0).max(240).nullable().optional() })).max(200);

export async function saveRegisterAction(input: { ref: z.input<typeof ref>; marks: z.input<typeof marks> }) {
  const ctx = await getCtx();
  const r = ref.safeParse(input.ref);
  const m = marks.safeParse(input.marks);
  if (!r.success || !m.success) return fail("invalid");
  const res = await guard(() => saveRegister(attViewer(ctx), r.data, m.data));
  if ("ok" in res) return res;
  return { ok: true as const, saved: res.saved, unchanged: res.unchanged, rejected: res.rejected, takenAt: res.takenAt.toISOString() };
}

export async function setRegisterClosedAction(input: { ref: z.input<typeof ref>; closed: boolean }) {
  const ctx = await getCtx();
  const r = ref.safeParse(input.ref);
  if (!r.success) return fail("invalid");
  const res = await guard(() => setRegisterClosed(attViewer(ctx), r.data, Boolean(input.closed)));
  if ("ok" in res) return res;
  revalidatePath("/attendance", "layout");
  return { ok: true as const };
}

export async function logContactAction(input: { followUpId: string; kind: "CALL" | "NOTE"; outcome?: "REACHED" | "NO_ANSWER" | "VOICEMAIL" | null; note?: string | null }) {
  const ctx = await getCtx();
  const res = await guard(() => logContact(attViewer(ctx), String(input.followUpId), { kind: input.kind, outcome: input.outcome ?? null, note: input.note ? String(input.note) : null }));
  if ("ok" in res) return res;
  revalidatePath("/attendance/office");
  return { ok: true as const };
}

export async function messageFamilyAction(input: { followUpId: string; message: string; reason?: string | null }) {
  const ctx = await getCtx();
  const res = await guard(() => messageFamily(attViewer(ctx), String(input.followUpId), { message: String(input.message ?? ""), reason: input.reason ? String(input.reason) : null }));
  if ("ok" in res) return res;
  await flushEffects(res.effects);
  revalidatePath("/attendance/office");
  return { ok: true as const, sent: res.sent };
}

export async function explainAbsenceAction(input: { followUpId: string; code: string }) {
  const ctx = await getCtx();
  const res = await guard(() => explainAbsence(attViewer(ctx), String(input.followUpId), String(input.code)));
  if ("ok" in res) return res;
  revalidatePath("/attendance/office");
  return { ok: true as const };
}

/** The office's "Send now": run today's unexplained absence follow-up without waiting for the set time. */
export async function runFollowUpNowAction() {
  const ctx = await getCtx();
  if (!canManage(attViewer(ctx))) return fail("forbidden");
  const res = await guard(() => runFollowUp(ctx.orgId, { force: true, flush: flushEffects }));
  if ("ok" in res) return res;
  revalidatePath("/attendance/office");
  return { ok: true as const, notified: res.notified, held: res.held, skipped: res.skipped ?? null };
}

const settingsSchema = z.object({
  mode: z.enum(["HORIZON", "EXTERNAL"]),
  dailyStart: z.string().max(5),
  lateCutoffMin: z.number().int(),
  closeTime: z.string().max(5),
  followUpTime: z.string().max(5),
  autoNotify: z.boolean(),
  persistentThreshold: z.number(),
  persistentMinDays: z.number().int(),
  dailyOnlyGrades: z.array(z.number().int()).max(20),
  headsOfYear: z.record(z.string().max(3), z.array(z.string().max(40)).max(5)),
  limitEnabled: z.boolean(),
  limitConsecutive: z.number().int(),
  limitTotal: z.number().int(),
  limitWarnPct: z.number().int(),
});

export async function saveSettingsAction(input: z.input<typeof settingsSchema>) {
  const ctx = await getCtx();
  if (!canConfigure(attViewer(ctx))) return fail("forbidden");
  const d = settingsSchema.safeParse(input);
  if (!d.success) return fail("invalid");
  const res = await guard(() => saveSettings(attViewer(ctx), d.data).then(() => ({ done: true })));
  if ("ok" in res) return res;
  revalidatePath("/attendance", "layout");
  return { ok: true as const };
}

const codeSchema = z.object({
  code: z.string().max(4),
  labelEn: z.string().max(80),
  labelAr: z.string().max(80),
  countsAs: z.enum(["PRESENT", "ABSENT", "NOT_COUNTED"]),
  authorised: z.boolean(),
  late: z.boolean(),
  category: z.string().max(20),
  private: z.boolean(),
  quick: z.string().max(10).nullable(),
  active: z.boolean(),
});

export async function saveCodesAction(input: Array<z.input<typeof codeSchema>>) {
  const ctx = await getCtx();
  if (!canConfigure(attViewer(ctx))) return fail("forbidden");
  const d = z.array(codeSchema).max(40).safeParse(input);
  if (!d.success) return fail("invalid");
  const res = await guard(() => saveCodes(attViewer(ctx), d.data).then(() => ({ done: true })));
  if ("ok" in res) return res;
  revalidatePath("/attendance", "layout");
  return { ok: true as const };
}
