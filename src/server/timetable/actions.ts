"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCtx, type Ctx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { buildPreset, validateDay, UAE_PRESET, type PresetOptions } from "./bell";
import { clashesForMove, currentYear, prefillQualifications, runAssignment, runGenerate, type GenerateReport } from "./service";
import { AbsenceError, cancelAbsence, declineCover, freeSubstitutes, reassignCover, reportAbsence } from "./cover";
import type { AssignResult } from "./assign";

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

async function manager(): Promise<Ctx | null> {
  const ctx = await getCtx();
  return ctx.can("timetable.manage") ? ctx : null;
}

function done() {
  revalidatePath("/[locale]/admin/timetable", "page");
  revalidatePath("/[locale]/timetable", "page");
  revalidatePath("/[locale]/admin/cover", "page");
}

function errorCode(e: unknown) {
  if (e instanceof AbsenceError) return e.message;
  return "generic";
}

// --- Teachers and subjects --------------------------------------------------------------

const qualSchema = z.object({
  membershipId: z.string().min(1),
  rows: z.array(z.object({ subjectId: z.string().min(1), gradeLevels: z.array(z.number().int().min(0).max(13)).max(14) })).max(40),
  maxPeriodsPerWeek: z.number().int().min(1).max(45),
});

export async function saveTeacherSubjectsAction(input: z.infer<typeof qualSchema>): Promise<{ ok: true } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const p = qualSchema.safeParse(input);
  if (!p.success) return fail("INVALID");
  const { membershipId, rows, maxPeriodsPerWeek } = p.data;
  await tenantTx(ctx.orgId, async (tx) => {
    const m = await tx.membership.findFirst({ where: { orgId: ctx.orgId, id: membershipId } });
    if (!m) throw new Error("NOT_FOUND");
    const keep = rows.filter((r) => r.gradeLevels.length > 0);
    await tx.teacherSubject.deleteMany({ where: { orgId: ctx.orgId, membershipId, subjectId: { notIn: keep.map((r) => r.subjectId) } } });
    for (const r of keep) {
      await tx.teacherSubject.upsert({
        where: { membershipId_subjectId: { membershipId, subjectId: r.subjectId } },
        create: { orgId: ctx.orgId, membershipId, subjectId: r.subjectId, gradeLevels: [...new Set(r.gradeLevels)].sort((a, b) => a - b), maxPeriodsPerWeek },
        update: { gradeLevels: [...new Set(r.gradeLevels)].sort((a, b) => a - b), maxPeriodsPerWeek },
      });
    }
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "timetable.teacher_subjects", entityType: "Membership", entityId: membershipId, meta: { subjects: keep.length, maxPeriodsPerWeek } as never } });
  });
  done();
  return { ok: true };
}

const bulkSchema = z.object({
  membershipIds: z.array(z.string().min(1)).min(1).max(200),
  maxPeriodsPerWeek: z.number().int().min(1).max(45).nullable(),
  addSubjectId: z.string().nullable(),
  addGrades: z.array(z.number().int().min(0).max(13)).max(14),
});

