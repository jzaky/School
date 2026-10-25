// Request conversations and absence privacy, against real Postgres through the RLS-restricted app role.
// Proves: families never receive staff-only or private messages (loader, unread counts, notifications, server
// action, attachment route); private notes reach only the author and the chosen staff; teachers and the
// principal never see sick-day reasons or doctor's notes; substitutes never see a private staff absence reason;
// rule 7 on wellbeing matters; tenant isolation for the new tables.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/queue", () => ({ flushEffects: async () => undefined, queue: () => null }));
vi.mock("@/server/context", () => ({ getCtx: async () => current.ctx, getOptionalCtx: async () => current.ctx }));

import type { PrismaClient } from "@prisma/client";
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { can, permissionsOf, roleKeysOf } from "@/server/identity/can";
import type { Ctx } from "@/server/context";
import { ConversationError, handlingTeam, loadThread, postMessage, threadAccess, unreadByRequest } from "@/server/requests/conversation";
import { postRequestMessageAction } from "@/server/requests/conversation-actions";
import { canSeeAbsenceReason, canSeeStaffAbsenceReason } from "@/server/access/absence-access";
import { reportAbsence, addDays, dateKey, weekdayOfKey } from "@/server/timetable/cover";
import { searchAction } from "@/server/search/actions";
import { GET as fileRoute } from "@/app/api/requests/[id]/file/route";
import { seedDemo } from "../../prisma/seed/demo";
import { ownerClient, uid } from "./helpers";

const SLUG = "horizon-convo-itest";
let owner: PrismaClient;
let orgId: string;
let otherOrgId: string;
const ids: Record<string, string> = {};

async function member(key: string) {
  const p = await owner.demoPersona.findUniqueOrThrow({ where: { orgId_key: { orgId, key } } });
  return p.membershipId;
}

