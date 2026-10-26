// Course selection windows, exceptions, class sessions, assisted choosing (teachers and parents) and
// sign-off, against real Postgres through the RLS-restricted app role. Every write goes through
// submitChoices, the only path request code uses to change choices.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { tenantTx } from "@/lib/tenant-db";
import { execCtx } from "@/server/db";
import { SYSTEM_ROLES, type Permission } from "@/server/identity/permissions";
import {
  closeWindowNow,
  editAccess,
  endSession,
  grantException,
  grantHelper,
  revokeException,
  revokeHelper,
  saveSelectionSettings,
  saveWindow,
  signOffChoices,
  startSession,
  submitChoices,
  writerFor,
  type SelectionActor,
} from "@/server/registration/selection";
import { windowLabels } from "@/server/registration/selection-labels";
import { remindUnfinished, runSelectionNotices } from "@/server/registration/selection-notices";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
const orgIds: string[] = [];
const userIds: string[] = [];
let orgId: string;
let otherOrgId: string;
let currentId: string;
let nextId: string;
const sub: Record<string, string> = {};
const T0 = new Date("2026-11-01T04:00:00Z"); // 08:00 in Dubai
const T1 = new Date("2026-11-12T11:00:00Z"); // 15:00 in Dubai
const mid = new Date("2026-11-05T06:00:00Z");
const after = new Date("2026-11-14T06:00:00Z");
const ec = (now: Date) => execCtx(undefined as never, "", { now });

type Who = { membershipId: string; perms: Set<string> };
const people: Record<string, Who> = {};
const ids: Record<string, string> = {};

function actor(key: string, kind: "staff" | "student" | "parent"): SelectionActor {
  const p = people[key];
  return {
    membershipId: p.membershipId,
    userId: null,
    isStudent: kind === "student",
    isParent: kind === "parent",
    isStaff: kind === "staff",
    can: (perm: Permission) => p.perms.has(perm),
    ownStudentId: kind === "student" ? ids[key] : null,
    childIds: kind === "parent" ? (key === "otherParent" ? [ids.studentB] : [ids.studentA]) : [],
  };
}

async function member(org: string, key: string, role: string, roleIds: Record<string, string>) {
  const user = await owner.user.create({ data: { email: `${uid(key)}@cs.test`, nameEn: key } });
  userIds.push(user.id);
  const m = await owner.membership.create({ data: { orgId: org, userId: user.id } });
  await owner.membershipRole.create({ data: { orgId: org, membershipId: m.id, roleId: roleIds[role] } });
  people[key] = { membershipId: m.id, perms: new Set(SYSTEM_ROLES.find((r) => r.key === role)!.permissions) };
  return m.id;
}

/** Run a service call through the app role, scoped to the school, with an execution context at `now`. */
function inTx<T>(now: Date, fn: (tx: Parameters<Parameters<typeof tenantTx>[1]>[0], e: ReturnType<typeof execCtx>) => Promise<T>, org = orgId) {
  return tenantTx(org, (tx) => fn(tx, execCtx(tx, org, { now })), { timeout: 30_000 });
}

