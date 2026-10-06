// Push subscriptions, WhatsApp consent, notify fan-out, fee settings and career report access against real
// Postgres through the RLS-restricted app role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { execCtx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { recordWhatsAppConsent, savePushSubscription, setChannelPreference, withdrawWhatsAppConsent } from "@/server/notify/devices";
import { b64url, generateVapidKeys } from "@/server/notify/web-push";
import { deliverOutbound, type OutgoingMessage, type Sender } from "@/worker/handlers";
import { saveFeeSettings } from "@/server/fees/settings";
import { buildCareerReport, careerReportAudience } from "@/server/career/report";
import { renderCareerReportPdf } from "@/server/career/report-pdf";
import { ownerClient, uid } from "./helpers";

let owner: PrismaClient;
const orgs: string[] = [];
let A: { orgId: string; parent: string; staff: string; studentId: string; otherStudentId: string };
let B: { orgId: string; parent: string };
const ENV_KEYS = ["WEB_PUSH_PUBLIC_KEY", "WEB_PUSH_PRIVATE_KEY", "WEB_PUSH_SUBJECT", "WHATSAPP_PROVIDER"] as const;
const savedEnv: Record<string, string | undefined> = {};

function subscription() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint: `https://push.example.net/send/${uid("ep")}`, p256dh: b64url(ecdh.getPublicKey()), auth: b64url(crypto.randomBytes(16)) };
}

async function member(orgId: string, name: string) {
  const user = await owner.user.create({ data: { email: `${uid(name)}@parents.test`, nameEn: name } });
  return (await owner.membership.create({ data: { orgId, userId: user.id } })).id;
}

async function school(label: string) {
  const org = await owner.organization.create({ data: { slug: uid(`parents-${label}`), nameEn: `School ${label}`, nameAr: `مدرسة ${label}` } });
  orgs.push(org.id);
  await owner.messageTemplate.create({ data: { orgId: org.id, key: "request_completed", channel: "EMAIL", subjectEn: "Request {{number}} completed", subjectAr: "اكتمل الطلب {{number}}", bodyEn: "Your request is complete.", bodyAr: "اكتمل طلبك." } });
  await owner.messageTemplate.create({ data: { orgId: org.id, key: "parent_update", channel: "EMAIL", subjectEn: "Update about {{student}}", subjectAr: "تحديث بشأن {{student}}", bodyEn: "{{message}}", bodyAr: "{{message}}" } });
  return org.id;
}

beforeAll(async () => {
  owner = ownerClient();
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  const keys = generateVapidKeys();
  process.env.WEB_PUSH_PUBLIC_KEY = keys.publicKey;
  process.env.WEB_PUSH_PRIVATE_KEY = keys.privateKey;
  process.env.WEB_PUSH_SUBJECT = "mailto:it@parents.test";
  process.env.WHATSAPP_PROVIDER = "console";

  const a = await school("A");
  const student = await owner.student.create({ data: { orgId: a, studentNo: uid("CR"), firstNameEn: "Adam", lastNameEn: "Test", firstNameAr: "آدم", lastNameAr: "اختبار", gradeLevel: 10 } });
  const other = await owner.student.create({ data: { orgId: a, studentNo: uid("CR"), firstNameEn: "Other", lastNameEn: "Family", firstNameAr: "آخر", lastNameAr: "عائلة", gradeLevel: 10 } });
  A = { orgId: a, parent: await member(a, "Parent A"), staff: await member(a, "Staff A"), studentId: student.id, otherStudentId: other.id };
  const b = await school("B");
  B = { orgId: b, parent: await member(b, "Parent B") };
});

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  for (const orgId of orgs) {
    for (const table of ["pushSubscription", "whatsAppOptIn", "notificationPreference", "notification", "outboundMessage", "messageTemplate", "careerRecommendation", "aptitudeAssessment", "studentCoursePlan", "career", "auditEvent", "student"] as const) {
      await (owner[table] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { orgId } }).catch(() => undefined);
    }
    await owner.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  }
  await owner?.$disconnect();
});

describe("push subscription storage", () => {
  it("is invisible to another school and cannot be written into another school", async () => {
    const sub = subscription();
    const res = await savePushSubscription(tenantDb(A.orgId), A.orgId, A.parent, sub);
    expect(res.ok).toBe(true);
    expect(await tenantDb(A.orgId).pushSubscription.count({ where: { endpoint: sub.endpoint } })).toBe(1);
    // RLS: school B sees nothing, even when it asks for school A's rows by id.
    expect(await tenantDb(B.orgId).pushSubscription.count({ where: { endpoint: sub.endpoint } })).toBe(0);
    expect(await tenantDb(B.orgId).pushSubscription.count({ where: { orgId: A.orgId } })).toBe(0);
    // RLS WITH CHECK: school B cannot insert a row for school A.
    await expect(tenantDb(B.orgId).pushSubscription.create({ data: { orgId: A.orgId, membershipId: A.parent, ...subscription() } })).rejects.toThrow();
    // And cannot delete school A's row.
    const del = await tenantDb(B.orgId).pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } });
    expect(del.count).toBe(0);
  });

  it("moves a device to whoever subscribed it last and rejects malformed keys", async () => {
    const sub = subscription();
    await savePushSubscription(tenantDb(A.orgId), A.orgId, A.parent, sub);
    await savePushSubscription(tenantDb(A.orgId), A.orgId, A.staff, sub);
    const rows = await owner.pushSubscription.findMany({ where: { endpoint: sub.endpoint } });
    expect(rows).toHaveLength(1);
    expect(rows[0].membershipId).toBe(A.staff);
    expect(await savePushSubscription(tenantDb(A.orgId), A.orgId, A.parent, { ...sub, p256dh: "bad" })).toEqual({ ok: false, error: "INVALID" });
    await owner.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } });
  });
});