async function ctxFor(membershipId: string, org = orgId): Promise<Ctx> {
  const membership = await owner.membership.findUniqueOrThrow({ where: { id: membershipId }, include: { roles: { include: { role: true } }, staffProfile: true, student: true, guardian: { include: { links: { include: { student: true } } } } } });
  const user = await owner.user.findUniqueOrThrow({ where: { id: membership.userId } });
  const o = await owner.organization.findUniqueOrThrow({ where: { id: org } });
  const roles = roleKeysOf(membership);
  return {
    orgId: org,
    db: tenantDb(org),
    org: o,
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
const as = async (membershipId: string) => {
  const c = await ctxFor(membershipId);
  current.ctx = c;
  return c;
};

beforeAll(async () => {
  owner = ownerClient();
  const res = await seedDemo(owner, { slug: SLUG });
  orgId = res.orgId;
  for (const k of ["admin", "principal", "teacher", "parent", "student", "registrar", "counselor"]) ids[k] = await member(k);
  const nurse = await owner.membershipRole.findFirstOrThrow({ where: { orgId, role: { key: "nurse" } } });
  ids.nurse = nurse.membershipId;
  const rania = ids.parent;
  ids.bus = (await owner.request.findFirstOrThrow({ where: { orgId, requesterId: rania, service: { key: "transport_request" } } })).id;
  ids.sick = (await owner.request.findFirstOrThrow({ where: { orgId, requesterId: rania, service: { key: "absence_request" }, submission: { data: { path: ["absenceType"], equals: "illness" } } } })).id;
  ids.leave = (await owner.staffAbsence.findFirstOrThrow({ where: { orgId, membershipId: ids.teacher, requestId: { not: null } } })).requestId!;
  const other = await owner.organization.create({ data: { slug: uid("convo-other"), nameEn: "Other School", nameAr: "مدرسة أخرى" } });
  otherOrgId = other.id;
}, 300_000);

afterAll(async () => {
  await owner?.organization.deleteMany({ where: { OR: [{ slug: SLUG }, { id: otherOrgId }] } });
  await owner?.$disconnect();
});

describe("families only ever get shared messages", () => {
  it("the parent's thread, unread counts and the seeded data", async () => {
    const all = await owner.requestMessage.findMany({ where: { orgId, requestId: ids.bus } });
    expect(all.some((m) => m.visibility === "STAFF")).toBe(true);
    expect(all.some((m) => m.visibility === "PRIVATE")).toBe(true);
    const rania = await as(ids.parent);
    const thread = await loadThread(rania, ids.bus, { markRead: false });
    expect(thread).not.toBeNull();
    expect(thread!.messages.length).toBe(all.filter((m) => m.visibility === "SHARED").length);
    expect(thread!.messages.every((m) => m.visibility === "SHARED")).toBe(true);
    const json = JSON.stringify(thread);
    for (const m of all.filter((x) => x.visibility !== "SHARED")) expect(json).not.toContain(m.body.slice(0, 40));
    // The seeded thread has one shared message Rania has not read yet; staff notes never count.
    const req = await owner.request.findUniqueOrThrow({ where: { id: ids.bus } });
    expect((await unreadByRequest(rania, [req])).get(ids.bus)).toBe(1);
  });

  it("a staff-only note and a private note never reach the family, by any path", async () => {
    const aisha = await as(ids.admin);
    const effects: Effect[] = [];
    const before = await owner.notification.count({ where: { orgId, recipientId: ids.parent } });
    const staffNote = await postMessage(aisha, { requestId: ids.bus, body: "Internal: route 7 driver changes next month.", visibility: "STAFF" }, { effects });
    const privateNote = await postMessage(aisha, { requestId: ids.bus, body: "Private: fee waiver is likely.", visibility: "PRIVATE", privateToIds: [ids.principal] }, { effects });
    expect(await owner.notification.count({ where: { orgId, recipientId: ids.parent } })).toBe(before);
    const outbound = await owner.outboundMessage.findMany({ where: { orgId, idempotencyKey: { startsWith: `reqmsg:${privateNote.id}` } } });
    expect(outbound.every((o) => !o.idempotencyKey.includes(ids.parent))).toBe(true);
    expect((await owner.notification.findMany({ where: { orgId, recipientId: ids.principal, kind: "request_message" } })).length).toBeGreaterThan(0);
    // Parent and student loaders still show shared messages only.
    for (const who of [ids.parent, ids.student]) {
      const c = await as(who);
      const t = await loadThread(c, ids.bus, { markRead: false });
      if (!t) continue; // the student may not reach a parent-only service
      expect(t.messages.find((m) => m.id === staffNote.id || m.id === privateNote.id)).toBeUndefined();
    }
    // Directly through the app role: the family's filter cannot be widened.
    const rania = await as(ids.parent);
    await expect(postMessage(rania, { requestId: ids.bus, body: "x", visibility: "STAFF" }, { effects })).rejects.toThrow(ConversationError);
    await expect(postMessage(rania, { requestId: ids.bus, body: "x", visibility: "PRIVATE", privateToIds: [ids.admin] }, { effects })).rejects.toThrow(ConversationError);
  });

  it("the server action refuses staff and private messages from a parent, and accepts a shared reply that notifies staff", async () => {
    await as(ids.parent);
    expect(await postRequestMessageAction({ requestId: ids.bus, body: "Peek", visibility: "STAFF" })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await postRequestMessageAction({ requestId: ids.bus, body: "Peek", visibility: "PRIVATE", privateToIds: [ids.admin] })).toEqual({ ok: false, error: "FORBIDDEN" });
    const res = await postRequestMessageAction({ requestId: ids.bus, body: "Thank you again!", visibility: "SHARED" });
    expect(res.ok).toBe(true);
    const n = await owner.notification.findFirst({ where: { orgId, recipientId: ids.admin, kind: "request_message" }, orderBy: { createdAt: "desc" } });
    expect(n?.titleEn).toContain("replied");
    // Notifications never carry the message text.
    expect(n?.bodyEn ?? "").not.toContain("Thank you again");
    const audit = await owner.auditEvent.findFirst({ where: { orgId, action: "request.message.create", actorId: ids.parent }, orderBy: { createdAt: "desc" } });
    expect(audit).not.toBeNull();
  });
});

describe("private notes", () => {
  it("are visible only to the author and the chosen staff", async () => {
    const privates = await owner.requestMessage.findMany({ where: { orgId, requestId: ids.bus, visibility: "PRIVATE" } });
    expect(privates.length).toBeGreaterThan(0);
    for (const who of [ids.admin, ids.principal, ids.registrar]) {
      const c = await as(who);
      const t = await loadThread(c, ids.bus, { markRead: false });
      expect(t).not.toBeNull();
      const seen = new Set(t!.messages.map((m) => m.id));
      for (const p of privates) expect(seen.has(p.id)).toBe(p.membershipId === who || p.privateToIds.includes(who));
      // Staff-only notes are shared with the whole handling team.
      expect(t!.messages.some((m) => m.visibility === "STAFF")).toBe(true);
    }
    // On Adam's sick days, the registrar and the nurse share a private note the administrator cannot read.
    const nurse = await as(ids.nurse);
    const nt = await loadThread(nurse, ids.sick, { markRead: false });
    expect(nt?.messages.some((m) => m.visibility === "PRIVATE")).toBe(true);
    const aisha = await as(ids.admin);
    const at = await loadThread(aisha, ids.sick, { markRead: false });
    expect(at).not.toBeNull();
    expect(at!.messages.some((m) => m.visibility === "PRIVATE")).toBe(false);
  });

  it("can only go to staff who can see the request", async () => {
    const aisha = await as(ids.admin);
    const access = await threadAccess(aisha, ids.bus);
    const team = await handlingTeam(aisha.db, access!);
    expect(team.some((p) => p.id === ids.teacher)).toBe(false);
    await expect(postMessage(aisha, { requestId: ids.bus, body: "x", visibility: "PRIVATE", privateToIds: [ids.teacher] }, { effects: [] })).rejects.toThrow("RECIPIENT_NOT_ALLOWED");
    await expect(postMessage(aisha, { requestId: ids.bus, body: "x", visibility: "PRIVATE", privateToIds: [] }, { effects: [] })).rejects.toThrow("RECIPIENTS_REQUIRED");
  });
});

describe("student sick days are private", () => {
  it("teachers and the principal see neither the reason, the conversation nor the doctor's note", async () => {
    const sick = await owner.request.findUniqueOrThrow({ where: { id: ids.sick }, include: { service: true, submission: true } });
    const data = sick.submission!.data as Record<string, unknown>;
    expect(data.absenceType).toBe("illness");
    for (const who of [ids.teacher, ids.principal, ids.counselor]) {
      const c = await as(who);
      expect(canSeeAbsenceReason(c, sick, data, { approver: true })).toBe(false);
      expect(await threadAccess(c, ids.sick)).toBeNull();
      const res = await fileRoute(new Request(`http://x/api/requests/${ids.sick}/file?field=medicalNote`), { params: Promise.resolve({ id: ids.sick }) });
      expect([403, 404]).toContain(res.status);
    }
    // Even as an approver (the old homeroom workflow), a teacher gets no medical reason or file.
    const approval = await owner.approvalRequest.findFirstOrThrow({ where: { orgId, requestId: ids.sick } });
    await owner.approvalAssignee.create({ data: { orgId, approvalRequestId: approval.id, membershipId: ids.teacher, labelEn: "Homeroom", labelAr: "معلم الفصل", status: "APPROVED" } });
    await as(ids.teacher);
    const denied = await fileRoute(new Request(`http://x/api/requests/${ids.sick}/file?field=medicalNote`), { params: Promise.resolve({ id: ids.sick }) });
    expect([403, 404]).toContain(denied.status);
    expect(canSeeAbsenceReason(current.ctx as Ctx, sick, data, { approver: true })).toBe(false);
    expect(await threadAccess(current.ctx as Ctx, ids.sick)).toBeNull();
    await owner.approvalAssignee.deleteMany({ where: { orgId, approvalRequestId: approval.id, membershipId: ids.teacher } });
  });

  it("the family, the attendance office and the nurse can open the reason and the note", async () => {
    for (const who of [ids.parent, ids.registrar, ids.nurse, ids.admin]) {
      await as(who);
      const res = await fileRoute(new Request(`http://x/api/requests/${ids.sick}/file?field=medicalNote`), { params: Promise.resolve({ id: ids.sick }) });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
    }
    expect(await owner.auditEvent.count({ where: { orgId, action: "request.file.view", entityId: ids.sick } })).toBeGreaterThanOrEqual(4);
  });

  it("the register marks the days excused and reported by the parent, and the teacher is told without the reason", async () => {
    const marks = await owner.attendanceRecord.findMany({ where: { orgId, requestId: ids.sick } });
    expect(marks.length).toBe(2);
    expect(marks.every((m) => m.status === "EXCUSED" && m.source === "PARENT")).toBe(true);
    const notes = await owner.notification.findMany({ where: { orgId, recipientId: ids.teacher, kind: "absence_excused" } });
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) {
      const text = `${n.titleEn} ${n.bodyEn} ${n.titleAr} ${n.bodyAr}`.toLowerCase();
      for (const word of ["tonsillitis", "illness", "sore throat", "temperature", "مرض"]) expect(text).not.toContain(word);
    }
  });

  it("global search never surfaces the reason or messages", async () => {
    for (const who of [ids.teacher, ids.principal, ids.admin]) {
      await as(who);
      expect(await searchAction("tonsillitis")).toEqual([]);
      expect(await searchAction("route 7")).toEqual([]);
      const hits = await searchAction("Adam");
      expect(JSON.stringify(hits).toLowerCase()).not.toContain("tonsillitis");
    }
  });
});

describe("staff absence reasons are private", () => {
  it("substitutes get the cover notes, never the private reason", async () => {
    let day = addDays(dateKey(new Date()), 15);
    while (![1, 2, 3, 4, 5].includes(weekdayOfKey(day))) day = addDays(day, 1);
    const slot = await owner.timetableSlot.findFirstOrThrow({ where: { orgId, dayOfWeek: weekdayOfKey(day), teacherMembershipId: { not: null } }, orderBy: { id: "asc" } });
    const teacher = slot.teacherMembershipId!;
    const res = await tenantTx(
      orgId,
      (tx) =>
        reportAbsence(execCtx(tx, orgId, { quiet: true }), {
          membershipId: teacher,
          startsOn: day,
          endsOn: day,
          allDay: true,
          notes: "COVER-NOTES worksheet on the shared drive",
          reasonKind: "SICK",
          privateReason: "SECRET-REASON chest infection",
          reportedById: ids.admin,
        }),
      { timeout: 60000 },
    );
    const covers = await owner.coverAssignment.findMany({ where: { orgId, absenceId: res.absence.id, substituteId: { not: null } } });
    expect(covers.length).toBeGreaterThan(0);
    const subs = [...new Set(covers.map((c) => c.substituteId!))];
    const dayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
    const notes = await owner.notification.findMany({ where: { orgId, recipientId: { in: subs }, kind: "cover_assigned", titleEn: { contains: dayLabel } } });
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) {
      const text = `${n.titleEn} ${n.bodyEn} ${n.titleAr} ${n.bodyAr}`;
      expect(text).toContain("COVER-NOTES");
      expect(text).not.toContain("SECRET-REASON");
      expect(text.toLowerCase()).not.toContain("chest");
      expect(text.toLowerCase()).not.toContain("sick");
    }
    const outbound = await owner.outboundMessage.findMany({ where: { orgId, createdAt: { gte: res.absence.createdAt } } });
    for (const o of outbound) expect(`${o.subject}`).not.toContain("SECRET-REASON");
    const audit = await owner.auditEvent.findFirstOrThrow({ where: { orgId, action: "absence.report", entityId: res.absence.id } });
    expect(JSON.stringify(audit.meta)).not.toContain("SECRET-REASON");
    // Who may see the reason.
    const absence = await owner.staffAbsence.findUniqueOrThrow({ where: { id: res.absence.id } });
    for (const sub of subs) expect(canSeeStaffAbsenceReason(await ctxFor(sub), absence)).toBe(sub === teacher);
    expect(canSeeStaffAbsenceReason(await ctxFor(ids.registrar), absence)).toBe(false);
    expect(canSeeStaffAbsenceReason(await ctxFor(ids.principal), absence)).toBe(true);
    expect(canSeeStaffAbsenceReason(await ctxFor(teacher), absence)).toBe(true);
    expect(canSeeStaffAbsenceReason(await ctxFor(ids.admin), absence)).toBe(true);
  });

  it("an approved sick leave request becomes an absence with cover, and its details stay private", async () => {
    const leave = await owner.request.findUniqueOrThrow({ where: { id: ids.leave }, include: { service: true, submission: true } });
    const absence = await owner.staffAbsence.findFirstOrThrow({ where: { orgId, requestId: leave.id } });
    expect(absence.reasonKind).toBe("SICK");
    expect(absence.coverNotes).toContain("worksheet");
    const data = leave.submission!.data as Record<string, unknown>;
    const mona = await as(ids.registrar);
    expect(mona.can("requests.view_all")).toBe(true);
    expect(canSeeAbsenceReason(mona, leave, data)).toBe(false);
    expect(await threadAccess(mona, leave.id)).toBeNull();
    const denied = await fileRoute(new Request(`http://x/api/requests/${leave.id}/file?field=medicalCertificate`), { params: Promise.resolve({ id: leave.id }) });
    expect([403, 404]).toContain(denied.status);
    const omar = await as(ids.principal);
    expect(canSeeAbsenceReason(omar, leave, data)).toBe(true);
    const thread = await loadThread(omar, leave.id, { markRead: false });
    expect(thread?.messages.some((m) => m.visibility === "PRIVATE")).toBe(true);
    // Daniel sees his own request and shared messages, not the private note about him.
    const daniel = await as(ids.teacher);
    const own = await loadThread(daniel, leave.id, { markRead: false });
    expect(own?.messages.every((m) => m.visibility === "SHARED")).toBe(true);
  });
});

