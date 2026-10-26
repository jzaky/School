"use server";

// Staff actions for admissions. Every action checks its permission first, runs in a tenant transaction, writes the
// audit trail (inside the service functions) and flushes queued emails after commit.
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getCtx, type Ctx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { audit } from "@/server/audit/audit";
import { ALL_GRADE_LEVELS } from "@/lib/grade-levels";
import { AdmissionError, canEnroll, canManageAdmissions, canRevealIds, canSeeHealth, canViewAdmissions } from "./access";
import { DOC_CATEGORIES, DOC_KEY_RE, LEAVING_REASONS } from "./config";
import { enrollApplication, type EnrollResult } from "./enroll";
import { patternProblem } from "./numbers";
import { openWindow, respond, sendRemindersNow, updateWindow } from "./reenrollment";
import { aedToFils, validCutoff } from "./rules";
import { decryptJson, decryptText } from "./secure";
import { bookAssessment, extendOffer, makeOffer, moveStage, recordAssessment, reviewDocument, setPriority, staffMessage, type Actor } from "./service";
import { markSeatPaid } from "./seat-booking";
import { CUSTOM_STAGE_RE, MAX_CUSTOM_STAGES, OPTIONAL_STAGES, SYSTEM_STAGES } from "./stages";
import { cancelWithdrawal, completeWithdrawal, planWithdrawal } from "./withdrawals";
import { loadBoardColumn, type BoardFilters } from "./queries";
import { AUTHORITIES, REG_STATUSES, updateRegistration } from "./registration";

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const actorOf = (ctx: Ctx): Actor => ({ membershipId: ctx.membershipId, userId: ctx.user.id });

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AdmissionError) return { ok: false, error: e.code };
  if (e instanceof z.ZodError) return { ok: false, error: "INVALID" };
  throw e;
}

/** Run a staff mutation in one transaction and send its emails after commit. */
async function run<T>(ctx: Ctx, fn: (ec: ReturnType<typeof execCtx>) => Promise<T>): Promise<T> {
  const effects: Effect[] = [];
  const out = await tenantTx(ctx.orgId, (tx) => fn(execCtx(tx, ctx.orgId, { actorId: ctx.membershipId, effects })), { timeout: 60_000 });
  await flushEffects(effects);
  return out;
}

async function managerCtx() {
  const ctx = await getCtx();
  if (!canManageAdmissions(ctx)) throw new AdmissionError("FORBIDDEN");
  return ctx;
}

const id = z.string().min(5).max(40);
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** End of the given Dubai day, so a deadline "on 20 May" lasts all day. */
const endOfDubaiDay = (key: string) => new Date(new Date(`${key}T23:59:00+04:00`).getTime());
const dubaiDay = (key: string) => new Date(`${key}T00:00:00Z`);

