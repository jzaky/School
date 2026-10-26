// Staff side of an application: stages, offers, assessments, documents, priority and the conversation.
// Every function runs inside a tenant transaction (ExecCtx) and writes an AdmissionEvent and an AuditEvent.
// Families are told by email (bilingual, no message text, no health details); the demo school never sends email.
import type { AdmissionApplication, MessageVisibility } from "@prisma/client";
import { identityDb } from "@/lib/tenant-db";
import type { ExecCtx, Tx } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { notify } from "@/server/notify/notify";
import { AdmissionError } from "./access";
import { ASSESSMENT_OUTCOMES, CLOSE_REASONS } from "./config";
import { mailFamily, type FamilyMail } from "./email";
import { recordEvent } from "./events";
import { childNameBoth, dateBoth, dateTimeBoth, gradeBoth } from "./labels";
import { canOffer, sectionName } from "./rules";
import { createSeatBookingCharge } from "./seat-booking";
import { gradeSeats } from "./capacity";
import { admissionYears, loadSettings } from "./settings";
import { checkMove, phaseOf } from "./stages";
import { ASSESSMENT_TYPE_KEY, ensureAdmissionSetup } from "./templates";

export type Actor = { membershipId: string; userId: string };

export async function loadApp(tx: Tx, orgId: string, id: string): Promise<AdmissionApplication> {
  const app = await tx.admissionApplication.findFirst({ where: { id, orgId } });
  if (!app) throw new AdmissionError("NOT_FOUND");
  return app;
}

/** Email the applying family (skipped for drafts; quiet in the demo school, whose addresses are fictional). */
export async function emailFamily(ec: ExecCtx, app: AdmissionApplication, kind: FamilyMail, vars: Record<string, string | { en: string; ar: string }>, key: string) {
  const org = await ec.tx.organization.findUnique({ where: { id: ec.orgId }, select: { slug: true, nameEn: true, nameAr: true, isDemo: true, defaultLocale: true } });
  const user = await identityDb.user.findUnique({ where: { id: app.applicantUserId }, select: { email: true, locale: true } });
  if (!org || !user) return false;
  const quietEc: ExecCtx = { ...ec, quiet: ec.quiet || org.isDemo };
  return mailFamily(quietEc, {
    to: user.email,
    kind,
    locale: (user.locale ?? org.defaultLocale) as "en" | "ar",
    vars: { school: { en: org.nameEn, ar: org.nameAr }, child: childNameBoth(app), number: app.number, ...vars },
    href: `/apply/${org.slug}/${app.id}`,
    idempotencyKey: key,
  });
}

async function seatFeeFor(tx: Tx, orgId: string, app: AdmissionApplication) {
  if (app.seatFeeFils !== null) return app.seatFeeFils;
  const cap = await tx.admissionCapacity.findUnique({ where: { orgId_academicYearId_gradeLevel: { orgId, academicYearId: app.academicYearId, gradeLevel: app.gradeLevel } } });
  return cap?.seatFeeFils ?? 0;
}

