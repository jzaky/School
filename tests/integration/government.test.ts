// Government reporting against real Postgres through the RLS-restricted app role: census counts from student
// records, the checks before sending, small-number suppression, permissions (including the Emirates ID gate on
// downloads), the file log with versions and checksums, submissions and their audit trail, due date reminders
// (idempotent), and tenant isolation.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));
vi.mock("@/server/queue", () => ({ flushEffects: async () => undefined, queue: () => null }));
vi.mock("@/server/context", () => ({ getCtx: async () => current.ctx, getOptionalCtx: async () => current.ctx }));

import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { can, permissionsOf, roleKeysOf } from "@/server/identity/can";
import type { Ctx } from "@/server/context";
import { encryptField } from "@/lib/crypto";
import { readZip } from "@/lib/zip";
import { buildReturn } from "@/server/govreports/build";
import { createReturnAction, fixStudentAction, logSubmissionAction, recordReferenceAction, saveDueDateAction, signOffAction } from "@/server/govreports/actions";
import { runGovReminders } from "@/server/govreports/reminders";
import { cellValue } from "@/server/govreports/table";
import { GET as exportRoute } from "@/app/api/government/export/route";
import { installStarterTemplate } from "../../prisma/seed/starter";
import { wipeTenant } from "../../prisma/seed/lib";
import { ownerClient, uid } from "./helpers";

let owner: PrismaClient;
let orgId: string;
let otherOrgId: string;
const m: Record<string, string> = {};
const s: Record<string, string> = {};
const DAY = 86_400_000;
const todayKey = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
const dayKey = (offset: number) => new Date(Date.now() + 4 * 3600_000 + offset * DAY).toISOString().slice(0, 10);

async function ctxFor(membershipId: string, org = orgId, locale: "en" | "ar" = "en"): Promise<Ctx> {
  const membership = await owner.membership.findUniqueOrThrow({ where: { id: membershipId }, include: { roles: { include: { role: true } }, staffProfile: true, student: true, guardian: { include: { links: { include: { student: true } } } } } });
  const user = await owner.user.findUniqueOrThrow({ where: { id: membership.userId } });
  const o = await owner.organization.findUniqueOrThrow({ where: { id: org } });
  const roles = roleKeysOf(membership);
  return { orgId: org, db: tenantDb(org), org: o, user, membership, membershipId, roles, perms: permissionsOf(membership), locale, persona: null, isStudent: false, isParent: false, isStaff: true, can: (p) => can(membership, p), session: null as never } as Ctx;
}
const as = async (key: string, locale: "en" | "ar" = "en") => {
  current.ctx = await ctxFor(m[key], key === "otherRegistrar" ? otherOrgId : orgId, locale);
  return current.ctx as Ctx;
};

async function staff(key: string, role: string, org = orgId) {
  const u = await owner.user.create({ data: { email: `${uid(key)}@gov.test`, nameEn: `Staff ${key}`, nameAr: `موظف ${key}`, emailVerified: new Date() } });
  const mem = await owner.membership.create({ data: { orgId: org, userId: u.id, status: "ACTIVE" } });
  const r = await owner.role.findFirstOrThrow({ where: { orgId: org, key: role } });
  await owner.membershipRole.create({ data: { orgId: org, membershipId: mem.id, roleId: r.id } });
  await owner.staffProfile.create({ data: { orgId: org, membershipId: mem.id, jobTitleEn: role === "principal" ? "Principal" : null, employeeNo: role === "teacher" ? null : `E-${key}` } });
  m[key] = mem.id;
}

/** A birth date at the usual age for the grade (grade + 5 on 31 December of the school year's first calendar year). */
function dobFor(grade: number) {
  const [y, mo] = todayKey().split("-").map(Number);
  const entry = mo >= 8 ? y : y - 1;
  return new Date(Date.UTC(entry - grade - 5, 2, 1));
}

const EID_A = "784201012345674";
const EID_DUP = "784201099999990";

