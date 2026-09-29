// School trips: publishing (participants, consent letters, notifications), consent decisions,
// reminders and cancellation. Every side effect is idempotent so a retry never double-sends.
import type { Trip } from "@prisma/client";
import type { ExecCtx, Tx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { audit } from "@/server/audit/audit";
import { ensureCalendarTemplates } from "./templates";

export class TripError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const TZ = "Asia/Dubai";
const fmt = (d: Date, locale: "en" | "ar", withYear = true) =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}), timeZone: TZ }).format(d);
const fmtTime = (d: Date, locale: "en" | "ar") => new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit", timeZone: TZ }).format(d);
const dayKey = (d: Date) => new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10);

export function tripDates(trip: Pick<Trip, "startsAt" | "endsAt">, locale: "en" | "ar") {
  const sameDay = dayKey(trip.startsAt) === dayKey(new Date(trip.endsAt.getTime() - 1));
  if (sameDay) return `${fmt(trip.startsAt, locale)}, ${fmtTime(trip.startsAt, locale)} - ${fmtTime(trip.endsAt, locale)}`;
  return `${fmt(trip.startsAt, locale)} - ${fmt(trip.endsAt, locale)}`;
}

function costText(cost: number | null, locale: "en" | "ar") {
  if (!cost) return locale === "ar" ? "مجانية" : "Free of charge";
  return locale === "ar" ? `${cost} درهم إماراتي` : `AED ${cost}`;
}

/** Students a trip is for: active students in the chosen grades, plus everyone enrolled in the chosen classes. */
export async function eligibleStudentIds(tx: Tx, orgId: string, trip: Pick<Trip, "gradeLevels" | "classIds">) {
  const or: object[] = [];
  if (trip.gradeLevels.length) or.push({ gradeLevel: { in: trip.gradeLevels } });
  if (trip.classIds.length) or.push({ enrollments: { some: { classId: { in: trip.classIds }, status: "ACTIVE" } } });
  if (!or.length) return [];
  const rows = await tx.student.findMany({ where: { orgId, status: "ACTIVE", OR: or }, select: { id: true }, orderBy: [{ gradeLevel: "asc" }, { lastNameEn: "asc" }] });
  return rows.map((r) => r.id);
}

/** Membership ids of the guardians who receive updates for each student. */
async function guardianMembers(tx: Tx, orgId: string, studentIds: string[]) {
  const links = await tx.guardianLink.findMany({ where: { orgId, studentId: { in: studentIds }, receivesUpdates: true }, include: { guardian: { select: { membershipId: true } } } });
  const map = new Map<string, string[]>();
  for (const l of links) {
    if (!l.guardian.membershipId) continue;
    map.set(l.studentId, [...(map.get(l.studentId) ?? []), l.guardian.membershipId]);
  }
  return map;
}

async function organizerName(tx: Tx, organizerId: string) {
  const m = await tx.membership.findUnique({ where: { id: organizerId }, include: { user: true } });
  return { en: m?.user.nameEn ?? "", ar: m?.user.nameAr ?? m?.user.nameEn ?? "" };
}

/**
 * Publish a trip (or re-publish to pick up newly eligible students). For each student this adds a
 * participant, generates the bilingual consent letter as a GENERATED document the family can see,
 * and notifies the guardians exactly once. The trip is added to the calendar.
 */
