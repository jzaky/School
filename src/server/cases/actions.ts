"use server";

import { revalidatePath } from "next/cache";
import type { CaseNoteKind, CaseStatus, ParentNotifyDecision, Priority } from "@prisma/client";
import { getCtx, type Ctx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { notify } from "@/server/notify/notify";
import { audit } from "@/server/audit/audit";
import { caseAccess, SENSITIVE } from "@/server/access/case-access";

type Result = { ok: true } | { ok: false; error: string };

async function loadForWrite(ctx: Ctx, caseId: string) {
  const c = await ctx.db.case.findUnique({ where: { id: caseId } });
  if (!c) return null;
  const access = await caseAccess(ctx, c);
  if (access.level !== "full") return null;
  const canManage = c.sensitivity === "SAFEGUARDING" ? ctx.can("safeguarding.manage") || access.via === "grant" || access.via === "assignee" : ctx.can("cases.manage") || access.via === "assignee" || access.via === "participant";
  return { c, access, canManage };
}

function done(caseId: string): Result {
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

const KIND_LABEL: Record<CaseNoteKind, { en: string; ar: string }> = {
  NOTE: { en: "Note added", ar: "تمت إضافة ملاحظة" },
  DECISION: { en: "Decision recorded", ar: "تم تسجيل قرار" },
  CONTACT: { en: "Contact recorded", ar: "تم تسجيل تواصل" },
  ACTION: { en: "Action recorded", ar: "تم تسجيل إجراء" },
  SYSTEM: { en: "System note", ar: "ملاحظة من النظام" },
};

/** Notes are append-only. There is no delete; amendments create a new version. */
export async function addNoteAction(input: { caseId: string; kind: CaseNoteKind; body: string; occurredAt?: string }): Promise<Result> {
  const ctx = await getCtx();
  const w = await loadForWrite(ctx, input.caseId);
  if (!w?.canManage) return { ok: false, error: "FORBIDDEN" };
  if (!input.body.trim()) return { ok: false, error: "EMPTY" };
  await tenantTx(ctx.orgId, async (tx) => {
    const when = input.occurredAt ? new Date(input.occurredAt) : new Date();
    const note = await tx.caseNote.create({ data: { orgId: ctx.orgId, caseId: w.c.id, authorId: ctx.membershipId, kind: input.kind, occurredAt: when } });
    await tx.caseNoteVersion.create({ data: { orgId: ctx.orgId, noteId: note.id, version: 1, body: input.body.trim(), editedById: ctx.membershipId } });
    await tx.timelineEvent.create({ data: { orgId: ctx.orgId, caseId: w.c.id, studentId: w.c.studentId, actorId: ctx.membershipId, kind: `note_${input.kind.toLowerCase()}`, titleEn: KIND_LABEL[input.kind].en, titleAr: KIND_LABEL[input.kind].ar, staffOnly: true, sensitivity: w.c.sensitivity } });
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, action: "case.note.add", entityType: "Case", entityId: w.c.id, sensitivity: w.c.sensitivity } });
  });
  return done(input.caseId);
}

export async function amendNoteAction(input: { noteId: string; body: string; reason: string }): Promise<Result> {
  const ctx = await getCtx();
  const note = await ctx.db.caseNote.findUnique({ where: { id: input.noteId } });
  if (!note) return { ok: false, error: "NOT_FOUND" };
  const w = await loadForWrite(ctx, note.caseId);
  if (!w?.canManage) return { ok: false, error: "FORBIDDEN" };
  if (!input.reason.trim() || !input.body.trim()) return { ok: false, error: "REASON_REQUIRED" };
  await tenantTx(ctx.orgId, async (tx) => {
    const next = note.currentVersion + 1;
    await tx.caseNoteVersion.create({ data: { orgId: ctx.orgId, noteId: note.id, version: next, body: input.body.trim(), editedById: ctx.membershipId, reason: input.reason.trim() } });
    await tx.caseNote.update({ where: { id: note.id }, data: { currentVersion: next } });
    await tx.timelineEvent.create({ data: { orgId: ctx.orgId, caseId: note.caseId, studentId: w.c.studentId, actorId: ctx.membershipId, kind: "note_amended", titleEn: `Note amended (version ${next})`, titleAr: `تم تعديل ملاحظة (الإصدار ${next})`, bodyEn: input.reason.trim(), bodyAr: input.reason.trim(), staffOnly: true, sensitivity: w.c.sensitivity } });
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, action: "case.note.amend", entityType: "CaseNote", entityId: note.id, sensitivity: w.c.sensitivity, reason: input.reason.trim() } });
  });
  return done(note.caseId);
}