async function student(key: string, over: Record<string, unknown> = {}) {
  const row = await owner.student.create({
    data: {
      orgId,
      studentNo: `GOV-${key}`,
      firstNameEn: `Stu${key}`,
      lastNameEn: "Test",
      firstNameAr: "طالب",
      lastNameAr: "اختبار",
      gradeLevel: 5,
      section: "A",
      gender: "F",
      dateOfBirth: dobFor(Number(over.gradeLevel ?? 5)),
      nationalityEn: "Emirati",
      nationalityAr: "إماراتي",
      emiratesIdEnc: encryptField(`7842010${String(Object.keys(s).length).padStart(7, "0")}1`),
      emiratesIdLast4: "0001",
      enrolledOn: new Date(Date.now() - 400 * DAY),
      curriculum: "AMERICAN",
      ...over,
    },
  });
  s[key] = row.id;
  await owner.govRegistration.create({ data: { orgId, studentId: row.id, kind: "ENROLLMENT", authority: "SPEA_DALEEL", status: "APPROVED", reference: `DAL-${key}`, decidedAt: new Date() } });
  return row.id;
}

beforeAll(async () => {
  owner = ownerClient();
  const org = await owner.organization.create({ data: { slug: uid("gov-itest"), nameEn: "Gov Test Academy Sharjah", nameAr: "أكاديمية الاختبار", shortNameEn: "GTA", regulator: "SPEA", emirate: "Sharjah", curricula: ["AMERICAN"] } });
  orgId = org.id;
  await installStarterTemplate(owner, orgId, { curricula: ["AMERICAN"], locale: "en", now: new Date(), installCourses: false });
  await staff("registrar", "registrar");
  await staff("admin", "school_admin");
  await staff("principal", "principal");
  await staff("teacher", "teacher");
  // A clerk who prepares returns but may not see full identity numbers.
  await owner.role.create({ data: { orgId, key: "gov_clerk", nameEn: "Returns clerk", nameAr: "موظف التقارير", permissions: ["government.reports", "people.view"], isSystem: false } });
  await staff("clerk", "gov_clerk");

  // Grade 5: six students, three of them people of determination (never printed), one Indian, one boy.
  for (const k of ["a", "b", "c", "d"]) await student(k, { hasSen: k !== "d" });
  await student("e", { gender: "M", nationalityEn: "India", nationalityAr: null });
  await student("f", { section: "B" });
  await owner.studentMedical.create({ data: { orgId, studentId: s.a, allergiesEnc: encryptField("Peanuts"), hasAlert: true } });
  await owner.student.update({ where: { id: s.a }, data: { emiratesIdEnc: encryptField(EID_A), emiratesIdLast4: EID_A.slice(-4) } });
  // Problems: no nationality, no Emirates ID, no registration reference, and two records with the same ID.
  await student("g", { nationalityEn: null, nationalityAr: null });
  await student("h", { emiratesIdEnc: null, emiratesIdLast4: null });
  const noRef = await student("i");
  await owner.govRegistration.deleteMany({ where: { studentId: noRef } });
  await student("j", { emiratesIdEnc: encryptField(EID_DUP), firstNameEn: "Twin" });
  await student("k", { emiratesIdEnc: encryptField(EID_DUP), firstNameEn: "Other" });
  // A student who joined in the period, and one admitted for later (not on roll).
  await student("new", { enrolledOn: new Date(Date.now() - 5 * DAY), gradeLevel: 6 });
  await student("later", { enrolledOn: new Date(Date.now() + 200 * DAY), status: "INACTIVE", gradeLevel: 6 });

  const other = await owner.organization.create({ data: { slug: uid("gov-other"), nameEn: "Other", nameAr: "أخرى" } });
  otherOrgId = other.id;
  await installStarterTemplate(owner, otherOrgId, { curricula: ["AMERICAN"], locale: "en", now: new Date(), installCourses: false });
  await staff("otherRegistrar", "registrar", otherOrgId);
}, 300_000);

afterAll(async () => {
  for (const id of [orgId, otherOrgId].filter(Boolean)) {
    await wipeTenant(owner, id);
    await owner.organization.delete({ where: { id } }).catch(() => undefined);
  }
  await owner?.$disconnect();
});

let censusId = "";

const download = async (query: string) => {
  const res = await exportRoute(new Request(`http://localhost/api/government/export?${query}`));
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: res.headers };
};

