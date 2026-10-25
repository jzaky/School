"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { RegistrationSource } from "@prisma/client";
import { getCtx, type Ctx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { canSeeStudent } from "@/server/access/student-access";
import { currentYear, getWindow, moveStudent, registrationYear, runAllocation, saveRegistration, setWindow } from "./service";
import { actorFromCtx, EngineAccessError } from "@/server/pathway-engine/access";
import { electiveImpactFor } from "@/server/pathway-engine/levels-service";
import { importRegistrationRows, previewRegistrationRows, RegImportTooLargeError } from "./import";
import type { ChoiceError } from "@/lib/registration";

type Fail = { ok: false; error: string; errors?: ChoiceError[] };
const fail = (error: string, errors?: ChoiceError[]): Fail => ({ ok: false, error, errors });
const actorOf = (ctx: Ctx) => ({ actorId: ctx.membershipId, actorUserId: ctx.user.id });

function refresh() {
  revalidatePath("/[locale]/admin/registration", "page");
  revalidatePath("/[locale]/subjects", "page");
  revalidatePath("/[locale]/classes", "layout");
}

async function manager(): Promise<Ctx | null> {
  const ctx = await getCtx();
  return ctx.can("registration.manage") ? ctx : null;
}

/** Who may register this student, and as what source. Null when not allowed. */
async function sourceFor(ctx: Ctx, studentId: string): Promise<RegistrationSource | null> {
  if (ctx.can("registration.manage") && ctx.isStaff) return "STAFF";
  if (!ctx.can("registration.submit")) return null;
  if (ctx.isStudent) return ctx.membership.student?.id === studentId ? "STUDENT" : null;
  if (ctx.isParent) return (await canSeeStudent(ctx, studentId)) ? "PARENT" : null;
  return null;
}

const saveSchema = z.object({ studentId: z.string().min(1), optionSubjectIds: z.array(z.string().min(1)).max(20), yearId: z.string().min(1).nullable().optional() });

/** Submit a student's option choices. Core subjects are registered automatically. Allocation runs straight away. */
export async function saveRegistrationAction(input: z.input<typeof saveSchema>) {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const ctx = await getCtx();
  const d = parsed.data;
  const source = await sourceFor(ctx, d.studentId);
  if (!source) return fail("FORBIDDEN");
  const target = await tenantTx(ctx.orgId, (tx) => registrationYear(tx, ctx.orgId, d.yearId));
  if (!target) return fail("NO_YEAR");
  if (source !== "STAFF") {
    const win = await tenantTx(ctx.orgId, (tx) => getWindow(tx, ctx.orgId, new Date(), { yearId: target.year.id, next: target.next }));
    if (!win.open) return fail("CLOSED");
  }
  const res = await tenantTx(
    ctx.orgId,
    async (tx) => {
      const r = await saveRegistration(tx, ctx.orgId, { studentId: d.studentId, optionSubjectIds: d.optionSubjectIds, source, actorId: ctx.membershipId, academicYearId: target.year.id });
      if (r.ok) await audit(tx, ctx.orgId, { ...actorOf(ctx), action: target.next ? "registration.select_next_year" : "registration.submit", entityType: "Student", entityId: d.studentId, meta: { source, yearId: target.year.id, options: d.optionSubjectIds.length, ...r.summary } });
      return r;
    },
    { timeout: 30_000 },
  );
  if (!res.ok) return fail(res.error, res.errors);
  refresh();
  return { ok: true as const, summary: res.summary };
}

/** Run allocation for the whole current year. Only places unplaced students; existing placements stay. */
export async function runAllocationAction() {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const summary = await tenantTx(
    ctx.orgId,
    async (tx) => {
      const year = await currentYear(tx, ctx.orgId);
      if (!year) return null;
      const s = await runAllocation(tx, ctx.orgId, year.id);
      await audit(tx, ctx.orgId, { ...actorOf(ctx), action: "registration.allocate", entityType: "AcademicYear", entityId: year.id, meta: s });
      return s;
    },
    { timeout: 120_000 },
  );
  if (!summary) return fail("NO_YEAR");
  refresh();
  return { ok: true as const, summary };
}

const moveSchema = z.object({ registrationId: z.string().min(1), classId: z.string().min(1) });

export async function moveStudentAction(input: z.input<typeof moveSchema>) {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const res = await tenantTx(ctx.orgId, async (tx) => {
    const r = await moveStudent(tx, ctx.orgId, parsed.data);
    if (r.ok) await audit(tx, ctx.orgId, { ...actorOf(ctx), action: "registration.move", entityType: "SubjectRegistration", entityId: parsed.data.registrationId, meta: { fromClassId: r.fromClassId, toClassId: parsed.data.classId } });
    return r;
  });
  if (!res.ok) return fail(res.error);
  refresh();
  return { ok: true as const };
}

const CURRICULA = ["BRITISH", "IB", "AMERICAN", "UAE_MOE", "JORDAN_TAWJIHI", "CBSE", "ISC", "SABIS", "OTHER"] as const;
const offeringSchema = z.object({
  id: z.string().optional(),
  gradeLevel: z.number().int().min(1).max(13),
  subjectId: z.string().min(1),
  kind: z.enum(["CORE", "OPTION"]),
  optionBlock: z.string().trim().toUpperCase().regex(/^[A-Z]$/).nullable().optional(),
  prerequisites: z.array(z.string().trim().toUpperCase().min(1).max(20)).max(6),
  periodsPerWeek: z.number().int().min(1).max(12),
  /** The year the offering is for: the current year (default) or next year's course selection. */
  yearId: z.string().min(1).nullable().optional(),
  /** The track: null for every track. */
  curriculum: z.enum(CURRICULA).nullable().optional(),
  /** The curriculum course it counts as for universities. */
  courseId: z.string().min(1).nullable().optional(),
  isAP: z.boolean().optional(),
});

/** Add or edit a subject offering for a grade in the current year. */
export async function saveOfferingAction(input: z.input<typeof offeringSchema>) {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = offeringSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const d = parsed.data;
  if (d.kind === "OPTION" && !d.optionBlock) return fail("BLOCK_REQUIRED");
  const res = await tenantTx(ctx.orgId, async (tx): Promise<Fail | { ok: true }> => {
    const target = await registrationYear(tx, ctx.orgId, d.yearId);
    if (!target) return fail("NO_YEAR");
    const year = target.year;
    const subject = await tx.subject.findFirst({ where: { orgId: ctx.orgId, id: d.subjectId }, select: { code: true } });
    if (!subject) return fail("INVALID");
    if (d.prerequisites.includes(subject.code.toUpperCase())) return fail("SELF_PREREQ");
    if (d.courseId) {
      const course = await tx.curriculumCourse.findFirst({ where: { id: d.courseId, OR: [{ orgId: null }, { orgId: ctx.orgId }] }, select: { id: true } });
      if (!course) return fail("INVALID");
    }
    const data = {
      kind: d.kind,
      optionBlock: d.kind === "OPTION" ? d.optionBlock! : null,
      prerequisites: [...new Set(d.prerequisites)],
      periodsPerWeek: d.periodsPerWeek,
      ...(d.curriculum !== undefined ? { curriculum: d.curriculum } : {}),
      ...(d.courseId !== undefined ? { courseId: d.courseId } : {}),
      ...(d.isAP !== undefined ? { isAP: d.isAP } : {}),
    };
    if (d.id) {
      const existing = await tx.subjectOffering.findFirst({ where: { orgId: ctx.orgId, id: d.id } });
      if (!existing) return fail("NOT_FOUND");
      await tx.subjectOffering.update({ where: { id: existing.id }, data });
      await audit(tx, ctx.orgId, { ...actorOf(ctx), action: "registration.offering_update", entityType: "SubjectOffering", entityId: existing.id, meta: data });
    } else {
      const dup = await tx.subjectOffering.findFirst({ where: { orgId: ctx.orgId, academicYearId: year.id, subjectId: d.subjectId, gradeLevel: d.gradeLevel } });
      if (dup) return fail("DUPLICATE");
      const created = await tx.subjectOffering.create({ data: { orgId: ctx.orgId, academicYearId: year.id, subjectId: d.subjectId, gradeLevel: d.gradeLevel, ...data } });
      await audit(tx, ctx.orgId, { ...actorOf(ctx), action: "registration.offering_add", entityType: "SubjectOffering", entityId: created.id, meta: { gradeLevel: d.gradeLevel, ...data } });
    }
    return { ok: true };
  });
  if (res.ok) refresh();
  return res;
}

/** Remove an offering. Refused while students are registered for it. */
export async function deleteOfferingAction(input: { id: string }) {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const res = await tenantTx(ctx.orgId, async (tx): Promise<Fail | { ok: true }> => {
    const o = await tx.subjectOffering.findFirst({ where: { orgId: ctx.orgId, id: String(input.id) } });
    if (!o) return fail("NOT_FOUND");
    const regs = await tx.subjectRegistration.findMany({ where: { orgId: ctx.orgId, academicYearId: o.academicYearId, subjectId: o.subjectId, status: { in: ["REQUESTED", "ALLOCATED", "WAITLISTED"] } }, select: { studentId: true } });
    if (regs.length) {
      const inGrade = await tx.student.count({ where: { orgId: ctx.orgId, id: { in: regs.map((r) => r.studentId) }, gradeLevel: o.gradeLevel } });
      if (inGrade > 0) return fail("IN_USE");
    }
    await tx.subjectOffering.delete({ where: { id: o.id } });
    await audit(tx, ctx.orgId, { ...actorOf(ctx), action: "registration.offering_remove", entityType: "SubjectOffering", entityId: o.id, meta: { gradeLevel: o.gradeLevel } });
    return { ok: true };
  });
  if (res.ok) refresh();
  return res;
}

const windowSchema = z.object({ deadline: z.string().datetime({ offset: true }).nullable(), yearId: z.string().min(1).nullable().optional() });

/** Open the registration window until a deadline, or close it now (deadline null). */
export async function setWindowAction(input: z.input<typeof windowSchema>) {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = windowSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const now = new Date();
  const deadline = parsed.data.deadline ? new Date(parsed.data.deadline) : now;
  if (parsed.data.deadline && deadline.getTime() <= now.getTime()) return fail("PAST_DEADLINE");
  const done = await tenantTx(ctx.orgId, async (tx) => {
    const target = await registrationYear(tx, ctx.orgId, parsed.data.yearId);
    if (!target) return false;
    const next = target.next ? { yearId: target.year.id, nameEn: target.year.nameEn, nameAr: target.year.nameAr } : undefined;
    const ev = await setWindow(tx, ctx.orgId, deadline, ctx.membershipId, { next });
    await audit(tx, ctx.orgId, { ...actorOf(ctx), action: parsed.data.deadline ? "registration.window_open" : "registration.window_close", entityType: "CalendarEvent", entityId: ev.id, meta: { deadline: deadline.toISOString(), yearId: target.year.id } });
    return true;
  });
  if (!done) return fail("NO_YEAR");
  refresh();
  revalidatePath("/[locale]/calendar", "page");
  return { ok: true as const };
}

const rowsSchema = z.array(z.record(z.string(), z.unknown())).max(2000);

export async function previewImportAction(input: { rows: unknown }) {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = rowsSchema.safeParse(input.rows);
  if (!parsed.success) return fail("INVALID");
  try {
    const preview = await tenantTx(ctx.orgId, (tx) => previewRegistrationRows(tx, ctx.orgId, parsed.data), { timeout: 60_000 });
    return { ok: true as const, preview };
  } catch (e) {
    if (e instanceof RegImportTooLargeError) return fail("TOO_MANY_ROWS");
    throw e;
  }
}

export async function importRegistrationsAction(input: { fileName: string; rows: unknown }) {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = rowsSchema.safeParse(input.rows);
  if (!parsed.success) return fail("INVALID");
  try {
    const res = await importRegistrationRows(ctx.orgId, { membershipId: ctx.membershipId, userId: ctx.user.id }, String(input.fileName ?? ""), parsed.data);
    refresh();
    return { ok: true as const, total: res.total, succeeded: res.succeeded, failed: res.failed, allocation: res.allocation };
  } catch (e) {
    if (e instanceof RegImportTooLargeError) return fail("TOO_MANY_ROWS");
    throw e;
  }
}

const impactSchema = z.object({ studentId: z.string().min(1), yearId: z.string().min(1).nullable().optional(), chosen: z.array(z.string().min(1)).max(20) });

/** University impact of each option in a student's picker, for the choices made so far. Read only. */
export async function electiveImpactAction(input: z.input<typeof impactSchema>) {
  const parsed = impactSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const ctx = await getCtx();
  if (!(await canSeeStudent(ctx, parsed.data.studentId))) return fail("FORBIDDEN");
  try {
    const impact = await electiveImpactFor(await actorFromCtx(ctx), parsed.data.studentId, { yearId: parsed.data.yearId, chosen: parsed.data.chosen });
    return { ok: true as const, impact };
  } catch (e) {
    if (e instanceof EngineAccessError) return fail("FORBIDDEN");
    throw e;
  }
}
