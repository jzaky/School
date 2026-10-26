// Cross-object access (IDOR) through the real route handlers and server actions, against real Postgres through the
// RLS-restricted app role: one family asking for another family's files by id, staff asking for records outside
// their access, and a user of one school using an id from another school.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({ ctx: null as unknown, cookie: undefined as string | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "hz_applicant" && current.cookie ? { value: current.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("@/server/queue", () => ({ flushEffects: async () => undefined, queue: () => null }));
vi.mock("@/server/context", () => ({ getCtx: async () => current.ctx, getOptionalCtx: async () => current.ctx, requirePermission: async () => current.ctx }));

import type { PrismaClient } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { can, permissionsOf, roleKeysOf } from "@/server/identity/can";
import type { Ctx } from "@/server/context";
import { makeApplicantToken } from "@/server/admissions/applicant";
import { GET as invoicePdf } from "@/app/api/fees/invoices/[id]/pdf/route";
import { GET as documentDownload } from "@/app/api/documents/[id]/download/route";
import { GET as caseExport } from "@/app/api/cases/[id]/export/route";
import { GET as admissionDoc } from "@/app/api/admissions/doc/[id]/route";
import { GET as attendanceCertificate } from "@/app/api/attendance/certificate/route";
import { GET as requestFile } from "@/app/api/requests/[id]/file/route";
import { runProgressAction } from "@/server/rostering/actions";
import { postRequestMessageAction } from "@/server/requests/conversation-actions";
import { completeTestPaymentAction } from "@/server/fees/actions";
import { installStarterTemplate } from "../../prisma/seed/starter";
import { ownerClient, uid } from "./helpers";

let owner: PrismaClient;
const A = { orgId: "", slug: "" };
const B = { orgId: "" };
const m: Record<string, string> = {};
const ids: Record<string, string> = {};

async function ctxFor(membershipId: string): Promise<Ctx> {
  const membership = await owner.membership.findUniqueOrThrow({
    where: { id: membershipId },
    include: { roles: { include: { role: true } }, staffProfile: true, student: true, guardian: { include: { links: { include: { student: true } } } } },
  });
  const user = await owner.user.findUniqueOrThrow({ where: { id: membership.userId } });
  const org = await owner.organization.findUniqueOrThrow({ where: { id: membership.orgId } });
  const roles = roleKeysOf(membership);
  const isStudent = roles.includes("student");
  const isParent = roles.includes("parent");
  return {
    orgId: org.id,
    db: tenantDb(org.id),
    org,
    user,
    membership,
    membershipId,
    roles,
    perms: permissionsOf(membership),
    locale: "en",
    persona: null,
    isStudent,
    isParent,
    isStaff: !isStudent && !isParent,
    can: (p) => can(membership, p),
    session: null as never,
  } as Ctx;
}

const as = async (key: string) => {
  current.ctx = await ctxFor(m[key]);
  return current.ctx as Ctx;
};
const req = (path: string) => new Request(`http://localhost${path}`);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function member(orgId: string, key: string, role: string) {
  const u = await owner.user.create({ data: { email: `${uid(key)}@idor.test`, nameEn: `Person ${key}`, emailVerified: new Date() } });
  const mem = await owner.membership.create({ data: { orgId, userId: u.id, status: "ACTIVE" } });
  const r = await owner.role.findFirstOrThrow({ where: { orgId, key: role } });
  await owner.membershipRole.create({ data: { orgId, membershipId: mem.id, roleId: r.id } });
  if (role !== "parent" && role !== "student") await owner.staffProfile.create({ data: { orgId, membershipId: mem.id } });
  m[key] = mem.id;
  return mem.id;
}