export async function updateCaseAction(input: { caseId: string; status?: CaseStatus; priority?: Priority; assigneeId?: string; nextFollowUpAt?: string | null }): Promise<Result> {
  const ctx = await getCtx();
  const w = await loadForWrite(ctx, input.caseId);
  if (!w?.canManage) return { ok: false, error: "FORBIDDEN" };
  const effects: Effect[] = [];
  await tenantTx(ctx.orgId, async (tx) => {
    const data: Record<string, unknown> = {};
    const events: Array<{ en: string; ar: string }> = [];
    if (input.status && input.status !== w.c.status) {
      data.status = input.status;
      if (input.status === "RESOLVED") data.resolvedAt = new Date();
      if (input.status === "CLOSED") data.closedAt = new Date();
      events.push({ en: `Status changed to ${input.status.toLowerCase().replace("_", " ")}`, ar: "تم تغيير حالة الملف" });
    }
    if (input.priority && input.priority !== w.c.priority) {
      data.priority = input.priority;
      events.push({ en: `Priority set to ${input.priority.toLowerCase()}`, ar: "تم تغيير الأولوية" });
    }
    if (input.nextFollowUpAt !== undefined) {
      data.nextFollowUpAt = input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null;
      events.push({ en: "Follow-up date updated", ar: "تم تحديث موعد المتابعة" });
    }
    if (input.assigneeId && input.assigneeId !== w.c.assigneeId) {
      data.assigneeId = input.assigneeId;
      await tx.caseParticipant.create({ data: { orgId: ctx.orgId, caseId: w.c.id, membershipId: input.assigneeId, role: "ASSIGNEE" } });
      events.push({ en: "Case reassigned", ar: "تمت إعادة إسناد الحالة" });
      await notify(execCtx(tx, ctx.orgId, { effects }), {
        recipients: [input.assigneeId],
        templateKey: "case_assigned",
        vars: { title: { en: w.c.titleEn, ar: w.c.titleAr }, student: { en: "", ar: "" } },
        href: `/cases/${w.c.id}`,
        sensitivity: w.c.sensitivity,
        idempotencyBase: `case:${w.c.id}:assign:${input.assigneeId}:${Date.now()}`,
      });
    }
    await tx.case.update({ where: { id: w.c.id }, data });
    for (const e of events) {
      await tx.timelineEvent.create({ data: { orgId: ctx.orgId, caseId: w.c.id, studentId: w.c.studentId, actorId: ctx.membershipId, kind: "status", titleEn: e.en, titleAr: e.ar, staffOnly: true, sensitivity: w.c.sensitivity } });
    }
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, action: "case.update", entityType: "Case", entityId: w.c.id, sensitivity: w.c.sensitivity, meta: input as never } });
  });
  await flushEffects(effects);
  return done(input.caseId);
}

