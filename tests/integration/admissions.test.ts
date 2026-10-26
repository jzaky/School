// Admissions against real Postgres through the RLS-restricted app role: the family application flow and its
// isolation (a family only ever sees its own application), duplicate detection, stage rules, capacity and the
// waitlist, offers, payment, enrollment (guardian dedup, sibling linking, invitations, documents, government
// registration), permissions on the server actions, re-enrollment reminders and tenant isolation.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));
vi.mock("@/server/queue", () => ({ flushEffects: async () => undefined, queue: () => null }));
vi.mock("@/server/context", () => ({ getCtx: async () => current.ctx, getOptionalCtx: async () => current.ctx }));

import type { PrismaClient } from "@prisma/client";
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { can, permissionsOf, roleKeysOf } from "@/server/identity/can";
import type { Ctx } from "@/server/context";
import { KG1 } from "@/lib/grade-levels";
import { encryptField } from "@/lib/crypto";
import { familyApplicationView, listFamilyApplications, parseStep, respondToOffer, saveStep, startApplication, submitApplication, type Family } from "@/server/admissions/family";
import { makeOffer, moveStage, setPriority } from "@/server/admissions/service";
import { markSeatPaid } from "@/server/admissions/seat-booking";
import { enrollApplication } from "@/server/admissions/enroll";
import { gradeSeats, waitlist } from "@/server/admissions/capacity";
import { admissionYears } from "@/server/admissions/settings";
import { enrollAction, makeOfferAction, moveStageAction, revealHealthAction, saveSettingsAction, updateRegistrationAction } from "@/server/admissions/actions";
import { openWindow, respond, sendRemindersNow, windowSummary } from "@/server/admissions/reenrollment";
import { completeWithdrawal } from "@/server/admissions/withdrawals";
import { funnel, nationalitySummary } from "@/server/admissions/reports";
import { makeApplicantToken, readApplicantToken } from "@/server/admissions/applicant";
import { installStarterTemplate } from "../../prisma/seed/starter";
import { wipeTenant } from "../../prisma/seed/lib";
import { ownerClient, uid } from "./helpers";

let owner: PrismaClient;
let orgId: string;
let otherOrgId: string;
let nextYearId: string;
const m: Record<string, string> = {};
const users: Record<string, { id: string; email: string }> = {};
let siblingId: string;
let existingGuardianId: string;

async function ctxFor(membershipId: string, org = orgId): Promise<Ctx> {
  const membership = await owner.membership.findUniqueOrThrow({ where: { id: membershipId }, include: { roles: { include: { role: true } }, staffProfile: true, student: true, guardian: { include: { links: { include: { student: true } } } } } });
  const user = await owner.user.findUniqueOrThrow({ where: { id: membership.userId } });
  const o = await owner.organization.findUniqueOrThrow({ where: { id: org } });
  const roles = roleKeysOf(membership);
  return { orgId: org, db: tenantDb(org), org: o, user, membership, membershipId, roles, perms: permissionsOf(membership), locale: "en", persona: null, isStudent: roles.includes("student"), isParent: roles.includes("parent"), isStaff: !roles.includes("student") && !roles.includes("parent"), can: (p) => can(membership, p), session: null as never } as Ctx;
}
const as = async (key: string) => {
  const c = await ctxFor(m[key]);
  current.ctx = c;
  return c;
};

async function staff(key: string, role: string, org = orgId) {
  const u = await owner.user.create({ data: { email: `${uid(key)}@adm.test`, nameEn: `Staff ${key}`, emailVerified: new Date() } });
  const mem = await owner.membership.create({ data: { orgId: org, userId: u.id, status: "ACTIVE" } });
  const r = await owner.role.findFirstOrThrow({ where: { orgId: org, key: role } });
  await owner.membershipRole.create({ data: { orgId: org, membershipId: mem.id, roleId: r.id } });
  await owner.staffProfile.create({ data: { orgId: org, membershipId: mem.id } });
  m[key] = mem.id;
}