async function family(key: string) {
  const parent = await member(A.orgId, `parent${key}`, "parent");
  const student = await owner.student.create({ data: { orgId: A.orgId, studentNo: uid(`S${key}`), firstNameEn: `Child${key}`, lastNameEn: "Test", firstNameAr: "طفل", lastNameAr: "اختبار", gradeLevel: 7 } });
  const g = await owner.guardian.create({ data: { orgId: A.orgId, membershipId: parent, firstNameEn: `Parent${key}`, lastNameEn: "Test", firstNameAr: "ولي", lastNameAr: "اختبار" } });
  await owner.guardianLink.create({ data: { orgId: A.orgId, guardianId: g.id, studentId: student.id, isPrimary: true } });
  const account = await owner.feeAccount.create({ data: { orgId: A.orgId, code: uid("ACC"), nameEn: `Family ${key}`, nameAr: "عائلة", payerGuardianId: g.id } });
  const invoice = await owner.invoice.create({
    data: {
      orgId: A.orgId,
      kind: "TAX",
      number: uid("INV"),
      accountId: account.id,
      issueDate: new Date(),
      dueDate: new Date(),
      billToName: `Parent${key} Test`,
      seller: { nameEn: "IDOR Test School", nameAr: "مدرسة", addressEn: "Sharjah", addressAr: "الشارقة", trn: null, vatRegistered: false },
      subtotalFils: 1000,
      discountFils: 0,
      netFils: 1000,
      vatFils: 0,
      totalFils: 1000,
    },
  });
  const doc = await owner.document.create({ data: { orgId: A.orgId, titleEn: `Report ${key}`, titleAr: "تقرير", studentId: student.id, uploadedById: m.admin, visibleToFamily: true } });
  const version = await owner.documentVersion.create({ data: { orgId: A.orgId, documentId: doc.id, version: 1, storageKey: "sample:report", fileName: "report.pdf", mimeType: "application/pdf", sizeBytes: 100, createdById: m.admin } });
  await owner.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  ids[`student${key}`] = student.id;
  ids[`invoice${key}`] = invoice.id;
  ids[`doc${key}`] = doc.id;
}