/** Bulk edit: set the weekly maximum and/or add a subject with grades for several teachers at once. */
export async function bulkEditTeachersAction(input: z.infer<typeof bulkSchema>): Promise<{ ok: true; updated: number } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const p = bulkSchema.safeParse(input);
  if (!p.success) return fail("INVALID");
  const { membershipIds, maxPeriodsPerWeek, addSubjectId, addGrades } = p.data;
  if (!maxPeriodsPerWeek && !(addSubjectId && addGrades.length)) return fail("NOTHING");
  let updated = 0;
  await tenantTx(ctx.orgId, async (tx) => {
    for (const id of membershipIds) {
      const existing = await tx.teacherSubject.findMany({ where: { orgId: ctx.orgId, membershipId: id } });
      const max = maxPeriodsPerWeek ?? (existing.length ? Math.max(...existing.map((e) => e.maxPeriodsPerWeek)) : 24);
      if (addSubjectId && addGrades.length) {
        const cur = existing.find((e) => e.subjectId === addSubjectId);
        const grades = [...new Set([...(cur?.gradeLevels ?? []), ...addGrades])].sort((a, b) => a - b);
        await tx.teacherSubject.upsert({
          where: { membershipId_subjectId: { membershipId: id, subjectId: addSubjectId } },
          create: { orgId: ctx.orgId, membershipId: id, subjectId: addSubjectId, gradeLevels: grades, maxPeriodsPerWeek: max },
          update: { gradeLevels: grades },
        });
      }
      if (maxPeriodsPerWeek) await tx.teacherSubject.updateMany({ where: { orgId: ctx.orgId, membershipId: id }, data: { maxPeriodsPerWeek } });
      updated++;
    }
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "timetable.teacher_subjects_bulk", entityType: "Organization", entityId: ctx.orgId, meta: { count: membershipIds.length, maxPeriodsPerWeek, addSubjectId, addGrades } as never } });
  });
  done();
  return { ok: true, updated };
}

/**
 * Prefill qualifications from what teachers teach today (SchoolClass teacher) and their department's subjects
 * for their grade levels. Existing rows keep their grades and gain any new ones.
 */
export async function prefillTeacherSubjectsAction(): Promise<{ ok: true; created: number; updated: number } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const res = await tenantTx(ctx.orgId, (tx) => prefillQualifications(tx, ctx.orgId), { timeout: 30000 });
  await tenantTx(ctx.orgId, (tx) => tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "timetable.prefill", entityType: "Organization", entityId: ctx.orgId, meta: res as never } }));
  done();
  return { ok: true, ...res };
}

// --- Bell schedule ----------------------------------------------------------------------

const presetSchema = z.object({
  start: z.string().regex(/^\d{1,2}:\d{2}$/),
  assemblyMin: z.number().int().min(0).max(60),
  lessonsPerDay: z.number().int().min(3).max(12),
  lessonMin: z.number().int().min(20).max(120),
  fridayLessons: z.number().int().min(0).max(12),
  fridayLessonMin: z.number().int().min(20).max(120),
});

async function orphanedSlots(tx: import("@/lib/tenant-db").TenantTx, orgId: string, yearId: string) {
  const bell = await tx.bellPeriod.findMany({ where: { orgId, academicYearId: yearId, kind: "LESSON" } });
  const ok = new Set(bell.map((b) => `${b.dayOfWeek}|${b.periodNo}`));
  const slots = await tx.timetableSlot.findMany({ where: { orgId, academicYearId: yearId }, select: { id: true, dayOfWeek: true, periodNo: true } });
  const bad = slots.filter((s) => !ok.has(`${s.dayOfWeek}|${s.periodNo}`)).map((s) => s.id);
  if (bad.length) await tx.timetableSlot.deleteMany({ where: { orgId, id: { in: bad } } });
  return bad.length;
}

/** Replace the whole bell schedule with the standard UAE day (with the given options). */
export async function applyBellPresetAction(input: z.infer<typeof presetSchema>): Promise<{ ok: true; removedLessons: number } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const p = presetSchema.safeParse(input);
  if (!p.success) return fail("INVALID");
  const opts: PresetOptions = { ...UAE_PRESET, ...p.data, days: ctx.org.weekDays.length ? ctx.org.weekDays : UAE_PRESET.days };
  const rows = buildPreset(opts);
  if (rows.some((r) => r.endTime > "23:59")) return fail("TOO_LONG");
  let removed = 0;
  await tenantTx(ctx.orgId, async (tx) => {
    const year = await currentYear(tx, ctx.orgId);
    if (!year) throw new Error("NO_YEAR");
    await tx.bellPeriod.deleteMany({ where: { orgId: ctx.orgId, academicYearId: year.id } });
    await tx.bellPeriod.createMany({ data: rows.map((r) => ({ orgId: ctx.orgId, academicYearId: year.id, ...r })) });
    removed = await orphanedSlots(tx, ctx.orgId, year.id);
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "timetable.bell_preset", entityType: "AcademicYear", entityId: year.id, meta: { ...p.data, removedLessons: removed } as never } });
  });
  done();
  return { ok: true, removedLessons: removed };
}

const daySchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  rows: z.array(z.object({ startTime: z.string(), endTime: z.string(), kind: z.enum(["LESSON", "BREAK", "ASSEMBLY"]) })).max(20),
});

/** Save one day's periods, optionally copied to several days. Lessons in removed periods are unscheduled. */
export async function saveBellDaysAction(input: z.infer<typeof daySchema>): Promise<{ ok: true; removedLessons: number } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const p = daySchema.safeParse(input);
  if (!p.success) return fail("INVALID");
  const rows = [...p.data.rows].sort((a, b) => a.startTime.padStart(5, "0").localeCompare(b.startTime.padStart(5, "0")));
  const err = validateDay(rows);
  if (err) return fail(err);
  let removed = 0;
  await tenantTx(ctx.orgId, async (tx) => {
    const year = await currentYear(tx, ctx.orgId);
    if (!year) throw new Error("NO_YEAR");
    for (const day of p.data.days) {
      await tx.bellPeriod.deleteMany({ where: { orgId: ctx.orgId, academicYearId: year.id, dayOfWeek: day } });
      if (rows.length) await tx.bellPeriod.createMany({ data: rows.map((r, i) => ({ orgId: ctx.orgId, academicYearId: year.id, dayOfWeek: day, periodNo: i + 1, startTime: r.startTime.padStart(5, "0"), endTime: r.endTime.padStart(5, "0"), kind: r.kind })) });
    }
    removed = await orphanedSlots(tx, ctx.orgId, year.id);
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "timetable.bell_edit", entityType: "AcademicYear", entityId: year.id, meta: { days: p.data.days, periods: rows.length, removedLessons: removed } as never } });
  });
  done();
  return { ok: true, removedLessons: removed };
}

// --- Assignment and generation ----------------------------------------------------------

export async function runAssignmentAction(input: { overwrite: boolean }): Promise<{ ok: true; result: Pick<AssignResult, "assignments" | "unassigned">; changed: number } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const res = await tenantTx(ctx.orgId, (tx) => runAssignment(tx, ctx.orgId, { overwrite: Boolean(input.overwrite), actorId: ctx.membershipId }), { timeout: 30000 });
  done();
  return { ok: true, result: { assignments: res.assignments, unassigned: res.unassigned }, changed: res.changed };
}

/** Set or clear a section's teacher by hand. */
export async function setSectionTeacherAction(input: { classId: string; teacherId: string | null }): Promise<{ ok: true } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  await tenantTx(ctx.orgId, async (tx) => {
    const c = await tx.schoolClass.findFirst({ where: { orgId: ctx.orgId, id: input.classId } });
    if (!c) throw new Error("NOT_FOUND");
    if (input.teacherId) {
      const m = await tx.membership.findFirst({ where: { orgId: ctx.orgId, id: input.teacherId, status: "ACTIVE" } });
      if (!m) throw new Error("NOT_FOUND");
    }
    await tx.schoolClass.update({ where: { id: c.id }, data: { teacherMembershipId: input.teacherId } });
    await tx.timetableSlot.updateMany({ where: { orgId: ctx.orgId, classId: c.id, locked: false }, data: { teacherMembershipId: input.teacherId } });
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "timetable.section_teacher", entityType: "SchoolClass", entityId: c.id, meta: { from: c.teacherMembershipId, to: input.teacherId } as never } });
  });
  done();
  return { ok: true };
}