async function applicant(key: string) {
  const u = await owner.user.create({ data: { email: `${uid(key)}@family.test`, nameEn: `Family ${key}`, emailVerified: new Date() } });
  users[key] = { id: u.id, email: u.email };
}
const fam = (key: string): Family => ({ userId: users[key].id, email: users[key].email, locale: "en", quiet: true });

const student = (over: Record<string, unknown> = {}) => ({
  academicYearId: nextYearId,
  gradeLevel: KG1,
  curriculum: null,
  firstNameEn: "Laila",
  lastNameEn: "Haddad",
  firstNameAr: "ليلى",
  lastNameAr: "حداد",
  dateOfBirth: "2023-05-10",
  gender: "F",
  nationality: "JO",
  homeLanguage: "ar",
  emiratesId: "",
  passport: "N1234567",
  ...over,
});
const family = (email: string, over: Record<string, unknown> = {}) => ({
  guardians: [{ relationship: "MOTHER", firstNameEn: "Huda", lastNameEn: "Haddad", firstNameAr: "هدى", lastNameAr: "حداد", email, phone: "+971 50 555 7001", occupation: "", employer: "", livesWith: true, primary: true }],
  siblings: [],
  staffChild: false,
  ...over,
});

/** Fill and submit an application for a family. Returns its id. */
async function apply(key: string, s: Record<string, unknown> = {}, f?: Record<string, unknown>) {
  const app = await startApplication(orgId, fam(key), { academicYearId: nextYearId, gradeLevel: (s.gradeLevel as number) ?? KG1 });
  for (const [step, data] of [
    ["student", student(s)],
    ["schooling", { attended: false }],
    ["family", f ?? family(users[key].email)],
    ["health", { allergies: "Peanuts", conditions: "", medications: "", supportNeeded: false, supportDetails: "", previousAssessment: false }],
  ] as const) {
    const parsed = parseStep(step, data);
    if (!parsed.ok) throw new Error(`invalid ${step}: ${parsed.fields.join(",")}`);
    await saveStep(orgId, fam(key), app.id, parsed.value);
  }
  await submitApplication(orgId, fam(key), app.id, { slug: "x", nameEn: "School", nameAr: "مدرسة" });
  return app.id;
}

const ec = <T>(fn: (e: ReturnType<typeof execCtx>) => Promise<T>) => {
  const effects: Effect[] = [];
  return tenantTx(orgId, (tx) => fn(execCtx(tx, orgId, { effects, quiet: true })), { timeout: 60_000 });
};
const actor = () => ({ membershipId: m.officer, userId: "u" });