export async function moveStageAction(input: { applicationId: string; to: string; reason?: string | null; note?: string | null; closedBy?: "SCHOOL" | "FAMILY" }): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    const v = z.object({ applicationId: id, to: z.string().max(40), reason: z.string().max(40).nullish(), note: z.string().max(300).nullish(), closedBy: z.enum(["SCHOOL", "FAMILY"]).optional() }).parse(input);
    await run(ctx, (ec) => moveStage(ec, actorOf(ctx), v.applicationId, v.to, { reason: v.reason ?? null, note: v.note ?? null, closedBy: v.closedBy }));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function makeOfferAction(input: { applicationId: string; deadline: string; section: string | null; override: boolean; overrideReason?: string | null }): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    const v = z.object({ applicationId: id, deadline: dateKey, section: z.string().max(4).nullable(), override: z.boolean(), overrideReason: z.string().max(300).nullish() }).parse(input);
    await run(ctx, (ec) => makeOffer(ec, actorOf(ctx), v.applicationId, { deadline: endOfDubaiDay(v.deadline), section: v.section, override: v.override, overrideReason: v.overrideReason ?? null }));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function extendOfferAction(input: { applicationId: string; deadline: string }): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    const v = z.object({ applicationId: id, deadline: dateKey }).parse(input);
    await run(ctx, (ec) => extendOffer(ec, actorOf(ctx), v.applicationId, endOfDubaiDay(v.deadline)));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function markPaidAction(input: { applicationId: string; reference: string | null }): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    const v = z.object({ applicationId: id, reference: z.string().max(80).nullable() }).parse(input);
    await run(ctx, async (ec) => {
      const res = await markSeatPaid(ec, { applicationId: v.applicationId, reference: v.reference, actor: actorOf(ctx), source: "staff", family: null });
      if (res === "paid") {
        const { emailFamily, loadApp } = await import("./service");
        await emailFamily(ec, await loadApp(ec.tx, ctx.orgId, v.applicationId), "paid", {}, `adm:${v.applicationId}:paid`);
      }
    });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function bookAssessmentAction(input: { applicationId: string; hostId: string; date: string; time: string; durationMin: number; locationEn?: string | null; locationAr?: string | null }): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    const v = z.object({ applicationId: id, hostId: id, date: dateKey, time: z.string().regex(/^\d{2}:\d{2}$/), durationMin: z.number().int().min(15).max(240), locationEn: z.string().max(120).nullish(), locationAr: z.string().max(120).nullish() }).parse(input);
    const startsAt = new Date(`${v.date}T${v.time}:00+04:00`);
    if (Number.isNaN(startsAt.getTime())) return { ok: false, error: "WHEN" };
    await run(ctx, (ec) => bookAssessment(ec, actorOf(ctx), v.applicationId, { hostId: v.hostId, startsAt, durationMin: v.durationMin, locationEn: v.locationEn?.trim() || null, locationAr: v.locationAr?.trim() || null }));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function recordAssessmentAction(input: { applicationId: string; outcome: string; notes: string }): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    const v = z.object({ applicationId: id, outcome: z.string().max(20), notes: z.string().max(4000) }).parse(input);
    await run(ctx, (ec) => recordAssessment(ec, actorOf(ctx), v.applicationId, { outcome: v.outcome, notes: v.notes }));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function staffMessageAction(input: { applicationId: string; body: string; visibility: "SHARED" | "STAFF" }): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    const v = z.object({ applicationId: id, body: z.string().min(1).max(4000), visibility: z.enum(["SHARED", "STAFF"]) }).parse(input);
    await run(ctx, (ec) => staffMessage(ec, actorOf(ctx), v.applicationId, { body: v.body, visibility: v.visibility }));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function reviewDocumentAction(input: { documentId: string; status: "ACCEPTED" | "REJECTED" | "RECEIVED"; note?: string | null }): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    const v = z.object({ documentId: id, status: z.enum(["ACCEPTED", "REJECTED", "RECEIVED"]), note: z.string().max(300).nullish() }).parse(input);
    await run(ctx, (ec) => reviewDocument(ec, actorOf(ctx), v.documentId, { status: v.status, note: v.note ?? null }));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setPriorityAction(input: { applicationId: string; siblingStudentIds: string[]; staffChildVerified: boolean; priorityBoost: number; reason?: string | null }): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    const v = z.object({ applicationId: id, siblingStudentIds: z.array(id).max(8), staffChildVerified: z.boolean(), priorityBoost: z.number().int().min(-3).max(3), reason: z.string().max(300).nullish() }).parse(input);
    await run(ctx, (ec) => setPriority(ec, actorOf(ctx), v.applicationId, { siblingStudentIds: v.siblingStudentIds, staffChildVerified: v.staffChildVerified, priorityBoost: v.priorityBoost, reason: v.reason ?? null }));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function enrollAction(input: { applicationId: string; homeroomClassId: string | null; section: string | null; linkStudentId: string | null; sendInvites: boolean }): Promise<Ok<{ result: EnrollResult }>> {
  try {
    const ctx = await getCtx();
    if (!canEnroll(ctx)) return { ok: false, error: "FORBIDDEN" };
    const v = z.object({ applicationId: id, homeroomClassId: id.nullable(), section: z.string().max(4).nullable(), linkStudentId: id.nullable(), sendInvites: z.boolean() }).parse(input);
    const result = await run(ctx, (ec) => enrollApplication(ec, actorOf(ctx), v.applicationId, v));
    return { ok: true, result };
  } catch (e) {
    return fail(e);
  }
}