/** Move without extra input: review stages, waitlist, recording an acceptance, declining or withdrawing (with a reason). */
export async function moveStage(ec: ExecCtx, actor: Actor, id: string, to: string, opts: { reason?: string | null; note?: string | null; closedBy?: "SCHOOL" | "FAMILY" } = {}) {
  const { tx, orgId, now } = ec;
  const app = await loadApp(tx, orgId, id);
  const s = await loadSettings(tx, orgId);
  const fee = await seatFeeFor(tx, orgId, app);
  const check = checkMove(app.stage, to, s.stages, { seatFeeRequired: fee > 0 && !s.stages.find((x) => x.key === "SEAT_PAID")?.hidden });
  if (!check.ok) throw new AdmissionError(check.error);
  if (check.action === "offer" || check.action === "paid" || check.action === "enroll") throw new AdmissionError(`NEEDS_${check.action.toUpperCase()}`);
  const reason = (opts.reason ?? "").trim();
  if (check.action === "reason" && !(CLOSE_REASONS as readonly string[]).includes(reason)) throw new AdmissionError("REASON");
  const pt = phaseOf(to, s.stages);
  const pf = phaseOf(app.stage, s.stages);
  await tx.admissionApplication.update({
    where: { id: app.id },
    data: {
      stage: to,
      stageChangedAt: now,
      ...(pt === "waitlist" && !app.waitlistedAt ? { waitlistedAt: now } : {}),
      ...(pt === "closed" ? { closedBy: to === "DECLINED" ? (opts.closedBy ?? "SCHOOL") : (opts.closedBy ?? "FAMILY"), closeReason: reason } : {}),
      ...(pf === "closed" ? { closedBy: null, closeReason: null } : {}),
      // An offer taken back (moved to review or the waitlist) no longer has a deadline.
      ...(pf === "offer" && (pt === "review" || pt === "waitlist") ? { offerDeadline: null, offerSection: null } : {}),
      ...(pt === "accepted" ? { offerRespondedAt: now } : {}),
    },
  });
  await recordEvent(tx, orgId, { applicationId: app.id, kind: "stage", fromStage: app.stage, toStage: to, actorMembershipId: actor.membershipId, data: reason ? { reason, note: (opts.note ?? "").slice(0, 300) || undefined } : undefined, at: now });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "admission.stage", entityType: "AdmissionApplication", entityId: app.id, meta: { from: app.stage, to, reason: reason || undefined } });
  if (pt === "accepted") await createSeatBookingCharge(ec, app.id);
  if (pt === "waitlist" || to === "DECLINED") await emailFamily(ec, app, "update", {}, `adm:${app.id}:update:${to}:${now.getTime()}`);
  return { from: app.stage, to };
}

/** Make an offer: checks seats (unless overridden with a reason), sets the deadline and tells the family. */
export async function makeOffer(ec: ExecCtx, actor: Actor, id: string, input: { deadline: Date; section: string | null; override: boolean; overrideReason?: string | null }) {
  const { tx, orgId, now } = ec;
  const app = await loadApp(tx, orgId, id);
  const s = await loadSettings(tx, orgId);
  const check = checkMove(app.stage, "OFFER_MADE", s.stages, { seatFeeRequired: false });
  if (!check.ok) throw new AdmissionError(check.error);
  const days = (input.deadline.getTime() - now.getTime()) / 86_400_000;
  if (!(days > 0 && days <= 120)) throw new AdmissionError("DEADLINE");
  const year = (await admissionYears(tx, orgId)).find((y) => y.id === app.academicYearId);
  if (!year) throw new AdmissionError("YEAR");
  const seats = await gradeSeats(tx, orgId, year, app.gradeLevel);
  if (!canOffer(seats)) {
    if (!input.override) throw new AdmissionError("FULL");
    if (!(input.overrideReason ?? "").trim()) throw new AdmissionError("REASON");
  }
  const sections = seats.sectionSeats.map((_, i) => sectionName(i));
  const section = input.section && sections.includes(input.section) ? input.section : null;
  await tx.admissionApplication.update({
    where: { id: app.id },
    data: { stage: "OFFER_MADE", stageChangedAt: now, offerMadeAt: now, offerDeadline: input.deadline, offerSection: section, offerRespondedAt: null, seatFeeFils: seats.seatFeeFils },
  });
  await recordEvent(tx, orgId, {
    applicationId: app.id,
    kind: "offer",
    fromStage: app.stage,
    toStage: "OFFER_MADE",
    actorMembershipId: actor.membershipId,
    data: { deadline: input.deadline.toISOString(), section, override: !canOffer(seats) ? (input.overrideReason ?? "").slice(0, 300) : undefined },
    at: now,
  });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "admission.offer", entityType: "AdmissionApplication", entityId: app.id, meta: { from: app.stage, overCapacity: !canOffer(seats) } });
  await emailFamily(ec, app, "offer", { grade: gradeBoth(app.gradeLevel), year: { en: year.nameEn, ar: year.nameAr }, deadline: dateBoth(input.deadline) }, `adm:${app.id}:offer:${now.getTime()}`);
}

