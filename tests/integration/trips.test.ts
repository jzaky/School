// Trips: publishing (participants, consent letters, notifications exactly once) and a parent granting
// consent, against real Postgres through the RLS-restricted app role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx } from "@/server/db";
import { decideConsent, publishTrip, remindPending, TripError } from "@/server/trips/service";
import { seedDemo } from "../../prisma/seed/demo";
import { ownerClient } from "./helpers";

const SLUG = "horizon-trips-itest";
let owner: PrismaClient;
let orgId: string;

async function member(key: string) {
  const p = await owner.demoPersona.findUniqueOrThrow({ where: { orgId_key: { orgId, key } } });
  return p.membershipId;
}

beforeAll(async () => {
  owner = ownerClient();
  const res = await seedDemo(owner, { slug: SLUG });
  orgId = res.orgId;
}, 240_000);

afterAll(async () => {
  await owner.$disconnect();
});

describe("trips", () => {
  it("publishes a trip once: participants, letters and guardian notifications", async () => {
    const teacher = await member("teacher");
    const start = new Date(Date.now() + 20 * 86400_000);
    const trip = await owner.trip.create({
      data: {
        orgId,
        titleEn: "Grade 10 Geography field day",
        titleAr: "يوم ميداني للجغرافيا للصف العاشر",
        destinationEn: "Hatta Dam",
        destinationAr: "سد حتا",
        startsAt: start,
        endsAt: new Date(start.getTime() + 6 * 3600_000),
        costAed: 90,
        consentDeadline: new Date(start.getTime() - 3 * 86400_000),
        gradeLevels: [10],
        organizerId: teacher,
      },
    });
    const students = await owner.student.findMany({ where: { orgId, gradeLevel: 10, status: "ACTIVE" } });
    const links = await owner.guardianLink.findMany({ where: { orgId, studentId: { in: students.map((s) => s.id) }, receivesUpdates: true }, include: { guardian: true } });
    const expectedNotifications = links.filter((l) => l.guardian.membershipId).length;

    const r1 = await tenantTx(orgId, (tx) => publishTrip(execCtx(tx, orgId, { quiet: true, actorId: teacher }), { tripId: trip.id, actorId: teacher }), { timeout: 60000 });
    expect(r1.participants).toBe(students.length);
    expect(r1.added).toBe(students.length);

    const parts = await owner.tripParticipant.findMany({ where: { tripId: trip.id } });
    expect(parts).toHaveLength(students.length);
    expect(parts.every((p) => p.consent === "PENDING" && p.documentId && p.letterSentAt)).toBe(true);
    const docs = await owner.document.findMany({ where: { id: { in: parts.map((p) => p.documentId!) } }, include: { versions: true } });
    expect(docs).toHaveLength(students.length);
    expect(docs.every((d) => d.source === "GENERATED" && d.visibleToFamily && d.studentId && d.versions[0]?.storageKey.startsWith("render:"))).toBe(true);

    const notes = await owner.notification.count({ where: { orgId, href: `/trips/${trip.id}` } });
    expect(notes).toBe(expectedNotifications);
    const outbound = await owner.outboundMessage.count({ where: { orgId, idempotencyKey: { startsWith: `trip:${trip.id}:` } } });

    const published = await owner.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(published.status).toBe("PUBLISHED");
    expect(published.calendarEventId).toBeTruthy();
    const ev = await owner.calendarEvent.findUniqueOrThrow({ where: { id: published.calendarEventId! } });
    expect(ev.gradeLevels).toEqual([10]);

    // Publishing again adds nobody and notifies nobody.
    const r2 = await tenantTx(orgId, (tx) => publishTrip(execCtx(tx, orgId, { quiet: true, actorId: teacher }), { tripId: trip.id, actorId: teacher }), { timeout: 60000 });
    expect(r2).toMatchObject({ added: 0, notified: 0 });
    expect(await owner.notification.count({ where: { orgId, href: `/trips/${trip.id}` } })).toBe(notes);
    expect(await owner.outboundMessage.count({ where: { orgId, idempotencyKey: { startsWith: `trip:${trip.id}:` } } })).toBe(outbound);
    expect(await owner.document.count({ where: { orgId, id: { in: parts.map((p) => p.documentId!) } } })).toBe(students.length);

    // Reminders go out at most once a day.
    const rem1 = await tenantTx(orgId, (tx) => remindPending(execCtx(tx, orgId, { quiet: true }), { tripId: trip.id, actorId: teacher }));
    expect(rem1.alreadySentToday).toBe(false);
    const rem2 = await tenantTx(orgId, (tx) => remindPending(execCtx(tx, orgId, { quiet: true }), { tripId: trip.id, actorId: teacher }));
    expect(rem2).toEqual({ sent: 0, alreadySentToday: true });
  });

  it("lets a parent grant consent, recorded with who and when, and audited", async () => {
    const rania = await member("parent");
    const adam = await owner.student.findFirstOrThrow({ where: { orgId, membershipId: await member("student") } });
    const trip = await owner.trip.findFirstOrThrow({ where: { orgId, gradeLevels: { has: 9 }, status: "PUBLISHED" } });
    const p = await owner.tripParticipant.findUniqueOrThrow({ where: { tripId_studentId: { tripId: trip.id, studentId: adam.id } } });
    expect(p.consent).toBe("PENDING");

    // Another family's parent cannot decide for Adam.
    const otherLink = await owner.guardianLink.findFirstOrThrow({ where: { orgId, studentId: { not: adam.id }, guardian: { membershipId: { not: null }, links: { none: { studentId: adam.id } } } }, include: { guardian: true } });
    await expect(tenantTx(orgId, (tx) => decideConsent(execCtx(tx, orgId), { participantId: p.id, deciderMembershipId: otherLink.guardian.membershipId!, decision: "GRANTED" }))).rejects.toBeInstanceOf(TripError);

    const when = new Date();
    await tenantTx(orgId, (tx) => decideConsent(execCtx(tx, orgId, { now: when }), { participantId: p.id, deciderMembershipId: rania, decision: "GRANTED", note: "He has a nut allergy." }));
    const after = await owner.tripParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after).toMatchObject({ consent: "GRANTED", decidedById: rania, noteEn: "He has a nut allergy." });
    expect(after.decidedAt?.getTime()).toBe(when.getTime());
    const audit = await owner.auditEvent.findFirst({ where: { orgId, action: "trip.consent.granted", entityId: p.id, actorId: rania } });
    expect(audit).not.toBeNull();
  });
});
