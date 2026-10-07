import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "@/lib/prisma";
import { statusDb, tenantDb } from "@/lib/tenant-db";
import { CONSENT_VERSION } from "@/lib/leads";
import { createOfferLead, createTasterLead, leadCsvRow, listLeads, tasterByToken } from "@/server/marketing/leads";
import { deliverLeadEmail, sweepLeadEmails } from "@/server/marketing/lead-email";
import { getPricing, savePricing } from "@/server/marketing/pricing-store";
import { TASTER_QUESTIONS } from "@/server/marketing/taster";
import { ensureReferralCode, referralOverview, resolveReferralCode } from "@/server/platform/referrals";
import { provisionSchool, removeOrphanUser, removeSchool, resolvePasswordUser } from "@/server/platform/signup";
import { recordSample, uptimeHistory } from "@/server/status/status";
import type { OutgoingMessage } from "@/worker/handlers";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
const leadIds: string[] = [];
const created: Array<{ orgId: string; userId: string }> = [];
const answers = Object.fromEntries(TASTER_QUESTIONS.map((q, i) => [q.id, (i % 5) + 1]));
const contact = (label: string) => ({ name: `Visitor ${label}`, email: `${uid(label)}@growth-itest.test`, role: "STUDENT" as const, schoolName: null, consent: true as const, locale: "en" as const });

async function school(label: string, referralCode?: string | null) {
  const user = await resolvePasswordUser({ email: `${uid(label)}@growth-itest.test`, password: "Strong-pass-2026", name: `Admin ${label}`, locale: "en" }, owner);
  const p = await provisionSchool({ userId: user.userId, schoolNameEn: `Growth ${label} School`, schoolNameAr: `مدرسة ${label}`, emirate: "Dubai", curricula: ["BRITISH"], locale: "en", isPrincipal: true, referralCode }, owner);
  created.push({ orgId: p.orgId, userId: user.userId });
  return p;
}

let prevPricing: unknown = undefined;

beforeAll(async () => {
  prevPricing = (await owner.platformSetting.findUnique({ where: { key: "pricing" } }))?.value;
});

afterAll(async () => {
  await owner.marketingLead.deleteMany({ where: { id: { in: leadIds } } });
  for (const c of created) {
    await removeSchool(c.orgId, owner).catch(() => undefined);
    await owner.verificationToken.deleteMany({ where: { identifier: `verify-email:${c.userId}` } });
    await removeOrphanUser(c.userId, owner).catch(() => undefined);
  }
  if (prevPricing === undefined) await owner.platformSetting.deleteMany({ where: { key: "pricing" } });
  else await owner.platformSetting.update({ where: { key: "pricing" }, data: { value: prevPricing as object } });
  await owner.uptimeSample.deleteMany({ where: { slot: { lt: new Date("2001-01-01T00:00:00Z") } } });
  await owner.$disconnect();
}, 120_000);

describe("marketing leads", () => {
  it("creates a taster lead with consent, source and the scored result, readable by its private token", async () => {
    const now = new Date();
    const { lead, token, result } = await createTasterLead(owner, { contact: contact("taster"), answers, now });
    leadIds.push(lead.id);
    expect(lead).toMatchObject({ type: "TASTER", source: "try", role: "STUDENT", consentVersion: CONSENT_VERSION, emailStatus: "QUEUED" });
    expect(lead.consentAt.getTime()).toBe(now.getTime());
    expect((lead.payload as { top: unknown[] }).top).toHaveLength(3);
    const found = await tasterByToken(owner, token);
    expect(found?.lead.id).toBe(lead.id);
    expect(found?.result.areas[0].key).toBe(result.areas[0].key);
    expect(await tasterByToken(owner, `${lead.id}.forged`)).toBeNull();
    expect(leadCsvRow(lead)).toContain("yes");
  });

  it("creates an offer lead with the estimator inputs", async () => {
    const inputs = { students: 850, campuses: 2, modules: ["core" as const, "career" as const], plan: "year" as const, staffCostPerHour: 70, assumptions: { lettersPerStudentYear: 1, minutesPerLetter: 10, absencesPerStudentMonth: 0.5, minutesPerAbsence: 3, meetingsPerStudentYear: 2, minutesPerMeeting: 6, messagesPerStudentMonth: 1, minutesPerMessage: 2, schoolMonthsPerYear: 10 } };
    const { lead } = await createOfferLead(owner, { contact: { ...contact("offer"), role: "STAFF", schoolName: "Al Noor School" }, inputs });
    leadIds.push(lead.id);
    expect(lead).toMatchObject({ type: "OFFER", source: "pricing", schoolName: "Al Noor School" });
    expect(lead.payload).toMatchObject({ students: 850, campuses: 2, plan: "year" });
    const offers = await listLeads(owner, { type: "OFFER" });
    expect(offers.some((l) => l.id === lead.id)).toBe(true);
  });

  it("sends each lead email once, through the provider, with an idempotency key", async () => {
    const { lead } = await createTasterLead(owner, { contact: contact("mail"), answers });
    leadIds.push(lead.id);
    const sent: OutgoingMessage[] = [];
    const send = async (m: OutgoingMessage) => {
      sent.push(m);
      return { providerId: "test" };
    };
    const [a, b] = await Promise.all([deliverLeadEmail(owner, lead.id, { send }), deliverLeadEmail(owner, lead.id, { send })]);
    expect([a, b].sort()).toEqual(["sent", "skipped"]);
    expect(await deliverLeadEmail(owner, lead.id, { send })).toBe("skipped");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: "EMAIL", idempotencyKey: `lead:${lead.id}`, locale: "en" });
    const row = await owner.marketingLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.emailStatus).toBe("SENT");
    expect(row.emailSentAt).not.toBeNull();
  });

  it("marks a failed send and the sweeper picks up emails the queue missed", async () => {
    const { lead: failing } = await createTasterLead(owner, { contact: contact("fail"), answers });
    leadIds.push(failing.id);
    expect(await deliverLeadEmail(owner, failing.id, { send: async () => Promise.reject(new Error("boom")) })).toBe("failed");
    expect((await owner.marketingLead.findUniqueOrThrow({ where: { id: failing.id } })).emailStatus).toBe("FAILED");

    const old = new Date(Date.now() - 10 * 60_000);
    const { lead: stale } = await createTasterLead(owner, { contact: contact("stale"), answers, now: old });
    leadIds.push(stale.id);
    const sent: string[] = [];
    const res = await sweepLeadEmails(owner, { send: async (m) => (sent.push(m.id), { providerId: "test" }) });
    expect(sent).toContain(stale.id);
    expect(res.sent).toBeGreaterThanOrEqual(1);
  });

  it("keeps leads and platform settings away from the app role", async () => {
    await expect(prisma.marketingLead.findMany({ take: 1 })).rejects.toThrow();
    await expect(prisma.platformSetting.findMany({ take: 1 })).rejects.toThrow();
  });

  it("stores pricing settings normalized, unpublished by default", async () => {
    await owner.platformSetting.deleteMany({ where: { key: "pricing" } });
    expect((await getPricing(owner)).published).toBe(false);
    const saved = await savePricing(owner, { currency: "AED", perStudent: { core: 120 }, published: true, pilotMonths: 3 }, null);
    expect(saved.perStudent.core).toBe(120);
    expect((await getPricing(owner)).published).toBe(true);
  });
});

