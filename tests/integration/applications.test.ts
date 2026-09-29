// Application tracker through the RLS-restricted app role: start from a shortlist entry, checklist, idempotent
// task generation, recommendation letters and who may read an application.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { execCtx } from "@/server/db";
import { assignRecommendation, changeStage, generateTasks, LEDGER_QUEUE, setItemDue, startApplication, syncLetterTask } from "@/server/applications/service";
import { readableApplication } from "@/server/applications/access";
import { runApplicationReminders } from "@/server/applications/reminders";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
const orgIds: string[] = [];
const userIds: string[] = [];
let orgId: string;
let otherOrgId: string;
let studentId: string;
let otherStudentId: string;
let entryId: string;
let programId: string;
let teacherId: string;
let counselorId: string;
let parentMembership: { id: string; guardianLinks: string[] };
let appId: string;
const now = new Date(Date.UTC(2026, 8, 29, 8));

async function member(org: string, name: string, staff: boolean) {
  const user = await owner.user.create({ data: { email: `${uid(name)}@example.test`, nameEn: name } });
  userIds.push(user.id);
  const m = await owner.membership.create({ data: { orgId: org, userId: user.id } });
  if (staff) await owner.staffProfile.create({ data: { orgId: org, membershipId: m.id } });
  return m.id;
}

/** Just enough of the request context for the access module. */
function fakeCtx(kind: "student" | "parent" | "manager", membershipId: string, links: string[], selfStudentId?: string) {
  const perms = kind === "manager" ? ["applications.manage", "pathways.view", "people.view"] : ["pathways.view"];
  return {
    orgId,
    db: tenantDb(orgId),
    membershipId,
    isStudent: kind === "student",
    isParent: kind === "parent",
    isStaff: kind === "manager",
    can: (p: string) => perms.includes(p),
    membership: { student: selfStudentId ? { id: selfStudentId } : null, guardian: kind === "parent" ? { links: links.map((studentId) => ({ studentId })) } : null },
  } as never;
}

beforeAll(async () => {
  const org = await owner.organization.create({ data: { slug: uid("apps-itest"), nameEn: "Applications Test School", nameAr: "مدرسة اختبار الطلبات" } });
  const other = await owner.organization.create({ data: { slug: uid("apps-other"), nameEn: "Other School", nameAr: "مدرسة أخرى" } });
  orgId = org.id;
  otherOrgId = other.id;
  orgIds.push(orgId, otherOrgId);
  const studentMember = await member(orgId, "Student", false);
  teacherId = await member(orgId, "Teacher", true);
  counselorId = await member(orgId, "Counselor", true);
  const parentId = await member(orgId, "Parent", false);
  const s = await owner.student.create({ data: { orgId, studentNo: "AP-1", firstNameEn: "Test", lastNameEn: "Senior", firstNameAr: "طالب", lastNameAr: "اختبار", gradeLevel: 12, curriculum: "BRITISH", membershipId: studentMember } });
  const s2 = await owner.student.create({ data: { orgId, studentNo: "AP-2", firstNameEn: "Other", lastNameEn: "Family", firstNameAr: "آخر", lastNameAr: "عائلة", gradeLevel: 12, curriculum: "BRITISH" } });
  studentId = s.id;
  otherStudentId = s2.id;
  await owner.careerProfile.create({ data: { orgId, studentId, advisorId: counselorId } });
  const g = await owner.guardian.create({ data: { orgId, membershipId: parentId, firstNameEn: "P", lastNameEn: "Other", firstNameAr: "و", lastNameAr: "أمر" } });
  await owner.guardianLink.create({ data: { orgId, guardianId: g.id, studentId: otherStudentId } });
  parentMembership = { id: parentId, guardianLinks: [otherStudentId] };
  const uni = await owner.university.create({ data: { orgId, key: "apps_test_uni", nameEn: "Test University", nameAr: "جامعة الاختبار", countryCode: "GB", cityEn: "London", cityAr: "لندن", applyVia: "UCAS" } });
  const program = await owner.universityProgram.create({
    data: { orgId, universityId: uni.id, key: "apps-test-cs", nameEn: "Computer Science BSc", nameAr: "علوم الحاسوب", field: "computer_science", degree: "BSc", requirements: { route: { via: "UCAS" }, admissionsTests: ["TMUA"] }, englishReq: { ielts: 7 } },
  });
  programId = program.id;
  await owner.applicationDeadline.create({ data: { orgId, programId, universityId: uni.id, intakeYear: 2027, kind: "UCAS_EQUAL", date: new Date(Date.UTC(2027, 0, 14, 12)) } });
  const entry = await owner.shortlistEntry.create({ data: { orgId, studentId, universityId: uni.id, programEn: "Computer Science BSc", category: "TARGET" } });
  entryId = entry.id;
});

