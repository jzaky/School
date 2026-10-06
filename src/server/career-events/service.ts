// University fairs, visits and info sessions. Career advisors and counselors create events for chosen grades;
// students (and parents for their children) register or cancel; staff mark attendance. Capacity is enforced
// under a row lock on the event, so two people taking the last place at once cannot both get it.
// Notifications go through the notify pipeline with idempotency keys. Never logs names.
import type { CareerEvent, CareerEventKind } from "@prisma/client";
import type { ExecCtx, Tx } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { notify } from "@/server/notify/notify";
import { fmtWhen } from "@/server/appointments/booking";
import { ensureCareerEventTemplates } from "./templates";

export type CareerEventErrorCode =
  | "NOT_FOUND"
  | "NOT_ELIGIBLE"
  | "FULL"
  | "CLOSED"
  | "CANCELLED"
  | "STARTED"
  | "NOT_REGISTERED"
  | "NOT_STARTED"
  | "INVALID"
  | "TITLE_REQUIRED"
  | "INVALID_DATES"
  | "IN_PAST"
  | "DEADLINE_AFTER_START"
  | "GRADES_REQUIRED"
  | "PLACE_REQUIRED"
  | "INVALID_URL"
  | "CAPACITY_BELOW_REGISTERED";

export class CareerEventError extends Error {
  constructor(public code: CareerEventErrorCode) {
    super(code);
  }
}

export const KIND_LABEL: Record<CareerEventKind, { en: string; ar: string }> = {
  UNIVERSITY_VISIT: { en: "University visit", ar: "زيارة جامعية" },
  FAIR: { en: "University fair", ar: "معرض جامعي" },
  INFO_SESSION: { en: "Information session", ar: "جلسة تعريفية" },
};

/** The time registration closes: the deadline, or the start of the event. */
export function closesAt(ev: Pick<CareerEvent, "registrationDeadline" | "startsAt">) {
  return ev.registrationDeadline && ev.registrationDeadline < ev.startsAt ? ev.registrationDeadline : ev.startsAt;
}

/** Whether a student in this grade may register for the event (pure). */
export function gradeEligible(ev: Pick<CareerEvent, "gradeLevels">, grade: number) {
  return ev.gradeLevels.length === 0 || ev.gradeLevels.includes(grade);
}

/** Registration state for display (pure). */
export function registrationState(ev: Pick<CareerEvent, "status" | "startsAt" | "registrationDeadline" | "capacity">, registered: number, now: Date): "open" | "full" | "closed" | "cancelled" | "past" {
  if (ev.status === "CANCELLED") return "cancelled";
  if (ev.startsAt <= now) return "past";
  if (closesAt(ev) <= now) return "closed";
  if (ev.capacity != null && registered >= ev.capacity) return "full";
  return "open";
}

/** Membership ids to notify about a student: the student and guardians who receive updates. */
async function familyRecipients(tx: Tx, orgId: string, studentIds: string[]) {
  const [students, links] = await Promise.all([
    tx.student.findMany({ where: { orgId, id: { in: studentIds } }, select: { id: true, membershipId: true, firstNameEn: true, firstNameAr: true } }),
    tx.guardianLink.findMany({ where: { orgId, studentId: { in: studentIds }, receivesUpdates: true }, select: { studentId: true, guardian: { select: { membershipId: true } } } }),
  ]);
  return students.map((s) => ({
    student: s,
    recipients: [s.membershipId, ...links.filter((l) => l.studentId === s.id).map((l) => l.guardian.membershipId)].filter((m): m is string => Boolean(m)),
  }));
}

/** Lock the event row for the rest of the transaction and return it. */
async function lockEvent(tx: Tx, eventId: string) {
  await tx.$queryRaw`SELECT id FROM "CareerEvent" WHERE id = ${eventId} FOR UPDATE`;
  const ev = await tx.careerEvent.findUnique({ where: { id: eventId } });
  if (!ev) throw new CareerEventError("NOT_FOUND");
  return ev;
}