export async function generateTimetableAction(): Promise<{ ok: true; report: GenerateReport } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const report = await tenantTx(ctx.orgId, (tx) => runGenerate(tx, ctx.orgId, { actorId: ctx.membershipId }), { timeout: 60000 });
  if (!report) return fail("NO_YEAR");
  done();
  return { ok: true, report };
}

export type MoveOption = { day: number; period: number; clashes: Array<{ kind: "TEACHER" | "STUDENT" | "ROOM" | "SAME_CLASS"; classId: string; className: string }> };

/** Every lesson period with what would clash if the lesson moved there. */
export async function moveOptionsAction(slotId: string): Promise<{ ok: true; options: MoveOption[]; current: { day: number; period: number } } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const res = await tenantTx(ctx.orgId, (tx) => clashesForMove(tx, ctx.orgId, slotId), { timeout: 30000 });
  if (!res) return fail("NOT_FOUND");
  const ids = [...new Set(res.options.flatMap((o) => o.clashes.map((c) => c.classId)))];
  const classes = await ctx.db.schoolClass.findMany({ where: { id: { in: ids } }, select: { id: true, nameEn: true, nameAr: true } });
  const name = (id: string) => {
    const c = classes.find((x) => x.id === id);
    return c ? (ctx.locale === "ar" ? c.nameAr || c.nameEn : c.nameEn) : "";
  };
  return {
    ok: true,
    current: { day: res.slot.dayOfWeek, period: res.slot.periodNo },
    options: res.options.map((o) => ({ ...o, clashes: o.clashes.map((c) => ({ ...c, className: name(c.classId) })) })),
  };
}

/** Move a lesson to another period. Refused when it would clash. The moved lesson is locked so regeneration keeps it. */
export async function moveLessonAction(input: { slotId: string; day: number; period: number }): Promise<{ ok: true } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  try {
    await tenantTx(
      ctx.orgId,
      async (tx) => {
        const res = await clashesForMove(tx, ctx.orgId, input.slotId);
        if (!res) throw new AbsenceError("NOT_FOUND");
        const target = res.options.find((o) => o.day === input.day && o.period === input.period);
        if (!target) throw new AbsenceError("NOT_A_LESSON");
        if (target.clashes.length) throw new AbsenceError("CLASH");
        await tx.timetableSlot.update({ where: { id: res.slot.id }, data: { dayOfWeek: input.day, periodNo: input.period, locked: true } });
        await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "timetable.move", entityType: "TimetableSlot", entityId: res.slot.id, meta: { from: { day: res.slot.dayOfWeek, period: res.slot.periodNo }, to: { day: input.day, period: input.period } } as never } });
      },
      { timeout: 30000 },
    );
  } catch (e) {
    return fail(errorCode(e));
  }
  done();
  return { ok: true };
}

export async function toggleLockAction(input: { slotId: string; locked: boolean }): Promise<{ ok: true } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const slot = await ctx.db.timetableSlot.findUnique({ where: { id: input.slotId } });
  if (!slot) return fail("NOT_FOUND");
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.timetableSlot.update({ where: { id: slot.id }, data: { locked: input.locked } });
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: input.locked ? "timetable.lock" : "timetable.unlock", entityType: "TimetableSlot", entityId: slot.id } });
  });
  done();
  return { ok: true };
}

// --- Absence and cover ------------------------------------------------------------------