/** Parent notification on sensitive cases is a recorded decision with a reason (rule 7). */
export async function recordParentDecisionAction(input: { caseId: string; decision: ParentNotifyDecision; reason: string; guardianIds: string[]; message?: string }): Promise<Result> {
  const ctx = await getCtx();
  const w = await loadForWrite(ctx, input.caseId);
  if (!w?.canManage) return { ok: false, error: "FORBIDDEN" };
  if (!input.reason.trim()) return { ok: false, error: "REASON_REQUIRED" };
  const effects: Effect[] = [];
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.parentNotificationDecision.create({ data: { orgId: ctx.orgId, caseId: w.c.id, decision: input.decision, reason: input.reason.trim(), guardianIds: input.guardianIds, decidedById: ctx.membershipId } });
    await tx.timelineEvent.create({
      data: {
        orgId: ctx.orgId,
        caseId: w.c.id,
        studentId: w.c.studentId,
        actorId: ctx.membershipId,
        kind: "note_decision",
        titleEn: input.decision === "NOTIFY" ? "Decision: notify parents" : input.decision === "DEFER" ? "Decision: defer telling parents" : "Decision: do not notify parents",
        titleAr: input.decision === "NOTIFY" ? "قرار: إبلاغ ولي الأمر" : input.decision === "DEFER" ? "قرار: تأجيل إبلاغ ولي الأمر" : "قرار: عدم إبلاغ ولي الأمر",
        bodyEn: input.reason.trim(),
        bodyAr: input.reason.trim(),
        staffOnly: true,
        sensitivity: w.c.sensitivity,
      },
    });
    if (input.decision === "NOTIFY" && input.guardianIds.length) {
      const guardians = await tx.guardian.findMany({ where: { id: { in: input.guardianIds } } });
      const student = await tx.student.findUnique({ where: { id: w.c.studentId } });
      const msg = input.message?.trim() || (SENSITIVE.includes(w.c.sensitivity) ? "The school would like to talk with you. Please expect a call from us today." : "The school has an update for you.");
      for (const g of guardians) {
        await tx.message.create({ data: { orgId: ctx.orgId, caseId: w.c.id, channel: "EMAIL", fromId: ctx.membershipId, toGuardianId: g.id, toLabel: `${g.firstNameEn} ${g.lastNameEn}`, subject: "An update from school", body: msg } });
      }
      await notify(execCtx(tx, ctx.orgId, { effects }), {
        recipients: guardians.map((g) => g.membershipId).filter(Boolean) as string[],
        templateKey: "parent_update",
        vars: { student: { en: student ? `${student.firstNameEn}` : "", ar: student ? `${student.firstNameAr}` : "" }, message: { en: msg, ar: msg } },
        href: null,
        channels: ["IN_APP", "EMAIL"],
        idempotencyBase: `case:${w.c.id}:parent:${Date.now()}`,
      });
    }
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, action: "case.parent_notification", entityType: "Case", entityId: w.c.id, sensitivity: w.c.sensitivity, reason: input.reason.trim(), meta: { decision: input.decision } as never } });
  });
  await flushEffects(effects);
  return done(input.caseId);
}

export async function addExternalReferralAction(input: { caseId: string; agencyEn: string; referredAt: string; referenceNo?: string; contactName?: string; contactPhone?: string; contactEmail?: string; notes?: string }): Promise<Result> {
  const ctx = await getCtx();
  const w = await loadForWrite(ctx, input.caseId);
  if (!w?.canManage) return { ok: false, error: "FORBIDDEN" };
  if (!input.agencyEn.trim()) return { ok: false, error: "AGENCY_REQUIRED" };
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.externalReferral.create({
      data: { orgId: ctx.orgId, caseId: w.c.id, agencyEn: input.agencyEn.trim(), referredAt: new Date(input.referredAt), referenceNo: input.referenceNo || null, contactName: input.contactName || null, contactPhone: input.contactPhone || null, contactEmail: input.contactEmail || null, notes: input.notes || null, createdById: ctx.membershipId },
    });
    await tx.timelineEvent.create({ data: { orgId: ctx.orgId, caseId: w.c.id, studentId: w.c.studentId, actorId: ctx.membershipId, kind: "note_contact", titleEn: `External referral to ${input.agencyEn.trim()}`, titleAr: `إحالة خارجية إلى ${input.agencyEn.trim()}`, bodyEn: input.referenceNo || null, bodyAr: input.referenceNo || null, staffOnly: true, sensitivity: w.c.sensitivity } });
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, action: "case.external_referral", entityType: "Case", entityId: w.c.id, sensitivity: w.c.sensitivity } });
  });
  return done(input.caseId);
}