describe("returns and permissions", () => {
  it("only government.reports holders create returns; the authority comes from the school's regulator", async () => {
    await as("teacher");
    expect(await createReturnAction({ kind: "CENSUS", asOf: todayKey() })).toEqual({ ok: false, error: "FORBIDDEN" });
    await as("principal");
    expect(await createReturnAction({ kind: "CENSUS", asOf: todayKey() })).toEqual({ ok: false, error: "FORBIDDEN" });
    await as("registrar");
    expect(await createReturnAction({ kind: "NOPE", asOf: todayKey() })).toEqual({ ok: false, error: "KIND" });
    expect(await createReturnAction({ kind: "CENSUS", asOf: todayKey(), periodFrom: dayKey(5) })).toEqual({ ok: false, error: "PERIOD" });
    const r = await createReturnAction({ kind: "CENSUS", asOf: todayKey() });
    expect(r.ok).toBe(true);
    censusId = (r as { id: string }).id;
    const row = await owner.govReturn.findUniqueOrThrow({ where: { id: censusId } });
    expect(row).toMatchObject({ authority: "SPEA_DALEEL", status: "DRAFT", kind: "CENSUS" });
    expect(await owner.auditEvent.count({ where: { orgId, action: "government.return_create", entityId: censusId } })).toBe(1);
  });
});

describe("census", () => {
  it("counts the students on roll from their records", async () => {
    const ret = await owner.govReturn.findUniqueOrThrow({ where: { id: censusId } });
    const data = await buildReturn(tenantDb(orgId), orgId, { kind: "CENSUS", asOf: ret.asOf, periodFrom: null });
    expect(data.summary).toMatchObject({ students: 12, male: 1, female: 11, emirati: 10, otherNationalities: 1, grades: 2 });
    const grades = data.tables.find((t) => t.key === "grades")!;
    const g5 = grades.rows.find((r) => cellValue(r[0], "en") === "Grade 5")!;
    expect(g5.map((c) => cellValue(c, "en"))).toEqual(["Grade 5", 2, 1, 10, 11, 9, 1, 0, 0]);
    const g6 = grades.rows.find((r) => cellValue(r[0], "en") === "Grade 6")!;
    expect(cellValue(g6[7], "en")).toBe(1); // joined in the period
    const sections = data.tables.find((t) => t.key === "sections")!;
    expect(sections.rows.map((r) => `${cellValue(r[0], "en")} ${cellValue(r[1], "en")} ${cellValue(r[5], "en")}`)).toEqual(["Grade 5 A 10", "Grade 5 B 1", "Grade 6 A 1"]);
    const nat = data.tables.find((t) => t.key === "nationality")!;
    expect(nat.rows.map((r) => [cellValue(r[0], "en"), cellValue(r[1], "en")])).toEqual([["Emirati", 10], ["Indian", 1], ["Not recorded", 1]]);
  });

  it("never prints a count of people of determination below 5", async () => {
    const ret = await owner.govReturn.findUniqueOrThrow({ where: { id: censusId } });
    const data = await buildReturn(tenantDb(orgId), orgId, { kind: "CENSUS", asOf: ret.asOf, periodFrom: null });
    expect(data.summary.sen).toBeNull();
    const sen = data.tables.find((t) => t.key === "sen")!;
    expect(sen.rows.map((r) => cellValue(r[1], "en"))).toEqual(["Fewer than 5"]);
    expect(cellValue(sen.rows[0][0], "en")).toBe("Grade 5 to Grade 6");
    for (const t of data.tables) for (const r of t.rows) if (t.key === "sen" || cellValue(r[0], "en") === "People of determination") expect(r.map((c) => cellValue(c, "en"))).not.toContain(3);
  });

  it("finds the problems to fix, without printing an identity number", async () => {
    const ret = await owner.govReturn.findUniqueOrThrow({ where: { id: censusId } });
    const data = await buildReturn(tenantDb(orgId), orgId, { kind: "CENSUS", asOf: ret.asOf, periodFrom: null });
    const keyOf = (id?: string) => Object.entries(s).find(([, v]) => v === id)?.[0];
    const got = data.problems.filter((p) => p.rule !== "duplicate_eid").map((p) => `${p.rule}:${keyOf(p.studentId)}`).sort();
    expect(got).toEqual(["missing_eid:h", "missing_nationality:g", "no_reference:i"]);
    const dup = data.problems.filter((p) => p.rule === "duplicate_eid");
    expect(dup).toHaveLength(1);
    expect([keyOf(dup[0].studentId), keyOf(dup[0].otherStudentId)].sort()).toEqual(["j", "k"]);
    expect(JSON.stringify(data.problems)).not.toContain(EID_DUP);
    expect(JSON.stringify(data)).not.toContain("Peanuts");
  });
});