beforeAll(async () => {
  owner = ownerClient();
  const org = await owner.organization.create({ data: { slug: uid("adm-itest"), nameEn: "Test Academy Sharjah", nameAr: "أكاديمية الاختبار", shortNameEn: "TAS", regulator: "SPEA", emirate: "Sharjah", curricula: ["AMERICAN"] } });
  orgId = org.id;
  const now = new Date();
  await installStarterTemplate(owner, orgId, { curricula: ["AMERICAN"], locale: "en", now, installCourses: false });
  const cur = await owner.academicYear.findFirstOrThrow({ where: { orgId, isCurrent: true } });
  const ny = cur.startsOn.getUTCFullYear() + 1;
  nextYearId = (await owner.academicYear.create({ data: { orgId, nameEn: `${ny}-${ny + 1}`, nameAr: `${ny}-${ny + 1}`, startsOn: new Date(Date.UTC(ny, 7, 24)), endsOn: new Date(Date.UTC(ny + 1, 6, 2)), isCurrent: false } })).id;
  await staff("officer", "admissions_officer");
  await staff("teacher", "teacher");
  await staff("principal", "principal");
  await staff("nurse", "nurse");
  await staff("registrar", "registrar");
  await owner.admissionSettings.create({ data: { orgId, publicOpen: true, admissionNoPattern: "TAS{YY}{SEQ:4}" } });
  await owner.admissionCapacity.create({ data: { orgId, academicYearId: nextYearId, gradeLevel: KG1, sectionSeats: [2], seatFeeFils: 150000 } });
  await owner.admissionCapacity.create({ data: { orgId, academicYearId: nextYearId, gradeLevel: 3, sectionSeats: [20, 20], seatFeeFils: 0 } });
  for (const k of ["a", "b", "c", "d", "e", "sib"]) await applicant(k);
  // An existing family: a Grade 2 student whose mother already uses the family portal.
  const pu = await owner.user.create({ data: { email: `${uid("mona")}@family.test`, nameEn: "Mona Saleh" } });
  const pm = await owner.membership.create({ data: { orgId, userId: pu.id } });
  await owner.membershipRole.create({ data: { orgId, membershipId: pm.id, roleId: (await owner.role.findFirstOrThrow({ where: { orgId, key: "parent" } })).id } });
  m.parent = pm.id;
  const s = await owner.student.create({ data: { orgId, studentNo: "TAS-0001", firstNameEn: "Sami", lastNameEn: "Saleh", firstNameAr: "سامي", lastNameAr: "صالح", gradeLevel: 2, section: "A", dateOfBirth: new Date("2018-03-02T00:00:00Z"), emiratesIdEnc: encryptField("784201812345671"), emiratesIdLast4: "5671" } });
  siblingId = s.id;
  const g = await owner.guardian.create({ data: { orgId, membershipId: pm.id, firstNameEn: "Mona", lastNameEn: "Saleh", firstNameAr: "منى", lastNameAr: "صالح", email: pu.email, phone: "+971 50 555 0303" } });
  existingGuardianId = g.id;
  await owner.guardianLink.create({ data: { orgId, guardianId: g.id, studentId: s.id, isPrimary: true } });
  users.mona = { id: pu.id, email: pu.email };
  const other = await owner.organization.create({ data: { slug: uid("adm-other"), nameEn: "Other", nameAr: "أخرى" } });
  otherOrgId = other.id;
}, 300_000);

afterAll(async () => {
  for (const id of [orgId, otherOrgId].filter(Boolean)) {
    await wipeTenant(owner, id);
    await owner.organization.delete({ where: { id } }).catch(() => undefined);
  }
  await owner?.$disconnect();
});

