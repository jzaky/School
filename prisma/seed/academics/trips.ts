// Demo data for the trips module. Runs after the core demo seed and is safe to re-run: each trip has a
// stable id and is skipped when it already exists.
import type { Prisma, PrismaClient } from "@prisma/client";
import type { SeedWorld } from "../demo";
import { at, schoolDay, stableId } from "../lib";
import { execCtx } from "../../../src/server/db";
import { publishTrip } from "../../../src/server/trips/service";
import { ensureCalendarTemplates } from "../../../src/server/trips/templates";

export async function seedTrips(w: SeedWorld) {
  await seedTripsData(w.db, w.orgId, w.now, w.log);
}

type Decision = "GRANTED" | "DECLINED" | "PENDING";

const DECLINE_NOTES = [
  "He has a family commitment that day, thank you.",
  "She is recovering from a cold and should rest.",
  "We are travelling that week.",
];

export async function seedTripsData(db: PrismaClient, orgId: string, now: Date, log: (m: string) => void = () => {}) {
  const tx = db as unknown as Prisma.TransactionClient;
  const personas = await db.demoPersona.findMany({ where: { orgId } });
  const persona = (k: string) => personas.find((p) => p.key === k)?.membershipId ?? null;
  const teacher = persona("teacher") ?? persona("admin");
  const admin = persona("admin") ?? teacher;
  if (!teacher || !admin) return;
  const adamMid = persona("student");
  const adam = adamMid ? await db.student.findFirst({ where: { orgId, membershipId: adamMid } }) : null;
  await ensureCalendarTemplates(tx, orgId);

  // Decide consent for a participant as the first guardian who can approve (the seed stands in for the parent).
  const decide = async (tripId: string, studentId: string, decision: Decision, when: Date, note: string | null) => {
    if (decision === "PENDING") return;
    const link = await db.guardianLink.findFirst({ where: { orgId, studentId, canApprove: true, guardian: { membershipId: { not: null } } }, include: { guardian: true }, orderBy: { isPrimary: "desc" } });
    if (!link?.guardian.membershipId) return;
    const p = await db.tripParticipant.update({ where: { tripId_studentId: { tripId, studentId } }, data: { consent: decision, decidedById: link.guardian.membershipId, decidedAt: when, noteEn: note } });
    await db.auditEvent.create({ data: { orgId, actorId: link.guardian.membershipId, action: decision === "GRANTED" ? "trip.consent.granted" : "trip.consent.declined", entityType: "TripParticipant", entityId: p.id, meta: { tripId, previous: "PENDING", withNote: Boolean(note) }, createdAt: when } });
  };

  // 1. Grade 9 science trip, published a few days ago, consent still being collected (Adam's is pending).
  const museumId = stableId(orgId, "trip", "g9_museum");
  if (!(await db.trip.findUnique({ where: { id: museumId } }))) {
    const day = schoolDay(8, now);
    await db.trip.create({
      data: {
        id: museumId,
        orgId,
        titleEn: "Grade 9 Science trip: Museum of the Future",
        titleAr: "رحلة العلوم للصف التاسع: متحف المستقبل",
        descEn: "Students will explore the exhibitions on space, climate and health technology and take part in a guided workshop that links to the Grade 9 physics unit on energy. Transport is by school bus, leaving at 08:00 and returning by 14:00.",
        descAr: "يستكشف الطلاب معارض الفضاء والمناخ وتقنيات الصحة ويشاركون في ورشة موجهة ترتبط بوحدة الطاقة في منهج الفيزياء للصف التاسع. التنقل بالحافلة المدرسية، مع الانطلاق الساعة 08:00 والعودة قبل الساعة 14:00.",
        destinationEn: "Museum of the Future, Sheikh Zayed Road, Dubai",
        destinationAr: "متحف المستقبل، شارع الشيخ زايد، دبي",
        startsAt: at(day, 8, 0, now),
        endsAt: at(day, 14, 0, now),
        costAed: 145,
        consentDeadline: at(day - 3, 23, 59, now),
        gradeLevels: [9],
        classIds: [],
        organizerId: teacher,
        createdAt: at(-6, 10, 0, now),
      },
    });
    await publishTrip(execCtx(tx, orgId, { now: at(-4, 9, 15, now), quiet: true, actorId: teacher }), { tripId: museumId, actorId: teacher });
    const participants = await db.tripParticipant.findMany({ where: { tripId: museumId }, orderBy: { createdAt: "asc" } });
    let i = 0;
    for (const p of participants) {
      if (adam && p.studentId === adam.id) continue;
      const decision: Decision = i % 7 === 3 ? "DECLINED" : i % 3 === 2 ? "PENDING" : "GRANTED";
      await decide(museumId, p.studentId, decision, at(-4 + (i % 4), 12 + (i % 8), (i * 7) % 60, now), decision === "DECLINED" ? DECLINE_NOTES[i % DECLINE_NOTES.length] : null);
      i++;
    }
    log("trips: Grade 9 science trip published with mixed consent");
  }

  // 2. A Grade 11 heritage visit that already happened.
  const heritageId = stableId(orgId, "trip", "g11_heritage");
  if (!(await db.trip.findUnique({ where: { id: heritageId } }))) {
    const day = schoolDay(-7, now);
    await db.trip.create({
      data: {
        id: heritageId,
        orgId,
        titleEn: "Grade 11 History visit: Al Fahidi and Etihad Museum",
        titleAr: "زيارة التاريخ للصف الحادي عشر: حي الفهيدي ومتحف الاتحاد",
        descEn: "A guided walk through the Al Fahidi Historical Neighbourhood followed by the Etihad Museum, supporting the unit on the formation of the UAE.",
        descAr: "جولة إرشادية في حي الفهيدي التاريخي تليها زيارة متحف الاتحاد، دعماً لوحدة قيام دولة الإمارات.",
        destinationEn: "Al Fahidi Historical Neighbourhood and Etihad Museum, Dubai",
        destinationAr: "حي الفهيدي التاريخي ومتحف الاتحاد، دبي",
        startsAt: at(day, 8, 30, now),
        endsAt: at(day, 13, 30, now),
        costAed: 60,
        consentDeadline: at(day - 3, 23, 59, now),
        gradeLevels: [11],
        classIds: [],
        organizerId: admin,
        createdAt: at(day - 14, 9, 0, now),
      },
    });
    const published = at(day - 10, 9, 0, now);
    await publishTrip(execCtx(tx, orgId, { now: published, quiet: true, actorId: admin }), { tripId: heritageId, actorId: admin });
    // Old consent requests were read long ago.
    await db.notification.updateMany({ where: { orgId, href: `/trips/${heritageId}`, readAt: null }, data: { readAt: at(day - 9, 18, 0, now) } });
    const participants = await db.tripParticipant.findMany({ where: { tripId: heritageId }, orderBy: { createdAt: "asc" } });
    let i = 0;
    for (const p of participants) {
      const decision: Decision = i === 4 ? "DECLINED" : "GRANTED";
      await decide(heritageId, p.studentId, decision, at(day - 9 + (i % 5), 19, (i * 11) % 60, now), decision === "DECLINED" ? DECLINE_NOTES[2] : null);
      i++;
    }
    await db.trip.update({ where: { id: heritageId }, data: { status: "COMPLETED" } });
    log("trips: completed Grade 11 heritage visit");
  }
}