describe("exports, the Emirates ID gate and the file log", () => {
  it("the registrar exports Excel with English and Arabic headers; the file is logged and audited", async () => {
    await as("registrar");
    const x = await download(`return=${censusId}&format=xlsx`);
    expect(x.status).toBe(200);
    expect(x.headers.get("content-disposition")).toMatch(/census-\d{4}-\d{2}-\d{2}-v1\.xlsx/);
    const book = readZip(x.body);
    const text = [...book.entries()].filter(([k]) => k.startsWith("xl/worksheets/")).map(([, v]) => v.toString("utf8")).join("");
    expect(book.get("xl/workbook.xml")!.toString("utf8")).toContain('name="Students by grade and section"');
    expect(text).toContain(">Section<");
    expect(text).toContain(">الشعبة<");
    expect(text).not.toContain("Peanuts");
    expect(text).not.toContain(EID_A);
    const row = await owner.govReturnExport.findFirstOrThrow({ where: { returnId: censusId, format: "XLSX" } });
    expect(row).toMatchObject({ version: 1, withIds: false, problemCount: 4, generatedById: m.registrar });
    expect(row.fileSha256).toBe(createHash("sha256").update(x.body).digest("hex"));
    const a = await owner.auditEvent.findFirstOrThrow({ where: { orgId, entityId: censusId, action: "government.export_with_problems" } });
    expect(a.meta).toMatchObject({ format: "XLSX", version: 1, problems: 4, withIds: false });
  });

  it("the same data keeps its version; changed data gets the next one", async () => {
    await as("registrar");
    const c = await download(`return=${censusId}&format=csv`);
    expect(c.status).toBe(200);
    expect(c.body.toString("utf8").split("\r\n")[0]).toContain("Grade / الصف");
    expect((await owner.govReturnExport.findFirstOrThrow({ where: { returnId: censusId, format: "CSV" } })).version).toBe(1);
    const fix = await fixStudentAction({ studentId: s.g, nationality: "JO" });
    expect(fix).toEqual({ ok: true, fields: ["nationality"] });
    const st = await owner.student.findUniqueOrThrow({ where: { id: s.g } });
    expect([st.nationalityEn, st.nationalityAr]).toEqual(["Jordanian", "أردني"]);
    const audit = await owner.auditEvent.findFirstOrThrow({ where: { orgId, action: "student.identity_update", entityId: s.g } });
    expect(audit.meta).toEqual({ fields: ["nationality"], source: "government_reporting" });
    await download(`return=${censusId}&format=csv`);
    const latest = await owner.govReturnExport.findFirstOrThrow({ where: { returnId: censusId }, orderBy: { createdAt: "desc" } });
    expect(latest).toMatchObject({ version: 2, problemCount: 3 });
  });

  it("an Emirates ID typed in is stored encrypted and never written to the audit log", async () => {
    await as("registrar");
    expect(await fixStudentAction({ studentId: s.h, emiratesId: "784-2010-0000001" })).toEqual({ ok: false, error: "EID" });
    expect(await fixStudentAction({ studentId: s.h, emiratesId: "784-2010-7654321-9" })).toEqual({ ok: true, fields: ["emiratesId"] });
    const st = await owner.student.findUniqueOrThrow({ where: { id: s.h } });
    expect(st.emiratesIdEnc).toMatch(/^v1:/);
    expect(st.emiratesIdLast4).toBe("3219");
    const audits = await owner.auditEvent.findMany({ where: { orgId, entityId: s.h } });
    expect(JSON.stringify(audits)).not.toContain("7654321");
    await as("teacher");
    expect(await fixStudentAction({ studentId: s.h, gender: "M" })).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("full Emirates ID numbers need people.reveal_ids, only in the registration list, and are audited as confidential", async () => {
    await as("registrar");
    const reg = await createReturnAction({ kind: "REGISTRATION", asOf: todayKey(), periodFrom: dayKey(-30) });
    const regId = (reg as { id: string }).id;
    // The census never carries identity numbers.
    expect((await download(`return=${censusId}&format=xlsx&ids=1`)).status).toBe(400);
    const masked = await download(`return=${regId}&format=csv`);
    expect(masked.body.toString("utf8")).toContain("On file");
    const full = await download(`return=${regId}&format=csv&ids=1`);
    expect(full.status).toBe(200);
    expect(full.body.toString("utf8")).toMatch(/784-\d{4}-\d{7}-\d/);
    const ev = await owner.auditEvent.findFirstOrThrow({ where: { orgId, entityId: regId, meta: { path: ["withIds"], equals: true } } });
    expect(ev.sensitivity).toBe("CONFIDENTIAL");
    await as("clerk");
    expect((await download(`return=${regId}&format=csv`)).status).toBe(200);
    expect((await download(`return=${regId}&format=csv&ids=1`)).status).toBe(403);
    await as("principal");
    expect((await download(`return=${regId}&format=xlsx`)).status).toBe(403);
    expect((await download(`return=${censusId}&format=pdf&lang=ar`)).status).toBe(200);
    await as("teacher");
    expect((await download(`return=${censusId}&format=pdf`)).status).toBe(403);
  });
});

describe("sign-off and submission", () => {
  it("the principal signs off; the registrar cannot", async () => {
    await as("registrar");
    expect(await signOffAction({ returnId: censusId, confirm: true })).toEqual({ ok: false, error: "FORBIDDEN" });
    await as("principal");
    const r = await signOffAction({ returnId: censusId, confirm: true });
    expect(r.ok).toBe(true);
    const row = await owner.govReturn.findUniqueOrThrow({ where: { id: censusId } });
    expect(row).toMatchObject({ status: "SIGNED_OFF", signedOffById: m.principal, signedOffName: "Staff principal", signedOffTitle: "Principal" });
    expect(row.signedDataHash).toMatch(/^[0-9a-f]{64}$/);
    const pdf = await download(`return=${censusId}&format=pdf&lang=en`);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await owner.auditEvent.count({ where: { orgId, action: "government.sign_off", entityId: censusId } })).toBe(1);
  });

  it("a submission records the file, the authority's reference and closes the due date; the logs are append-only", async () => {
    await as("registrar");
    expect((await saveDueDateAction({ titleEn: "Census", titleAr: "الإحصاء", kind: "CENSUS", dueOn: dayKey(5) })).ok).toBe(true);
    const due = await owner.govDueDate.findFirstOrThrow({ where: { orgId, titleEn: "Census" } });
    await owner.govReturn.update({ where: { id: censusId }, data: { dueDateId: due.id } });
    const file = await owner.govReturnExport.findFirstOrThrow({ where: { returnId: censusId, format: "XLSX" } });
    expect(await logSubmissionAction({ returnId: censusId, exportId: file.id, submittedOn: dayKey(2), reference: "X" })).toEqual({ ok: false, error: "DATE_FUTURE" });
    expect(await logSubmissionAction({ returnId: censusId, exportId: file.id, submittedOn: todayKey(), reference: "DAL-CNS-778" })).toEqual({ ok: true });
    const sub = await owner.govSubmission.findFirstOrThrow({ where: { returnId: censusId } });
    expect(sub).toMatchObject({ reference: "DAL-CNS-778", exportId: file.id, recordedById: m.registrar });
    expect((await owner.govReturn.findUniqueOrThrow({ where: { id: censusId } })).status).toBe("SUBMITTED");
    expect((await owner.govDueDate.findUniqueOrThrow({ where: { id: due.id } })).doneAt).not.toBeNull();
    const ev = await owner.auditEvent.findFirstOrThrow({ where: { orgId, action: "government.submission", entityId: censusId } });
    expect(ev.meta).toMatchObject({ exportId: file.id, version: file.version, fileSha256: file.fileSha256 });
    // The app role can add to the logs but never change or remove them.
    const db = tenantDb(orgId);
    await expect(db.govReturnExport.update({ where: { id: file.id }, data: { version: 99 } })).rejects.toThrow();
    await expect(db.govSubmission.deleteMany({ where: { id: sub.id } })).rejects.toThrow();
  });

  it("records a registration reference for a student enrolled before Horizon kept them", async () => {
    await as("registrar");
    expect(await recordReferenceAction({ studentId: s.i, status: "APPROVED", reference: "DAL-77881", date: todayKey() })).toEqual({ ok: true });
    const reg = await owner.govRegistration.findFirstOrThrow({ where: { studentId: s.i, kind: "ENROLLMENT" } });
    expect(reg).toMatchObject({ status: "APPROVED", reference: "DAL-77881", authority: "SPEA_DALEEL" });
    expect(await owner.auditEvent.count({ where: { orgId, action: "student.gov_registration", entityId: s.i } })).toBe(2);
  });
});

describe("due date reminders", () => {
  it("reminds holders of government.reports once per stage, and again when the date moves", async () => {
    await as("registrar");
    await saveDueDateAction({ titleEn: "Attendance return", titleAr: "تقرير الحضور", kind: "ATTENDANCE", dueOn: dayKey(10) });
    await saveDueDateAction({ titleEn: "Staff return", titleAr: "تقرير الكادر", kind: "STAFF", dueOn: dayKey(2) });
    await saveDueDateAction({ titleEn: "Results", titleAr: "النتائج", kind: "RESULTS", dueOn: dayKey(40) });
    const now = new Date();
    const first = await runGovReminders(orgId, { now, quiet: true, flush: async () => undefined });
    const second = await runGovReminders(orgId, { now, quiet: true, flush: async () => undefined });
    expect(first.sent).toBe(2);
    expect(second.sent).toBe(0);
    const notes = await owner.notification.findMany({ where: { orgId, kind: "gov_due_reminder" } });
    const to = new Set(notes.map((n) => n.recipientId));
    expect(to).toEqual(new Set([m.registrar, m.admin, m.clerk]));
    expect(notes.filter((n) => n.recipientId === m.registrar).map((n) => n.titleEn).sort()).toEqual(["Attendance return is due in 10 days", "Staff return is due in 2 days"]);
    expect(notes.find((n) => n.titleEn.startsWith("Staff"))?.titleAr).toContain("تقرير الكادر");
    // Moving a date sends that stage again, for the new date.
    const att = await owner.govDueDate.findFirstOrThrow({ where: { orgId, titleEn: "Attendance return" } });
    await saveDueDateAction({ id: att.id, titleEn: "Attendance return", titleAr: "تقرير الحضور", kind: "ATTENDANCE", dueOn: dayKey(11) });
    expect((await runGovReminders(orgId, { now, quiet: true, flush: async () => undefined })).sent).toBe(1);
    // Inside 3 days only the 3-day reminder goes; a done date gets none.
    expect(await owner.jobRun.count({ where: { orgId, queue: "government", idempotencyKey: { contains: ":14:" } } })).toBe(3);
  });
});

describe("tenant isolation", () => {
  it("another school sees none of these returns, due dates or files", async () => {
    const db = tenantDb(otherOrgId);
    expect(await db.govReturn.count()).toBe(0);
    expect(await db.govDueDate.count()).toBe(0);
    expect(await db.govReturnExport.count()).toBe(0);
    expect(await db.govSubmission.count()).toBe(0);
    await as("otherRegistrar");
    expect((await download(`return=${censusId}&format=xlsx`)).status).toBe(404);
    expect(await signOffAction({ returnId: censusId, confirm: true })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await fixStudentAction({ studentId: s.a, gender: "M" })).toEqual({ ok: false, error: "NOT_FOUND" });
    const due = await owner.govDueDate.findFirstOrThrow({ where: { orgId } });
    expect(await createReturnAction({ kind: "CENSUS", asOf: todayKey(), dueDateId: due.id })).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