/** Give the family more time to answer an offer. */
export async function extendOffer(ec: ExecCtx, actor: Actor, id: string, deadline: Date) {
  const { tx, orgId, now } = ec;
  const app = await loadApp(tx, orgId, id);
  if (app.stage !== "OFFER_MADE") throw new AdmissionError("INVALID");
  if (deadline.getTime() <= now.getTime() || deadline.getTime() - now.getTime() > 120 * 86_400_000) throw new AdmissionError("DEADLINE");
  await tx.admissionApplication.update({ where: { id: app.id }, data: { offerDeadline: deadline } });
  await recordEvent(tx, orgId, { applicationId: app.id, kind: "offer", actorMembershipId: actor.membershipId, data: { extended: deadline.toISOString(), before: app.offerDeadline?.toISOString() ?? null }, at: now });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "admission.offer_extend", entityType: "AdmissionApplication", entityId: app.id, meta: { before: app.offerDeadline?.toISOString() ?? null, after: deadline.toISOString() } });
  const year = await tx.academicYear.findUnique({ where: { id: app.academicYearId }, select: { nameEn: true, nameAr: true } });
  await emailFamily(ec, app, "offer", { grade: gradeBoth(app.gradeLevel), year: { en: year?.nameEn ?? "", ar: year?.nameAr ?? "" }, deadline: dateBoth(deadline) }, `adm:${app.id}:offer-extend:${now.getTime()}`);
}

