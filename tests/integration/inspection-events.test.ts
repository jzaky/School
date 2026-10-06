// Inspection evidence pack aggregates and sensitive-case rules, career event registration capacity and
// reminders, partner resources and tenant isolation, against real Postgres through the RLS-restricted app role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { execCtx } from "@/server/db";
import { can, permissionsOf, roleKeysOf } from "@/server/identity/can";
import type { Ctx } from "@/server/context";
import { buildEvidencePack, EvidenceError } from "@/server/inspection/evidence";
import { cancelRegistration, CareerEventError, registerStudent, saveEvent, sendDueReminders } from "@/server/career-events/service";
import { seedDemo } from "../../prisma/seed/demo";
import { ownerClient, uid } from "./helpers";

const SLUG = "horizon-inspect-itest";
let owner: PrismaClient;
let orgId: string;
let otherOrgId: string;
const now = new Date();
const from = new Date(now.getTime() - 200 * 86_400_000);
const to = new Date(now.getTime() + 86_400_000);

async function member(key: string) {
  const p = await owner.demoPersona.findUniqueOrThrow({ where: { orgId_key: { orgId, key } } });
  return p.membershipId;
}

async function ctxFor(membershipId: string): Promise<Ctx> {
  const membership = await owner.membership.findUniqueOrThrow({ where: { id: membershipId }, include: { roles: { include: { role: true } }, staffProfile: true, student: true, guardian: { include: { links: { include: { student: true } } } } } });
  const user = await owner.user.findUniqueOrThrow({ where: { id: membership.userId } });
  const org = await owner.organization.findUniqueOrThrow({ where: { id: orgId } });
  const roles = roleKeysOf(membership);
  return {
    orgId,
    db: tenantDb(orgId),
    org,
    user,
    membership,
    membershipId,
    roles,
    perms: permissionsOf(membership),
    locale: "en",
    persona: null,
    isStudent: roles.includes("student"),
    isParent: roles.includes("parent"),
    isStaff: !roles.includes("student") && !roles.includes("parent"),
    can: (p) => can(membership, p),
    session: null as never,
  } as Ctx;
}

beforeAll(async () => {
  owner = ownerClient();
  const res = await seedDemo(owner, { slug: SLUG });
  orgId = res.orgId;
  const other = await owner.organization.create({ data: { slug: uid("inspect-other"), nameEn: "Other School", nameAr: "مدرسة أخرى" } });
  otherOrgId = other.id;
}, 300_000);

afterAll(async () => {
  await owner.organization.delete({ where: { id: otherOrgId } }).catch(() => undefined);
  await owner.$disconnect();
});

