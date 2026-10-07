import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { readZip } from "@/lib/zip";
import { encryptField } from "@/lib/crypto";
import { getObject, putObjectAt, deleteObject } from "@/server/documents/storage-core";
import { buildSubjectExport, ExportError } from "@/server/privacy/export";
import { resolveSubject } from "@/server/privacy/subject";
import { applyErasure, planErasure, summarise } from "@/server/privacy/erase";
import { expireSchoolExports, requestSchoolExport, runSchoolExport } from "@/server/privacy/school-export";
import { resetLastActiveMemo, touchLastActive } from "@/server/identity/last-active";
import { pilotMeasures } from "@/server/analytics/pilot";
import { deleteSchool, schoolDeletionReport } from "@/server/platform/school-delete";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
const uploadDir = mkdtempSync(path.join(tmpdir(), "privacy-test-"));
process.env.LOCAL_UPLOAD_DIR = uploadDir;
const orgIds: string[] = [];
const userIds: string[] = [];
const DAY = 86_400_000;

type World = Awaited<ReturnType<typeof makeSchool>>;

async function member(orgId: string, name: string, staff = true) {
  const user = await owner.user.create({ data: { email: `${uid(name.toLowerCase())}@privacy.test`, nameEn: name, nameAr: "اسم" } });
  userIds.push(user.id);
  const m = await owner.membership.create({ data: { orgId, userId: user.id } });
  if (staff) await owner.staffProfile.create({ data: { orgId, membershipId: m.id, phone: "+971500000000" } });
  return m;
}