beforeAll(async () => {
  owner = ownerClient();
  for (const [o, label] of [[A, "a"], [B, "b"]] as const) {
    const slug = uid(`idor-${label}`);
    const org = await owner.organization.create({ data: { slug, nameEn: `IDOR School ${label}`, nameAr: `مدرسة ${label}`, emirate: "Sharjah", curricula: ["AMERICAN"] } });
    o.orgId = org.id;
    if (o === A) A.slug = slug;
    await installStarterTemplate(owner, org.id, { curricula: ["AMERICAN"], locale: "en", now: new Date(), installCourses: false });
  }
  await member(A.orgId, "admin", "school_admin");
  await member(A.orgId, "teacher", "teacher");
  await member(A.orgId, "dsl", "dsl");
  await member(B.orgId, "adminB", "school_admin");
  await family("1");
  await family("2");

  // A safeguarding case about child 1, owned by the DSL.
  const c = await owner.case.create({ data: { orgId: A.orgId, number: uid("CASE"), type: "SAFEGUARDING", sensitivity: "SAFEGUARDING", studentId: ids.student1, titleEn: "Concern", titleAr: "مخاوف", assigneeId: m.dsl } });
  ids.case = c.id;

  // A request from family 1 with a file attached to its form.
  const service = await owner.serviceDefinition.findFirstOrThrow({ where: { orgId: A.orgId, formId: { not: null }, audience: { has: "parent" }, sensitivity: "STANDARD", key: { notIn: ["absence_request", "staff_leave"] } } });
  const form = await owner.form.findFirstOrThrow({ where: { id: service.formId! }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  const fv = form.versions[0];
  const schema = { steps: [{ id: "s", titleEn: "S", titleAr: "S", sections: [{ id: "x", titleEn: "X", titleAr: "X", fields: [{ id: "note", type: "file", labelEn: "Note", labelAr: "ملاحظة" }] }] }] };
  const fv2 = await owner.formVersion.create({ data: { orgId: A.orgId, formId: form.id, version: (fv?.version ?? 0) + 100, schema, publishedAt: new Date() } });
  const sub = await owner.submission.create({ data: { orgId: A.orgId, formVersionId: fv2.id, submittedById: m.parent1, data: { note: { key: "sample:note", name: "note.pdf", type: "application/pdf" } } } });
  const r = await owner.request.create({ data: { orgId: A.orgId, number: uid("REQ"), serviceId: service.id, requesterId: m.parent1, studentId: ids.student1, titleEn: "Request", titleAr: "طلب", submissionId: sub.id } });
  ids.request = r.id;

  // An admissions application with one document, and a roster run in school B.
  const year = await owner.academicYear.findFirstOrThrow({ where: { orgId: A.orgId } });
  const applicant = await owner.user.create({ data: { email: `${uid("applicant")}@idor.test`, nameEn: "Applicant One", emailVerified: new Date() } });
  const other = await owner.user.create({ data: { email: `${uid("applicant2")}@idor.test`, nameEn: "Applicant Two", emailVerified: new Date() } });
  ids.applicant = applicant.id;
  ids.otherApplicant = other.id;
  const app = await owner.admissionApplication.create({ data: { orgId: A.orgId, number: uid("APP"), applicantUserId: applicant.id, academicYearId: year.id, gradeLevel: 7 } });
  const adoc = await owner.admissionDocument.create({ data: { orgId: A.orgId, applicationId: app.id, typeKey: "passport", fileName: "passport.pdf", mimeType: "application/pdf", sizeBytes: 10, storageKey: "sample:passport", checksum: "x" } });
  ids.admissionDoc = adoc.id;
  const run = await owner.rosterRun.create({ data: { orgId: B.orgId, provider: "oneroster", trigger: "UPLOAD" } });
  ids.runB = run.id;
}, 180_000);

afterAll(async () => {
  await owner.$disconnect();
});

describe("fee documents", () => {
  it("a parent opens their own invoice but not another family's, and school B cannot open it at all", async () => {
    await as("parent1");
    expect((await invoicePdf(req(`/api/fees/invoices/${ids.invoice1}/pdf`), params(ids.invoice1))).status).toBe(200);
    expect((await invoicePdf(req(`/api/fees/invoices/${ids.invoice2}/pdf`), params(ids.invoice2))).status).toBe(404);
    await as("adminB");
    expect((await invoicePdf(req(`/api/fees/invoices/${ids.invoice1}/pdf`), params(ids.invoice1))).status).toBe(404);
  });

  it("the built-in test checkout cannot mark a real school's invoice paid", async () => {
    await as("parent1");
    const link = await owner.paymentLink.create({ data: { orgId: A.orgId, accountId: (await owner.invoice.findUniqueOrThrow({ where: { id: ids.invoice1 } })).accountId, invoiceId: ids.invoice1, amountFils: 1000, provider: "console", expiresAt: new Date(Date.now() + 86_400_000) } });
    expect(await completeTestPaymentAction(link.id, "paid")).toEqual({ ok: false, error: "FORBIDDEN" });
    expect((await owner.invoice.findUniqueOrThrow({ where: { id: ids.invoice1 } })).paidFils).toBe(0);
  });
});

describe("documents and report cards", () => {
  it("a family opens documents shared about their own child only", async () => {
    await as("parent1");
    expect((await documentDownload(req(`/api/documents/${ids.doc1}/download`), params(ids.doc1))).status).toBe(200);
    expect((await documentDownload(req(`/api/documents/${ids.doc2}/download`), params(ids.doc2))).status).toBe(403);
  });

  it("an id from another school is simply not found", async () => {
    await as("adminB");
    expect((await documentDownload(req(`/api/documents/${ids.doc1}/download`), params(ids.doc1))).status).toBe(404);
  });

  it("downloads carry a safe Content-Disposition and no inline for non-preview requests", async () => {
    await as("parent1");
    const res = await documentDownload(req(`/api/documents/${ids.doc1}/download`), params(ids.doc1));
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="report.pdf"; filename\*=UTF-8''report\.pdf$/);
  });
});

describe("cases", () => {
  it("a teacher cannot export a safeguarding case; the DSL can; school B gets not found", async () => {
    await as("teacher");
    expect((await caseExport(req(`/api/cases/${ids.case}/export`), params(ids.case))).status).toBe(403);
    await as("parent1");
    expect((await caseExport(req(`/api/cases/${ids.case}/export`), params(ids.case))).status).toBe(403);
    await as("dsl");
    expect((await caseExport(req(`/api/cases/${ids.case}/export`), params(ids.case))).status).toBe(200);
    await as("adminB");
    expect((await caseExport(req(`/api/cases/${ids.case}/export`), params(ids.case))).status).toBe(404);
  });
});

describe("requests and conversations", () => {
  it("another family can neither open the attachment nor post to the conversation", async () => {
    await as("parent2");
    expect((await requestFile(req(`/api/requests/${ids.request}/file?field=note`), params(ids.request))).status).toBe(404);
    const post = await postRequestMessageAction({ requestId: ids.request, body: "Hello", visibility: "SHARED" });
    expect(post.ok).toBe(false);
    expect(await owner.requestMessage.count({ where: { requestId: ids.request } })).toBe(0);
  });

  it("the requesting family opens its own attachment", async () => {
    await as("parent1");
    const res = await requestFile(req(`/api/requests/${ids.request}/file?field=note`), params(ids.request));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("school B cannot reach the request at all", async () => {
    await as("adminB");
    expect((await requestFile(req(`/api/requests/${ids.request}/file?field=note`), params(ids.request))).status).toBe(404);
    expect((await postRequestMessageAction({ requestId: ids.request, body: "Hello", visibility: "SHARED" })).ok).toBe(false);
  });
});

describe("admissions documents", () => {
  it("staff without admissions access and staff of another school are refused", async () => {
    await as("teacher");
    expect((await admissionDoc(req(`/api/admissions/doc/${ids.admissionDoc}`), params(ids.admissionDoc))).status).toBe(403);
    await as("adminB");
    expect((await admissionDoc(req(`/api/admissions/doc/${ids.admissionDoc}`), params(ids.admissionDoc))).status).toBe(404);
    await as("admin");
    expect((await admissionDoc(req(`/api/admissions/doc/${ids.admissionDoc}`), params(ids.admissionDoc))).status).toBe(200);
  });

  it("another applicant family cannot open the document, the owning family can", async () => {
    current.ctx = null;
    current.cookie = makeApplicantToken(ids.otherApplicant, null);
    expect((await admissionDoc(req(`/api/admissions/doc/${ids.admissionDoc}?slug=${A.slug}`), params(ids.admissionDoc))).status).toBe(404);
    current.cookie = makeApplicantToken(ids.applicant, null);
    expect((await admissionDoc(req(`/api/admissions/doc/${ids.admissionDoc}?slug=${A.slug}`), params(ids.admissionDoc))).status).toBe(200);
    current.cookie = undefined;
  });
});

describe("attendance certificates and rostering runs", () => {
  it("a parent cannot issue an attendance certificate, even for their own child", async () => {
    await as("parent1");
    expect((await attendanceCertificate(req(`/api/attendance/certificate?student=${ids.student1}`))).status).toBe(403);
  });

  it("a rostering run of school B is not found from school A, and a teacher may not read runs", async () => {
    await as("admin");
    expect(await runProgressAction(ids.runB)).toMatchObject({ ok: false });
    await as("teacher");
    expect(await runProgressAction(ids.runB)).toMatchObject({ ok: false, error: "FORBIDDEN" });
    await as("adminB");
    expect(await runProgressAction(ids.runB)).toMatchObject({ ok: true });
  });
});