/** Health and learning support details: medical access only, and every view is audited. */
export async function revealHealthAction(input: { applicationId: string }): Promise<Ok<{ medical: { allergies?: string; conditions?: string; medications?: string } | null; support: { needed?: boolean; details?: string; previousAssessment?: boolean } | null }>> {
  const ctx = await getCtx();
  // The school nurse and staff with sensitive-document access review health details without admissions.view.
  if (!canSeeHealth(ctx)) return { ok: false, error: "FORBIDDEN" };
  const app = await ctx.db.admissionApplication.findFirst({ where: { id: String(input.applicationId), orgId: ctx.orgId } });
  if (!app) return { ok: false, error: "NOT_FOUND" };
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "admission.health_view", entityType: "AdmissionApplication", entityId: app.id, sensitivity: "MEDICAL" });
  return { ok: true, medical: decryptJson(app.medicalEnc), support: decryptJson(app.supportEnc) };
}

/** Full Emirates ID or passport number: people.reveal_ids only, audited. */
export async function revealApplicantIdAction(input: { applicationId: string; field: "emiratesId" | "passport" }): Promise<Ok<{ value: string }>> {
  const ctx = await getCtx();
  if (!canViewAdmissions(ctx) || !canRevealIds(ctx)) return { ok: false, error: "FORBIDDEN" };
  const app = await ctx.db.admissionApplication.findFirst({ where: { id: String(input.applicationId), orgId: ctx.orgId } });
  const enc = input.field === "emiratesId" ? app?.emiratesIdEnc : app?.passportEnc;
  const value = decryptText(enc);
  if (!app || !value) return { ok: false, error: "NOT_FOUND" };
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: `admission.reveal_${input.field}`, entityType: "AdmissionApplication", entityId: app.id, sensitivity: "CONFIDENTIAL" });
  return { ok: true, value: input.field === "emiratesId" ? value.replace(/^(\d{3})(\d{4})(\d{7})(\d)$/, "$1-$2-$3-$4") : value };
}

export async function loadBoardColumnAction(input: { stage: string; filters: BoardFilters; cursor: number }) {
  const ctx = await getCtx();
  if (!canViewAdmissions(ctx)) return { ok: false as const, error: "FORBIDDEN" };
  const v = z.object({ stage: z.string().max(40), cursor: z.number().int().min(0).max(100_000), filters: z.object({ yearId: z.string().max(40), grade: z.number().int().nullable(), q: z.string().max(80).nullable(), flag: z.string().max(20).nullable() }) }).safeParse(input);
  if (!v.success) return { ok: false as const, error: "INVALID" };
  return { ok: true as const, ...(await loadBoardColumn(ctx, v.data.stage, v.data.filters, v.data.cursor)) };
}

// ---------------------------------------------------------------------------
// Settings and capacity
// ---------------------------------------------------------------------------

const stageRow = z.object({ key: z.string().max(40), labelEn: z.string().max(40).nullable(), labelAr: z.string().max(40).nullable(), hidden: z.boolean() });
const docRow = z.object({
  key: z.string().regex(DOC_KEY_RE),
  labelEn: z.string().trim().min(2).max(80),
  labelAr: z.string().trim().min(2).max(80),
  required: z.boolean(),
  minGrade: z.number().int().refine((g) => ALL_GRADE_LEVELS.includes(g)).nullable(),
  exemptNationalities: z.array(z.string().regex(/^[A-Z]{2}$/)).max(10),
  category: z.enum(DOC_CATEGORIES as unknown as [string, ...string[]]),
});