describe("family application", () => {
  let appA: string;
  it("a family starts, saves each step, submits, and staff are told", async () => {
    appA = await apply("a", { emiratesId: "784-2023-1111111-1" });
    const row = await owner.admissionApplication.findUniqueOrThrow({ where: { id: appA } });
    expect(row.stage).toBe("NEW");
    expect(row.number).toMatch(/^ADM-\d{4}-\d{4}$/);
    // Identifiers and health details are stored encrypted; only a keyed hash is searchable.
    expect(row.emiratesIdEnc).toMatch(/^v1:/);
    expect(row.emiratesIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.medicalEnc).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain("Peanuts");
    expect(row.hasMedical).toBe(true);
    const n = await owner.notification.findFirst({ where: { orgId, recipientId: m.officer, kind: "admission_submitted" } });
    expect(n?.titleEn).toContain(row.number);
  });

  it("a family only ever sees its own application", async () => {
    await expect(familyApplicationView(orgId, users.b.id, appA)).rejects.toThrow(/NOT_FOUND/);
    expect((await listFamilyApplications(orgId, users.b.id)).length).toBe(0);
    const parsed = parseStep("schooling", { attended: false });
    if (!parsed.ok) throw new Error("x");
    await expect(saveStep(orgId, fam("b"), appA, parsed.value)).rejects.toThrow(/NOT_FOUND/);
    await expect(respondToOffer(orgId, fam("b"), appA, true, null)).rejects.toThrow(/NOT_FOUND/);
    const mine = await familyApplicationView(orgId, users.a.id, appA);
    expect(mine.app.id).toBe(appA);
    // Families never get staff-only notes.
    await owner.admissionMessage.create({ data: { orgId, applicationId: appA, authorMembershipId: m.officer, visibility: "STAFF", body: "Internal: check the report" } });
    await owner.admissionMessage.create({ data: { orgId, applicationId: appA, authorMembershipId: m.officer, visibility: "SHARED", body: "Please upload the passport" } });
    const view = await familyApplicationView(orgId, users.a.id, appA);
    expect(view.messages.map((x) => x.body)).toEqual(["Please upload the passport"]);
  });

  it("submitted applications are locked and a family cannot apply twice for the same child", async () => {
    const parsed = parseStep("schooling", { attended: false });
    if (!parsed.ok) throw new Error("x");
    await expect(saveStep(orgId, fam("a"), appA, parsed.value)).rejects.toThrow(/LOCKED/);
    const again = await startApplication(orgId, fam("a"), { academicYearId: nextYearId, gradeLevel: KG1 });
    const st = parseStep("student", student({ emiratesId: "784-2023-1111111-1" }));
    if (!st.ok) throw new Error("x");
    await expect(saveStep(orgId, fam("a"), again.id, st.value)).rejects.toThrow(/DUPLICATE_OWN/);
  });

  it("validates each step and refuses a grade the school does not offer", async () => {
    expect(parseStep("student", student({ emiratesId: "123" })).ok).toBe(false);
    expect(parseStep("family", { guardians: [] }).ok).toBe(false);
    await expect(startApplication(orgId, fam("c"), { academicYearId: nextYearId, gradeLevel: 9 })).rejects.toThrow(/GRADE/);
  });

  it("flags duplicates for staff: same Emirates ID or same name and date of birth, against applications and students", async () => {
    const b = await apply("b", { emiratesId: "784-2023-1111111-1", firstNameEn: "Other", lastNameEn: "Child", dateOfBirth: "2023-02-02" });
    const c = await apply("c", { firstNameEn: "laila", lastNameEn: " HADDAD", dateOfBirth: "2023-05-10", passport: "" });
    const d = await apply("d", { gradeLevel: 3, emiratesId: "784-2018-1234567-1", firstNameEn: "Sam", lastNameEn: "Other", dateOfBirth: "2018-01-01" });
    const [rb, rc, rd] = await Promise.all([b, c, d].map((id) => owner.admissionApplication.findUniqueOrThrow({ where: { id } })));
    expect(rb.duplicateFlags).toContain(`eid:application:${appA}`);
    expect(rc.duplicateFlags).toContain(`namedob:application:${appA}`);
    expect(rd.duplicateFlags).toContain(`eid:student:${siblingId}`);
    // The family is never told.
    const view = await familyApplicationView(orgId, users.b.id, b);
    expect(JSON.stringify(view)).not.toContain(appA);
  });
});