describe("inspection evidence pack", () => {
  it("aggregates match the records, with all six headings and a mapping for each", async () => {
    const ctx = await ctxFor(await member("principal"));
    const pack = await buildEvidencePack(ctx, { from, to, now });
    expect(pack.sections.map((s) => s.key)).toEqual(["safeguarding", "wellbeing", "parents", "careers", "attendance", "compliance"]);
    for (const s of pack.sections) expect(s.mapping.length).toBe(4);
    const metric = (section: string, key: string) => pack.sections.find((s) => s.key === section)!.metrics.find((m) => m.key === key)!;

    const sg = await owner.case.count({ where: { orgId, sensitivity: "SAFEGUARDING", openedAt: { gte: from, lt: to } } });
    const wb = await owner.case.count({ where: { orgId, sensitivity: "WELLBEING", openedAt: { gte: from, lt: to } } });
    expect(sg).toBeGreaterThan(0);
    expect(metric("safeguarding", "opened").value).toBe(sg);
    expect(metric("wellbeing", "opened").value).toBe(wb);
    expect(metric("safeguarding", "dslCount").value).toBeGreaterThanOrEqual(1);
    expect(metric("safeguarding", "training").note).toBe("notRecorded");
    const attendance = await owner.attendanceRecord.count({ where: { orgId, date: { gte: from, lt: to } } });
    expect(metric("attendance", "attendanceRecords").value).toBe(attendance);
    expect(metric("careers", "assessmentsCompleted").value).toBe(await owner.aptitudeAssessment.count({ where: { orgId, completedAt: { gte: from, lt: to } } }));
    // Without asking, no references are listed.
    expect(pack.sections.every((s) => s.references === undefined)).toBe(true);
  });

  it("never lists sensitive cases or names for a viewer the case access module does not allow", async () => {
    const admin = await ctxFor(await member("admin"));
    expect(admin.can("inspection.view")).toBe(true);
    expect(admin.can("cases.wellbeing") || admin.can("safeguarding.view")).toBe(false);
    const pack = await buildEvidencePack(admin, { from, to, now, withReferences: true });
    const sg = pack.sections.find((s) => s.key === "safeguarding")!;
    const wb = pack.sections.find((s) => s.key === "wellbeing")!;
    expect(sg.referencesAllowed).toBe(false);
    expect(wb.referencesAllowed).toBe(false);
    expect(sg.references).toBeUndefined();
    expect(wb.references).toBeUndefined();
    const json = JSON.stringify(pack);
    const sensitive = await owner.case.findMany({ where: { orgId, sensitivity: { in: ["WELLBEING", "SAFEGUARDING"] } }, include: { student: true } });
    for (const c of sensitive) {
      expect(json).not.toContain(c.number);
      expect(json).not.toContain(c.titleEn);
      expect(json).not.toContain(c.student.lastNameEn);
    }
    // Counts are still there.
    expect(sg.metrics.find((m) => m.key === "opened")!.value).toBeGreaterThan(0);
  });

  it("a principal sees wellbeing references (role access) but not safeguarding ones", async () => {
    const ctx = await ctxFor(await member("principal"));
    const pack = await buildEvidencePack(ctx, { from, to, now, withReferences: true });
    const wb = pack.sections.find((s) => s.key === "wellbeing")!;
    const sg = pack.sections.find((s) => s.key === "safeguarding")!;
    expect(wb.referencesAllowed).toBe(true);
    expect(wb.references!.length).toBe(await owner.case.count({ where: { orgId, sensitivity: "WELLBEING", openedAt: { gte: from, lt: to } } }));
    const assignedSg = await owner.case.count({ where: { orgId, sensitivity: "SAFEGUARDING", assigneeId: ctx.membershipId } });
    if (assignedSg === 0) {
      expect(sg.referencesAllowed).toBe(false);
      expect(sg.references).toBeUndefined();
    }
    // References carry numbers and dates only.
    for (const r of wb.references!) expect(Object.keys(r).sort()).toEqual(["closedAt", "firstResponseHours", "number", "openedAt", "status"]);
  });

  it("staff without the permission cannot build the pack", async () => {
    const teacher = await ctxFor(await member("teacher"));
    await expect(buildEvidencePack(teacher, { from, to, now })).rejects.toBeInstanceOf(EvidenceError);
    const dsl = await ctxFor(await member("dsl"));
    await expect(buildEvidencePack(dsl, { from, to, now })).rejects.toThrow("FORBIDDEN");
  });

  it("mapping rows are seeded per school and isolated by tenant", async () => {
    expect(await owner.inspectionMapping.count({ where: { orgId } })).toBe(24);
    expect(await tenantDb(otherOrgId).inspectionMapping.count()).toBe(0);
  });
});