const choose = (key: string, kind: "staff" | "student" | "parent", studentKey: string, now: Date, opts: { options?: string[]; final?: boolean } = {}) =>
  inTx(now, (tx, e) => submitChoices(tx, orgId, actor(key, kind), { studentId: ids[studentKey], optionSubjectIds: opts.options ?? [sub.PHYS, sub.CHEM], yearId: nextId, final: opts.final }, e));

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const org = await owner.organization.create({ data: { slug: uid(`cs-${label}`), nameEn: `Selection ${label}`, nameAr: `اختيار ${label}` } });
    orgIds.push(org.id);
  }
  [orgId, otherOrgId] = orgIds;
  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) roleIds[r.key] = (await owner.role.create({ data: { orgId, key: r.key, nameEn: r.nameEn, nameAr: r.nameAr, permissions: r.permissions } })).id;
  const current = await owner.academicYear.create({ data: { orgId, nameEn: "2026-2027", nameAr: "2026-2027", startsOn: new Date("2026-08-24"), endsOn: new Date("2027-07-01"), isCurrent: true } });
  const next = await owner.academicYear.create({ data: { orgId, nameEn: "2027-2028", nameAr: "2027-2028", startsOn: new Date("2027-08-23"), endsOn: new Date("2028-07-01") } });
  currentId = current.id;
  nextId = next.id;
  for (const [code, en] of [
    ["MATH", "Mathematics"],
    ["PHYS", "Physics"],
    ["CS", "Computer Science"],
    ["CHEM", "Chemistry"],
    ["ART", "Art"],
  ]) {
    sub[code] = (await owner.subject.create({ data: { orgId, code, nameEn: en, nameAr: en } })).id;
  }
  await owner.subjectOffering.createMany({
    data: [
      { orgId, academicYearId: nextId, subjectId: sub.MATH, gradeLevel: 10, kind: "CORE" },
      { orgId, academicYearId: nextId, subjectId: sub.PHYS, gradeLevel: 10, kind: "OPTION", optionBlock: "A" },
      { orgId, academicYearId: nextId, subjectId: sub.CS, gradeLevel: 10, kind: "OPTION", optionBlock: "A" },
      { orgId, academicYearId: nextId, subjectId: sub.CHEM, gradeLevel: 10, kind: "OPTION", optionBlock: "B" },
      { orgId, academicYearId: nextId, subjectId: sub.ART, gradeLevel: 10, kind: "OPTION", optionBlock: "B" },
    ],
  });
  await member(orgId, "admin", "school_admin", roleIds);
  await member(orgId, "teacher", "teacher", roleIds);
  await member(orgId, "otherTeacher", "teacher", roleIds);
  const counselor = await member(orgId, "counselor", "counselor", roleIds);
  await owner.staffProfile.create({ data: { orgId, membershipId: counselor, gradeLevels: [9] } });
  for (const key of ["studentA", "studentB", "studentC"]) {
    const m = await member(orgId, key, "student", roleIds);
    ids[key] = (await owner.student.create({ data: { orgId, membershipId: m, studentNo: uid("S"), firstNameEn: key, lastNameEn: "Test", firstNameAr: "طالب", lastNameAr: "اختبار", gradeLevel: 9 } })).id;
  }
  for (const [key, child] of [
    ["parentP", "studentA"],
    ["parentQ", "studentA"],
    ["otherParent", "studentB"],
  ]) {
    const m = await member(orgId, key, "parent", roleIds);
    const g = await owner.guardian.create({ data: { orgId, membershipId: m, firstNameEn: key, lastNameEn: "Parent", firstNameAr: "ولي", lastNameAr: "أمر" } });
    await owner.guardianLink.create({ data: { orgId, guardianId: g.id, studentId: ids[child] } });
  }
  // Homeroom 9A (the teacher's) has students A and B; C is in another homeroom.
  const hr = await owner.schoolClass.create({ data: { orgId, academicYearId: currentId, nameEn: "Homeroom 9A", nameAr: "الصف 9A", gradeLevel: 9, section: "A", isHomeroom: true, teacherMembershipId: people.teacher.membershipId } });
  const hrB = await owner.schoolClass.create({ data: { orgId, academicYearId: currentId, nameEn: "Homeroom 9B", nameAr: "الصف 9B", gradeLevel: 9, section: "B", isHomeroom: true, teacherMembershipId: people.otherTeacher.membershipId } });
  ids.homeroom = hr.id;
  await owner.enrollment.createMany({ data: [{ orgId, studentId: ids.studentA, classId: hr.id }, { orgId, studentId: ids.studentB, classId: hr.id }, { orgId, studentId: ids.studentC, classId: hrB.id }] });
});

afterAll(async () => {
  for (const id of orgIds) await owner.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE "orgId" = $1`, id);
  for (const id of orgIds) {
    for (const table of ["CourseSelectionSubmission", "CourseSelectionHelper", "CourseSelectionException", "CourseSelectionSession", "CourseSelectionWindow", "CourseSelectionSettings", "JobRun", "OutboundMessage", "Notification", "MessageTemplate", "CalendarEvent", "SubjectRegistration", "SubjectOffering", "Enrollment", "SchoolClass", "GuardianLink", "Guardian", "Student", "StaffProfile", "Subject", "AcademicYear", "MembershipRole", "Role"]) {
      await owner.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "orgId" = $1`, id);
    }
    await owner.membership.deleteMany({ where: { orgId: id } });
    await owner.organization.delete({ where: { id } });
  }
  await owner.user.deleteMany({ where: { id: { in: userIds } } });
  await owner.$disconnect();
});