describe("notify fan-out to devices", () => {
  it("queues one push per subscribed member, idempotently, and generic for sensitive kinds", async () => {
    const run = (base: string, templateKey: string) =>
      tenantTx(A.orgId, (tx) => notify(execCtx(tx, A.orgId, { quiet: true }), { recipients: [A.parent], templateKey, vars: { number: "REQ-1", student: "Adam", message: "Private wellbeing details" }, href: "/requests/1", idempotencyBase: base }));
    await run("itest:std", "request_completed");
    await run("itest:std", "request_completed");
    const std = await owner.outboundMessage.findMany({ where: { orgId: A.orgId, idempotencyKey: { startsWith: "itest:std" }, channel: "PUSH" } });
    expect(std).toHaveLength(1);
    expect(std[0].to).toBe(A.parent);
    expect(std[0].subject).toBe("Request REQ-1 completed");

    await run("itest:case", "parent_update");
    const sensitive = await owner.outboundMessage.findFirstOrThrow({ where: { orgId: A.orgId, idempotencyKey: { startsWith: "itest:case" }, channel: "PUSH" } });
    expect(sensitive.subject).not.toContain("Adam");
    expect(sensitive.subject).toContain("School A");
  });

  it("respects the member's push preference for a kind", async () => {
    await setChannelPreference(tenantDb(A.orgId), A.orgId, A.parent, "request_completed", "PUSH", false);
    await tenantTx(A.orgId, (tx) => notify(execCtx(tx, A.orgId, { quiet: true }), { recipients: [A.parent], templateKey: "request_completed", vars: { number: "REQ-2" }, idempotencyBase: "itest:prefoff" }));
    const rows = await owner.outboundMessage.findMany({ where: { orgId: A.orgId, idempotencyKey: { startsWith: "itest:prefoff" } } });
    expect(rows.map((r) => r.channel)).toEqual(["EMAIL"]);
    await setChannelPreference(tenantDb(A.orgId), A.orgId, A.parent, "request_completed", "PUSH", true);
  });

  it("sends WhatsApp only to consented numbers and kinds the school enabled", async () => {
    const db = tenantDb(A.orgId);
    const send = (base: string) => tenantTx(A.orgId, (tx) => notify(execCtx(tx, A.orgId, { quiet: true }), { recipients: [A.parent], templateKey: "request_completed", vars: { number: "REQ-3" }, idempotencyBase: base }));
    await send("itest:wa1"); // no consent yet
    await recordWhatsAppConsent(db, A.orgId, A.parent, "+971501234567", new Date());
    await send("itest:wa2"); // consent, but the school has not enabled the kind
    await owner.organization.update({ where: { id: A.orgId }, data: { whatsappKinds: ["request_completed"] } });
    await send("itest:wa3");
    await withdrawWhatsAppConsent(db, A.orgId, A.parent, new Date());
    await send("itest:wa4");
    const wa = await owner.outboundMessage.findMany({ where: { orgId: A.orgId, channel: "WHATSAPP" } });
    expect(wa.map((r) => r.idempotencyKey.split(":")[1])).toEqual(["wa3"]);
    expect(wa[0].to).toBe("+971501234567");
    const optIn = await owner.whatsAppOptIn.findUniqueOrThrow({ where: { membershipId: A.parent } });
    expect(optIn.consentedAt).toBeInstanceOf(Date);
    expect(optIn.withdrawnAt).toBeInstanceOf(Date);
  });

  it("delivers a push to the member's devices and drops expired ones", async () => {
    const sub = subscription();
    await savePushSubscription(tenantDb(A.orgId), A.orgId, A.parent, sub);
    const row = await owner.outboundMessage.create({ data: { orgId: A.orgId, channel: "PUSH", to: A.parent, templateKey: "request_completed", subject: "Done", idempotencyKey: uid("push"), status: "QUEUED" } });
    const seen: OutgoingMessage[] = [];
    const send: Sender = async (msg) => {
      seen.push(msg);
      return { providerId: "test", gone: [sub.endpoint] };
    };
    expect(await deliverOutbound({ orgId: A.orgId, outboundId: row.id, locale: "en", href: "/requests/1" }, { send })).toBe("sent");
    expect(seen[0].pushTargets?.map((t) => t.endpoint)).toContain(sub.endpoint);
    expect(seen[0].school).toBe("School A");
    expect(await owner.pushSubscription.count({ where: { endpoint: sub.endpoint } })).toBe(0);
  });
});