describe("career events", () => {
  let eventId: string;
  let advisor: string;
  let grade9: Array<{ id: string; membershipId: string | null }>;

  beforeAll(async () => {
    advisor = await member("career_advisor");
    grade9 = await owner.student.findMany({ where: { orgId, gradeLevel: 9, status: "ACTIVE" }, select: { id: true, membershipId: true }, take: 4, orderBy: { studentNo: "asc" } });
    const start = new Date(now.getTime() + 10 * 86_400_000);
    const res = await tenantTx(orgId, (tx) =>
      saveEvent(
        execCtx(tx, orgId, { quiet: true, now }),
        { kind: "UNIVERSITY_VISIT", titleEn: "Capacity test visit", titleAr: "", descEn: "", descAr: "", universityIds: [], otherUniversities: [], startsAt: start, endsAt: new Date(start.getTime() + 3600_000), locationEn: "Room 1", locationAr: "", onlineUrl: "", gradeLevels: [9], capacity: 2, registrationDeadline: null },
        advisor,
      ),
    );
    eventId = res.event.id;
    const stored = await owner.careerEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(stored.calendarEventId).toBeTruthy();
    const cal = await owner.calendarEvent.findUniqueOrThrow({ where: { id: stored.calendarEventId! } });
    expect(cal.gradeLevels).toEqual([9]);
  });

  const reg = (studentId: string, actor: string, org = orgId) => tenantTx(org, (tx) => registerStudent(execCtx(tx, org, { quiet: true, now }), { eventId, studentId, actorId: actor }));

  it("never goes over capacity, even when registrations race", async () => {
    const results = await Promise.allSettled(grade9.slice(0, 3).map((s) => reg(s.id, s.membershipId ?? advisor)));
    const ok = results.filter((r) => r.status === "fulfilled");
    const full = results.filter((r) => r.status === "rejected" && (r.reason as CareerEventError).code === "FULL");
    expect(ok).toHaveLength(2);
    expect(full).toHaveLength(1);
    expect(await owner.careerEventRegistration.count({ where: { eventId, status: "REGISTERED" } })).toBe(2);
  });

  it("registering twice is a no-op; cancelling frees the place", async () => {
    const registered = await owner.careerEventRegistration.findMany({ where: { eventId, status: "REGISTERED" } });
    const again = await reg(registered[0].studentId, advisor);
    expect(again.already).toBe(true);
    await tenantTx(orgId, (tx) => cancelRegistration(execCtx(tx, orgId, { quiet: true, now }), { eventId, studentId: registered[0].studentId, actorId: advisor }));
    const waiting = grade9.find((s) => !registered.some((r) => r.studentId === s.id))!;
    await reg(waiting.id, advisor);
    expect(await owner.careerEventRegistration.count({ where: { eventId, status: "REGISTERED" } })).toBe(2);
    await expect(reg(grade9[3].id, advisor)).rejects.toThrow("FULL");
  });

  it("students in other grades cannot register", async () => {
    const g11 = await owner.student.findFirstOrThrow({ where: { orgId, gradeLevel: 11, status: "ACTIVE" } });
    await expect(reg(g11.id, advisor)).rejects.toThrow("NOT_ELIGIBLE");
  });

  it("another school can neither see nor register for the event", async () => {
    expect(await tenantDb(otherOrgId).careerEvent.findMany({ where: { id: eventId } })).toHaveLength(0);
    expect(await tenantDb(otherOrgId).careerEventRegistration.count()).toBe(0);
    await expect(reg(grade9[3].id, advisor, otherOrgId)).rejects.toThrow("NOT_FOUND");
    expect(await tenantDb(otherOrgId).partnerResource.count()).toBe(0);
    expect(await tenantDb(orgId).partnerResource.count()).toBeGreaterThan(0);
  });

  it("reminders are sent once per registration", async () => {
    const soon = new Date(now.getTime() + 9 * 86_400_000 + 23 * 3600_000); // a day before the event
    const first = await tenantTx(orgId, (tx) => sendDueReminders(execCtx(tx, orgId, { quiet: true, now: soon })));
    expect(first.reminders).toBeGreaterThanOrEqual(2);
    const notes = await owner.notification.count({ where: { orgId, kind: "career_event_reminder", href: `/career/events/${eventId}` } });
    expect(notes).toBeGreaterThan(0);
    const second = await tenantTx(orgId, (tx) => sendDueReminders(execCtx(tx, orgId, { quiet: true, now: new Date(soon.getTime() + 3600_000) })));
    const mine = await owner.notification.count({ where: { orgId, kind: "career_event_reminder", href: `/career/events/${eventId}` } });
    expect(mine).toBe(notes);
    expect(second.reminders).toBeGreaterThanOrEqual(0);
  });
});