export async function publishTrip(ec: ExecCtx, input: { tripId: string; actorId: string }) {
  const { tx, orgId } = ec;
  const trip = await tx.trip.findUnique({ where: { id: input.tripId } });
  if (!trip) throw new TripError("NOT_FOUND");
  if (trip.status === "CANCELLED" || trip.status === "COMPLETED") throw new TripError("NOT_EDITABLE");
  const template = await ensureCalendarTemplates(tx, orgId);
  const category = await tx.documentCategory.findUnique({ where: { orgId_key: { orgId, key: "consent" } } });
  const studentIds = await eligibleStudentIds(tx, orgId, trip);
  if (!studentIds.length) throw new TripError("NO_STUDENTS");
  const [students, guardians, organizer, existing] = await Promise.all([
    tx.student.findMany({ where: { id: { in: studentIds } } }),
    guardianMembers(tx, orgId, studentIds),
    organizerName(tx, trip.organizerId),
    tx.tripParticipant.findMany({ where: { tripId: trip.id } }),
  ]);
  const deadline = trip.consentDeadline ?? trip.startsAt;
  const tripMerge = (locale: "en" | "ar") => ({
    "trip.title": locale === "ar" ? trip.titleAr : trip.titleEn,
    "trip.destination": locale === "ar" ? trip.destinationAr : trip.destinationEn,
    "trip.dates": tripDates(trip, locale),
    "trip.cost": costText(trip.costAed, locale),
    "trip.description": (locale === "ar" ? trip.descAr : trip.descEn) ?? "",
    "trip.deadline": fmt(deadline, locale),
    "trip.organizer": organizer[locale],
  });

  let added = 0;
  let notified = 0;
  for (const s of students) {
    let p = existing.find((e) => e.studentId === s.id);
    if (!p) {
      p = await tx.tripParticipant.create({ data: { orgId, tripId: trip.id, studentId: s.id, createdAt: ec.now } });
      added++;
    }
    if (!p.documentId) {
      const doc = await tx.document.create({
        data: {
          orgId,
          categoryId: category?.id ?? null,
          titleEn: `Trip consent letter: ${trip.titleEn}`,
          titleAr: `خطاب الموافقة على الرحلة: ${trip.titleAr}`,
          studentId: s.id,
          sensitivity: "STANDARD",
          source: "GENERATED",
          templateId: template.id,
          uploadedById: input.actorId,
          visibleToFamily: true,
          createdAt: ec.now,
        },
      });
      const student = (locale: "en" | "ar") => ({
        "student.fullName": `${s.firstNameEn} ${s.lastNameEn}`,
        "student.fullNameAr": `${s.firstNameAr} ${s.lastNameAr}`,
        "student.grade": `${s.gradeLevel}${s.section ?? ""}`,
        ...tripMerge(locale),
      });
      const version = await tx.documentVersion.create({
        data: {
          orgId,
          documentId: doc.id,
          version: 1,
          storageKey: `render:${doc.id}:1`,
          fileName: `trip-consent-${s.studentNo}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 0,
          renderData: { en: student("en"), ar: student("ar") } as never,
          output: "BILINGUAL",
          createdById: input.actorId,
          createdAt: ec.now,
        },
      });
      await tx.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
      p = await tx.tripParticipant.update({ where: { id: p.id }, data: { documentId: doc.id } });
    }
    if (!p.letterSentAt) {
      const recipients = guardians.get(s.id) ?? [];
      await notify(ec, {
        recipients,
        templateKey: "trip_consent_request",
        kind: "trip_consent",
        vars: { trip: { en: trip.titleEn, ar: trip.titleAr }, student: { en: s.firstNameEn, ar: s.firstNameAr }, date: { en: fmt(trip.startsAt, "en"), ar: fmt(trip.startsAt, "ar") }, deadline: { en: fmt(deadline, "en"), ar: fmt(deadline, "ar") } },
        href: `/trips/${trip.id}`,
        idempotencyBase: `trip:${trip.id}:${s.id}:consent`,
      });
      await tx.tripParticipant.update({ where: { id: p.id }, data: { letterSentAt: ec.now } });
      notified++;
    }
  }

  let calendarEventId = trip.calendarEventId;
  const eventData = {
    kind: "EVENT" as const,
    titleEn: trip.titleEn,
    titleAr: trip.titleAr,
    descEn: trip.destinationEn,
    descAr: trip.destinationAr,
    locationEn: trip.destinationEn,
    locationAr: trip.destinationAr,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    allDay: false,
    audience: ["staff", "student", "parent"],
    gradeLevels: [...new Set(students.map((s) => s.gradeLevel))].sort((a, b) => a - b),
    published: true,
    ownerId: trip.organizerId,
  };
  if (calendarEventId && (await tx.calendarEvent.findUnique({ where: { id: calendarEventId } }))) {
    await tx.calendarEvent.update({ where: { id: calendarEventId }, data: eventData });
  } else {
    calendarEventId = (await tx.calendarEvent.create({ data: { orgId, ...eventData, createdAt: ec.now } })).id;
  }
  await tx.trip.update({ where: { id: trip.id }, data: { status: "PUBLISHED", publishedAt: trip.publishedAt ?? ec.now, calendarEventId, templateKey: template.key } });
  await audit(tx, orgId, { actorId: input.actorId, action: trip.status === "DRAFT" ? "trip.publish" : "trip.republish", entityType: "Trip", entityId: trip.id, meta: { participants: students.length, added, notified } });
  return { participants: students.length, added, notified };
}

/** A guardian grants or declines consent for one child. Recorded with who decided and when, and audited. */
export async function decideConsent(ec: ExecCtx, input: { participantId: string; deciderMembershipId: string; decision: "GRANTED" | "DECLINED"; note?: string | null }) {
  const { tx, orgId } = ec;
  const p = await tx.tripParticipant.findUnique({ where: { id: input.participantId }, include: { trip: true } });
  if (!p) throw new TripError("NOT_FOUND");
  const link = await tx.guardianLink.findFirst({ where: { orgId, studentId: p.studentId, guardian: { membershipId: input.deciderMembershipId } } });
  if (!link) throw new TripError("FORBIDDEN");
  if (!link.canApprove) throw new TripError("CANNOT_APPROVE");
  if (p.trip.status !== "PUBLISHED") throw new TripError("NOT_OPEN");
  if (p.trip.startsAt <= ec.now) throw new TripError("STARTED");
  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
  const updated = await tx.tripParticipant.update({ where: { id: p.id }, data: { consent: input.decision, decidedById: input.deciderMembershipId, decidedAt: ec.now, noteEn: note } });
  await audit(tx, orgId, {
    actorId: input.deciderMembershipId,
    action: input.decision === "GRANTED" ? "trip.consent.granted" : "trip.consent.declined",
    entityType: "TripParticipant",
    entityId: p.id,
    meta: { tripId: p.tripId, previous: p.consent, withNote: Boolean(note) },
  });
  return updated;
}

/** Remind guardians of pending students. At most once per trip per Dubai day. */
export async function remindPending(ec: ExecCtx, input: { tripId: string; actorId: string }) {
  const { tx, orgId } = ec;
  const trip = await tx.trip.findUnique({ where: { id: input.tripId }, include: { participants: { where: { consent: "PENDING" } } } });
  if (!trip) throw new TripError("NOT_FOUND");
  if (trip.status !== "PUBLISHED") throw new TripError("NOT_OPEN");
  const day = dayKey(ec.now);
  const already = await tx.auditEvent.findFirst({ where: { orgId, action: "trip.reminder", entityType: "Trip", entityId: trip.id, meta: { path: ["day"], equals: day } } });
  if (already) return { sent: 0, alreadySentToday: true };
  const guardians = await guardianMembers(tx, orgId, trip.participants.map((p) => p.studentId));
  const students = await tx.student.findMany({ where: { id: { in: trip.participants.map((p) => p.studentId) } }, select: { id: true, firstNameEn: true, firstNameAr: true } });
  const deadline = trip.consentDeadline ?? trip.startsAt;
  let sent = 0;
  for (const s of students) {
    const recipients = guardians.get(s.id) ?? [];
    if (!recipients.length) continue;
    await notify(ec, {
      recipients,
      templateKey: "trip_consent_reminder",
      kind: "trip_consent",
      vars: { trip: { en: trip.titleEn, ar: trip.titleAr }, student: { en: s.firstNameEn, ar: s.firstNameAr }, deadline: { en: fmt(deadline, "en"), ar: fmt(deadline, "ar") } },
      href: `/trips/${trip.id}`,
      idempotencyBase: `trip:${trip.id}:${s.id}:reminder:${day}`,
    });
    sent++;
  }
  await audit(tx, orgId, { actorId: input.actorId, action: "trip.reminder", entityType: "Trip", entityId: trip.id, meta: { day, families: sent } });
  return { sent, alreadySentToday: false };
}

/** Cancel a trip: families are told once, and the trip leaves the calendar. */
export async function cancelTrip(ec: ExecCtx, input: { tripId: string; actorId: string; reasonEn?: string | null; reasonAr?: string | null }) {
  const { tx, orgId } = ec;
  const trip = await tx.trip.findUnique({ where: { id: input.tripId }, include: { participants: true } });
  if (!trip) throw new TripError("NOT_FOUND");
  if (trip.status === "CANCELLED" || trip.status === "COMPLETED") throw new TripError("NOT_EDITABLE");
  const wasPublished = trip.status === "PUBLISHED";
  await tx.trip.update({ where: { id: trip.id }, data: { status: "CANCELLED" } });
  if (trip.calendarEventId) await tx.calendarEvent.updateMany({ where: { id: trip.calendarEventId }, data: { published: false } });
  let notified = 0;
  if (wasPublished) {
    const guardians = await guardianMembers(tx, orgId, trip.participants.map((p) => p.studentId));
    const recipients = [...new Set([...guardians.values()].flat())];
    for (const r of recipients) {
      await notify(ec, {
        recipients: [r],
        templateKey: "trip_cancelled",
        kind: "trip_cancelled",
        vars: { trip: { en: trip.titleEn, ar: trip.titleAr }, date: { en: fmt(trip.startsAt, "en"), ar: fmt(trip.startsAt, "ar") }, reason: { en: input.reasonEn?.trim() ?? "", ar: input.reasonAr?.trim() || input.reasonEn?.trim() || "" } },
        href: `/trips/${trip.id}`,
        idempotencyBase: `trip:${trip.id}:cancel`,
      });
      notified++;
    }
  }
  await audit(tx, orgId, { actorId: input.actorId, action: "trip.cancel", entityType: "Trip", entityId: trip.id, reason: input.reasonEn?.trim() || null, meta: { notified } });
  return { notified };
}

export async function completeTrip(ec: ExecCtx, input: { tripId: string; actorId: string }) {
  const trip = await ec.tx.trip.findUnique({ where: { id: input.tripId } });
  if (!trip) throw new TripError("NOT_FOUND");
  if (trip.status !== "PUBLISHED") throw new TripError("NOT_OPEN");
  if (trip.endsAt > ec.now) throw new TripError("NOT_FINISHED");
  await ec.tx.trip.update({ where: { id: trip.id }, data: { status: "COMPLETED" } });
  await audit(ec.tx, ec.orgId, { actorId: input.actorId, action: "trip.complete", entityType: "Trip", entityId: trip.id });
}