describe("wellbeing matters (rule 7)", () => {
  it("the family is not notified unless staff record a decision, and staff views are audited", async () => {
    // A family request linked to a wellbeing case.
    const letter = await owner.request.findFirstOrThrow({ where: { orgId, requesterId: ids.parent, service: { key: "document_request" } } });
    const c = await owner.case.create({ data: { orgId, number: uid("WB"), type: "WELLBEING", sensitivity: "WELLBEING", studentId: letter.studentId!, titleEn: "Wellbeing", titleAr: "رفاه", assigneeId: ids.counselor } });
    await owner.request.update({ where: { id: letter.id }, data: { caseId: c.id } });
    try {
      // Staff without wellbeing access lose the thread.
      expect(await threadAccess(await ctxFor(ids.registrar), letter.id)).toBeNull();
      const sarah = await as(ids.counselor);
      const access = await threadAccess(sarah, letter.id);
      expect(access?.sensitive).toBe(true);
      const before = await owner.notification.count({ where: { orgId, recipientId: ids.parent } });
      await postMessage(sarah, { requestId: letter.id, body: "Shared without a decision", visibility: "SHARED" }, { effects: [] });
      expect(await owner.notification.count({ where: { orgId, recipientId: ids.parent } })).toBe(before);
      await expect(postMessage(sarah, { requestId: letter.id, body: "x", visibility: "SHARED", notifyFamily: true, notifyReason: "" }, { effects: [] })).rejects.toThrow("REASON_REQUIRED");
      await postMessage(sarah, { requestId: letter.id, body: "Shared with a decision", visibility: "SHARED", notifyFamily: true, notifyReason: "Agreed with the student to update the family." }, { effects: [] });
      expect(await owner.notification.count({ where: { orgId, recipientId: ids.parent } })).toBe(before + 1);
      expect(await owner.parentNotificationDecision.count({ where: { orgId, caseId: c.id, decision: "NOTIFY" } })).toBe(1);
      await loadThread(sarah, letter.id, { markRead: false });
      expect(await owner.auditEvent.count({ where: { orgId, action: "request.messages.view", entityId: letter.id, actorId: ids.counselor } })).toBeGreaterThan(0);
    } finally {
      await owner.request.update({ where: { id: letter.id }, data: { caseId: null } });
    }
  });
});