export async function registerStudent(ec: ExecCtx, input: { eventId: string; studentId: string; actorId: string }) {
  const { tx, orgId, now } = ec;
  const ev = await lockEvent(tx, input.eventId);
  if (ev.status === "CANCELLED") throw new CareerEventError("CANCELLED");
  if (ev.startsAt <= now) throw new CareerEventError("STARTED");
  if (closesAt(ev) <= now) throw new CareerEventError("CLOSED");
  const student = await tx.student.findFirst({ where: { orgId, id: input.studentId, status: "ACTIVE" }, select: { id: true, gradeLevel: true } });
  if (!student) throw new CareerEventError("NOT_FOUND");
  if (!gradeEligible(ev, student.gradeLevel)) throw new CareerEventError("NOT_ELIGIBLE");
  const existing = await tx.careerEventRegistration.findUnique({ where: { eventId_studentId: { eventId: ev.id, studentId: student.id } } });
  if (existing?.status === "REGISTERED") return { registration: existing, already: true };
  if (ev.capacity != null) {
    const taken = await tx.careerEventRegistration.count({ where: { eventId: ev.id, status: "REGISTERED" } });
    if (taken >= ev.capacity) throw new CareerEventError("FULL");
  }
  const registration = existing
    ? await tx.careerEventRegistration.update({ where: { id: existing.id }, data: { status: "REGISTERED", registeredById: input.actorId, registeredAt: now, cancelledAt: null, attended: null, attendanceMarkedAt: null, attendanceMarkedById: null } })
    : await tx.careerEventRegistration.create({ data: { orgId, eventId: ev.id, studentId: student.id, registeredById: input.actorId, registeredAt: now } });
  await audit(tx, orgId, { actorId: input.actorId, action: "career_event.register", entityType: "CareerEvent", entityId: ev.id, meta: { registrationId: registration.id } });
  return { registration, already: false };
}

export async function cancelRegistration(ec: ExecCtx, input: { eventId: string; studentId: string; actorId: string }) {
  const { tx, orgId, now } = ec;
  const ev = await lockEvent(tx, input.eventId);
  if (ev.startsAt <= now) throw new CareerEventError("STARTED");
  const existing = await tx.careerEventRegistration.findUnique({ where: { eventId_studentId: { eventId: ev.id, studentId: input.studentId } } });
  if (!existing || existing.status !== "REGISTERED") throw new CareerEventError("NOT_REGISTERED");
  const registration = await tx.careerEventRegistration.update({ where: { id: existing.id }, data: { status: "CANCELLED", cancelledAt: now } });
  await audit(tx, orgId, { actorId: input.actorId, action: "career_event.cancel_registration", entityType: "CareerEvent", entityId: ev.id, meta: { registrationId: registration.id } });
  return registration;
}

export async function markAttendance(ec: ExecCtx, input: { eventId: string; studentId: string; attended: boolean; actorId: string }) {
  const { tx, orgId, now } = ec;
  const ev = await tx.careerEvent.findUnique({ where: { id: input.eventId } });
  if (!ev) throw new CareerEventError("NOT_FOUND");
  if (ev.status === "CANCELLED") throw new CareerEventError("CANCELLED");
  // Attendance can be taken from an hour before the start (doors open), never for an event days away.
  if (ev.startsAt.getTime() - now.getTime() > 3_600_000) throw new CareerEventError("NOT_STARTED");
  const reg = await tx.careerEventRegistration.findUnique({ where: { eventId_studentId: { eventId: ev.id, studentId: input.studentId } } });
  if (!reg || reg.status !== "REGISTERED") throw new CareerEventError("NOT_REGISTERED");
  const updated = await tx.careerEventRegistration.update({ where: { id: reg.id }, data: { attended: input.attended, attendanceMarkedAt: now, attendanceMarkedById: input.actorId } });
  await audit(tx, orgId, { actorId: input.actorId, action: "career_event.attendance", entityType: "CareerEvent", entityId: ev.id, meta: { registrationId: reg.id, attended: input.attended } });
  return updated;
}

export type CareerEventInput = {
  id?: string | null;
  kind: CareerEventKind;
  titleEn: string;
  titleAr: string;
  descEn: string;
  descAr: string;
  universityIds: string[];
  otherUniversities: string[];
  startsAt: Date;
  endsAt: Date;
  locationEn: string;
  locationAr: string;
  onlineUrl: string;
  gradeLevels: number[];
  capacity: number | null;
  registrationDeadline: Date | null;
};

