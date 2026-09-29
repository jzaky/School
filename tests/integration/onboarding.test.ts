import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const ctxOrg: { current: { enabledModules: string[] } } = { current: { enabledModules: [] } };
vi.mock("@/server/context", () => ({ getCtx: async () => ({ org: ctxOrg.current }) }));

import { tenantDb } from "@/lib/tenant-db";
import { normalizeModuleList } from "@/lib/modules";
import { installStarterTemplate } from "../../prisma/seed/starter";
import { provisionSchool, removeOrphanUser, removeSchool, resolvePasswordUser, SignupError } from "@/server/platform/signup";
import { rateLimit, resetMemoryLimits } from "@/server/platform/rate-limit";
import { confirmEmailToken, schoolVerified, sendVerificationEmail } from "@/server/onboarding/verification";
import { requireModule } from "@/server/onboarding/modules";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
const created: Array<{ orgId: string; userId: string }> = [];

async function signUp(label: string, opts: { principal?: boolean } = {}) {
  const email = `${uid(label)}@onboarding-itest.test`;
  const user = await resolvePasswordUser({ email, password: "Strong-pass-2026", name: `Admin ${label}`, locale: "en" }, owner);
  const p = await provisionSchool({ userId: user.userId, schoolNameEn: `Itest ${label} School`, schoolNameAr: `مدرسة ${label}`, emirate: "Abu Dhabi", curricula: ["IB", "UAE_MOE"], locale: "ar", isPrincipal: opts.principal ?? false }, owner);
  created.push({ orgId: p.orgId, userId: user.userId });
  return { ...p, email, userId: user.userId };
}

let a: Awaited<ReturnType<typeof signUp>>;
let b: Awaited<ReturnType<typeof signUp>>;

beforeAll(async () => {
  a = await signUp("alpha", { principal: true });
  b = await signUp("beta");
}, 120_000);

afterAll(async () => {
  for (const c of created) {
    await removeSchool(c.orgId, owner).catch(() => undefined);
    await owner.verificationToken.deleteMany({ where: { identifier: `verify-email:${c.userId}` } });
    await removeOrphanUser(c.userId, owner).catch(() => undefined);
  }
  await owner.$disconnect();
}, 120_000);

