"use server";

// Server actions for course selection windows, settings, exceptions, assisted choosing, class sessions
// and sign-off. Every rule lives in ./selection; these parse input, scope to the school and flush effects.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCtx, type Ctx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { audit } from "@/server/audit/audit";
import { dubaiInstant } from "@/lib/selection-window";
import { personName } from "@/lib/i18n-data";
import { MAX_GRADE_LEVEL, MIN_GRADE_LEVEL } from "@/lib/grade-levels";
import {
  closeWindowNow,
  endSession,
  grantException,
  grantHelper,
  progressFor,
  revokeException,
  revokeHelper,
  saveSelectionSettings,
  saveWindow,
  selectionActorFromCtx,
  sessionActive,
  sessionClasses,
  signOffChoices,
  startSession,
} from "./selection";
import { windowLabels } from "./selection-labels";
import { remindUnfinished } from "./selection-notices";

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

function refresh() {
  revalidatePath("/[locale]/admin/registration", "layout");
  revalidatePath("/[locale]/subjects", "layout");
  revalidatePath("/[locale]/calendar", "page");
}

async function run<T extends { ok: boolean }>(ctx: Ctx, fn: (tx: Parameters<Parameters<typeof tenantTx>[1]>[0], effects: Effect[]) => Promise<T>) {
  const effects: Effect[] = [];
  const res = await tenantTx(ctx.orgId, (tx) => fn(tx, effects), { timeout: 60_000 });
  if (res.ok) {
    await flushEffects(effects);
    refresh();
  }
  return res;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);

const windowSchema = z.object({
  id: z.string().min(1).nullable().optional(),
  yearId: z.string().min(1),
  gradeLevels: z.array(z.number().int().min(MIN_GRADE_LEVEL).max(MAX_GRADE_LEVEL)).min(1).max(14),
  opensDate: date,
  opensTime: time,
  closesDate: date,
  closesTime: time,
  roundEn: z.string().trim().max(60).nullable().optional(),
  roundAr: z.string().trim().max(60).nullable().optional(),
});

/** Create or edit a selection window (Dubai date and time). Staff with registration.manage. */
export async function saveWindowAction(input: z.input<typeof windowSchema>) {
  const parsed = windowSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const d = parsed.data;
  const opensAt = dubaiInstant(d.opensDate, d.opensTime);
  const closesAt = dubaiInstant(d.closesDate, d.closesTime);
  if (!opensAt || !closesAt) return fail("INVALID");
  const ctx = await getCtx();
  if (!ctx.can("registration.manage")) return fail("FORBIDDEN");
  return run(ctx, (tx) => saveWindow(tx, ctx.orgId, selectionActorFromCtx(ctx), { id: d.id ?? null, academicYearId: d.yearId, gradeLevels: d.gradeLevels, opensAt, closesAt, roundEn: d.roundEn, roundAr: d.roundAr }, windowLabels));
}

export async function closeWindowAction(input: { id: string }) {
  const ctx = await getCtx();
  if (!ctx.can("registration.manage")) return fail("FORBIDDEN");
  return run(ctx, (tx) => closeWindowNow(tx, ctx.orgId, selectionActorFromCtx(ctx), String(input.id)));
}

const settingsSchema = z.object({ parentChoice: z.enum(["ALWAYS", "WHEN_ALLOWED", "NEVER"]), signOffRequired: z.boolean(), parentChoiceSignsOff: z.boolean() });

export async function saveSelectionSettingsAction(input: z.input<typeof settingsSchema>) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const ctx = await getCtx();
  if (!ctx.can("registration.manage")) return fail("FORBIDDEN");
  return run(ctx, (tx) => saveSelectionSettings(tx, ctx.orgId, selectionActorFromCtx(ctx), parsed.data));
}

const exceptionSchema = z.object({ studentId: z.string().min(1), yearId: z.string().min(1), untilDate: date, untilTime: time, reason: z.string().trim().min(3).max(500) });

/** Allow one student to change choices until a time. Responsible staff with registration.assist, or admins. */
export async function grantExceptionAction(input: z.input<typeof exceptionSchema>) {
  const parsed = exceptionSchema.safeParse(input);
  if (!parsed.success) return fail(input && typeof input.reason === "string" && input.reason.trim().length < 3 ? "REASON_REQUIRED" : "INVALID");
  const until = dubaiInstant(parsed.data.untilDate, parsed.data.untilTime);
  if (!until) return fail("INVALID");
  const ctx = await getCtx();
  return run(ctx, (tx, effects) => grantException(tx, ctx.orgId, selectionActorFromCtx(ctx), { studentId: parsed.data.studentId, yearId: parsed.data.yearId, until, reason: parsed.data.reason }, execCtx(tx, ctx.orgId, { effects })));
}

export async function revokeExceptionAction(input: { id: string }) {
  const ctx = await getCtx();
  return run(ctx, (tx) => revokeException(tx, ctx.orgId, selectionActorFromCtx(ctx), String(input.id)));
}