describe("fee payment link", () => {
  it("saves a valid link with an audit event and rejects an invalid one", async () => {
    const db = tenantDb(A.orgId);
    const res = await saveFeeSettings(db, A.orgId, { membershipId: A.staff, userId: "u" }, { url: "https://pay.school-a.example/fees", contact: "accounts@school-a.example" });
    expect(res.ok).toBe(true);
    const org = await owner.organization.findUniqueOrThrow({ where: { id: A.orgId } });
    expect(org.feePaymentUrl).toBe("https://pay.school-a.example/fees");
    expect(org.feeContact).toBe("accounts@school-a.example");
    const ev = await owner.auditEvent.findFirst({ where: { orgId: A.orgId, action: "org.fees_update" } });
    expect(ev).not.toBeNull();
    expect(await saveFeeSettings(db, A.orgId, { membershipId: A.staff, userId: "u" }, { url: "http://insecure.example", contact: "" })).toEqual({ ok: false, error: "URL_INVALID" });
    expect((await owner.organization.findUniqueOrThrow({ where: { id: A.orgId } })).feePaymentUrl).toBe("https://pay.school-a.example/fees");
  });

  it("cannot be changed from another school", async () => {
    await expect(tenantDb(B.orgId).organization.update({ where: { id: A.orgId }, data: { feePaymentUrl: "https://evil.example" } })).rejects.toThrow();
    expect((await owner.organization.findUniqueOrThrow({ where: { id: A.orgId } })).feePaymentUrl).toBe("https://pay.school-a.example/fees");
  });
});

describe("career report", () => {
  beforeAll(async () => {
    const career = await owner.career.create({
      data: { orgId: A.orgId, key: "graphic_designer", titleEn: "Graphic designer", titleAr: "مصمم جرافيك", clusterEn: "Arts", clusterAr: "الفنون", summaryEn: "s", summaryAr: "س", weights: {}, educationEn: "e", educationAr: "ت" },
    });
    const draft = await owner.career.create({
      data: { orgId: A.orgId, key: uid("draft_career"), titleEn: "Draft only career", titleAr: "مهنة مسودة", clusterEn: "X", clusterAr: "س", summaryEn: "s", summaryAr: "س", weights: {}, educationEn: "e", educationAr: "ت" },
    });
    const assessment = await owner.aptitudeAssessment.create({ data: { orgId: A.orgId, studentId: A.studentId, answers: {}, scores: { creative: 90, spatial: 80, analytical: 30 }, completedAt: new Date() } });
    await owner.careerRecommendation.create({ data: { orgId: A.orgId, studentId: A.studentId, assessmentId: assessment.id, careerId: career.id, rank: 1, matchScore: 91, reasoningEn: "r", reasoningAr: "ر", status: "APPROVED" } });
    await owner.careerRecommendation.create({ data: { orgId: A.orgId, studentId: A.studentId, assessmentId: assessment.id, careerId: draft.id, rank: 2, matchScore: 85, reasoningEn: "r", reasoningAr: "ر", status: "DRAFT" } });
    await owner.studentCoursePlan.create({ data: { orgId: A.orgId, studentId: A.studentId, name: "Design plan", status: "PROPOSED", goalCareerKey: "graphic_designer" } });
  });

  it("allows parents only their own children", () => {
    const parent = { isStudent: false, isParent: true, isStaff: false, can: () => false, visibleStudentIds: [A.studentId] };
    expect(careerReportAudience(parent, A.studentId)).toBe("family");
    expect(careerReportAudience(parent, A.otherStudentId)).toBeNull();
  });

  it("shows families only reviewed matches; staff also see drafts", async () => {
    const family = await buildCareerReport(tenantDb(A.orgId), A.orgId, A.studentId, "family");
    expect(family!.careers.map((c) => c.en)).toEqual(["Graphic designer"]);
    const staff = await buildCareerReport(tenantDb(A.orgId), A.orgId, A.studentId, "staff");
    expect(staff!.careers.map((c) => c.en)).toEqual(["Graphic designer", "Draft only career"]);
    expect(staff!.careers[1].reviewed).toBe(false);
    expect(family!.plan?.status).toBe("PROPOSED");
    expect(family!.plan?.goal?.en).toBe("Graphic designer");
    expect(family!.assessment!.scores[0]).toMatchObject({ key: "creative", score: 90 });
    const links = await owner.careerField.count({ where: { careerKey: "graphic_designer" } });
    if (links > 0) expect(family!.fields.length).toBeGreaterThan(0);
    expect(family!.nextSteps.length).toBeGreaterThan(0);
  });

  it("returns nothing for a student of another school", async () => {
    expect(await buildCareerReport(tenantDb(B.orgId), B.orgId, A.studentId, "staff")).toBeNull();
  });

  it("renders a PDF with Arabic text", async () => {
    const data = await buildCareerReport(tenantDb(A.orgId), A.orgId, A.studentId, "family");
    const pdf = await renderCareerReportPdf(data!);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5000);
  });
});