describe("staff pipeline", () => {
  let app1: string;
  let app2: string;
  let app3: string;
  it("stage rules hold on the server", async () => {
    app1 = (await owner.admissionApplication.findFirstOrThrow({ where: { orgId, applicantUserId: users.a.id, stage: "NEW" } })).id;
    await expect(ec((e) => moveStage(e, actor(), app1, "ENROLLED"))).rejects.toThrow(/INVALID/);
    await expect(ec((e) => moveStage(e, actor(), app1, "OFFER_MADE"))).rejects.toThrow(/NEEDS_OFFER/);
    await expect(ec((e) => moveStage(e, actor(), app1, "DECLINED"))).rejects.toThrow(/REASON/);
    await ec((e) => moveStage(e, actor(), app1, "ASSESSED"));
    expect((await owner.admissionApplication.findUniqueOrThrow({ where: { id: app1 } })).stage).toBe("ASSESSED");
  });

  it("offers respect capacity; an override needs a reason; the family accepts and staff mark the seat paid", async () => {
    const ids = (await owner.admissionApplication.findMany({ where: { orgId, gradeLevel: KG1, stage: "NEW" }, orderBy: { createdAt: "asc" } })).map((x) => x.id);
    [app2, app3] = ids;
    const deadline = new Date(Date.now() + 10 * 86_400_000);
    await ec((e) => makeOffer(e, actor(), app1, { deadline, section: "A", override: false }));
    await ec((e) => makeOffer(e, actor(), app2, { deadline, section: null, override: false }));
    // Two KG1 seats, both offered: the third offer needs an override with a reason.
    await expect(ec((e) => makeOffer(e, actor(), app3, { deadline, section: null, override: false }))).rejects.toThrow(/FULL/);
    await expect(ec((e) => makeOffer(e, actor(), app3, { deadline, section: null, override: true, overrideReason: "" }))).rejects.toThrow(/REASON/);
    const year = (await admissionYears(tenantDb(orgId) as never, orgId)).find((y) => y.id === nextYearId)!;
    const seats = await tenantTx(orgId, (tx) => gradeSeats(tx, orgId, year, KG1));
    expect(seats).toMatchObject({ capacity: 2, offered: 2, holding: 0 });
    await respondToOffer(orgId, fam("a"), app1, true, null);
    const r1 = await owner.admissionApplication.findUniqueOrThrow({ where: { id: app1 } });
    expect(r1).toMatchObject({ stage: "OFFER_ACCEPTED", seatFeeFils: 150000 });
    // Seat booking amount is due: enrolling before payment is refused.
    await expect(ec((e) => enrollApplication(e, actor(), app1, { homeroomClassId: null, section: null, linkStudentId: null, sendInvites: true }))).rejects.toThrow(/NEEDS_PAYMENT/);
    expect(await ec((e) => markSeatPaid(e, { applicationId: app1, reference: "RCPT-1", actor: actor(), source: "staff" }))).toBe("paid");
    expect(await ec((e) => markSeatPaid(e, { applicationId: app1, reference: "RCPT-1", actor: actor(), source: "fees" }))).toBe("already");
  });

  it("orders the waitlist by priority and then by date", async () => {
    await ec((e) => moveStage(e, actor(), app3, "WAITLISTED"));
    const four = await apply("e");
    await ec((e) => moveStage(e, actor(), four, "WAITLISTED"));
    // The later application has a sibling at the school, so it moves ahead.
    await ec((e) => setPriority(e, actor(), four, { siblingStudentIds: [siblingId], staffChildVerified: false, priorityBoost: 0, reason: null }));
    const list = await tenantTx(orgId, (tx) => waitlist(tx, orgId, nextYearId, KG1));
    expect(list.rows.map((r) => r.id)).toEqual([four, app3]);
    expect(list.rows[0]).toMatchObject({ position: 1, score: 1 });
    await expect(ec((e) => setPriority(e, actor(), four, { siblingStudentIds: [siblingId], staffChildVerified: false, priorityBoost: 2, reason: "" }))).rejects.toThrow(/REASON/);
  });

  it("enroll creates the student, reuses the sibling's guardian, invites the new one and copies documents", async () => {
    await owner.admissionDocument.create({ data: { orgId, applicationId: app1, typeKey: "passport", fileName: "passport.pdf", mimeType: "application/pdf", sizeBytes: 100, storageKey: `local:${orgId}/x/passport.pdf`, checksum: "abc" } });
    await owner.admissionDocument.create({ data: { orgId, applicationId: app1, typeKey: "photo", fileName: "photo.png", mimeType: "image/png", sizeBytes: 100, storageKey: `local:${orgId}/x/photo.png`, checksum: "def", status: "REJECTED" } });
    // Make app1 a sibling application: the father is Mona's existing guardian record (same email), plus a new mother.
    const guardians = [
      { relationship: "FATHER", firstNameEn: "Mona", lastNameEn: "Saleh", firstNameAr: "", lastNameAr: "", email: users.mona.email.toUpperCase(), phone: "+971 50 555 0303", occupation: "", employer: "", livesWith: true, primary: true },
      { relationship: "GUARDIAN", firstNameEn: "Rami", lastNameEn: "Saleh", firstNameAr: "رامي", lastNameAr: "صالح", email: `${uid("rami")}@family.test`, phone: "+971 50 555 0404", occupation: "", employer: "", livesWith: true, primary: false },
    ];
    await owner.admissionApplication.update({ where: { id: app1 }, data: { guardians, siblingStudentIds: [siblingId] } });
    const res = await ec((e) => enrollApplication(e, actor(), app1, { homeroomClassId: null, section: null, linkStudentId: null, sendInvites: true }));
    expect(res).toMatchObject({ guardiansReused: 1, guardiansCreated: 1, documentsCopied: 2, status: "INACTIVE" });
    expect(res.admissionNo).toMatch(/^TAS\d{2}\d{4}$/);
    const s = await owner.student.findUniqueOrThrow({ where: { id: res.studentId }, include: { guardians: true, medical: true } });
    expect(s).toMatchObject({ gradeLevel: KG1, section: "A", status: "INACTIVE", studentNo: res.admissionNo, curriculum: "AMERICAN" });
    expect(s.medical?.allergiesEnc).toMatch(/^v1:/);
    // Siblings share the existing guardian, so Mona sees both children with her current account.
    expect(s.guardians.map((g) => g.guardianId)).toContain(existingGuardianId);
    const mona = await ctxFor(m.parent);
    expect(mona.membership.guardian?.links.map((l) => l.studentId).sort()).toEqual([siblingId, res.studentId].sort());
    // Only the guardian without an account is invited, for all of their children.
    expect(res.invites).toHaveLength(1);
    const inv = await owner.invitation.findFirstOrThrow({ where: { orgId, email: res.invites[0].email } });
    expect(inv.studentIds).toEqual([res.studentId]);
    const docs = await owner.document.findMany({ where: { orgId, studentId: res.studentId } });
    expect(docs.map((d) => d.titleEn).sort()).toEqual(["Offer of a Place", "Passport (child)"]);
    const reg = await owner.govRegistration.findFirstOrThrow({ where: { orgId, studentId: res.studentId } });
    expect(reg).toMatchObject({ kind: "ENROLLMENT", status: "NOT_SUBMITTED", authority: "SPEA_DALEEL" });
    const audit = await owner.auditEvent.findFirst({ where: { orgId, action: "admission.enroll", entityId: app1 } });
    expect(audit).not.toBeNull();
    // Accepted seats now count as enrolled for next year.
    const year = (await admissionYears(tenantDb(orgId) as never, orgId)).find((y) => y.id === nextYearId)!;
    expect(await tenantTx(orgId, (tx) => gradeSeats(tx, orgId, year, KG1))).toMatchObject({ enrolled: 1, offered: 1, holding: 0 });
  });
});