export async function grantAccessAction(input: { caseId: string; membershipId: string; reason: string; days: number }): Promise<Result> {
  const ctx = await getCtx();
  const w = await loadForWrite(ctx, input.caseId);
  const allowed = w && (w.c.sensitivity === "SAFEGUARDING" ? ctx.can("safeguarding.manage") : w.canManage);
  if (!allowed || !w) return { ok: false, error: "FORBIDDEN" };
  if (!input.reason.trim()) return { ok: false, error: "REASON_REQUIRED" };
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.caseAccessGrant.create({ data: { orgId: ctx.orgId, caseId: w.c.id, membershipId: input.membershipId, grantedById: ctx.membershipId, reason: input.reason.trim(), expiresAt: new Date(Date.now() + Math.max(1, input.days) * 86400_000) } });
    await tx.caseParticipant.create({ data: { orgId: ctx.orgId, caseId: w.c.id, membershipId: input.membershipId, role: "TEAM" } });
    await tx.timelineEvent.create({ data: { orgId: ctx.orgId, caseId: w.c.id, studentId: w.c.studentId, actorId: ctx.membershipId, kind: "status", titleEn: "Access granted to a colleague", titleAr: "تم منح صلاحية الاطلاع لزميل", bodyEn: input.reason.trim(), bodyAr: input.reason.trim(), staffOnly: true, sensitivity: w.c.sensitivity } });
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, action: "case.grant", entityType: "Case", entityId: w.c.id, sensitivity: w.c.sensitivity, reason: input.reason.trim(), meta: { to: input.membershipId, days: input.days } as never } });
  });
  return done(input.caseId);
}

export async function revokeAccessAction(input: { grantId: string }): Promise<Result> {
  const ctx = await getCtx();
  const grant = await ctx.db.caseAccessGrant.findUnique({ where: { id: input.grantId } });
  if (!grant) return { ok: false, error: "NOT_FOUND" };
  const w = await loadForWrite(ctx, grant.caseId);
  if (!w?.canManage) return { ok: false, error: "FORBIDDEN" };
  await ctx.db.caseAccessGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: "case.grant.revoke", entityType: "Case", entityId: grant.caseId, sensitivity: w.c.sensitivity });
  return done(grant.caseId);
}

/** Emergency access to a restricted case: needs a written reason, is time-limited, alerts the DSL and is audited. */
export async function breakGlassAction(input: { caseId: string; reason: string }): Promise<Result> {
  const ctx = await getCtx();
  const c = await ctx.db.case.findUnique({ where: { id: input.caseId } });
  if (!c) return { ok: false, error: "NOT_FOUND" };
  const access = await caseAccess(ctx, c);
  if (access.level !== "none" || !access.canBreakGlass) return { ok: false, error: "FORBIDDEN" };
  if (input.reason.trim().length < 10) return { ok: false, error: "REASON_REQUIRED" };
  const effects: Effect[] = [];
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.breakGlassAccess.create({ data: { orgId: ctx.orgId, caseId: c.id, membershipId: ctx.membershipId, reason: input.reason.trim(), expiresAt: new Date(Date.now() + 60 * 60000) } });
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "case.break_glass", entityType: "Case", entityId: c.id, sensitivity: c.sensitivity, reason: input.reason.trim() } });
    await tx.timelineEvent.create({ data: { orgId: ctx.orgId, caseId: c.id, studentId: c.studentId, actorId: ctx.membershipId, kind: "status", titleEn: "Emergency access used", titleAr: "تم استخدام الوصول الطارئ", bodyEn: input.reason.trim(), bodyAr: input.reason.trim(), staffOnly: true, sensitivity: c.sensitivity } });
    const dsls = await tx.membershipRole.findMany({ where: { orgId: ctx.orgId, role: { key: { in: ["dsl", "deputy_dsl"] } } } });
    await notify(execCtx(tx, ctx.orgId, { effects }), {
      recipients: dsls.map((d) => d.membershipId),
      templateKey: "break_glass",
      vars: { actor: { en: ctx.user.nameEn, ar: ctx.user.nameAr ?? ctx.user.nameEn }, number: c.number, reason: input.reason.trim() },
      href: `/cases/${c.id}`,
      sensitivity: c.sensitivity,
      urgent: true,
      channels: ["IN_APP", "EMAIL"],
      idempotencyBase: `breakglass:${c.id}:${ctx.membershipId}:${Date.now()}`,
    });
  });
  await flushEffects(effects);
  return done(input.caseId);
}

