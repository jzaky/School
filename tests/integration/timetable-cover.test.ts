// Timetable generation and staff absence cover against real Postgres through the RLS-restricted app role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx } from "@/server/db";
import { findClashes } from "@/server/timetable/solver";
import { loadSolverInput, currentYear, runGenerate } from "@/server/timetable/service";
import { dateKey, declineCover, reportAbsence, weekdayOfKey, addDays } from "@/server/timetable/cover";
import { busyKey } from "@/server/timetable/cover-picker";
import { seedDemo } from "../../prisma/seed/demo";
import { ownerClient } from "./helpers";

const SLUG = "horizon-tt-itest";
let owner: PrismaClient;
let orgId: string;

beforeAll(async () => {
  owner = ownerClient();
  const res = await seedDemo(owner, { slug: SLUG });
  orgId = res.orgId;
}, 300000);

afterAll(async () => {
  await owner?.organization.deleteMany({ where: { slug: SLUG } });
  await owner?.$disconnect();
});

/** Next school day at least `min` days ahead, as YYYY-MM-DD. */
function nextSchoolDay(min: number) {
  let k = addDays(dateKey(new Date()), min);
  while (![1, 2, 3, 4, 5].includes(weekdayOfKey(k))) k = addDays(k, 1);
  return k;
}

describe("timetable", () => {
  it("seeds a clash-free timetable where every section has its lessons", async () => {
    const input = await tenantTx(orgId, async (tx) => {
      const year = await currentYear(tx, orgId);
      return loadSolverInput(tx, orgId, year!.id);
    });
    expect(input.slots.length).toBeGreaterThan(200);
    const placements = input.slots.map((s) => ({ classId: s.classId, day: s.dayOfWeek, period: s.periodNo }));
    expect(findClashes(placements, input.classes)).toEqual([]);
    for (const c of input.classes) expect(input.slots.filter((s) => s.classId === c.id).length).toBe(c.periods);
  });

  it("regenerates with locked lessons kept", async () => {
    const slot = await owner.timetableSlot.findFirstOrThrow({ where: { orgId }, orderBy: { id: "asc" } });
    await owner.timetableSlot.update({ where: { id: slot.id }, data: { locked: true } });
    const report = await tenantTx(orgId, (tx) => runGenerate(tx, orgId, {}), { timeout: 60000 });
    expect(report?.unplaced).toEqual([]);
    const still = await owner.timetableSlot.findUniqueOrThrow({ where: { id: slot.id } });
    expect([still.dayOfWeek, still.periodNo, still.locked]).toEqual([slot.dayOfWeek, slot.periodNo, true]);
  });
});

describe("staff absence and cover", () => {
  it("reports an absence, assigns free substitutes and notifies them", async () => {
    const day = nextSchoolDay(3);
    const wd = weekdayOfKey(day);
    const slots = await owner.timetableSlot.findMany({ where: { orgId, dayOfWeek: wd, teacherMembershipId: { not: null } } });
    const perTeacher = new Map<string, number>();
    for (const s of slots) perTeacher.set(s.teacherMembershipId!, (perTeacher.get(s.teacherMembershipId!) ?? 0) + 1);
    const teacher = [...perTeacher.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const lessons = slots.filter((s) => s.teacherMembershipId === teacher).length;

    const res = await tenantTx(orgId, (tx) => reportAbsence(execCtx(tx, orgId, { quiet: true }), { membershipId: teacher, startsOn: day, endsOn: day, allDay: true, notes: "Test notes", reportedById: teacher }), { timeout: 60000 });
    expect(res.created).toBe(lessons);
    const covers = await owner.coverAssignment.findMany({ where: { orgId, absenceId: res.absence.id } });
    expect(covers).toHaveLength(lessons);
    expect(covers.filter((c) => c.status === "ASSIGNED").length).toBeGreaterThan(0);

    // Every substitute is free that period: not teaching, and not covering twice.
    const busy = new Set(slots.map((s) => busyKey(day, s.periodNo, s.teacherMembershipId!)));
    const seen = new Set<string>();
    for (const c of covers.filter((x) => x.substituteId)) {
      expect(c.substituteId).not.toBe(teacher);
      expect(busy.has(busyKey(day, c.periodNo, c.substituteId!))).toBe(false);
      const k = `${c.periodNo}|${c.substituteId}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
      expect(c.notifiedAt).not.toBeNull();
      const inApp = await owner.notification.count({ where: { orgId, recipientId: c.substituteId!, kind: "cover_assigned" } });
      expect(inApp).toBeGreaterThan(0);
      const email = await owner.outboundMessage.count({ where: { orgId, idempotencyKey: { startsWith: `cover:${c.id}:${c.substituteId}:` } } });
      expect(email).toBe(1);
    }
    const absence = await owner.staffAbsence.findUniqueOrThrow({ where: { id: res.absence.id } });
    expect(["COVERED", "PARTLY_COVERED"]).toContain(absence.status);
    expect(await owner.auditEvent.count({ where: { orgId, action: "absence.report", entityId: res.absence.id } })).toBe(1);

    // A second report for the same day is refused.
    await expect(
      tenantTx(orgId, (tx) => reportAbsence(execCtx(tx, orgId, { quiet: true }), { membershipId: teacher, startsOn: day, endsOn: day, allDay: true, reportedById: teacher })),
    ).rejects.toThrow("OVERLAP");

    // A substitute declines: someone else gets the lesson, and never the one who declined.
    const first = covers.find((c) => c.status === "ASSIGNED")!;
    const next = await tenantTx(orgId, (tx) => declineCover(execCtx(tx, orgId, { quiet: true }), first.id, first.substituteId!, "Exam invigilation"), { timeout: 60000 });
    const after = await owner.coverAssignment.findUniqueOrThrow({ where: { id: first.id } });
    if (next) {
      expect(after.status).toBe("ASSIGNED");
      expect(after.substituteId).toBe(next);
      expect(next).not.toBe(first.substituteId);
    } else expect(after.status).toBe("DECLINED");
  });
});