describe("referrals", () => {
  it("gives a school one stable code and records the referring school at sign-up", async () => {
    const a = await school("referrer");
    const code = await ensureReferralCode(tenantDb(a.orgId), a.orgId);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(await ensureReferralCode(tenantDb(a.orgId), a.orgId)).toBe(code);
    expect((await resolveReferralCode(owner, code.toLowerCase()))?.id).toBe(a.orgId);

    const b = await school("referred", code);
    const c = await school("unknown-code", "ZZZZZZZZ");
    const [orgB, orgC] = await Promise.all([owner.organization.findUniqueOrThrow({ where: { id: b.orgId } }), owner.organization.findUniqueOrThrow({ where: { id: c.orgId } })]);
    expect(orgB.referredByOrgId).toBe(a.orgId);
    expect(orgC.referredByOrgId).toBeNull();
    const signupAudit = await owner.auditEvent.findFirstOrThrow({ where: { orgId: b.orgId, action: "org.signup" } });
    expect(signupAudit.meta).toMatchObject({ referred: true });

    const overview = await referralOverview(owner);
    const row = overview.rows.find((r) => r.id === a.orgId);
    expect(row?.schools.map((s) => s.id)).toEqual([b.orgId]);
  }, 120_000);
});

describe("status history", () => {
  it("writes one sample per 5-minute slot and reads it back through the app role", async () => {
    const at = new Date("2000-06-01T10:02:00Z");
    const first = await recordSample(owner, { web: true, database: true, redis: true, worker: true }, at);
    const again = await recordSample(owner, { web: false, database: true, redis: true, worker: true }, new Date("2000-06-01T10:04:59Z"));
    expect(first).toEqual({ written: true, slot: new Date("2000-06-01T10:00:00Z") });
    expect(again.written).toBe(false);
    const row = await owner.uptimeSample.findUniqueOrThrow({ where: { slot: first.slot } });
    expect(row.web).toBe(true);
    // The app role can read samples for /status but never write them.
    expect(await statusDb.uptimeSample.count({ where: { slot: first.slot } })).toBe(1);
    await expect(prisma.uptimeSample.create({ data: { slot: new Date("2000-06-01T11:00:00Z"), database: true, redis: true, worker: true } })).rejects.toThrow();
  });

  it("builds a 90-day history where missing slots count as down", async () => {
    // A private window in the past: two slots written in a 30-minute span, one of them degraded.
    await recordSample(owner, { web: null, database: true, redis: true, worker: true }, new Date("2000-07-01T00:00:00Z"));
    await recordSample(owner, { web: null, database: true, redis: true, worker: false }, new Date("2000-07-01T00:05:00Z"));
    const days = await uptimeHistory(owner, new Date("2000-07-01T00:30:00Z"), 2);
    expect(days.map((d) => d.day)).toEqual(["2000-06-30", "2000-07-01"]);
    const today = days[1];
    expect(today.samples).toBe(2);
    expect(today.up).toBe(1);
    expect(today.components.worker).toBe(1);
    // Six slots expected (00:00 to 00:25); one fully up.
    expect(today.expected).toBe(6);
    expect(today.uptime).toBeCloseTo(16.67, 1);
  });
});