async function makeSchool(label: string) {
  const org = await owner.organization.create({ data: { slug: uid(`priv-${label}`), nameEn: `Privacy ${label}`, nameAr: `خصوصية ${label}` } });
  const orgId = org.id;
  orgIds.push(orgId);
  const admin = await member(orgId, `Admin${label}`);
  const studentM = await member(orgId, `Student${label}`, false);
  const parentM = await member(orgId, `Parent${label}`, false);
  const student = await owner.student.create({
    data: { orgId, membershipId: studentM.id, studentNo: `S-${label}-1`, firstNameEn: "Lina", lastNameEn: `Test${label}`, firstNameAr: "لينا", lastNameAr: "اختبار", gradeLevel: 9, dateOfBirth: new Date("2011-03-04") },
  });
  const guardian = await owner.guardian.create({ data: { orgId, membershipId: parentM.id, firstNameEn: "Huda", lastNameEn: `Test${label}`, firstNameAr: "هدى", lastNameAr: "اختبار", email: `huda-${label}@privacy.test` } });
  await owner.guardianLink.create({ data: { orgId, guardianId: guardian.id, studentId: student.id } });
  const cat = await owner.serviceCategory.create({ data: { orgId, key: uid("cat"), nameEn: "Cat", nameAr: "فئة" } });
  const service = await owner.serviceDefinition.create({ data: { orgId, key: uid("svc"), categoryId: cat.id, nameEn: "Enrolment letter", nameAr: "خطاب قيد", descEn: "d", descAr: "د" } });
  const form = await owner.form.create({ data: { orgId, key: uid("form"), nameEn: "F", nameAr: "ن" } });
  const fv = await owner.formVersion.create({ data: { orgId, formId: form.id, version: 1, schema: {} } });
  const submission = await owner.submission.create({ data: { orgId, formVersionId: fv.id, submittedById: parentM.id, studentId: student.id, data: { reason: "Visa for Lina" } } });
  const request = await owner.request.create({
    data: { orgId, number: uid("REQ"), serviceId: service.id, requesterId: parentM.id, studentId: student.id, submissionId: submission.id, titleEn: "Letter for Lina", titleAr: "خطاب للينا" },
  });
  const standard = await owner.case.create({ data: { orgId, number: uid("C"), type: "ACADEMIC", studentId: student.id, titleEn: "Maths support", titleAr: "دعم الرياضيات", assigneeId: admin.id } });
  const note = await owner.caseNote.create({ data: { orgId, caseId: standard.id, authorId: admin.id } });
  await owner.caseNoteVersion.create({ data: { orgId, noteId: note.id, version: 1, body: "Weekly maths session agreed.", editedById: admin.id } });
  const wellbeing = await owner.case.create({ data: { orgId, number: uid("C"), type: "WELLBEING", sensitivity: "WELLBEING", studentId: student.id, titleEn: "Wellbeing check", titleAr: "متابعة الرفاه" } });
  const safeguarding = await owner.case.create({ data: { orgId, number: uid("C"), type: "SAFEGUARDING", sensitivity: "SAFEGUARDING", studentId: student.id, titleEn: "Protection concern", titleAr: "مخاوف حماية" } });
  await owner.studentMedical.create({ data: { orgId, studentId: student.id, allergiesEnc: encryptField("Peanuts"), hasAlert: true } });
  await owner.attendanceRecord.create({ data: { orgId, studentId: student.id, date: new Date("2026-09-15"), status: "PRESENT" } });
  await owner.notification.create({ data: { orgId, recipientId: studentM.id, kind: "info", titleEn: "Hello", titleAr: "مرحبا" } });
  const storageKey = await putObjectAt(`${orgId}/test/${uid("passport")}.pdf`, Buffer.from(`%PDF passport copy ${label}`), "application/pdf");
  const doc = await owner.document.create({ data: { orgId, titleEn: "Passport copy", titleAr: "نسخة الجواز", studentId: student.id, uploadedById: parentM.id, source: "UPLOAD" } });
  await owner.documentVersion.create({ data: { orgId, documentId: doc.id, version: 1, storageKey, fileName: "passport.pdf", mimeType: "application/pdf", sizeBytes: 20, createdById: parentM.id } });
  const purpose = await owner.processingPurpose.create({ data: { orgId, key: "photo", nameEn: "Photos", nameAr: "الصور", descEn: "d", descAr: "د", lawfulBasis: "Consent", dataCategories: ["images"], requiresConsent: true } });
  await owner.consentRecord.create({ data: { orgId, purposeId: purpose.id, studentId: student.id, guardianId: guardian.id, status: "GRANTED" } });
  await owner.retentionPolicy.createMany({
    data: [
      { orgId, recordType: "student_record", nameEn: "Record", nameAr: "سجل", retentionDays: 365 * 50, action: "REVIEW" },
      { orgId, recordType: "request", nameEn: "Requests", nameAr: "طلبات", retentionDays: 365 * 3, action: "ANONYMIZE" },
      { orgId, recordType: "case_standard", nameEn: "Cases", nameAr: "حالات", retentionDays: 365 * 6, action: "REVIEW" },
      { orgId, recordType: "case_wellbeing", nameEn: "Wellbeing", nameAr: "رفاه", retentionDays: 365 * 7, action: "REVIEW" },
      { orgId, recordType: "case_safeguarding", nameEn: "Safeguarding", nameAr: "حماية", retentionDays: 365 * 25, action: "REVIEW" },
      { orgId, recordType: "medical", nameEn: "Medical", nameAr: "طبي", retentionDays: 365 * 7, action: "REVIEW" },
    ],
  });
  const now = new Date();
  const dsrAccess = await owner.dataSubjectRequest.create({ data: { orgId, number: uid("DSR"), type: "ACCESS", subjectName: "Lina", requesterName: "Huda", studentId: student.id, dueAt: new Date(now.getTime() + 30 * DAY) } });
  const dsrDeletion = await owner.dataSubjectRequest.create({ data: { orgId, number: uid("DSR"), type: "DELETION", subjectName: "Lina", requesterName: "Huda", studentId: student.id, dueAt: new Date(now.getTime() + 30 * DAY) } });
  return { org, orgId, admin, studentM, parentM, student, guardian, service, submission, request, standard, wellbeing, safeguarding, doc, storageKey, dsrAccess, dsrDeletion };
}