/** Book (or rebook) the assessment or interview as a meeting with a member of staff. */
export async function bookAssessment(ec: ExecCtx, actor: Actor, id: string, input: { hostId: string; startsAt: Date; durationMin: number; locationEn: string | null; locationAr: string | null }) {
  const { tx, orgId, now } = ec;
  const app = await loadApp(tx, orgId, id);
  const s = await loadSettings(tx, orgId);
  const p = phaseOf(app.stage, s.stages);
  if (p !== "review" && p !== "waitlist") throw new AdmissionError("INVALID");
  if (!(input.durationMin >= 15 && input.durationMin <= 240)) throw new AdmissionError("DURATION");
  if (input.startsAt.getTime() < now.getTime() - 3600_000 || input.startsAt.getTime() - now.getTime() > 365 * 86_400_000) throw new AdmissionError("WHEN");
  const host = await tx.membership.findFirst({ where: { id: input.hostId, orgId, status: "ACTIVE", staffProfile: { isNot: null } }, include: { user: { select: { nameEn: true, nameAr: true } } } });
  if (!host) throw new AdmissionError("HOST");
  await ensureAdmissionSetup(tx, orgId);
  const type = await tx.appointmentType.findUnique({ where: { orgId_key: { orgId, key: ASSESSMENT_TYPE_KEY } } });
  if (!type) throw new AdmissionError("TYPE");
  const endsAt = new Date(input.startsAt.getTime() + input.durationMin * 60_000);
  // Serialise bookings per host so two people cannot take the same time.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.hostId}))`;
  const clash = await tx.appointment.findFirst({
    where: { orgId, hostId: input.hostId, status: { notIn: ["CANCELLED", "NO_SHOW"] }, startsAt: { lt: endsAt }, endsAt: { gt: input.startsAt }, ...(app.assessmentAppointmentId ? { id: { not: app.assessmentAppointmentId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new AdmissionError("HOST_BUSY");
  const child = childNameBoth(app);
  const appt = await tx.appointment.create({
    data: {
      orgId,
      typeId: type.id,
      hostId: input.hostId,
      bookedById: actor.membershipId,
      studentId: null,
      startsAt: input.startsAt,
      endsAt,
      status: "CONFIRMED",
      locationEn: input.locationEn || type.locationEn,
      locationAr: input.locationAr || type.locationAr,
      notesEn: `${app.number}: ${child.en}`,
      rescheduledFromId: app.assessmentAppointmentId,
      createdAt: now,
    },
  });
  await tx.appointmentAttendee.createMany({ data: [{ orgId, appointmentId: appt.id, membershipId: input.hostId }, ...(actor.membershipId !== input.hostId ? [{ orgId, appointmentId: appt.id, membershipId: actor.membershipId }] : [])] });
  if (app.assessmentAppointmentId) await tx.appointment.updateMany({ where: { id: app.assessmentAppointmentId, orgId }, data: { status: "CANCELLED", cancelReason: "Rescheduled" } });
  const visible = s.stages.find((x) => x.key === "ASSESSMENT_BOOKED" && !x.hidden);
  const moveTo = visible && p === "review" && ["NEW", "DOCUMENTS_PENDING"].includes(app.stage) ? "ASSESSMENT_BOOKED" : null;
  await tx.admissionApplication.update({ where: { id: app.id }, data: { assessmentAppointmentId: appt.id, ...(moveTo ? { stage: moveTo, stageChangedAt: now } : {}) } });
  await recordEvent(tx, orgId, { applicationId: app.id, kind: "assessment", fromStage: moveTo ? app.stage : null, toStage: moveTo, actorMembershipId: actor.membershipId, data: { appointmentId: appt.id, startsAt: input.startsAt.toISOString() }, at: now });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "admission.assessment_book", entityType: "AdmissionApplication", entityId: app.id, meta: { appointmentId: appt.id } });
  const when = dateTimeBoth(input.startsAt);
  await notify(ec, { recipients: [input.hostId], templateKey: "meeting_booked", vars: { student: child, when }, href: `/meetings/${appt.id}`, channels: ["IN_APP", "EMAIL"], idempotencyBase: `appt:${appt.id}:host` });
  if (!ec.quiet) {
    for (const [label, hours] of [["24h", 24], ["1h", 1]] as const) {
      const delay = input.startsAt.getTime() - hours * 3600_000 - now.getTime();
      if (delay > 0) ec.effects.push({ kind: "job", queue: "reminders", name: "appointment", data: { orgId, appointmentId: appt.id, window: label }, jobId: `reminder:${appt.id}:${label}`, delayMs: delay });
    }
  }
  await emailFamily(ec, app, "assessment", { when, location: { en: appt.locationEn ?? "", ar: appt.locationAr ?? appt.locationEn ?? "" } }, `adm:${app.id}:assessment:${appt.id}`);
  return appt;
}

/** Record the assessment outcome; moves the application to "Assessed" when the school uses that stage. */
export async function recordAssessment(ec: ExecCtx, actor: Actor, id: string, input: { outcome: string; notes: string }) {
  const { tx, orgId, now } = ec;
  const app = await loadApp(tx, orgId, id);
  if (!(ASSESSMENT_OUTCOMES as readonly string[]).includes(input.outcome)) throw new AdmissionError("OUTCOME");
  const s = await loadSettings(tx, orgId);
  const p = phaseOf(app.stage, s.stages);
  if (p !== "review" && p !== "waitlist") throw new AdmissionError("INVALID");
  const visible = s.stages.find((x) => x.key === "ASSESSED" && !x.hidden);
  const moveTo = visible && p === "review" && app.stage !== "ASSESSED" ? "ASSESSED" : null;
  await tx.admissionApplication.update({ where: { id: app.id }, data: { assessmentOutcome: input.outcome, assessmentNotes: input.notes.trim().slice(0, 4000) || null, ...(moveTo ? { stage: moveTo, stageChangedAt: now } : {}) } });
  if (app.assessmentAppointmentId) await tx.appointment.updateMany({ where: { id: app.assessmentAppointmentId, orgId, status: { in: ["CONFIRMED", "SCHEDULED"] }, startsAt: { lte: now } }, data: { status: "COMPLETED" } });
  await recordEvent(tx, orgId, { applicationId: app.id, kind: "assessment", fromStage: moveTo ? app.stage : null, toStage: moveTo, actorMembershipId: actor.membershipId, data: { outcome: input.outcome }, at: now });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "admission.assessment_record", entityType: "AdmissionApplication", entityId: app.id, meta: { outcome: input.outcome } });
}

export const STAFF_MESSAGE_MAX = 4000;

/** A message to the family (SHARED, emailed without its text) or a staff-only note (STAFF, never shown to families). */
export async function staffMessage(ec: ExecCtx, actor: Actor, id: string, input: { body: string; visibility: MessageVisibility }) {
  const { tx, orgId, now } = ec;
  const body = input.body.trim();
  if (!body || body.length > STAFF_MESSAGE_MAX) throw new AdmissionError("MESSAGE");
  if (input.visibility !== "SHARED" && input.visibility !== "STAFF") throw new AdmissionError("VISIBILITY");
  const app = await loadApp(tx, orgId, id);
  if (app.stage === "DRAFT" && input.visibility === "SHARED") throw new AdmissionError("DRAFT");
  const msg = await tx.admissionMessage.create({ data: { orgId, applicationId: app.id, authorMembershipId: actor.membershipId, visibility: input.visibility, body, createdAt: now } });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "admission.message", entityType: "AdmissionApplication", entityId: app.id, meta: { visibility: input.visibility } });
  if (input.visibility === "SHARED") await emailFamily(ec, app, "message", {}, `admmsg:${msg.id}`);
  return msg;
}