afterAll(async () => {
  for (const id of orgIds) {
    const where = { orgId: id };
    await owner.notification.deleteMany({ where });
    await owner.outboundMessage.deleteMany({ where });
    await owner.messageTemplate.deleteMany({ where });
    await owner.task.deleteMany({ where });
    await owner.jobRun.deleteMany({ where });
    await owner.application.deleteMany({ where });
    await owner.applicationDeadline.deleteMany({ where });
    await owner.shortlistEntry.deleteMany({ where });
    await owner.universityProgram.deleteMany({ where });
    await owner.university.deleteMany({ where });
    await owner.careerProfile.deleteMany({ where });
    await owner.guardianLink.deleteMany({ where });
    await owner.guardian.deleteMany({ where });
    await owner.student.deleteMany({ where });
    await owner.staffProfile.deleteMany({ where });
    await owner.auditEvent.deleteMany({ where });
    await owner.membership.deleteMany({ where });
    await owner.organization.delete({ where: { id } });
  }
  await owner.user.deleteMany({ where: { id: { in: userIds } } });
  await owner.$disconnect();
});

describe("application tracker", () => {
  it("starts an application from a shortlist entry and builds the checklist", async () => {
    const res = await tenantTx(orgId, (tx) => startApplication(tx, orgId, { studentId, shortlistEntryId: entryId, actorId: null, now }));
    expect(res).toMatchObject({ ok: true, created: true });
    if (!res.ok) return;
    appId = res.applicationId;
    const app = await owner.application.findUniqueOrThrow({ where: { id: appId }, include: { items: true } });
    expect(app).toMatchObject({ programId, route: "UCAS", intakeYear: 2027, stage: "PREPARING", counselorId });
    expect(app.items.map((i) => i.titleEn)).toEqual(expect.arrayContaining(["UCAS personal statement", "TMUA admissions test", "IELTS 7 or equivalent", "Submit the UCAS application"]));
    expect(app.items.every((i) => i.titleAr)).toBe(true);
    expect((await owner.shortlistEntry.findUniqueOrThrow({ where: { id: entryId } })).programId).toBe(programId);
    expect(await owner.auditEvent.count({ where: { orgId, action: "applications.start", entityId: appId } })).toBe(1);
    // Starting again returns the same application.
    const again = await tenantTx(orgId, (tx) => startApplication(tx, orgId, { studentId, shortlistEntryId: entryId, actorId: null, now }));
    expect(again).toMatchObject({ ok: true, created: false, applicationId: appId });
  });

  it("generates tasks idempotently, keyed per application, item and cycle", async () => {
    const first = await tenantTx(orgId, (tx) => generateTasks(tx, orgId, appId, { now }));
    expect(first.created).toBeGreaterThan(3);
    expect(first.deadline?.source).toBe("PROGRAM");
    const count = await owner.task.count({ where: { orgId } });
    const second = await tenantTx(orgId, (tx) => generateTasks(tx, orgId, appId, { now }));
    expect(second.created).toBe(0);
    expect(await owner.task.count({ where: { orgId } })).toBe(count);
    const keys = await owner.jobRun.findMany({ where: { orgId, queue: LEDGER_QUEUE } });
    expect(new Set(keys.map((k) => k.idempotencyKey)).size).toBe(keys.length);
    expect(keys.every((k) => k.idempotencyKey.startsWith(`app:${appId}:`) && k.idempotencyKey.includes(":2027:"))).toBe(true);
    // Counselor work goes to the counselor, student work to the student.
    const tasks = await owner.task.findMany({ where: { orgId } });
    expect(tasks.some((t) => t.assigneeId === counselorId)).toBe(true);
    expect(tasks.every((t) => t.studentId === studentId && t.href === `/career/applications/${appId}`)).toBe(true);
  });

  it("regeneration keeps completed tasks and locked dates", async () => {
    const tasks = await owner.task.findMany({ where: { orgId }, orderBy: { dueAt: "asc" } });
    await owner.task.update({ where: { id: tasks[0].id }, data: { status: "DONE", completedAt: now } });
    const item = await owner.applicationRequirement.findFirstOrThrow({ where: { applicationId: appId, kind: "PERSONAL_STATEMENT" } });
    const locked = new Date(Date.UTC(2026, 11, 1, 12));
    await tenantTx(orgId, (tx) => setItemDue(tx, orgId, { itemId: item.id, dueAt: locked, actorId: null }));
    await tenantTx(orgId, (tx) => generateTasks(tx, orgId, appId, { now: new Date(now.getTime() + 7 * 86_400_000) }));
    expect((await owner.task.findUniqueOrThrow({ where: { id: tasks[0].id } })).status).toBe("DONE");
    const ledger = await owner.jobRun.findFirstOrThrow({ where: { orgId, idempotencyKey: { startsWith: `app:${appId}:${item.id}:` } } });
    const psTask = await owner.task.findUniqueOrThrow({ where: { id: (ledger.result as { taskId: string }).taskId } });
    expect(psTask.dueAt?.toISOString()).toBe(locked.toISOString());
  });

  it("assigning a recommendation creates one teacher task and notifies the teacher; completing it ticks the item", async () => {
    const item = await owner.applicationRequirement.findFirstOrThrow({ where: { applicationId: appId, kind: "RECOMMENDATION" } });
    const r1 = await tenantTx(orgId, (tx) => assignRecommendation(execCtx(tx, orgId, { now, quiet: true }), { itemId: item.id, teacherId, actorId: counselorId }));
    expect(r1).toMatchObject({ ok: true, created: true });
    const r2 = await tenantTx(orgId, (tx) => assignRecommendation(execCtx(tx, orgId, { now, quiet: true }), { itemId: item.id, teacherId, actorId: counselorId }));
    expect(r2).toMatchObject({ ok: true, created: false });
    const letterTasks = await owner.task.findMany({ where: { orgId, assigneeId: teacherId } });
    expect(letterTasks).toHaveLength(1);
    expect(letterTasks[0].titleEn).toContain("Recommendation letter");
    expect(await owner.notification.count({ where: { orgId, recipientId: teacherId } })).toBe(1);
    expect((await owner.applicationRequirement.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("IN_PROGRESS");
    await tenantTx(orgId, async (tx) => {
      await tx.task.update({ where: { id: letterTasks[0].id }, data: { status: "DONE" } });
      await syncLetterTask(tx, orgId, letterTasks[0].id, "DONE");
    });
    expect((await owner.applicationRequirement.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("DONE");
    // Assigning a teacher is not something a student can reach, and the counselor's assignment task is now complete.
    await tenantTx(orgId, (tx) => generateTasks(tx, orgId, appId, { now }));
    const ledger = await owner.jobRun.findFirst({ where: { orgId, idempotencyKey: `app:${appId}:${item.id}:2027:counselor` } });
    if (ledger) expect((await owner.task.findUniqueOrThrow({ where: { id: (ledger.result as { taskId: string }).taskId } })).status).toBe("DONE");
  });

  it("validates stage changes and records dates", async () => {
    const bad = await tenantTx(orgId, (tx) => changeStage(tx, orgId, { applicationId: appId, to: "OFFER", actor: "staff", actorId: counselorId, now }));
    expect(bad).toEqual({ ok: false, error: "invalid_transition" });
    expect(await tenantTx(orgId, (tx) => changeStage(tx, orgId, { applicationId: appId, to: "SUBMITTED", actor: "student", actorId: null, now }))).toEqual({ ok: true });
    expect(await tenantTx(orgId, (tx) => changeStage(tx, orgId, { applicationId: appId, to: "OFFER", actor: "student", actorId: null, now }))).toEqual({ ok: false, error: "invalid_transition" });
    expect(await tenantTx(orgId, (tx) => changeStage(tx, orgId, { applicationId: appId, to: "OFFER", actor: "staff", actorId: counselorId, now }))).toEqual({ ok: true });
    const app = await owner.application.findUniqueOrThrow({ where: { id: appId } });
    expect(app.submittedAt).not.toBeNull();
    expect(app.decidedAt).not.toBeNull();
    expect((await owner.shortlistEntry.findUniqueOrThrow({ where: { id: entryId } })).status).toBe("OFFER");
    // Pre-submission tasks were archived with a reason; completed ones stayed done.
    const open = await owner.task.count({ where: { orgId, assigneeId: { not: teacherId }, status: { in: ["TODO", "IN_PROGRESS"] }, dueAt: { lt: new Date(Date.UTC(2027, 0, 14)) } } });
    expect(open).toBe(0);
    const archived = await owner.jobRun.findMany({ where: { orgId, queue: LEDGER_QUEUE, name: "task" } });
    expect(archived.some((r) => (r.result as { archivedReason?: string }).archivedReason === "Application submitted")).toBe(true);
    expect(await owner.auditEvent.count({ where: { orgId, action: "applications.stage", entityId: appId } })).toBe(2);
  });

  it("reminders are sent once per task and day", async () => {
    const extra = await tenantTx(orgId, (tx) => startApplication(tx, orgId, { studentId, programId, actorId: null, now, intakeYear: 2028 }));
    if (!extra.ok) throw new Error("start failed");
    await tenantTx(orgId, (tx) => generateTasks(tx, orgId, extra.applicationId, { now }));
    // Pull one task into the reminder window.
    const ledger = await owner.jobRun.findFirstOrThrow({ where: { orgId, idempotencyKey: { startsWith: `app:${extra.applicationId}:` } } });
    await owner.task.update({ where: { id: (ledger.result as { taskId: string }).taskId }, data: { dueAt: new Date(now.getTime() + 3 * 86_400_000), status: "TODO" } });
    const flush = async () => {};
    const a = await runApplicationReminders(orgId, { now, flush });
    const b = await runApplicationReminders(orgId, { now, flush });
    expect(a.reminders).toBeGreaterThan(0);
    expect(b).toEqual({ reminders: 0, digests: 0 });
  });

  it("parents read only their own children's applications, and other schools see nothing", async () => {
    const other = await tenantTx(orgId, (tx) => startApplication(tx, orgId, { studentId: otherStudentId, programId, actorId: null, now }));
    if (!other.ok) throw new Error("start failed");
    const parent = fakeCtx("parent", parentMembership.id, parentMembership.guardianLinks);
    expect(await readableApplication(parent, appId)).toBeNull();
    expect((await readableApplication(parent, other.applicationId))?.id).toBe(other.applicationId);
    const student = fakeCtx("student", "x", [], studentId);
    expect(await readableApplication(student, other.applicationId)).toBeNull();
    expect((await readableApplication(student, appId))?.id).toBe(appId);
    const manager = fakeCtx("manager", counselorId, []);
    expect((await readableApplication(manager, other.applicationId))?.id).toBe(other.applicationId);
    // Row-level security: another school cannot read the application or its checklist at all.
    const foreign = tenantDb(otherOrgId);
    expect(await foreign.application.findFirst({ where: { id: appId } })).toBeNull();
    expect(await foreign.applicationRequirement.count({ where: { applicationId: appId } })).toBe(0);
    expect(await foreign.task.count({ where: { studentId } })).toBe(0);
  });
});