const absenceSchema = z.object({
  membershipId: z.string().nullable(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  allDay: z.boolean(),
  fromPeriod: z.number().int().min(1).max(20).nullable(),
  toPeriod: z.number().int().min(1).max(20).nullable(),
  notes: z.string().max(500).nullable(),
});

/** Report an absence: your own (absence.report) or any teacher's (cover.manage). Cover is arranged straight away. */
export async function reportAbsenceAction(input: z.infer<typeof absenceSchema>): Promise<{ ok: true; created: number; covered: number; uncovered: number } | Fail> {
  const ctx = await getCtx();
  const p = absenceSchema.safeParse(input);
  if (!p.success) return fail("INVALID");
  const who = p.data.membershipId ?? ctx.membershipId;
  if (who === ctx.membershipId ? !ctx.can("absence.report") : !ctx.can("cover.manage")) return fail("FORBIDDEN");
  const effects: Effect[] = [];
  try {
    const res = await tenantTx(
      ctx.orgId,
      async (tx) => {
        const m = await tx.membership.findFirst({ where: { orgId: ctx.orgId, id: who, status: "ACTIVE" } });
        if (!m) throw new AbsenceError("NOT_FOUND");
        return reportAbsence(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId }), { ...p.data, membershipId: who, reportedById: ctx.membershipId });
      },
      { timeout: 60000 },
    );
    await flushEffects(effects);
    done();
    return { ok: true, created: res.created, covered: res.covered, uncovered: res.uncovered };
  } catch (e) {
    return fail(errorCode(e));
  }
}

export async function cancelAbsenceAction(absenceId: string): Promise<{ ok: true } | Fail> {
  const ctx = await getCtx();
  const a = await ctx.db.staffAbsence.findUnique({ where: { id: absenceId } });
  if (!a) return fail("NOT_FOUND");
  const own = a.membershipId === ctx.membershipId && ctx.can("absence.report");
  if (!own && !ctx.can("cover.manage")) return fail("FORBIDDEN");
  const effects: Effect[] = [];
  try {
    await tenantTx(ctx.orgId, (tx) => cancelAbsence(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId }), absenceId, ctx.membershipId), { timeout: 30000 });
  } catch (e) {
    return fail(errorCode(e));
  }
  await flushEffects(effects);
  done();
  return { ok: true };
}

export type SubOption = { id: string; name: string; tier: "DEPARTMENT" | "QUALIFIED" | "ANY"; overLimit: boolean; coverCount: number };

export async function freeSubstitutesAction(coverId: string): Promise<{ ok: true; options: SubOption[] } | Fail> {
  const ctx = await getCtx();
  if (!ctx.can("cover.manage")) return fail("FORBIDDEN");
  const ranked = await tenantTx(ctx.orgId, (tx) => freeSubstitutes(tx, ctx.orgId, coverId), { timeout: 30000 });
  const members = await ctx.db.membership.findMany({ where: { id: { in: ranked.map((r) => r.id) } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } });
  return {
    ok: true,
    options: ranked.map((r) => {
      const m = members.find((x) => x.id === r.id);
      return { ...r, name: m ? (ctx.locale === "ar" ? m.user.nameAr || m.user.nameEn : m.user.nameEn) : "" };
    }),
  };
}

export async function reassignCoverAction(input: { coverId: string; substituteId: string | null }): Promise<{ ok: true; substituteId: string | null } | Fail> {
  const ctx = await getCtx();
  if (!ctx.can("cover.manage")) return fail("FORBIDDEN");
  const effects: Effect[] = [];
  try {
    const next = await tenantTx(ctx.orgId, (tx) => reassignCover(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId }), input.coverId, { substituteId: input.substituteId, actorId: ctx.membershipId }), { timeout: 30000 });
    await flushEffects(effects);
    done();
    return { ok: true, substituteId: next };
  } catch (e) {
    return fail(errorCode(e));
  }
}

export async function declineCoverAction(input: { coverId: string; reason: string }): Promise<{ ok: true; reassigned: boolean } | Fail> {
  const ctx = await getCtx();
  if (!ctx.isStaff) return fail("FORBIDDEN");
  if (!input.reason.trim()) return fail("REASON_REQUIRED");
  const effects: Effect[] = [];
  try {
    const next = await tenantTx(ctx.orgId, (tx) => declineCover(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId }), input.coverId, ctx.membershipId, input.reason), { timeout: 30000 });
    await flushEffects(effects);
    done();
    return { ok: true, reassigned: Boolean(next) };
  } catch (e) {
    return fail(errorCode(e));
  }
}