/** Accept or reject an uploaded document. A rejected document asks the family for a new one. */
export async function reviewDocument(ec: ExecCtx, actor: Actor, docId: string, input: { status: "ACCEPTED" | "REJECTED" | "RECEIVED"; note: string | null }) {
  const { tx, orgId, now } = ec;
  const doc = await tx.admissionDocument.findFirst({ where: { id: docId, orgId } });
  if (!doc) throw new AdmissionError("NOT_FOUND");
  await tx.admissionDocument.update({ where: { id: doc.id }, data: { status: input.status, reviewNote: (input.note ?? "").trim().slice(0, 300) || null } });
  await recordEvent(tx, orgId, { applicationId: doc.applicationId, kind: "document", actorMembershipId: actor.membershipId, data: { typeKey: doc.typeKey, status: input.status }, at: now });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "admission.document_review", entityType: "AdmissionDocument", entityId: doc.id, meta: { from: doc.status, to: input.status } });
  if (input.status === "REJECTED") {
    const app = await loadApp(tx, orgId, doc.applicationId);
    await emailFamily(ec, app, "update", {}, `adm:${app.id}:doc:${doc.id}:rejected`);
  }
}

/** Waitlist priority: confirmed siblings, a verified staff child and a staff adjustment with a reason. */
export async function setPriority(ec: ExecCtx, actor: Actor, id: string, input: { siblingStudentIds: string[]; staffChildVerified: boolean; priorityBoost: number; reason: string | null }) {
  const { tx, orgId, now } = ec;
  const app = await loadApp(tx, orgId, id);
  const ids = [...new Set(input.siblingStudentIds)].slice(0, 8);
  if (ids.length) {
    const found = await tx.student.count({ where: { orgId, id: { in: ids } } });
    if (found !== ids.length) throw new AdmissionError("SIBLING");
  }
  if (!Number.isInteger(input.priorityBoost) || input.priorityBoost < -3 || input.priorityBoost > 3) throw new AdmissionError("BOOST");
  const reason = (input.reason ?? "").trim().slice(0, 300);
  if (input.priorityBoost !== app.priorityBoost && !reason) throw new AdmissionError("REASON");
  await tx.admissionApplication.update({ where: { id: app.id }, data: { siblingStudentIds: ids, staffChildVerified: input.staffChildVerified, priorityBoost: input.priorityBoost } });
  const meta = { siblings: { before: app.siblingStudentIds.length, after: ids.length }, staffChild: { before: app.staffChildVerified, after: input.staffChildVerified }, boost: { before: app.priorityBoost, after: input.priorityBoost } };
  await recordEvent(tx, orgId, { applicationId: app.id, kind: "priority", actorMembershipId: actor.membershipId, data: { ...meta, reason: reason || undefined }, at: now });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "admission.priority", entityType: "AdmissionApplication", entityId: app.id, meta });
}

/** Section letters for a grade (from capacity), for offers and enrollment. */
export function sectionsOf(sectionSeats: number[]) {
  return sectionSeats.map((seats, i) => ({ name: sectionName(i), seats }));
}