/** Validate and normalize event input (pure). Throws CareerEventError. */
export function normalizeEventInput(input: CareerEventInput, now: Date) {
  if (!["UNIVERSITY_VISIT", "FAIR", "INFO_SESSION"].includes(input.kind)) throw new CareerEventError("INVALID");
  const titleEn = input.titleEn.trim();
  if (titleEn.length < 3) throw new CareerEventError("TITLE_REQUIRED");
  if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime()) || input.endsAt <= input.startsAt) throw new CareerEventError("INVALID_DATES");
  if (input.startsAt <= now) throw new CareerEventError("IN_PAST");
  if (input.registrationDeadline && (Number.isNaN(input.registrationDeadline.getTime()) || input.registrationDeadline > input.startsAt)) throw new CareerEventError("DEADLINE_AFTER_START");
  const grades = [...new Set(input.gradeLevels.filter((g) => Number.isInteger(g) && g >= 1 && g <= 13))].sort((a, b) => a - b);
  if (!grades.length) throw new CareerEventError("GRADES_REQUIRED");
  const url = input.onlineUrl.trim();
  if (url && !/^https:\/\/[^\s]+\.[^\s]+$/i.test(url)) throw new CareerEventError("INVALID_URL");
  const locationEn = input.locationEn.trim();
  if (!locationEn && !url) throw new CareerEventError("PLACE_REQUIRED");
  const capacity = input.capacity != null && Number.isFinite(input.capacity) && input.capacity > 0 ? Math.min(5000, Math.round(input.capacity)) : null;
  const others = [...new Set(input.otherUniversities.map((s) => s.trim()).filter(Boolean))].slice(0, 30);
  return {
    kind: input.kind,
    titleEn,
    titleAr: input.titleAr.trim() || titleEn,
    descEn: input.descEn.trim() || null,
    descAr: input.descAr.trim() || null,
    universityIds: [...new Set(input.universityIds)].slice(0, 60),
    otherUniversities: others,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    locationEn: locationEn || null,
    locationAr: input.locationAr.trim() || locationEn || null,
    onlineUrl: url || null,
    gradeLevels: grades,
    capacity,
    registrationDeadline: input.registrationDeadline,
  };
}

async function syncCalendar(tx: Tx, orgId: string, ev: CareerEvent, now: Date) {
  const data = {
    kind: "EVENT" as const,
    titleEn: ev.titleEn,
    titleAr: ev.titleAr,
    descEn: ev.descEn,
    descAr: ev.descAr,
    locationEn: ev.locationEn ?? (ev.onlineUrl ? "Online" : null),
    locationAr: ev.locationAr ?? (ev.onlineUrl ? "عبر الإنترنت" : null),
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    allDay: false,
    audience: ["staff", "student", "parent"],
    gradeLevels: ev.gradeLevels,
    published: ev.status === "PUBLISHED",
    ownerId: ev.organizerId,
  };
  if (ev.calendarEventId && (await tx.calendarEvent.findUnique({ where: { id: ev.calendarEventId } }))) {
    await tx.calendarEvent.update({ where: { id: ev.calendarEventId }, data });
    return ev.calendarEventId;
  }
  const row = await tx.calendarEvent.create({ data: { orgId, ...data, createdAt: now } });
  await tx.careerEvent.update({ where: { id: ev.id }, data: { calendarEventId: row.id } });
  return row.id;
}

/** Create or update an event, keep its calendar entry in step, and (on create) tell the students in its grades. */
export async function saveEvent(ec: ExecCtx, input: CareerEventInput, actorId: string) {
  const { tx, orgId, now } = ec;
  const data = normalizeEventInput(input, now);
  let ev: CareerEvent;
  let created = false;
  if (input.id) {
    const current = await lockEvent(tx, input.id);
    if (current.status === "CANCELLED") throw new CareerEventError("CANCELLED");
    if (data.capacity != null) {
      const taken = await tx.careerEventRegistration.count({ where: { eventId: current.id, status: "REGISTERED" } });
      if (taken > data.capacity) throw new CareerEventError("CAPACITY_BELOW_REGISTERED");
    }
    ev = await tx.careerEvent.update({ where: { id: current.id }, data });
  } else {
    ev = await tx.careerEvent.create({ data: { orgId, ...data, organizerId: actorId, createdAt: now } });
    created = true;
  }
  await syncCalendar(tx, orgId, ev, now);
  await audit(tx, orgId, { actorId, action: created ? "career_event.create" : "career_event.update", entityType: "CareerEvent", entityId: ev.id, meta: { kind: ev.kind, grades: ev.gradeLevels, capacity: ev.capacity } });
  let notified = 0;
  if (created) notified = await announceEvent(ec, ev);
  return { event: ev, created, notified };
}

/** In-app announcement to the students in the event's grades. Claimed once per event (JobRun key). */
export async function announceEvent(ec: ExecCtx, ev: CareerEvent) {
  const { tx, orgId, now } = ec;
  const key = `cevnew:${ev.id}`;
  const claim = await tx.jobRun.createMany({ data: [{ orgId, queue: "career_events", name: "announce", idempotencyKey: key, status: "COMPLETED", finishedAt: now }], skipDuplicates: true });
  if (claim.count !== 1) return 0;
  await ensureCareerEventTemplates(tx, orgId);
  const students = await tx.student.findMany({ where: { orgId, status: "ACTIVE", gradeLevel: { in: ev.gradeLevels }, membershipId: { not: null } }, select: { membershipId: true } });
  const recipients = students.map((s) => s.membershipId!).filter(Boolean);
  if (!recipients.length) return 0;
  const deadline = ev.registrationDeadline ? fmtWhen(ev.registrationDeadline) : null;
  const res = await notify(ec, {
    recipients,
    templateKey: "career_event_new",
    kind: "career_event",
    vars: {
      kind: KIND_LABEL[ev.kind],
      title: { en: ev.titleEn, ar: ev.titleAr },
      when: fmtWhen(ev.startsAt),
      deadline: deadline ? { en: ` by ${deadline.en}`, ar: ` قبل ${deadline.ar}` } : "",
    },
    href: `/career/events/${ev.id}`,
    channels: ["IN_APP"],
    idempotencyBase: key,
  });
  return res.inApp;
}

