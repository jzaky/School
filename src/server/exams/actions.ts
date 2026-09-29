"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { audit } from "@/server/audit/audit";
import { detectClashes, instant, suggestSchedule, type SuggestResult } from "./schedule";
import { publishSittings, sittingEventData } from "./service";
import { examContext } from "./queries";

type Result = { ok: true; count?: number; notified?: number } | { ok: false; error: string };
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

async function manager() {
  const ctx = await getCtx();
  return ctx.can("calendar.manage") ? ctx : null;
}

function done(r: Result = { ok: true }): Result {
  revalidatePath("/", "layout");
  return r;
}

export type SittingInput = { id?: string | null; termId: string | null; subjectId: string; gradeLevel: number; date: string; startTime: string; endTime: string; room: string; invigilatorIds: string[] };

export async function saveSittingAction(input: SittingInput): Promise<Result> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  if (!KEY_RE.test(input.date) || !TIME_RE.test(input.startTime) || !TIME_RE.test(input.endTime) || mins(input.endTime) <= mins(input.startTime)) return { ok: false, error: "INVALID_TIMES" };
  if (!Number.isInteger(input.gradeLevel) || input.gradeLevel < 1 || input.gradeLevel > 13) return { ok: false, error: "INVALID" };
  const subject = await ctx.db.subject.findUnique({ where: { id: input.subjectId } });
  if (!subject) return { ok: false, error: "SUBJECT_REQUIRED" };
  const staff = input.invigilatorIds.length ? await ctx.db.staffProfile.findMany({ where: { membershipId: { in: input.invigilatorIds } }, select: { membershipId: true } }) : [];
  const data = {
    termId: input.termId || null,
    subjectId: subject.id,
    gradeLevel: input.gradeLevel,
    titleEn: subject.nameEn,
    titleAr: subject.nameAr,
    startsAt: instant(input.date, mins(input.startTime)),
    endsAt: instant(input.date, mins(input.endTime)),
    room: input.room.trim() || null,
    invigilatorIds: staff.map((s) => s.membershipId),
  };
  await tenantTx(ctx.orgId, async (tx) => {
    if (input.id) {
      const existing = await tx.examSitting.findUnique({ where: { id: input.id } });
      if (!existing) throw new Error("NOT_FOUND");
      const s = await tx.examSitting.update({ where: { id: existing.id }, data });
      if (s.status === "PUBLISHED" && s.calendarEventId) await tx.calendarEvent.updateMany({ where: { id: s.calendarEventId }, data: sittingEventData(s) });
      await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "exam.update", entityType: "ExamSitting", entityId: s.id });
    } else {
      const s = await tx.examSitting.create({ data: { orgId: ctx.orgId, ...data } });
      await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "exam.create", entityType: "ExamSitting", entityId: s.id });
    }
  });
  return done();
}

export async function deleteSittingAction(id: string): Promise<Result> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const s = await ctx.db.examSitting.findUnique({ where: { id } });
  if (!s) return { ok: false, error: "NOT_FOUND" };
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.examSitting.delete({ where: { id } });
    if (s.calendarEventId) await tx.calendarEvent.deleteMany({ where: { id: s.calendarEventId } });
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "exam.delete", entityType: "ExamSitting", entityId: id, meta: { grade: s.gradeLevel, published: s.status === "PUBLISHED" } });
  });
  return done();
}

export type SuggestOptions = {
  termId: string | null;
  windowStart: string;
  windowEnd: string;
  grades: number[];
  maxPerDay: number;
  sessions: string[];
  durationMin: number;
  rooms: string[];
  invigilatorIds: string[];
};