const helperSchema = z.object({
  studentId: z.string().min(1),
  helperId: z.string().min(1),
  untilDate: date.nullable().optional(),
  untilTime: time.nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

/** Let someone choose for a student: the student themself, responsible staff with registration.assist, or admins. */
export async function grantHelperAction(input: z.input<typeof helperSchema>) {
  const parsed = helperSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const d = parsed.data;
  const until = d.untilDate ? dubaiInstant(d.untilDate, d.untilTime ?? "15:00") : null;
  if (d.untilDate && !until) return fail("INVALID");
  const ctx = await getCtx();
  return run(ctx, (tx, effects) => grantHelper(tx, ctx.orgId, selectionActorFromCtx(ctx), { studentId: d.studentId, helperId: d.helperId, until, reason: d.reason }, execCtx(tx, ctx.orgId, { effects })));
}

export async function revokeHelperAction(input: { id: string }) {
  const ctx = await getCtx();
  return run(ctx, (tx, effects) => revokeHelper(tx, ctx.orgId, selectionActorFromCtx(ctx), String(input.id), execCtx(tx, ctx.orgId, { effects })));
}

const sessionSchema = z.object({ classId: z.string().min(1), minutes: z.number().int(), yearId: z.string().min(1).nullable().optional() });

export async function startSessionAction(input: z.input<typeof sessionSchema>) {
  const parsed = sessionSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const ctx = await getCtx();
  return run(ctx, (tx) => startSession(tx, ctx.orgId, selectionActorFromCtx(ctx), parsed.data));
}

export async function endSessionAction(input: { id: string }) {
  const ctx = await getCtx();
  return run(ctx, (tx) => endSession(tx, ctx.orgId, selectionActorFromCtx(ctx), String(input.id)));
}

export type SessionStudent = { id: string; name: string; status: "not_started" | "in_progress" | "submitted" | "signed_off"; chosen: number; blocks: number };

/** Live progress for a class session (polled by the teacher's screen). Selection status only. */
export async function sessionProgressAction(input: { id: string }): Promise<{ ok: true; active: boolean; endsAt: string; students: SessionStudent[] } | Fail> {
  const ctx = await getCtx();
  const actor = selectionActorFromCtx(ctx);
  return tenantTx(ctx.orgId, async (tx) => {
    const s = await tx.courseSelectionSession.findFirst({ where: { orgId: ctx.orgId, id: String(input.id) } });
    if (!s) return fail("NOT_FOUND");
    const classes = await sessionClasses(tx, ctx.orgId, actor);
    if (!classes.some((c) => c.id === s.classId)) return fail("FORBIDDEN");
    const roster = await tx.enrollment.findMany({ where: { orgId: ctx.orgId, classId: s.classId }, include: { student: { select: { id: true, gradeLevel: true, curriculum: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, status: true } } } });
    const students = roster.map((e) => e.student).filter((x) => x.status === "ACTIVE");
    const progress = await progressFor(tx, ctx.orgId, s.academicYearId, students);
    const rows: SessionStudent[] = students
      .filter((st) => progress.has(st.id))
      .map((st) => {
        const p = progress.get(st.id)!;
        return { id: st.id, name: personName(st, ctx.locale), status: p.status, chosen: p.chosen, blocks: p.blocks };
      })
      .sort((a, b) => a.name.localeCompare(b.name, ctx.locale));
    return { ok: true as const, active: sessionActive(s, new Date()), endsAt: (s.endedAt ?? s.endsAt).toISOString(), students: rows };
  });
}

const signSchema = z.object({ studentId: z.string().min(1), yearId: z.string().min(1) });

export async function signOffAction(input: z.input<typeof signSchema>) {
  const parsed = signSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const ctx = await getCtx();
  return run(ctx, (tx, effects) => signOffChoices(tx, ctx.orgId, selectionActorFromCtx(ctx), parsed.data, execCtx(tx, ctx.orgId, { effects })));
}

const remindSchema = z.object({ windowId: z.string().min(1), studentIds: z.array(z.string().min(1)).max(2000).optional() });

/** Remind every student who has not finished (and their parents). Once per student per day. */
export async function remindUnfinishedAction(input: z.input<typeof remindSchema>) {
  const parsed = remindSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const ctx = await getCtx();
  if (!ctx.can("registration.manage")) return fail("FORBIDDEN");
  const res = await run(ctx, async (tx, effects) => {
    const r = await remindUnfinished(execCtx(tx, ctx.orgId, { effects }), parsed.data.windowId, { studentIds: parsed.data.studentIds });
    if (r.ok) {
      await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "registration.remind", entityType: "CourseSelectionWindow", entityId: parsed.data.windowId, meta: { students: r.students, people: r.people, unfinished: r.unfinished } });
    }
    return r;
  });
  return res;
}