describe("permissions", () => {
  it("only admissions.manage moves stages and makes offers; only admissions.enroll enrolls", async () => {
    const app = (await owner.admissionApplication.findFirstOrThrow({ where: { orgId, stage: "WAITLISTED" } })).id;
    await as("teacher");
    expect(await moveStageAction({ applicationId: app, to: "NEW" })).toEqual({ ok: false, error: "FORBIDDEN" });
    await as("principal");
    expect(await makeOfferAction({ applicationId: app, deadline: "2099-01-01", section: null, override: true, overrideReason: "x" })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await enrollAction({ applicationId: app, homeroomClassId: null, section: null, linkStudentId: null, sendInvites: false })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect((await saveSettingsAction({} as never)).ok).toBe(false);
    await as("officer");
    expect(await moveStageAction({ applicationId: app, to: "NEW" })).toEqual({ ok: true });
  });

  it("health details follow the medical rules: admissions staff without medical access cannot open them", async () => {
    const app = (await owner.admissionApplication.findFirstOrThrow({ where: { orgId, hasMedical: true, stage: { not: "DRAFT" } } })).id;
    await as("officer");
    expect(await revealHealthAction({ applicationId: app })).toEqual({ ok: false, error: "FORBIDDEN" });
    await as("teacher");
    expect(await revealHealthAction({ applicationId: app })).toEqual({ ok: false, error: "FORBIDDEN" });
    await as("nurse");
    const res = await revealHealthAction({ applicationId: app });
    expect(res.ok).toBe(true);
    const audit = await owner.auditEvent.findFirst({ where: { orgId, action: "admission.health_view", entityId: app, actorId: m.nurse } });
    expect(audit?.sensitivity).toBe("MEDICAL");
  });

  it("government registration: approval needs the reference and date; a rejection needs a note", async () => {
    const reg = await owner.govRegistration.findFirstOrThrow({ where: { orgId } });
    await as("teacher");
    expect(await updateRegistrationAction({ registrationId: reg.id, status: "SUBMITTED", reference: null, date: null, note: null })).toEqual({ ok: false, error: "FORBIDDEN" });
    await as("officer");
    expect(await updateRegistrationAction({ registrationId: reg.id, status: "APPROVED", reference: "D-1", date: "2026-01-01", note: null })).toEqual({ ok: false, error: "INVALID" });
    expect((await updateRegistrationAction({ registrationId: reg.id, status: "SUBMITTED", reference: null, date: null, note: null })).ok).toBe(true);
    expect(await updateRegistrationAction({ registrationId: reg.id, status: "APPROVED", reference: null, date: "2026-01-01", note: null })).toEqual({ ok: false, error: "REFERENCE" });
    expect(await updateRegistrationAction({ registrationId: reg.id, status: "REJECTED", reference: null, date: null, note: null })).toEqual({ ok: false, error: "NOTE" });
    expect((await updateRegistrationAction({ registrationId: reg.id, status: "APPROVED", reference: "DLL-2026-0042", date: "2026-01-01", note: null })).ok).toBe(true);
    expect(await owner.govRegistration.findUniqueOrThrow({ where: { id: reg.id } })).toMatchObject({ status: "APPROVED", reference: "DLL-2026-0042" });
  });
});

describe("re-enrollment and leavers", () => {
  it("families answer per child, leavers become planned withdrawals, reminders go once per round", async () => {
    const now = new Date();
    const w = await ec((e) => openWindow(e, actor(), { academicYearId: nextYearId, opensAt: new Date(now.getTime() - 86_400_000), closesAt: new Date(now.getTime() + 14 * 86_400_000), messageEn: null, messageAr: null, reminderDays: [7, 2] }));
    const opened = await owner.notification.count({ where: { orgId, recipientId: m.parent, kind: "reenrollment_open" } });
    expect(opened).toBe(1);
    const sentA = await ec((e) => sendRemindersNow(e, actor(), w.id));
    const sentB = await ec((e) => sendRemindersNow(e, actor(), w.id));
    expect([sentA, sentB]).toEqual([1, 0]);
    // A parent may only answer for their own child.
    const other = await owner.student.create({ data: { orgId, studentNo: "TAS-0002", firstNameEn: "X", lastNameEn: "Y", firstNameAr: "س", lastNameAr: "ص", gradeLevel: 4 } });
    await expect(ec((e) => respond(e, { membershipId: m.parent, userId: users.mona.id, staff: false }, { windowId: w.id, studentId: other.id, intent: "RETURNING", reasonKey: null, reasonNote: null, leavingDate: null }))).rejects.toThrow(/FORBIDDEN/);
    await ec((e) => respond(e, { membershipId: m.parent, userId: users.mona.id, staff: false }, { windowId: w.id, studentId: siblingId, intent: "LEAVING", reasonKey: "relocation_abroad", reasonNote: null, leavingDate: null }));
    const wd = await owner.studentWithdrawal.findFirstOrThrow({ where: { orgId, studentId: siblingId } });
    expect(wd).toMatchObject({ status: "PLANNED", source: "REENROLLMENT" });
    const summary = await tenantTx(orgId, (tx) => windowSummary(tx, orgId, w.id));
    expect(summary.find((r) => r.grade === 2)).toMatchObject({ eligible: 1, leaving: 1, pending: 0 });
    // Changing the answer back cancels the planned withdrawal.
    await ec((e) => respond(e, { membershipId: m.parent, userId: users.mona.id, staff: false }, { windowId: w.id, studentId: siblingId, intent: "RETURNING", reasonKey: null, reasonNote: null, leavingDate: null }));
    expect((await owner.studentWithdrawal.findUniqueOrThrow({ where: { id: wd.id } })).status).toBe("CANCELLED");
  });

  it("completing a withdrawal issues a numbered transfer certificate and a withdrawal registration", async () => {
    const s = await owner.student.findFirstOrThrow({ where: { orgId, studentNo: "TAS-0002" } });
    const { planWithdrawal } = await import("@/server/admissions/withdrawals");
    const wd = await ec((e) => planWithdrawal(e, actor(), { studentId: s.id, leavingDate: new Date(), reasonKey: "another_school", reasonNote: null, destination: "Another school" }));
    const res = await ec((e) => completeWithdrawal(e, actor(), wd.id));
    expect(res.tcNumber).toMatch(/^TC-\d{4}-0001$/);
    expect((await owner.student.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("WITHDRAWN");
    expect(await owner.govRegistration.findFirst({ where: { orgId, studentId: s.id, kind: "WITHDRAWAL" } })).not.toBeNull();
    expect(await owner.document.findFirst({ where: { orgId, studentId: s.id, source: "GENERATED" } })).not.toBeNull();
  });
});

describe("reports and isolation", () => {
  it("reports are aggregates", async () => {
    const f = await tenantTx(orgId, (tx) => funnel(tx, orgId, nextYearId));
    expect(f.find((r) => r.stage === "NEW" && r.grade === KG1)?.n).toBeGreaterThanOrEqual(4);
    const nat = await tenantTx(orgId, (tx) => nationalitySummary(tx, orgId, nextYearId));
    expect(nat.every((r) => r.n >= 3 || r.code === "OTHER")).toBe(true);
  });

  it("another school cannot read, change or add admissions rows", async () => {
    const other = tenantDb(otherOrgId);
    expect(await other.admissionApplication.count()).toBe(0);
    expect(await other.admissionDocument.count()).toBe(0);
    expect(await other.admissionEvent.count()).toBe(0);
    expect(await other.govRegistration.count()).toBe(0);
    expect(await other.reenrollmentResponse.count()).toBe(0);
    const app = await owner.admissionApplication.findFirstOrThrow({ where: { orgId } });
    expect((await other.admissionApplication.updateMany({ where: { id: app.id }, data: { stage: "WITHDRAWN" } })).count).toBe(0);
    await expect(tenantTx(otherOrgId, (tx) => tx.admissionApplication.create({ data: { orgId, number: "X", applicantUserId: "u", academicYearId: nextYearId, gradeLevel: 1 } }))).rejects.toThrow();
    // Application history is append-only for the app role.
    await expect(tenantTx(orgId, (tx) => tx.admissionEvent.deleteMany({ where: { applicationId: app.id } }))).rejects.toThrow();
  });

  it("applicant sessions are signed and tied to the password", () => {
    process.env.AUTH_SECRET ||= "test-secret";
    const t = makeApplicantToken("user1", "hash-a");
    expect(readApplicantToken(t)?.userId).toBe("user1");
    expect(readApplicantToken(`${t.split(".")[0]}.forged`)).toBeNull();
    expect(readApplicantToken(makeApplicantToken("user1", "hash-a", Date.now() - 13 * 3600_000))).toBeNull();
  });
});