async function buildSuggestion(opts: SuggestOptions): Promise<{ ok: false; error: string } | { ok: true; result: SuggestResult; subjectNames: Record<string, { en: string; ar: string }> }> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  if (!KEY_RE.test(opts.windowStart) || !KEY_RE.test(opts.windowEnd) || opts.windowEnd < opts.windowStart) return { ok: false, error: "INVALID_DATES" };
  if (!opts.grades.length) return { ok: false, error: "GRADES_REQUIRED" };
  const sessions = opts.sessions.filter((s) => TIME_RE.test(s)).map(mins);
  if (!sessions.length) return { ok: false, error: "INVALID_TIMES" };
  const ec = await examContext(ctx);
  // Subjects each grade studies, from the subject classes of the current year. Already scheduled subjects are skipped.
  const [classes, existing] = await Promise.all([
    ctx.db.schoolClass.findMany({ where: { gradeLevel: { in: opts.grades }, subjectId: { not: null }, isHomeroom: false, ...(ec.year ? { academicYearId: ec.year.id } : {}) }, include: { subject: true }, orderBy: { nameEn: "asc" } }),
    ctx.db.examSitting.findMany({ where: { termId: opts.termId, gradeLevel: { in: opts.grades } }, select: { gradeLevel: true, subjectId: true } }),
  ]);
  const subjectNames: Record<string, { en: string; ar: string }> = {};
  const grades = [...opts.grades].sort((a, b) => a - b).map((g) => {
    const seen = new Set(existing.filter((e) => e.gradeLevel === g).map((e) => e.subjectId));
    const subjects: Array<{ subjectId: string; durationMin: number }> = [];
    for (const c of classes.filter((c) => c.gradeLevel === g)) {
      if (!c.subject || seen.has(c.subject.id)) continue;
      seen.add(c.subject.id);
      subjectNames[c.subject.id] = { en: c.subject.nameEn, ar: c.subject.nameAr };
      subjects.push({ subjectId: c.subject.id, durationMin: Math.max(30, Math.min(240, opts.durationMin || 90)) });
    }
    return { gradeLevel: g, subjects };
  });
  const blocked = ec.holidayKeys.filter((k) => k >= opts.windowStart && k <= opts.windowEnd);
  const result = suggestSchedule({
    windowStart: opts.windowStart,
    windowEnd: opts.windowEnd,
    grades,
    maxPerDay: opts.maxPerDay,
    sessions,
    weekDays: ctx.org.weekDays,
    blockedDays: blocked,
    rooms: opts.rooms.map((r) => r.trim()).filter(Boolean),
    invigilators: opts.invigilatorIds,
    invigilatorsPerSitting: opts.invigilatorIds.length ? 1 : 0,
  });
  return { ok: true, result, subjectNames };
}

/** Preview an automatic schedule without saving it. */
export async function previewSuggestionAction(opts: SuggestOptions) {
  return buildSuggestion(opts);
}

/** Save the suggested schedule as draft sittings. */
export async function applySuggestionAction(opts: SuggestOptions): Promise<Result> {
  const built = await buildSuggestion(opts);
  if (!built.ok) return built;
  const ctx = await getCtx();
  if (!built.result.sittings.length) return { ok: false, error: "NOTHING_TO_SCHEDULE" };
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.examSitting.createMany({
      data: built.result.sittings.map((s) => ({
        orgId: ctx.orgId,
        termId: opts.termId,
        subjectId: s.subjectId,
        gradeLevel: s.gradeLevel,
        titleEn: built.subjectNames[s.subjectId]?.en ?? "",
        titleAr: built.subjectNames[s.subjectId]?.ar ?? "",
        startsAt: instant(s.dateKey, s.startMinute),
        endsAt: instant(s.dateKey, s.endMinute),
        room: s.room,
        invigilatorIds: s.invigilatorIds,
      })),
    });
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "exam.suggest.apply", entityType: "ExamSitting", meta: { count: built.result.sittings.length, grades: opts.grades } });
  });
  return done({ ok: true, count: built.result.sittings.length });
}

/** Publish every draft sitting in the term (optionally one grade). Refuses while there are clashes. */
export async function publishSittingsAction(input: { termId: string | null; gradeLevel?: number | null }): Promise<Result> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const ec = await examContext(ctx);
  const all = await ctx.db.examSitting.findMany({ where: { termId: input.termId } });
  const drafts = all.filter((s) => s.status === "DRAFT" && (input.gradeLevel == null || s.gradeLevel === input.gradeLevel));
  if (!drafts.length) return { ok: false, error: "NO_DRAFTS" };
  const clashes = detectClashes(all, { holidays: ec.holidays, weekDays: ctx.org.weekDays }).filter((c) => drafts.some((d) => d.id === c.sittingId));
  if (clashes.length) return { ok: false, error: "CLASHES" };
  const effects: Effect[] = [];
  const r = await tenantTx(ctx.orgId, (tx) => publishSittings(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId }), { sittingIds: drafts.map((d) => d.id), actorId: ctx.membershipId }), { timeout: 60000 });
  await flushEffects(effects);
  return done({ ok: true, count: r.published, notified: r.notified });
}