describe("tenant isolation", () => {
  it("another school can neither read, change nor add conversation rows", async () => {
    const msg = await owner.requestMessage.findFirstOrThrow({ where: { orgId } });
    const other = tenantDb(otherOrgId);
    expect(await other.requestMessage.findUnique({ where: { id: msg.id } })).toBeNull();
    expect(await other.requestMessage.count()).toBe(0);
    expect(await other.requestThreadRead.count()).toBe(0);
    expect((await other.requestMessage.updateMany({ where: { id: msg.id }, data: { body: "hacked" } })).count).toBe(0);
    expect((await other.requestMessage.deleteMany({ where: { id: msg.id } })).count).toBe(0);
    await expect(other.requestMessage.create({ data: { orgId, requestId: msg.requestId, membershipId: msg.membershipId, body: "x" } })).rejects.toThrow();
    await expect(
      tenantTx(otherOrgId, (tx) => tx.$executeRaw`INSERT INTO "RequestMessage" (id, "orgId", "requestId", "membershipId", visibility, "privateToIds", body) VALUES (${uid("m")}, ${orgId}, ${msg.requestId}, ${msg.membershipId}, 'SHARED', '{}', 'x')`),
    ).rejects.toThrow();
    expect((await owner.requestMessage.findUniqueOrThrow({ where: { id: msg.id } })).body).toBe(msg.body);
    // A member of another school gets no thread for this school's request id.
    const outsider = await owner.user.create({ data: { email: `${uid("o")}@iso.test`, nameEn: "Outsider" } });
    const m = await owner.membership.create({ data: { orgId: otherOrgId, userId: outsider.id } });
    expect(await threadAccess(await ctxFor(m.id, otherOrgId), msg.requestId)).toBeNull();
    await owner.user.delete({ where: { id: outsider.id } });
  });
});