export async function saveSettingsAction(input: {
  publicOpen: boolean;
  openYearIds: string[];
  cutoffMonth: number;
  cutoffDay: number;
  admissionNoPattern: string;
  offerDays: number;
  introEn: string;
  introAr: string;
  authority: string;
  authorityLabelEn: string;
  authorityLabelAr: string;
  stages: Array<z.infer<typeof stageRow>>;
  documentTypes: Array<z.infer<typeof docRow>>;
}): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    const v = z
      .object({
        publicOpen: z.boolean(),
        openYearIds: z.array(id).max(4),
        cutoffMonth: z.number().int(),
        cutoffDay: z.number().int(),
        admissionNoPattern: z.string().max(40),
        offerDays: z.number().int().min(1).max(60),
        introEn: z.string().max(600),
        introAr: z.string().max(600),
        authority: z.enum(AUTHORITIES),
        authorityLabelEn: z.string().max(60),
        authorityLabelAr: z.string().max(60),
        stages: z.array(stageRow).max(SYSTEM_STAGES.length + MAX_CUSTOM_STAGES),
        documentTypes: z.array(docRow).min(1).max(20),
      })
      .parse(input);
    if (!validCutoff(v.cutoffMonth, v.cutoffDay)) return { ok: false, error: "CUTOFF" };
    if (patternProblem(v.admissionNoPattern)) return { ok: false, error: `PATTERN_${patternProblem(v.admissionNoPattern)}` };
    if (new Set(v.documentTypes.map((d) => d.key)).size !== v.documentTypes.length) return { ok: false, error: "DOC_DUPLICATE" };
    for (const s of v.stages) {
      const custom = CUSTOM_STAGE_RE.test(s.key);
      if (!custom && !(SYSTEM_STAGES as readonly string[]).includes(s.key)) return { ok: false, error: "STAGE" };
      if (custom && !s.labelEn?.trim()) return { ok: false, error: "STAGE_LABEL" };
      if (s.hidden && !custom && !OPTIONAL_STAGES.includes(s.key)) return { ok: false, error: "STAGE_REQUIRED" };
    }
    const years = await ctx.db.academicYear.findMany({ where: { orgId: ctx.orgId, id: { in: v.openYearIds } }, select: { id: true } });
    if (years.length !== v.openYearIds.length) return { ok: false, error: "YEAR" };
    // A custom stage still holding applications cannot be removed.
    const before = await ctx.db.admissionSettings.findUnique({ where: { orgId: ctx.orgId } });
    const removed = ((before?.stages as Array<{ key: string }> | null) ?? []).map((s) => s.key).filter((k) => CUSTOM_STAGE_RE.test(k) && !v.stages.some((s) => s.key === k));
    if (removed.length && (await ctx.db.admissionApplication.count({ where: { orgId: ctx.orgId, stage: { in: removed } } }))) return { ok: false, error: "STAGE_IN_USE" };
    const data = {
      publicOpen: v.publicOpen,
      openYearIds: v.openYearIds,
      cutoffMonth: v.cutoffMonth,
      cutoffDay: v.cutoffDay,
      admissionNoPattern: v.admissionNoPattern.trim(),
      offerDays: v.offerDays,
      introEn: v.introEn.trim() || null,
      introAr: v.introAr.trim() || null,
      authority: v.authority,
      authorityLabelEn: v.authorityLabelEn.trim() || null,
      authorityLabelAr: v.authorityLabelAr.trim() || null,
      stages: v.stages.map((s) => ({ key: s.key, labelEn: s.labelEn?.trim() || null, labelAr: s.labelAr?.trim() || null, hidden: s.hidden })) as Prisma.InputJsonValue,
      documentTypes: v.documentTypes as Prisma.InputJsonValue,
      updatedById: ctx.membershipId,
    };
    await tenantTx(ctx.orgId, async (tx) => {
      await tx.admissionSettings.upsert({ where: { orgId: ctx.orgId }, create: { orgId: ctx.orgId, ...data }, update: data });
      await audit(tx, ctx.orgId, {
        actorId: ctx.membershipId,
        actorUserId: ctx.user.id,
        action: "admission.settings",
        entityType: "AdmissionSettings",
        entityId: ctx.orgId,
        meta: { before: before ? { publicOpen: before.publicOpen, pattern: before.admissionNoPattern, cutoff: `${before.cutoffMonth}-${before.cutoffDay}` } : null, after: { publicOpen: v.publicOpen, pattern: data.admissionNoPattern, cutoff: `${v.cutoffMonth}-${v.cutoffDay}`, stages: v.stages.length, documentTypes: v.documentTypes.length } },
      });
    });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveCapacityAction(input: { academicYearId: string; rows: Array<{ gradeLevel: number; sectionSeats: number[]; seatFee: string }> }): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    const v = z
      .object({
        academicYearId: id,
        rows: z.array(z.object({ gradeLevel: z.number().int().refine((g) => ALL_GRADE_LEVELS.includes(g)), sectionSeats: z.array(z.number().int().min(1).max(60)).max(16), seatFee: z.string().max(14) })).max(ALL_GRADE_LEVELS.length),
      })
      .parse(input);
    const year = await ctx.db.academicYear.findFirst({ where: { id: v.academicYearId, orgId: ctx.orgId } });
    if (!year) return { ok: false, error: "YEAR" };
    const parsed = v.rows.map((r) => ({ ...r, seatFeeFils: r.seatFee.trim() ? aedToFils(r.seatFee) : 0 }));
    if (parsed.some((r) => r.seatFeeFils === null)) return { ok: false, error: "AMOUNT" };
    await tenantTx(ctx.orgId, async (tx) => {
      const before = await tx.admissionCapacity.findMany({ where: { orgId: ctx.orgId, academicYearId: year.id } });
      for (const r of parsed) {
        if (!r.sectionSeats.length) {
          await tx.admissionCapacity.deleteMany({ where: { orgId: ctx.orgId, academicYearId: year.id, gradeLevel: r.gradeLevel } });
          continue;
        }
        await tx.admissionCapacity.upsert({
          where: { orgId_academicYearId_gradeLevel: { orgId: ctx.orgId, academicYearId: year.id, gradeLevel: r.gradeLevel } },
          create: { orgId: ctx.orgId, academicYearId: year.id, gradeLevel: r.gradeLevel, sectionSeats: r.sectionSeats, seatFeeFils: r.seatFeeFils! },
          update: { sectionSeats: r.sectionSeats, seatFeeFils: r.seatFeeFils! },
        });
      }
      const total = (rows: Array<{ sectionSeats: number[] }>) => rows.reduce((s, r) => s + r.sectionSeats.reduce((a, b) => a + b, 0), 0);
      await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "admission.capacity", entityType: "AcademicYear", entityId: year.id, meta: { before: { grades: before.length, seats: total(before) }, after: { grades: parsed.filter((r) => r.sectionSeats.length).length, seats: total(parsed) } } });
    });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Re-enrollment and withdrawals