/** Cancel an event: registrations close, the calendar entry is hidden, registered families are told once each. */
export async function cancelEvent(ec: ExecCtx, input: { eventId: string; actorId: string }) {
  const { tx, orgId, now } = ec;
  const ev = await lockEvent(tx, input.eventId);
  if (ev.status === "CANCELLED") return { notified: 0 };
  if (ev.endsAt <= now) throw new CareerEventError("STARTED");
  const updated = await tx.careerEvent.update({ where: { id: ev.id }, data: { status: "CANCELLED", cancelledAt: now } });
  if (ev.calendarEventId) await tx.calendarEvent.updateMany({ where: { id: ev.calendarEventId }, data: { published: false } });
  await ensureCareerEventTemplates(tx, orgId);
  const regs = await tx.careerEventRegistration.findMany({ where: { eventId: ev.id, status: "REGISTERED" }, select: { studentId: true } });
  let notified = 0;
  for (const { student, recipients } of await familyRecipients(tx, orgId, regs.map((r) => r.studentId))) {
    const key = `cevcancel:${ev.id}:${student.id}`;
    const claim = await tx.jobRun.createMany({ data: [{ orgId, queue: "career_events", name: "cancel", idempotencyKey: key, status: "COMPLETED", finishedAt: now }], skipDuplicates: true });
    if (claim.count !== 1) continue;
    const res = await notify(ec, {
      recipients,
      templateKey: "career_event_cancelled",
      kind: "career_event",
      vars: { title: { en: updated.titleEn, ar: updated.titleAr }, when: fmtWhen(updated.startsAt), student: { en: student.firstNameEn, ar: student.firstNameAr } },
      href: `/career/events/${ev.id}`,
      channels: ["IN_APP", "EMAIL"],
      idempotencyBase: key,
    });
    notified += res.inApp;
  }
  await audit(tx, orgId, { actorId: input.actorId, action: "career_event.cancel", entityType: "CareerEvent", entityId: ev.id, meta: { registered: regs.length } });
  return { notified };
}

const REMINDER_WINDOW_MS = 24 * 3_600_000;

/**
 * Reminders for registered students and their families, about a day before the event. Idempotent: one JobRun
 * key per registration, so running it every hour (or twice) sends each reminder once. Registrations made after
 * the window opened are still reminded once.
 */
export async function sendDueReminders(ec: ExecCtx) {
  const { tx, orgId, now } = ec;
  const events = await tx.careerEvent.findMany({ where: { orgId, status: "PUBLISHED", startsAt: { gt: now, lte: new Date(now.getTime() + REMINDER_WINDOW_MS) } } });
  if (!events.length) return { reminders: 0 };
  await ensureCareerEventTemplates(tx, orgId);
  let reminders = 0;
  for (const ev of events) {
    const regs = await tx.careerEventRegistration.findMany({ where: { eventId: ev.id, status: "REGISTERED" }, select: { id: true, studentId: true } });
    const fam = await familyRecipients(tx, orgId, regs.map((r) => r.studentId));
    const hours = Math.max(1, Math.round((ev.startsAt.getTime() - now.getTime()) / 3_600_000));
    for (const r of regs) {
      const key = `cevremind:${r.id}:24h`;
      const claim = await tx.jobRun.createMany({ data: [{ orgId, queue: "career_events", name: "reminder", idempotencyKey: key, status: "COMPLETED", finishedAt: now }], skipDuplicates: true });
      if (claim.count !== 1) continue;
      const f = fam.find((x) => x.student.id === r.studentId);
      if (!f?.recipients.length) continue;
      await notify(ec, {
        recipients: f.recipients,
        templateKey: "career_event_reminder",
        kind: "career_event_reminder",
        vars: {
          title: { en: ev.titleEn, ar: ev.titleAr },
          relative: { en: `in ${hours} hours`, ar: `خلال ${hours} ساعة` },
          when: fmtWhen(ev.startsAt),
          student: { en: f.student.firstNameEn, ar: f.student.firstNameAr },
          place: { en: ev.locationEn ?? "Online", ar: ev.locationAr ?? ev.locationEn ?? "عبر الإنترنت" },
        },
        href: `/career/events/${ev.id}`,
        channels: ["IN_APP", "EMAIL"],
        idempotencyBase: key,
      });
      reminders++;
    }
  }
  return { reminders };
}