export async function sendCaseMessageAction(input: { caseId: string; channel: "INTERNAL" | "EMAIL"; toGuardianId?: string | null; subject?: string; body: string }): Promise<Result> {
  const ctx = await getCtx();
  const w = await loadForWrite(ctx, input.caseId);
  if (!w?.canManage) return { ok: false, error: "FORBIDDEN" };
  if (!input.body.trim()) return { ok: false, error: "EMPTY" };
  if (input.channel === "EMAIL" && SENSITIVE.includes(w.c.sensitivity)) {
    // Contacting the family about a sensitive case requires a recorded NOTIFY decision first.
    const decision = await ctx.db.parentNotificationDecision.findFirst({ where: { caseId: w.c.id, decision: "NOTIFY" } });
    if (!decision) return { ok: false, error: "DECISION_REQUIRED" };
  }
  const effects: Effect[] = [];
  await tenantTx(ctx.orgId, async (tx) => {
    const guardian = input.toGuardianId ? await tx.guardian.findUnique({ where: { id: input.toGuardianId } }) : null;
    await tx.message.create({ data: { orgId: ctx.orgId, caseId: w.c.id, channel: input.channel, fromId: ctx.membershipId, toGuardianId: guardian?.id ?? null, toLabel: guardian ? `${guardian.firstNameEn} ${guardian.lastNameEn}` : null, subject: input.subject || null, body: input.body.trim() } });
    await tx.timelineEvent.create({ data: { orgId: ctx.orgId, caseId: w.c.id, studentId: w.c.studentId, actorId: ctx.membershipId, kind: "message", titleEn: input.channel === "EMAIL" ? `Email sent to ${guardian ? guardian.firstNameEn + " " + guardian.lastNameEn : "family"}` : "Internal message", titleAr: input.channel === "EMAIL" ? "تم إرسال بريد إلكتروني إلى الأسرة" : "رسالة داخلية", staffOnly: true, sensitivity: w.c.sensitivity } });
    if (input.channel === "EMAIL" && guardian?.membershipId) {
      await notify(execCtx(tx, ctx.orgId, { effects }), {
        recipients: [guardian.membershipId],
        templateKey: "parent_update",
        vars: { student: { en: "", ar: "" }, message: { en: input.body.trim(), ar: input.body.trim() } },
        channels: ["IN_APP", "EMAIL"],
        idempotencyBase: `case:${w.c.id}:msg:${Date.now()}`,
      });
    }
    if (input.channel === "INTERNAL") {
      const team = await tx.caseParticipant.findMany({ where: { caseId: w.c.id, role: { in: ["ASSIGNEE", "TEAM"] } } });
      await notify(execCtx(tx, ctx.orgId, { effects }), {
        recipients: team.map((p) => p.membershipId).filter((m): m is string => Boolean(m) && m !== ctx.membershipId),
        templateKey: "case_assigned",
        vars: { title: { en: `New message on ${w.c.number}`, ar: `رسالة جديدة على ${w.c.number}` }, student: { en: "", ar: "" } },
        href: `/cases/${w.c.id}?tab=communications`,
        channels: ["IN_APP"],
        sensitivity: w.c.sensitivity,
        idempotencyBase: `case:${w.c.id}:internal:${Date.now()}`,
      });
    }
  });
  await flushEffects(effects);
  return done(input.caseId);
}