// ---------------------------------------------------------------------------

export async function openWindowAction(input: { academicYearId: string; opensOn: string; closesOn: string; messageEn: string; messageAr: string; reminderDays: number[] }): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    const v = z.object({ academicYearId: id, opensOn: dateKey, closesOn: dateKey, messageEn: z.string().max(1000), messageAr: z.string().max(1000), reminderDays: z.array(z.number().int().min(1).max(30)).max(4) }).parse(input);
    await run(ctx, (ec) => openWindow(ec, actorOf(ctx), { academicYearId: v.academicYearId, opensAt: new Date(`${v.opensOn}T00:00:00+04:00`), closesAt: endOfDubaiDay(v.closesOn), messageEn: v.messageEn, messageAr: v.messageAr, reminderDays: v.reminderDays }));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updateWindowAction(input: { windowId: string; closesOn?: string | null; close?: boolean }): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    const v = z.object({ windowId: id, closesOn: dateKey.nullish(), close: z.boolean().optional() }).parse(input);
    await run(ctx, (ec) => updateWindow(ec, actorOf(ctx), v.windowId, { closesAt: v.closesOn ? endOfDubaiDay(v.closesOn) : undefined, close: v.close }));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function sendRemindersAction(input: { windowId: string }): Promise<Ok<{ sent: number }>> {
  try {
    const ctx = await managerCtx();
    const sent = await run(ctx, (ec) => sendRemindersNow(ec, actorOf(ctx), String(input.windowId)));
    return { ok: true, sent };
  } catch (e) {
    return fail(e);
  }
}