describe("self-serve sign-up", () => {
  it("creates an organization with the starter template and an admin membership", async () => {
    const org = await owner.organization.findUniqueOrThrow({ where: { id: a.orgId } });
    expect(org.slug).toMatch(/^itest-alpha/);
    expect(org.regulator).toBe("ADEK");
    expect(org.defaultLocale).toBe("ar");
    expect(org.curricula).toEqual(["IB", "UAE_MOE"]);
    expect(org.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(org.createdById).toBe(a.userId);
    const db = tenantDb(a.orgId);
    const [roles, services, forms, holidays, bells, bands, templates, courses, year] = await Promise.all([
      db.role.count(),
      db.serviceDefinition.count(),
      db.form.count(),
      db.calendarEvent.count({ where: { kind: "HOLIDAY" } }),
      db.bellPeriod.count(),
      db.gradeBand.count(),
      db.messageTemplate.findMany({ where: { key: "email_verification" } }),
      db.schoolCourse.count(),
      db.academicYear.findFirst({ where: { isCurrent: true }, include: { terms: true } }),
    ]);
    expect(roles).toBeGreaterThanOrEqual(14);
    expect(services).toBeGreaterThan(20);
    expect(forms).toBeGreaterThan(20);
    expect(holidays).toBeGreaterThan(5);
    expect(bells).toBeGreaterThan(20);
    expect(bands).toBe(5); // IB first: percentage bands
    expect(templates).toHaveLength(1);
    expect(courses).toBeGreaterThan(20);
    expect(year?.terms).toHaveLength(3);
    const texts = await db.messageTemplate.findMany({ select: { bodyEn: true, bodyAr: true } });
    expect(texts.some((t) => /Horizon|هورايزن/.test(`${t.bodyEn} ${t.bodyAr}`))).toBe(false);
    const membership = await db.membership.findFirstOrThrow({ where: { userId: a.userId }, include: { roles: { include: { role: true } } } });
    expect(membership.roles.map((r) => r.role.key).sort()).toEqual(["principal", "school_admin"]);
    const audit = await db.auditEvent.findFirst({ where: { action: "org.signup" } });
    expect(audit?.actorUserId).toBe(a.userId);
  });

  it("keeps the second school isolated from the first", async () => {
    const dbB = tenantDb(b.orgId);
    expect(await dbB.serviceDefinition.count({ where: { orgId: a.orgId } })).toBe(0);
    expect(await dbB.membership.count({ where: { orgId: a.orgId } })).toBe(0);
    expect(await dbB.organization.findUnique({ where: { id: a.orgId } })).toBeNull();
    const own = await dbB.membership.findMany();
    expect(own.every((m) => m.orgId === b.orgId)).toBe(true);
    expect(b.slug).not.toBe(a.slug);
  });

  it("reuses an existing account only with the right password", async () => {
    const again = await resolvePasswordUser({ email: a.email, password: "Strong-pass-2026", name: "x", locale: "en" }, owner);
    expect(again).toEqual({ userId: a.userId, created: false });
    await expect(resolvePasswordUser({ email: a.email, password: "Wrong-pass-2026", name: "x", locale: "en" }, owner)).rejects.toBeInstanceOf(SignupError);
  });

  it("gives unique slugs to schools with the same name", async () => {
    const user = await resolvePasswordUser({ email: `${uid("gamma")}@onboarding-itest.test`, password: "Strong-pass-2026", name: "G", locale: "en" }, owner);
    const p = await provisionSchool({ userId: user.userId, schoolNameEn: "Itest alpha School", schoolNameAr: "مدرسة", emirate: "Dubai", curricula: ["BRITISH"], locale: "en", isPrincipal: false }, owner);
    created.push({ orgId: p.orgId, userId: user.userId });
    expect(p.slug).not.toBe(a.slug);
    expect(await tenantDb(p.orgId).gradeBand.count()).toBe(7); // British letter bands
  }, 60_000);

  it("verifies the founding administrator's email with a one-time link", async () => {
    const org = await owner.organization.findUniqueOrThrow({ where: { id: b.orgId } });
    expect(await schoolVerified(org)).toBe(false);
    const { token } = await sendVerificationEmail({ orgId: b.orgId, membershipId: b.membershipId, userId: b.userId, name: "Admin", school: { en: "B", ar: "ب" } });
    const out = await tenantDb(b.orgId).outboundMessage.findFirst({ where: { templateKey: "email_verification" } });
    expect(out?.channel).toBe("EMAIL");
    const stored = await owner.verificationToken.findFirst({ where: { identifier: `verify-email:${b.userId}` } });
    expect(stored?.token).not.toBe(token); // only the hash is stored
    expect(await confirmEmailToken("not-a-real-token-at-all-000")).toBeNull();
    expect(await confirmEmailToken(token)).toBe(b.userId);
    expect(await confirmEmailToken(token)).toBeNull(); // one use
    expect(await schoolVerified(org)).toBe(true);
  });
});

describe("starter template", () => {
  it("is idempotent", async () => {
    const before = await tenantDb(a.orgId).serviceDefinition.count();
    const summary = await installStarterTemplate(owner, a.orgId, { curricula: ["IB"], locale: "en", now: new Date() });
    expect(Object.entries(summary).filter(([, n]) => n > 0)).toEqual([]);
    expect(await tenantDb(a.orgId).serviceDefinition.count()).toBe(before);
  }, 60_000);
});

describe("module gating", () => {
  it("answers notFound for a switched-off module and passes a switched-on one", async () => {
    ctxOrg.current = { enabledModules: normalizeModuleList(["grades"]) };
    await expect(requireModule("trips")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    await expect(requireModule("grades")).resolves.toBeTruthy();
    await expect(requireModule("cases")).resolves.toBeTruthy();
    ctxOrg.current = { enabledModules: [] };
    await expect(requireModule("trips")).resolves.toBeTruthy();
  });
});

describe("rate limit", () => {
  it("blocks after the limit within the window and resets after it", async () => {
    resetMemoryLimits();
    const key = uid("rl");
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3, 60_000, { now: t, memoryOnly: true })).ok).toBe(true);
    const blocked = await rateLimit(key, 3, 60_000, { now: t + 1000, memoryOnly: true });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(59);
    expect((await rateLimit(key, 3, 60_000, { now: t + 61_000, memoryOnly: true })).ok).toBe(true);
  });
  it("works through Redis when it is available", async () => {
    await rateLimit(uid("rl-warm"), 2, 60_000); // opens the connection
    await new Promise((r) => setTimeout(r, 300));
    const key = uid("rl-redis");
    const results = [];
    for (let i = 0; i < 3; i++) results.push((await rateLimit(key, 2, 60_000)).ok);
    expect(results).toEqual([true, true, false]);
  });
});
