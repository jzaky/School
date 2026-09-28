// Booking, rescheduling and cancelling appointments. Runs inside a tenant transaction.
import type { ExecCtx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { availableSlots, loadHostInputs } from "./availability";
import { dubaiDateKey, pickRoundRobinHost } from "./slots";

export class BookingError extends Error {}

function fmtWhen(d: Date) {
  const f = (loc: string) =>
    new Intl.DateTimeFormat(loc === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { timeZone: "Asia/Dubai", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(d);
  return { en: f("en"), ar: f("ar") };
}

export async function bookAppointment(
  ec: ExecCtx,
  input: { typeId: string; hostId: string | null; start: Date; bookedById: string; studentId: string | null; guardianId?: string | null; caseId?: string | null; notes?: string | null; rescheduleOf?: string | null },
) {
  const { tx, orgId } = ec;
  const type = await tx.appointmentType.findUnique({ where: { id: input.typeId }, include: { hosts: true } });
  if (!type || type.orgId !== orgId) throw new BookingError("TYPE_NOT_FOUND");
  const hostIds = input.hostId ? [input.hostId] : type.hosts.map((h) => h.membershipId);
  if (!hostIds.length) throw new BookingError("NO_HOST");
  // Serialize bookings per host so two people cannot take the same slot.
  for (const h of [...hostIds].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${h}))`;

  const key = dubaiDateKey(input.start);
  const slots = await availableSlots(tx, orgId, type.id, hostIds, { now: ec.now, fromKey: key, days: 1, ignoreAppointmentId: input.rescheduleOf ?? undefined });
  const slot = (slots.get(key) ?? []).find((s: { start: Date }) => s.start.getTime() === input.start.getTime());
  if (!slot) throw new BookingError("SLOT_TAKEN");
  let hostId = input.hostId;
  if (!hostId) {
    const hosts = await loadHostInputs(tx, orgId, slot.hostIds, key, 7);
    hostId = pickRoundRobinHost(slot, hosts, type.id);
  }
  if (!hostId || !slot.hostIds.includes(hostId)) throw new BookingError("SLOT_TAKEN");

  let guardianId = input.guardianId ?? null;
  if (!guardianId) {
    const g = await tx.guardian.findFirst({ where: { orgId, membershipId: input.bookedById } });
    guardianId = g?.id ?? null;
  }
  const appt = await tx.appointment.create({
    data: {
      orgId,
      typeId: type.id,
      hostId,
      bookedById: input.bookedById,
      studentId: input.studentId,
      guardianId,
      caseId: input.caseId ?? null,
      startsAt: slot.start,
      endsAt: slot.end,
      status: "CONFIRMED",
      locationEn: type.locationEn,
      locationAr: type.locationAr,
      notesEn: input.notes ?? null,
      rescheduledFromId: input.rescheduleOf ?? null,
      createdAt: ec.now,
    },
  });
  const student = input.studentId ? await tx.student.findUnique({ where: { id: input.studentId } }) : null;
  await tx.appointmentAttendee.createMany({
    data: [
      { orgId, appointmentId: appt.id, membershipId: hostId },
      { orgId, appointmentId: appt.id, membershipId: input.bookedById, studentId: input.studentId, guardianId },
      ...(student?.membershipId && student.membershipId !== input.bookedById ? [{ orgId, appointmentId: appt.id, membershipId: student.membershipId, studentId: student.id }] : []),
    ],
  });
  if (input.rescheduleOf) {
    await tx.appointment.update({ where: { id: input.rescheduleOf }, data: { status: "CANCELLED", cancelReason: "Rescheduled" } });
  }

  const when = fmtWhen(slot.start);
  const [host, booker] = await Promise.all([
    tx.membership.findUnique({ where: { id: hostId }, include: { user: true } }),
    tx.membership.findUnique({ where: { id: input.bookedById }, include: { user: true } }),
  ]);
  const studentName = student ? { en: `${student.firstNameEn} ${student.lastNameEn}`, ar: `${student.firstNameAr} ${student.lastNameAr}` } : { en: booker?.user.nameEn ?? "", ar: booker?.user.nameAr ?? "" };
  const title = { en: type.nameEn, ar: type.nameAr };
  const location = { en: type.locationEn ?? "", ar: type.locationAr ?? type.locationEn ?? "" };
  const hostName = { en: host?.user.nameEn ?? "", ar: host?.user.nameAr ?? host?.user.nameEn ?? "" };

  const timelineData = {
    orgId,
    caseId: input.caseId ?? null,
    studentId: input.studentId,
    actorId: input.bookedById,
    kind: "meeting",
    titleEn: `${input.rescheduleOf ? "Meeting rescheduled" : "Meeting booked"}: ${type.nameEn} with ${hostName.en}`,
    titleAr: `${input.rescheduleOf ? "تمت إعادة جدولة الموعد" : "تم حجز موعد"}: ${type.nameAr} مع ${hostName.ar}`,
    bodyEn: when.en,
    bodyAr: when.ar,
    staffOnly: Boolean(input.caseId),
    createdAt: ec.now,
  };
  await tx.timelineEvent.create({ data: timelineData });

  await notify(ec, {
    recipients: [hostId],
    templateKey: "meeting_booked",
    vars: { student: studentName, when },
    href: `/meetings/${appt.id}`,
    channels: ["IN_APP", "EMAIL"],
    idempotencyBase: `appt:${appt.id}:host`,
  });
  await notify(ec, {
    recipients: [input.bookedById],
    templateKey: "appointment_confirmed",
    vars: { title, when, host: hostName, location },
    href: `/meetings/${appt.id}`,
    channels: ["IN_APP", "EMAIL"],
    idempotencyBase: `appt:${appt.id}:booker`,
  });
  if (!ec.quiet) {
    for (const [label, hours] of [["24h", 24], ["1h", 1]] as const) {
      const delay = slot.start.getTime() - hours * 3600_000 - ec.now.getTime();
      if (delay > 0) {
        ec.effects.push({ kind: "job", queue: "reminders", name: "appointment", data: { orgId, appointmentId: appt.id, window: label }, jobId: `reminder:${appt.id}:${label}`, delayMs: delay });
      }
    }
  }
  await tx.auditEvent.create({ data: { orgId, actorId: input.bookedById, action: input.rescheduleOf ? "appointment.reschedule" : "appointment.book", entityType: "Appointment", entityId: appt.id, createdAt: ec.now } });
  return appt;
}

export async function cancelAppointment(ec: ExecCtx, input: { appointmentId: string; byId: string; reason?: string | null }) {
  const { tx, orgId } = ec;
  const appt = await tx.appointment.findUnique({ where: { id: input.appointmentId }, include: { attendees: true, type: true } });
  if (!appt || appt.orgId !== orgId) throw new BookingError("NOT_FOUND");
  const allowed = appt.hostId === input.byId || appt.bookedById === input.byId || appt.attendees.some((a) => a.membershipId === input.byId);
  if (!allowed) throw new BookingError("FORBIDDEN");
  if (appt.status === "CANCELLED") return appt;
  await tx.appointment.update({ where: { id: appt.id }, data: { status: "CANCELLED", cancelReason: input.reason ?? null } });
  const others = appt.attendees.map((a) => a.membershipId).filter((m): m is string => Boolean(m) && m !== input.byId);
  await notify(ec, {
    recipients: others,
    templateKey: "appointment_reminder",
    vars: { title: { en: `Cancelled: ${appt.type.nameEn}`, ar: `أُلغي: ${appt.type.nameAr}` }, relative: { en: "", ar: "" }, when: fmtWhen(appt.startsAt), host: { en: "", ar: "" }, location: { en: appt.locationEn ?? "", ar: appt.locationAr ?? "" } },
    href: `/meetings/${appt.id}`,
    channels: ["IN_APP", "EMAIL"],
    idempotencyBase: `appt:${appt.id}:cancel`,
  });
  await tx.timelineEvent.create({ data: { orgId, caseId: appt.caseId, studentId: appt.studentId, actorId: input.byId, kind: "meeting", titleEn: `Meeting cancelled: ${appt.type.nameEn}`, titleAr: `تم إلغاء الموعد: ${appt.type.nameAr}`, bodyEn: input.reason ?? null, bodyAr: input.reason ?? null, staffOnly: Boolean(appt.caseId), createdAt: ec.now } });
  await tx.auditEvent.create({ data: { orgId, actorId: input.byId, action: "appointment.cancel", entityType: "Appointment", entityId: appt.id, createdAt: ec.now } });
  return appt;
}