const responseSchema = z.object({ windowId: id, studentId: id, intent: z.enum(["RETURNING", "LEAVING"]), reasonKey: z.string().max(40).nullable(), reasonNote: z.string().max(500).nullable(), leavingDate: dateKey.nullable() });

/** A parent's answer for their own child, or staff recording an answer given by phone. */
export async function reenrollmentResponseAction(input: z.input<typeof responseSchema>): Promise<Ok> {
  try {
    const ctx = await getCtx();
    const staff = canManageAdmissions(ctx);
    if (!staff && !(ctx.isParent && ctx.can("family.portal"))) return { ok: false, error: "FORBIDDEN" };
    const v = responseSchema.parse(input);
    if (v.intent === "LEAVING" && !(LEAVING_REASONS as readonly string[]).includes(v.reasonKey ?? "")) return { ok: false, error: "REASON" };
    await run(ctx, (ec) => respond(ec, { membershipId: ctx.membershipId, userId: ctx.user.id, staff }, { ...v, leavingDate: v.leavingDate ? dubaiDay(v.leavingDate) : null }));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function planWithdrawalAction(input: { studentId: string; leavingDate: string; reasonKey: string; reasonNote: string; destination: string }): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    const v = z.object({ studentId: id, leavingDate: dateKey, reasonKey: z.string().max(40), reasonNote: z.string().max(500), destination: z.string().max(160) }).parse(input);
    await run(ctx, (ec) => planWithdrawal(ec, actorOf(ctx), { studentId: v.studentId, leavingDate: dubaiDay(v.leavingDate), reasonKey: v.reasonKey, reasonNote: v.reasonNote, destination: v.destination }));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function completeWithdrawalAction(input: { withdrawalId: string }): Promise<Ok<{ tcNumber: string }>> {
  try {
    const ctx = await getCtx();
    if (!canEnroll(ctx)) return { ok: false, error: "FORBIDDEN" };
    const res = await run(ctx, (ec) => completeWithdrawal(ec, actorOf(ctx), String(input.withdrawalId)));
    return { ok: true, tcNumber: res.tcNumber };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelWithdrawalAction(input: { withdrawalId: string }): Promise<Ok> {
  try {
    const ctx = await managerCtx();
    await run(ctx, (ec) => cancelWithdrawal(ec, actorOf(ctx), String(input.withdrawalId)));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Student search for the leaver form and sibling matching (staff with admissions.manage). */
export async function searchStudentsAction(input: { q: string }) {
  const ctx = await getCtx();
  if (!canManageAdmissions(ctx)) return [];
  const q = String(input.q ?? "").trim().slice(0, 60);
  if (q.length < 2) return [];
  const rows = await ctx.db.student.findMany({
    where: { orgId: ctx.orgId, status: { in: ["ACTIVE", "INACTIVE"] }, OR: [{ firstNameEn: { contains: q, mode: "insensitive" } }, { lastNameEn: { contains: q, mode: "insensitive" } }, { firstNameAr: { contains: q } }, { lastNameAr: { contains: q } }, { studentNo: { contains: q, mode: "insensitive" } }] },
    orderBy: [{ lastNameEn: "asc" }],
    take: 12,
    select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, section: true, studentNo: true },
  });
  return rows;
}

/** Government registration (for example SPEA DALEEL): status, the authority's reference and the decision date. */
export async function updateRegistrationAction(input: { registrationId: string; status: string; reference: string | null; date: string | null; note: string | null }): Promise<Ok> {
  try {
    const ctx = await getCtx();
    if (!canEnroll(ctx)) return { ok: false, error: "FORBIDDEN" };
    const v = z.object({ registrationId: id, status: z.enum(REG_STATUSES), reference: z.string().max(60).nullable(), date: dateKey.nullable(), note: z.string().max(500).nullable() }).parse(input);
    await run(ctx, (ec) => updateRegistration(ec, actorOf(ctx), v.registrationId, { status: v.status, reference: v.reference, date: v.date ? dubaiDay(v.date) : null, note: v.note }));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