/** Just enough request context for the export and the case access module. */
function fakeCtx(w: World, perms: string[]) {
  return {
    orgId: w.orgId,
    db: tenantDb(w.orgId),
    org: w.org,
    user: { id: w.admin.userId, email: "admin@privacy.test" },
    membershipId: w.admin.id,
    roles: ["school_admin"],
    isStaff: true,
    isStudent: false,
    isParent: false,
    can: (p: string) => perms.includes(p),
  } as never;
}

let A: World;
let B: World;

beforeAll(async () => {
  A = await makeSchool("a");
  B = await makeSchool("b");
});

afterAll(async () => {
  for (const id of orgIds) {
    const { tenantTablesInDeleteOrder } = await import("../../prisma/seed/lib");
    for (const t of await tenantTablesInDeleteOrder(owner)) await owner.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "orgId" = $1`, id);
    await owner.organization.deleteMany({ where: { id } });
  }
  await owner.user.deleteMany({ where: { id: { in: userIds } } });
  await owner.platformAuditEvent.deleteMany({ where: { orgRef: { in: orgIds } } });
  await owner.$disconnect();
  rmSync(uploadDir, { recursive: true, force: true });
});

const ADMIN = ["compliance.manage", "cases.view_all", "school.manage"];

describe("one-person export", () => {
  it("contains the person's records across modules and their files, and nothing from another school", async () => {
    const res = await buildSubjectExport(fakeCtx(A, ADMIN), { kind: "student", id: A.student.id }, { dsrId: A.dsrAccess.id });
    const zip = readZip(res.zip);
    expect(zip.get("summary.pdf")!.subarray(0, 4).toString()).toBe("%PDF");
    const data = JSON.parse(zip.get("data.json")!.toString("utf8"));
    expect(data.Student[0].studentNo).toBe("S-a-1");
    expect(data.Student[0]).not.toHaveProperty("emiratesIdEnc");
    expect(data.Request.map((r: { id: string }) => r.id)).toContain(A.request.id);
    expect(data.Notification).toHaveLength(1);
    expect(data.AttendanceRecord).toHaveLength(1);
    expect(data.Case.map((c: { id: string }) => c.id)).toEqual([A.standard.id]);
    expect(data.CaseNote[0].body).toBe("Weekly maths session agreed.");
    expect(data.ConsentRecord).toHaveLength(1);
    expect(data.Document[0].id).toBe(A.doc.id);
    const fileName = [...zip.keys()].find((k) => k.startsWith("files/"));
    expect(fileName).toBeTruthy();
    expect(zip.get(fileName!)!.toString()).toBe("%PDF passport copy a");
    expect(zip.has("csv/Request.csv")).toBe(true);
    expect(zip.get("withheld.csv")!.toString("utf8")).toContain("Restricted");
    // Tenant isolation: nothing from school B appears anywhere in the archive.
    const all = [...zip.values()].map((b) => b.toString("latin1")).join("\n");
    for (const foreign of [B.student.id, B.request.id, B.doc.id, B.standard.id, "S-b-1", "passport copy b"]) expect(all).not.toContain(foreign);
    const events = await owner.auditEvent.findMany({ where: { orgId: A.orgId, action: "dsr.export", entityId: A.student.id } });
    expect(events.length).toBeGreaterThan(0);
  });

  it("cannot reach a person in another school", async () => {
    await expect(buildSubjectExport(fakeCtx(A, ADMIN), { kind: "student", id: B.student.id })).rejects.toBeInstanceOf(ExportError);
    expect(await resolveSubject(tenantDb(A.orgId), A.orgId, { kind: "student", id: B.student.id })).toBeNull();
    await expect(buildSubjectExport(fakeCtx(A, ADMIN), { kind: "guardian", id: A.guardian.id }, { dsrId: A.dsrAccess.id })).rejects.toMatchObject({ code: "DSR_MISMATCH" });
  });
});

describe("sensitive withholding", () => {
  const withheldOf = (res: Awaited<ReturnType<typeof buildSubjectExport>>) => Object.fromEntries(res.withheld.map((w) => [`${w.model}:${w.reason}`, w.count]));

  it("releases wellbeing and medical content only for an access request and an exporter with access; never safeguarding", async () => {
    const counselor = [...ADMIN, "cases.wellbeing", "people.medical"];
    const access = await buildSubjectExport(fakeCtx(A, counselor), { kind: "student", id: A.student.id }, { dsrId: A.dsrAccess.id });
    expect(access.data.Case.map((c) => c.id).sort()).toEqual([A.standard.id, A.wellbeing.id].sort());
    expect(access.data.StudentMedical[0].allergies).toBe("Peanuts");
    expect(withheldOf(access)).toEqual({ "Restricted:protected": 1 });
    const audited = await owner.auditEvent.count({ where: { orgId: A.orgId, action: "case.export", entityId: A.wellbeing.id } });
    expect(audited).toBeGreaterThan(0);
    expect(JSON.stringify(access.data)).not.toContain(A.safeguarding.id);

    const deletion = await buildSubjectExport(fakeCtx(A, counselor), { kind: "student", id: A.student.id }, { dsrId: A.dsrDeletion.id });
    expect(deletion.data.StudentMedical).toBeUndefined();
    expect(withheldOf(deletion)).toEqual({ "Restricted:protected": 1, "Restricted:request_type": 2 });

    const none = await buildSubjectExport(fakeCtx(A, counselor), { kind: "student", id: A.student.id });
    expect(withheldOf(none)).toEqual({ "Restricted:protected": 1, "Restricted:no_request": 2 });

    // The school admin has no wellbeing or medical access: withheld as protected, without saying what it is.
    const admin = await buildSubjectExport(fakeCtx(A, ADMIN), { kind: "student", id: A.student.id }, { dsrId: A.dsrAccess.id });
    expect(withheldOf(admin)).toEqual({ "Restricted:protected": 3 });
    expect(JSON.stringify(admin.withheld)).not.toMatch(/SAFEGUARDING|WELLBEING/);
  });
});

describe("erasure", () => {
  it("does exactly what the preview said, keeps what the school must retain and removes the files", async () => {
    const db = tenantDb(A.orgId);
    const subject = (await resolveSubject(db, A.orgId, { kind: "student", id: A.student.id }))!;
    const plan = await planErasure(db, A.orgId, subject);
    const byModel = summarise(plan.items);
    expect(byModel["Notification:delete"]).toBe(1);
    expect(byModel["Document:delete"]).toBe(1);
    expect(byModel["GuardianLink:delete"]).toBe(1);
    expect(byModel["AttendanceRecord:retain"]).toBe(1);
    expect(byModel["Case:retain"]).toBe(3);
    expect(byModel["Request:anonymise"]).toBe(1);
    expect(byModel["Submission:anonymise"]).toBe(1);
    expect(byModel["ConsentRecord:retain"]).toBe(1);
    expect(byModel["StudentMedical:retain"]).toBe(1);
    expect(plan.files).toBe(1);

    // A stale preview is refused.
    expect(await tenantTx(A.orgId, (tx) => applyErasure(tx, A.orgId, subject, { expectHash: "stale" }))).toBeNull();

    const result = (await tenantTx(A.orgId, (tx) => applyErasure(tx, A.orgId, subject, { expectHash: plan.hash })))!;
    expect(result).not.toBeNull();
    expect(summarise(result.done)).toEqual(summarise(plan.items));
    for (const k of result.fileKeys) expect(await deleteObject(k)).toBe(true);
    expect(await getObject(A.storageKey)).toBeNull();

    const s = await owner.student.findUniqueOrThrow({ where: { id: A.student.id } });
    expect([s.firstNameEn, s.lastNameEn, s.dateOfBirth, s.anonymisedAt !== null]).toEqual(["Former", "student", null, true]);
    expect(await owner.notification.count({ where: { recipientId: A.studentM.id } })).toBe(0);
    expect(await owner.document.count({ where: { id: A.doc.id } })).toBe(0);
    expect(await owner.attendanceRecord.count({ where: { studentId: A.student.id } })).toBe(1);
    expect(await owner.case.count({ where: { studentId: A.student.id } })).toBe(3);
    const req = await owner.request.findUniqueOrThrow({ where: { id: A.request.id }, include: { submission: true } });
    expect(req.titleEn).toBe("Enrolment letter");
    expect(req.submission?.data).toEqual({});
    expect((await owner.dataSubjectRequest.findUniqueOrThrow({ where: { id: A.dsrAccess.id } })).subjectName).toContain("Erased");
    expect((await owner.membership.findUniqueOrThrow({ where: { id: A.studentM.id } })).status).toBe("SUSPENDED");
    // School B is untouched.
    expect((await owner.student.findUniqueOrThrow({ where: { id: B.student.id } })).firstNameEn).toBe("Lina");
    expect(await getObject(B.storageKey)).not.toBeNull();
  });
});

describe("school export job", () => {
  it("is idempotent, contains only the school's data, and expires", async () => {
    const first = await requestSchoolExport(B.orgId, { requestedById: B.admin.id, includeRestricted: false });
    const again = await requestSchoolExport(B.orgId, { requestedById: B.admin.id, includeRestricted: false });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.export.id).toBe(first.export.id);
    const job = { orgId: B.orgId, exportId: first.export.id };
    expect(await runSchoolExport(job)).toBe("ready");
    expect(await runSchoolExport(job)).toBe("duplicate");
    expect(await owner.jobRun.count({ where: { orgId: B.orgId, idempotencyKey: `school-export:${first.export.id}` } })).toBe(1);
    const row = await owner.dataExport.findUniqueOrThrow({ where: { id: first.export.id } });
    expect(row.status).toBe("READY");
    expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    const zip = readZip((await getObject(row.storageKey!))!);
    expect(zip.has("README.txt")).toBe(true);
    const students = zip.get("people/Student.csv")!.toString("utf8");
    expect(students).toContain(B.student.id);
    expect(students).not.toContain(A.student.id);
    const cases = zip.get("cases/Case.csv")!.toString("utf8");
    expect(cases).toContain(B.standard.id);
    expect(cases).not.toContain(B.safeguarding.id);
    expect([...zip.keys()].some((k) => k.startsWith("restricted/"))).toBe(false);
    expect([...zip.keys()].some((k) => k.startsWith("files/"))).toBe(true);
    expect(zip.get("people/StudentMedical.csv")?.toString("utf8") ?? "").not.toContain("allergiesEnc");

    expect(await expireSchoolExports(B.orgId, new Date(Date.now() + 25 * 3600_000))).toBe(1);
    expect((await owner.dataExport.findUniqueOrThrow({ where: { id: first.export.id } })).status).toBe("EXPIRED");
    expect(await getObject(row.storageKey!)).toBeNull();
  });
});

describe("last active", () => {
  it("writes at most once per 15 minutes", async () => {
    resetLastActiveMemo();
    const db = tenantDb(A.orgId);
    const t0 = new Date("2026-10-01T08:00:00Z");
    expect(await touchLastActive(db, A.admin.id, null, t0)).toBe(true);
    const seen = (await owner.membership.findUniqueOrThrow({ where: { id: A.admin.id } })).lastSeenAt!;
    expect(seen.toISOString()).toBe(t0.toISOString());
    expect(await touchLastActive(db, A.admin.id, seen, new Date(t0.getTime() + 14 * 60_000))).toBe(false);
    expect(await touchLastActive(db, A.admin.id, seen, new Date(t0.getTime() + 16 * 60_000))).toBe(true);
    // Another process already wrote: the conditional update does nothing.
    resetLastActiveMemo();
    expect(await touchLastActive(db, A.admin.id, seen, new Date(t0.getTime() + 20 * 60_000))).toBe(false);
    // A membership in another school is never touched through this school's client.
    resetLastActiveMemo();
    expect(await touchLastActive(db, B.admin.id, null, t0)).toBe(false);
  });
});

describe("pilot measures", () => {
  it("computes adoption, letter median, on-time share and meetings for the period", async () => {
    const org = await owner.organization.create({ data: { slug: uid("pilot"), nameEn: "Pilot", nameAr: "تجربة" } });
    orgIds.push(org.id);
    const orgId = org.id;
    const now = new Date("2026-10-05T12:00:00Z");
    const period = { from: new Date("2026-09-29T00:00:00Z"), to: now };
    const s1 = await member(orgId, "T1");
    const s2 = await member(orgId, "T2");
    const s3 = await member(orgId, "T3");
    await owner.membership.update({ where: { id: s1.id }, data: { lastSeenAt: new Date("2026-10-04T09:00:00Z") } });
    await owner.membership.update({ where: { id: s3.id }, data: { lastSeenAt: new Date("2026-09-01T09:00:00Z") } });
    await owner.auditEvent.create({ data: { orgId, actorId: s2.id, action: "x", entityType: "y", createdAt: new Date("2026-10-02T09:00:00Z") } });
    // 4 guardians, 1 linked with an active account.
    const pm = await member(orgId, "P1", false);
    await owner.guardian.create({ data: { orgId, membershipId: pm.id, firstNameEn: "A", lastNameEn: "B", firstNameAr: "أ", lastNameAr: "ب" } });
    for (let i = 0; i < 3; i++) await owner.guardian.create({ data: { orgId, firstNameEn: "G", lastNameEn: String(i), firstNameAr: "و", lastNameAr: "ل" } });
    const cat = await owner.serviceCategory.create({ data: { orgId, key: "c", nameEn: "C", nameAr: "ف" } });
    const svc = await owner.serviceDefinition.create({ data: { orgId, key: "s", categoryId: cat.id, nameEn: "S", nameAr: "خ", descEn: "d", descAr: "د", slaHours: 48 } });
    const mk = async (submitted: string, completed: string | null, extra: Record<string, unknown> = {}) =>
      owner.request.create({ data: { orgId, number: uid("R"), serviceId: svc.id, requesterId: s1.id, titleEn: "t", titleAr: "ت", submittedAt: new Date(submitted), completedAt: completed ? new Date(completed) : null, status: completed ? "COMPLETED" : "SUBMITTED", ...extra } });
    // Closed in period: two inside the 48 h target, one late, one sensitive (ignored).
    await mk("2026-09-30T08:00:00Z", "2026-10-01T08:00:00Z");
    await mk("2026-09-30T08:00:00Z", "2026-10-01T20:00:00Z", { slaDueAt: new Date("2026-10-02T00:00:00Z") });
    await mk("2026-09-25T08:00:00Z", "2026-10-03T08:00:00Z");
    await mk("2026-09-30T08:00:00Z", "2026-10-03T08:00:00Z", { sensitivity: "WELLBEING" });
    // Letters issued 1, 3 and 10 days after the request: median 3.
    for (const days of [1, 3, 10]) {
      const submitted = new Date(Date.parse("2026-10-04T08:00:00Z") - days * DAY);
      const r = await mk(submitted.toISOString(), null);
      await owner.document.create({ data: { orgId, titleEn: "Letter", titleAr: "خطاب", source: "GENERATED", requestId: r.id, uploadedById: s1.id, createdAt: new Date("2026-10-04T08:00:00Z") } });
    }
    const type = await owner.appointmentType.create({ data: { orgId, key: "m", nameEn: "M", nameAr: "م", durationMin: 30 } as never });
    const appt = (status: string, created: string) =>
      owner.appointment.create({ data: { orgId, typeId: type.id, hostId: s1.id, bookedById: pm.id, startsAt: new Date("2026-10-10T08:00:00Z"), endsAt: new Date("2026-10-10T08:30:00Z"), status: status as "CONFIRMED", createdAt: new Date(created) } });
    await appt("CONFIRMED", "2026-10-01T08:00:00Z");
    await appt("CONFIRMED", "2026-10-02T08:00:00Z");
    await appt("CANCELLED", "2026-10-02T08:00:00Z");
    await appt("CONFIRMED", "2026-09-01T08:00:00Z");

    const m = await pilotMeasures(tenantDb(orgId), orgId, period);
    expect(m.staffTotal).toBe(3);
    expect(m.staffActive).toBe(2);
    expect(m.guardiansOnRecord).toBe(4);
    expect(m.parentAccountsLinked).toBe(1);
    expect(m.adoptionPct).toBe(25);
    expect(m.lettersIssued).toBe(3);
    expect(m.letterMedianDays).toBe(3);
    expect(m.requestsClosed).toBe(3);
    expect(m.requestsClosedOnTime).toBe(2);
    expect(m.onTimePct).toBe(66.7);
    expect(m.meetingsBooked).toBe(2);
  });
});

describe("delete school (platform)", () => {
  it("reports, refuses without the typed slug, deletes everything and keeps a platform record without personal data", async () => {
    const org = await owner.organization.create({ data: { slug: uid("gone"), nameEn: "Leaving School", nameAr: "مدرسة مغادرة" } });
    orgIds.push(org.id);
    const lonely = await member(org.id, "OnlyHere");
    const shared = await owner.membership.create({ data: { orgId: org.id, userId: A.admin.userId } });
    await owner.student.create({ data: { orgId: org.id, studentNo: "G-1", firstNameEn: "Omar", lastNameEn: "Gone", firstNameAr: "عمر", lastNameAr: "مغادر", gradeLevel: 7 } });
    await owner.auditEvent.create({ data: { orgId: org.id, actorId: lonely.id, action: "x", entityType: "y" } });
    await putObjectAt(`${org.id}/x/file.txt`, Buffer.from("hello"), "text/plain");

    const report = (await schoolDeletionReport(owner, org.id))!;
    expect(report.totalRows).toBeGreaterThanOrEqual(5);
    expect(report.files).toBe(1);
    expect(report.users).toEqual({ exclusive: 1, shared: 1 });
    expect(await deleteSchool(owner, org.id, { confirm: "nope", actorUserId: A.admin.userId, actorOrgId: A.orgId })).toEqual({ ok: false, error: "CONFIRM" });
    expect(await deleteSchool(owner, org.id, { confirm: org.slug, actorUserId: A.admin.userId, actorOrgId: org.id })).toEqual({ ok: false, error: "CURRENT_SCHOOL" });

    const res = await deleteSchool(owner, org.id, { confirm: org.slug, actorUserId: A.admin.userId, actorOrgId: A.orgId });
    expect(res.ok).toBe(true);
    expect(await owner.organization.count({ where: { id: org.id } })).toBe(0);
    expect(await owner.student.count({ where: { orgId: org.id } })).toBe(0);
    expect(await owner.auditEvent.count({ where: { orgId: org.id } })).toBe(0);
    expect(await owner.membership.count({ where: { id: shared.id } })).toBe(0);
    expect(await owner.user.count({ where: { id: lonely.userId } })).toBe(0);
    expect(await owner.user.count({ where: { id: A.admin.userId } })).toBe(1);
    const record = await owner.platformAuditEvent.findFirstOrThrow({ where: { orgRef: org.id } });
    const text = JSON.stringify(record);
    for (const personal of ["Omar", "Leaving School", "OnlyHere", "@privacy.test"]) expect(text).not.toContain(personal);
    expect(record.action).toBe("school.delete");
    // Other schools are untouched.
    expect(await owner.student.count({ where: { orgId: B.orgId } })).toBe(1);
  });
});