describe("windows", () => {
  it("only registration.manage staff create windows, without overlaps or backwards dates", async () => {
    const input = { academicYearId: nextId, gradeLevels: [9], opensAt: T0, closesAt: T1, roundEn: "Round 1", roundAr: "الجولة الأولى" };
    expect(await inTx(mid, (tx) => saveWindow(tx, orgId, actor("teacher", "staff"), input, windowLabels))).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await inTx(mid, (tx) => saveWindow(tx, orgId, actor("admin", "staff"), { ...input, opensAt: T1, closesAt: T0 }, windowLabels))).toEqual({ ok: false, error: "BAD_RANGE" });
    const res = await inTx(mid, (tx) => saveWindow(tx, orgId, actor("admin", "staff"), input, windowLabels));
    expect(res.ok).toBe(true);
    if (res.ok) ids.window = res.id;
    const overlap = await inTx(mid, (tx) => saveWindow(tx, orgId, actor("admin", "staff"), { ...input, gradeLevels: [8, 9], opensAt: new Date(T1.getTime() - 3_600_000), closesAt: new Date(T1.getTime() + 86_400_000), roundEn: "Round 2" }, windowLabels));
    expect(overlap).toEqual({ ok: false, error: "OVERLAP" });
    // The closing deadline is on the calendar, with the grades, in both languages.
    const w = await owner.courseSelectionWindow.findUniqueOrThrow({ where: { id: ids.window } });
    const ev = await owner.calendarEvent.findUniqueOrThrow({ where: { id: w.calendarEventId! } });
    expect(ev.startsAt.toISOString()).toBe(T1.toISOString());
    expect(ev.gradeLevels).toEqual([9]);
    expect(ev.titleEn).toBe("Course selection closes: Grade 9 (Round 1)");
    expect(ev.titleAr).toContain("الصف 9");
  });

  it("students change choices only while the window is open, exactly at its boundaries", async () => {
    const before = await choose("studentA", "student", "studentA", new Date(T0.getTime() - 1));
    expect(before).toEqual({ ok: false, error: "CLOSED" });
    const atOpen = await choose("studentA", "student", "studentA", T0);
    expect(atOpen.ok).toBe(true);
    const atClose = await choose("studentA", "student", "studentA", T1, { options: [sub.CS, sub.CHEM] });
    expect(atClose).toEqual({ ok: false, error: "CLOSED" });
    const lastMs = await choose("studentA", "student", "studentA", new Date(T1.getTime() - 1), { options: [sub.CS, sub.CHEM] });
    expect(lastMs.ok).toBe(true);
  });

  it("students cannot change another student's choices, and a parent only their own child's", async () => {
    expect(await choose("studentA", "student", "studentB", mid)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await choose("otherParent", "parent", "studentA", mid)).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("staff with registration.manage can still change choices after closing, labelled and audited", async () => {
    const res = await choose("admin", "staff", "studentB", after);
    expect(res.ok).toBe(true);
    const s = await owner.courseSelectionSubmission.findFirstOrThrow({ where: { orgId, studentId: ids.studentB, academicYearId: nextId } });
    expect(s).toMatchObject({ afterClose: true, onBehalf: true, lastSource: "STAFF", lastById: people.admin.membershipId });
    const ev = await owner.auditEvent.findFirstOrThrow({ where: { orgId, entityId: ids.studentB, action: "registration.select_next_year" }, orderBy: { createdAt: "desc" } });
    expect(ev.meta).toMatchObject({ afterClose: true, writer: "manager" });
  });

  it("closing a window now locks students out straight away", async () => {
    const w2 = await inTx(mid, (tx) => saveWindow(tx, orgId, actor("admin", "staff"), { academicYearId: currentId, gradeLevels: [9], opensAt: new Date(mid.getTime() - 3_600_000), closesAt: new Date(mid.getTime() + 86_400_000), roundEn: "This year" }, windowLabels));
    expect(w2.ok).toBe(true);
    if (!w2.ok) return;
    expect(await inTx(mid, (tx) => closeWindowNow(tx, orgId, actor("teacher", "staff"), w2.id, mid))).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect((await inTx(mid, (tx) => closeWindowNow(tx, orgId, actor("admin", "staff"), w2.id, mid))).ok).toBe(true);
    const access = await inTx(mid, (tx) => editAccess(tx, orgId, { id: ids.studentA, gradeLevel: 9 }, currentId, new Date(mid.getTime() + 1000)));
    expect(access).toMatchObject({ state: "closed", open: false });
  });
});

describe("exceptions", () => {
  it("a responsible teacher allows one student to change choices until a time, with a reason", async () => {
    const until = new Date(after.getTime() + 2 * 86_400_000);
    const input = { studentId: ids.studentA, yearId: nextId, until, reason: "Round 2 place in Chemistry" };
    // Daniel teaches 9A; the other teacher is not responsible for student A.
    expect(await inTx(after, (tx, e) => grantException(tx, orgId, actor("otherTeacher", "staff"), input, e))).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(await inTx(after, (tx, e) => grantException(tx, orgId, actor("teacher", "staff"), { ...input, reason: " " }, e))).toMatchObject({ ok: false, error: "REASON_REQUIRED" });
    const res = await inTx(after, (tx, e) => grantException(tx, orgId, actor("teacher", "staff"), input, e));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((await choose("studentA", "student", "studentA", after, { options: [sub.PHYS, sub.ART] })).ok).toBe(true);
    // Not for anyone else, and not after the time.
    expect(await choose("studentC", "student", "studentC", after)).toEqual({ ok: false, error: "CLOSED" });
    expect(await choose("studentA", "student", "studentA", until)).toEqual({ ok: false, error: "CLOSED" });
    // The student and both parents are told; the reason is in the audit log.
    const told = await owner.notification.count({ where: { orgId, kind: "course_selection", titleEn: { startsWith: "Course changes allowed" } } });
    expect(told).toBe(3);
    const ev = await owner.auditEvent.findFirstOrThrow({ where: { orgId, action: "registration.exception_grant" } });
    expect(ev.reason).toBe("Round 2 place in Chemistry");
    // Revoked: closed again.
    expect((await inTx(after, (tx) => revokeException(tx, orgId, actor("teacher", "staff"), res.id, after))).ok).toBe(true);
    expect(await choose("studentA", "student", "studentA", new Date(after.getTime() + 1000))).toEqual({ ok: false, error: "CLOSED" });
  });
});

describe("class sessions", () => {
  it("the homeroom teacher opens choosing for their class only, for a set time", async () => {
    expect(await inTx(after, (tx) => startSession(tx, orgId, actor("otherTeacher", "staff"), { classId: ids.homeroom, minutes: 30 }, after))).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(await inTx(after, (tx) => startSession(tx, orgId, actor("teacher", "staff"), { classId: ids.homeroom, minutes: 31 }, after))).toMatchObject({ ok: false, error: "INVALID" });
    const res = await inTx(after, (tx) => startSession(tx, orgId, actor("teacher", "staff"), { classId: ids.homeroom, minutes: 30 }, after));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = await owner.courseSelectionSession.findUniqueOrThrow({ where: { id: res.id } });
    expect(s.academicYearId).toBe(nextId);
    expect(s.code).toMatch(/^[A-Z2-9]{6}$/);
    const inSession = new Date(after.getTime() + 10 * 60_000);
    // Students in 9A can choose; a student in another homeroom cannot.
    const access = await inTx(inSession, (tx) => editAccess(tx, orgId, { id: ids.studentB, gradeLevel: 9 }, nextId, inSession));
    expect(access).toMatchObject({ open: true, via: "session" });
    expect((await choose("studentB", "student", "studentB", inSession, { options: [sub.CS, sub.ART] })).ok).toBe(true);
    expect(await choose("studentC", "student", "studentC", inSession)).toEqual({ ok: false, error: "CLOSED" });
    // It ends on its own.
    expect(await choose("studentB", "student", "studentB", new Date(after.getTime() + 30 * 60_000))).toEqual({ ok: false, error: "CLOSED" });
    // A second session ended early by the teacher.
    const again = await inTx(after, (tx) => startSession(tx, orgId, actor("teacher", "staff"), { classId: ids.homeroom, minutes: 45 }, inSession));
    if (!again.ok) throw new Error("session");
    const early = new Date(inSession.getTime() + 5 * 60_000);
    expect((await inTx(early, (tx) => endSession(tx, orgId, actor("teacher", "staff"), again.id, early))).ok).toBe(true);
    expect(await choose("studentB", "student", "studentB", new Date(early.getTime() + 1000))).toEqual({ ok: false, error: "CLOSED" });
    const actions = (await owner.auditEvent.findMany({ where: { orgId, entityType: "CourseSelectionSession" }, select: { action: true } })).map((a) => a.action).sort();
    expect(actions).toEqual(["registration.session_end", "registration.session_start", "registration.session_start"]);
  });
});

describe("assisted choosing", () => {
  it("a student lets their own teacher help, and only that teacher, only while choosing is open", async () => {
    // Not a teacher of student C, so not offered.
    expect(await inTx(mid, (tx, e) => grantHelper(tx, orgId, actor("studentA", "student"), { studentId: ids.studentA, helperId: people.otherTeacher.membershipId }, e))).toMatchObject({ ok: false, error: "NOT_ALLOWED_HELPER" });
    const res = await inTx(mid, (tx, e) => grantHelper(tx, orgId, actor("studentA", "student"), { studentId: ids.studentA, helperId: people.teacher.membershipId }, e));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Until defaults to the window's close.
    const g = await owner.courseSelectionHelper.findUniqueOrThrow({ where: { id: res.id } });
    expect(g.until.toISOString()).toBe(T1.toISOString());
    expect(g).toMatchObject({ kind: "STAFF", byStudent: true });
    // The helper chooses; the choice records who made it.
    const done = await choose("teacher", "staff", "studentA", mid, { options: [sub.CS, sub.ART] });
    expect(done.ok).toBe(true);
    // Each choice records who made it: Computer Science is the teacher's, Art stays the student's own earlier choice.
    const regs = await owner.subjectRegistration.findMany({ where: { orgId, studentId: ids.studentA, academicYearId: nextId, subjectId: { in: [sub.CS, sub.ART] } } });
    const cs = regs.find((r) => r.subjectId === sub.CS)!;
    const art = regs.find((r) => r.subjectId === sub.ART)!;
    expect(cs).toMatchObject({ createdById: people.teacher.membershipId, source: "STAFF", status: "REQUESTED" });
    expect(cs.chosenAt?.toISOString()).toBe(mid.toISOString());
    expect(art.createdById).toBe(people.studentA.membershipId);
    const s = await owner.courseSelectionSubmission.findFirstOrThrow({ where: { orgId, studentId: ids.studentA, academicYearId: nextId } });
    expect(s).toMatchObject({ onBehalf: true, lastById: people.teacher.membershipId });
    // Not for another student, and not another teacher.
    expect(await choose("teacher", "staff", "studentB", mid)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await choose("otherTeacher", "staff", "studentA", mid)).toEqual({ ok: false, error: "FORBIDDEN" });
    // The window rules still apply to the helper.
    expect(await choose("teacher", "staff", "studentA", new Date(T1.getTime() - 60_000 + 120_000))).toMatchObject({ ok: false });
    // Revoked by the student: the teacher can no longer choose.
    expect((await inTx(mid, (tx, e) => revokeHelper(tx, orgId, actor("studentA", "student"), res.id, e))).ok).toBe(true);
    expect(await choose("teacher", "staff", "studentA", mid)).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("a grant ends at its own time", async () => {
    const until = new Date(mid.getTime() + 3_600_000);
    const res = await inTx(mid, (tx, e) => grantHelper(tx, orgId, actor("teacher", "staff"), { studentId: ids.studentB, helperId: people.teacher.membershipId, until, reason: "No phone at home" }, e));
    expect(res.ok).toBe(true);
    // Staff turning it on tells the student and the parent.
    expect(await owner.notification.count({ where: { orgId, recipientId: { in: [people.studentB.membershipId, people.otherParent.membershipId] }, titleEn: { contains: "can help" } } })).toBe(2);
    expect((await inTx(mid, (tx) => writerFor(tx, orgId, actor("teacher", "staff"), ids.studentB, mid))).role).toBe("helper");
    expect((await inTx(until, (tx) => writerFor(tx, orgId, actor("teacher", "staff"), ids.studentB, until))).role).toBeNull();
  });

  it("parents choose always, only when allowed, or never, by school setting", async () => {
    const set = (parentChoice: "ALWAYS" | "WHEN_ALLOWED" | "NEVER", parentChoiceSignsOff = true) => inTx(mid, (tx) => saveSelectionSettings(tx, orgId, actor("admin", "staff"), { parentChoice, signOffRequired: true, parentChoiceSignsOff }));
    expect((await inTx(mid, (tx) => saveSelectionSettings(tx, orgId, actor("teacher", "staff"), { parentChoice: "NEVER", signOffRequired: true, parentChoiceSignsOff: true }))).ok).toBe(false);
    await set("NEVER");
    expect(await choose("parentP", "parent", "studentA", mid)).toEqual({ ok: false, error: "PARENT_SIGN_OFF_ONLY" });
    await set("WHEN_ALLOWED");
    expect(await choose("parentP", "parent", "studentA", mid)).toEqual({ ok: false, error: "PARENT_NOT_ALLOWED" });
    // Only a guardian linked to the student can be allowed.
    expect(await inTx(mid, (tx, e) => grantHelper(tx, orgId, actor("studentA", "student"), { studentId: ids.studentA, helperId: people.otherParent.membershipId }, e))).toMatchObject({ ok: false, error: "NOT_ALLOWED_HELPER" });
    const grant = await inTx(mid, (tx, e) => grantHelper(tx, orgId, actor("studentA", "student"), { studentId: ids.studentA, helperId: people.parentP.membershipId }, e));
    expect(grant.ok).toBe(true);
    // Parent P chooses: with sign-off on and a parent's choice counting as sign-off, it is signed off.
    const res = await choose("parentP", "parent", "studentA", mid, { options: [sub.PHYS, sub.CHEM] });
    expect(res).toMatchObject({ ok: true, status: "SIGNED_OFF" });
    // The other parent was not allowed, so cannot choose.
    expect(await choose("parentQ", "parent", "studentA", mid)).toEqual({ ok: false, error: "PARENT_NOT_ALLOWED" });
    // When a parent's choice does not count as sign-off, the other parent or the student confirms, never the same parent.
    await set("WHEN_ALLOWED", false);
    const again = await choose("parentP", "parent", "studentA", mid, { options: [sub.CS, sub.CHEM] });
    expect(again).toMatchObject({ ok: true, status: "SUBMITTED" });
    expect(await inTx(mid, (tx, e) => signOffChoices(tx, orgId, actor("parentP", "parent"), { studentId: ids.studentA, yearId: nextId }, e))).toEqual({ ok: false, error: "SAME_PARENT" });
    expect((await inTx(mid, (tx, e) => signOffChoices(tx, orgId, actor("studentA", "student"), { studentId: ids.studentA, yearId: nextId }, e))).ok).toBe(true);
    const s = await owner.courseSelectionSubmission.findFirstOrThrow({ where: { orgId, studentId: ids.studentA, academicYearId: nextId } });
    expect(s).toMatchObject({ status: "SIGNED_OFF", signedOffById: people.studentA.membershipId, lastSource: "PARENT" });
    // In "always" mode a grant is not needed (and not offered).
    await set("ALWAYS");
    expect((await choose("parentQ", "parent", "studentA", mid, { options: [sub.PHYS, sub.ART] })).ok).toBe(true);
    expect(await inTx(mid, (tx, e) => grantHelper(tx, orgId, actor("studentA", "student"), { studentId: ids.studentA, helperId: people.parentQ.membershipId }, e))).toMatchObject({ ok: false, error: "PARENTS_ALWAYS" });
    await set("WHEN_ALLOWED");
  });

  it("a student's own submission waits for a parent, and a re-submit without changes keeps the sign-off", async () => {
    const res = await choose("studentA", "student", "studentA", mid, { options: [sub.CS, sub.ART] });
    expect(res).toMatchObject({ ok: true, status: "SUBMITTED" });
    expect(await inTx(mid, (tx, e) => signOffChoices(tx, orgId, actor("studentA", "student"), { studentId: ids.studentA, yearId: nextId }, e))).toEqual({ ok: false, error: "FORBIDDEN" });
    expect((await inTx(mid, (tx, e) => signOffChoices(tx, orgId, actor("parentQ", "parent"), { studentId: ids.studentA, yearId: nextId }, e))).ok).toBe(true);
    const same = await choose("studentA", "student", "studentA", mid, { options: [sub.CS, sub.ART] });
    expect(same).toMatchObject({ ok: true, status: "SIGNED_OFF", changed: 0 });
  });

  it("progress can be saved before every block is chosen (next year only)", async () => {
    const res = await choose("studentC", "student", "studentC", mid, { options: [sub.PHYS], final: false });
    expect(res).toMatchObject({ ok: true, status: "DRAFT" });
    const final = await choose("studentC", "student", "studentC", mid, { options: [sub.PHYS] });
    expect(final).toMatchObject({ ok: false, error: "INVALID" });
  });
});

describe("notices", () => {
  it("open, reminders and closing summary are each sent once, and only reminders skip finished students", async () => {
    const noFlush = { flush: async () => undefined };
    const first = await runSelectionNotices(orgId, { now: mid, ...noFlush });
    expect(first.open).toBeGreaterThan(0);
    expect((await runSelectionNotices(orgId, { now: mid, ...noFlush })).open).toBe(0);
    const threeDays = new Date(T1.getTime() - 60 * 3_600_000);
    const r1 = await runSelectionNotices(orgId, { now: threeDays, ...noFlush });
    // Student C is not finished (a draft): C is reminded; A and B have finished.
    const reminded = await owner.notification.findMany({ where: { orgId, titleEn: { startsWith: "Course selection closes" } }, select: { recipientId: true } });
    expect(reminded.map((n) => n.recipientId)).toEqual([people.studentC.membershipId]);
    expect(r1.reminders).toBe(1);
    expect((await runSelectionNotices(orgId, { now: threeDays, ...noFlush })).reminders).toBe(0);
    const closed = await runSelectionNotices(orgId, { now: new Date(T1.getTime() + 60_000), ...noFlush });
    expect(closed.summaries).toBeGreaterThan(0);
    expect((await runSelectionNotices(orgId, { now: new Date(T1.getTime() + 120_000), ...noFlush })).summaries).toBe(0);
  });

  it("the staff reminder reaches each unfinished student once a day", async () => {
    const day = new Date(T1.getTime() - 26 * 3_600_000);
    const a = await inTx(day, (_tx, e) => remindUnfinished(e, ids.window));
    expect(a).toMatchObject({ ok: true, students: 1, unfinished: 1 });
    const b = await inTx(new Date(day.getTime() + 3_600_000), (_tx, e) => remindUnfinished(e, ids.window));
    expect(b).toMatchObject({ ok: true, students: 0 });
  });
});

describe("tenant isolation", () => {
  it("another school cannot read or change this school's course selection rows", async () => {
    const tables = ["courseSelectionWindow", "courseSelectionException", "courseSelectionSession", "courseSelectionHelper", "courseSelectionSubmission", "courseSelectionSettings"] as const;
    for (const t of tables) {
      expect(await (owner[t] as unknown as { count: (a: object) => Promise<number> }).count({ where: { orgId } })).toBeGreaterThan(0);
      const seen = await tenantTx(otherOrgId, (tx) => (tx[t] as unknown as { count: (a: object) => Promise<number> }).count({ where: { orgId } }));
      expect(seen, t).toBe(0);
    }
    const changed = await tenantTx(otherOrgId, (tx) => tx.courseSelectionWindow.updateMany({ where: { id: ids.window }, data: { closesAt: after } }));
    expect(changed.count).toBe(0);
    await expect(tenantTx(otherOrgId, (tx) => tx.courseSelectionHelper.create({ data: { orgId, studentId: ids.studentA, helperId: people.teacher.membershipId, kind: "STAFF", until: after, grantedById: people.teacher.membershipId } }))).rejects.toThrow();
    // A student of this school cannot be chosen for from another school's context.
    const other = await tenantTx(otherOrgId, (tx) => submitChoices(tx, otherOrgId, actor("admin", "staff"), { studentId: ids.studentA, optionSubjectIds: [], yearId: nextId }, execCtx(tx, otherOrgId, { now: mid })));
    expect(other.ok).toBe(false);
    void ec;
  });
});
