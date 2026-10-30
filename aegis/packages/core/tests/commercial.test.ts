import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, ownerPrisma, rawPrisma, withTenant } from "@aegis/db";
import { makeTestTenant, type TestTenant } from "./helpers.js";
import { registerUser } from "../src/identity/auth.js";
import { acceptInvitation } from "../src/orgs/orgs.js";
import { listUserMemberships } from "../src/identity/memberships.js";
import { effectiveLimits, featuresFor, normalizePlan, trialState, usageAgainstLimits } from "../src/commercial/plans.js";
import {
  computeInvoice,
  createSupportRequest,
  fromMinor,
  toMinor,
  customerHealth,
  getInvoiceForOrg,
  listSupportRequests,
  periodBounds,
  periodOf,
  platformCreateOrganization,
  platformDraftInvoice,
  platformInvoiceAction,
  platformSetContract,
  platformSetPlan,
  platformUpdateSupportRequest,
  snapshotUsage,
  subscriptionSummary,
} from "../src/commercial/billing.js";

const NOW = new Date("2026-10-14T08:00:00Z");

describe("plans and invoices (pure)", () => {
  it("maps the legacy plan key, lists planned features as not included anywhere they are not built, and leaves prices to the contract", () => {
    expect(normalizePlan("enterprise_trial")).toBe("trial");
    expect(normalizePlan("nonsense")).toBe("trial");
    const core = featuresFor("core");
    expect(core.find((f) => f.key === "shield")!.included).toBe(false);
    expect(featuresFor("enterprise").find((f) => f.key === "secure_execution")!.status).toBe("planned");
  });

  it("reports trial state and usage against limits without blocking anything", () => {
    expect(trialState("trial", new Date("2026-10-30T00:00:00Z"), NOW)).toMatchObject({ state: "active", daysLeft: 16 });
    expect(trialState("trial", new Date("2026-10-17T00:00:00Z"), NOW)).toMatchObject({ state: "ending_soon", daysLeft: 3 });
    expect(trialState("trial", new Date("2026-10-01T00:00:00Z"), NOW).state).toBe("ended");
    expect(trialState("core", null, NOW).state).toBe("not_trial");
    const lines = usageAgainstLimits(effectiveLimits("core", { agents: 5 }), { agents: 6, members: 41, monthlyDecisions: 10 });
    expect(lines.find((l) => l.metric === "agents")!.status).toBe("over");
    expect(lines.find((l) => l.metric === "members")!.status).toBe("near");
    expect(usageAgainstLimits(effectiveLimits("enterprise", null), { agents: 1, members: 1, monthlyDecisions: 1 }).every((l) => l.status === "unlimited")).toBe(true);
  });

  it("computes invoice lines in integers: fee, overage at four-decimal unit price, tax in basis points", () => {
    const r = computeInvoice({ periodFeeMinor: 1_250_000n, includedDecisions: 100_000, overageUnitPrice4: 125n, decisionsUsed: 100_333, taxRateBp: 500, periodLabel: "2026-09", planName: "Core" });
    // 333 decisions x 0.0125 = 4.1625 -> 4.16 (416 fils, half-up)
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1]!.amountMinor).toBe("416");
    expect(r.subtotalMinor).toBe(1_250_416n);
    expect(r.taxMinor).toBe(62_521n);
    expect(r.totalMinor).toBe(1_312_937n);
    const none = computeInvoice({ periodFeeMinor: 100n, includedDecisions: null, overageUnitPrice4: 125n, decisionsUsed: 9, taxRateBp: 0, periodLabel: "x", planName: "Core" });
    expect(none.lines).toHaveLength(1);
    expect(periodOf(NOW)).toBe("2026-10");
    expect(periodBounds("2026-12").end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("uses each currency's own decimal places (KWD three, JPY none)", () => {
    expect(toMinor(125.5, "KWD")).toBe(125_500n);
    expect(toMinor(1500, "JPY")).toBe(1500n);
    expect(toMinor(12.5, "AED")).toBe(1250n);
    expect(fromMinor(125_500n, "KWD")).toBe(125.5);
    // 333 decisions x 0.0125 KWD = 4.1625 KWD = 4.163 (fils, half-up): three decimals keep a digit AED rounds away.
    const kwd = computeInvoice({ periodFeeMinor: 1_000_000n, includedDecisions: 100_000, overageUnitPrice4: 125n, decisionsUsed: 100_333, taxRateBp: 0, periodLabel: "x", planName: "Core", currency: "KWD" });
    expect(kwd.lines[0]!.unitPrice4).toBe("10000000");
    expect(kwd.lines[1]!.amountMinor).toBe("4163");
    const jpy = computeInvoice({ periodFeeMinor: 50_000n, includedDecisions: 0, overageUnitPrice4: 15_000n, decisionsUsed: 3, taxRateBp: 0, periodLabel: "x", planName: "Core", currency: "JPY" });
    expect(jpy.lines[1]!.amountMinor).toBe("5");
  });
});

describe("commercial records (database)", () => {
  let t: TestTenant;
  let adminId: string;
  const created: string[] = [];
  beforeAll(async () => {
    t = await makeTestTenant("comm");
    const admin = await registerUser({ email: `padmin-${Date.now().toString(36)}@test.aegis.local`, name: "Platform Admin", password: "CorrectHorse1Battery" });
    adminId = admin.id;
    await ownerPrisma().user.update({ where: { id: adminId }, data: { isPlatformAdmin: true } });
  }, 60_000);
  afterAll(async () => {
    for (const id of created) await ownerPrisma().organization.delete({ where: { id } }).catch(() => undefined);
    await t.cleanup();
    await ownerPrisma().user.delete({ where: { id: adminId } }).catch(() => undefined);
    await disconnectAll();
  });

  it("only a platform administrator creates a customer, which starts with no members and an owner invitation for its first administrator", async () => {
    await expect(platformCreateOrganization(t.ownerUserId, { name: "Nope", slug: `nope-${Date.now().toString(36)}`, adminEmail: "a@b.example" })).rejects.toThrow(/Platform administrators only/);
    const email = `first-${Date.now().toString(36)}@test.aegis.local`;
    // Created at the real time: the invitation is accepted below, and acceptance checks expiry against the clock.
    const createdAt = new Date();
    const { org, invitationToken } = await platformCreateOrganization(adminId, { name: "Customer One", slug: `cust-${Date.now().toString(36)}`, adminEmail: email, plan: "trial", trialDays: 14 }, createdAt);
    created.push(org.id);
    expect(org.trialEndsAt!.toISOString()).toBe(new Date(createdAt.getTime() + 14 * 86_400_000).toISOString());
    expect(await withTenant(org.id, (db) => db.membership.count())).toBe(0);
    const user = await registerUser({ email, name: "First Admin", password: "CorrectHorse1Battery" });
    await acceptInvitation(invitationToken, user.id);
    const m = (await listUserMemberships(user.id)).find((x) => x.orgId === org.id)!;
    expect(m.roleKey ?? m.roleName).toMatch(/owner/i);
    await ownerPrisma().user.delete({ where: { id: user.id } }).catch(() => undefined);
  });

  it("contract to draft, issue and paid invoice; drafts stay with the provider and amounts never change", async () => {
    await expect(platformDraftInvoice(adminId, t.orgId, { period: "2026-09" })).rejects.toThrow(/Record a contract/);
    const contract = await platformSetContract(adminId, t.orgId, { plan: "core", termStart: "2026-01-01", termEnd: "2026-12-31", periodFee: 12500, includedDecisions: 1000, overageUnitPrice: 0.0125, taxRatePercent: 5, paymentTermsDays: 30 });
    expect(contract.periodFee).toBe(12500);
    expect((await rawPrisma().organization.findUniqueOrThrow({ where: { id: t.orgId } })).plan).toBe("core");
    const draft = await platformDraftInvoice(adminId, t.orgId, { period: "2026-09" });
    expect(draft.status).toBe("draft");
    expect(draft.total).toBe(13125);
    await expect(platformDraftInvoice(adminId, t.orgId, { period: "2026-09" })).rejects.toThrow(/already covers/);
    await expect(withTenant(t.orgId, (db) => getInvoiceForOrg(db, t.ownerCtx, draft.id))).rejects.toThrow(/not found/);
    await expect(platformInvoiceAction(adminId, t.orgId, draft.id, { action: "mark_paid", paymentReference: "TRX-1" })).rejects.toThrow(/Only an issued invoice/);
    const issued = await platformInvoiceAction(adminId, t.orgId, draft.id, { action: "issue" }, NOW);
    expect(issued.dueAt!.toISOString()).toBe("2026-11-13T08:00:00.000Z");
    await expect(platformInvoiceAction(adminId, t.orgId, draft.id, { action: "issue" })).rejects.toThrow(/Only a draft/);
    const seen = await withTenant(t.orgId, (db) => getInvoiceForOrg(db, t.ownerCtx, draft.id));
    expect(seen.total).toBe(13125);
    const paid = await platformInvoiceAction(adminId, t.orgId, draft.id, { action: "mark_paid", paymentReference: "Bank transfer 4471" });
    expect(paid.status).toBe("paid");
    await expect(platformInvoiceAction(adminId, t.orgId, draft.id, { action: "void", reason: "too late now" })).rejects.toThrow(/cannot be voided/);
    const summary = await withTenant(t.orgId, (db) => subscriptionSummary(db, { ...t.ownerCtx, now: NOW }));
    expect(summary.plan.key).toBe("core");
    expect(summary.invoices.map((i) => i.number)).toContain(draft.number);
    expect(summary.lines.find((l) => l.metric === "monthlyDecisions")!.limit).toBe(250_000);
    const events = await withTenant(t.orgId, (db) => db.evidenceEvent.findMany({ where: { subjectId: draft.id }, select: { type: true } }));
    expect(events.map((e) => e.type).sort()).toEqual(["invoice.drafted", "invoice.issued", "invoice.paid"]);
  });

  it("usage snapshots are idempotent: one row per period and metric", async () => {
    await withTenant(t.orgId, (db) => snapshotUsage(db, t.orgId, "2026-10", NOW));
    await withTenant(t.orgId, (db) => snapshotUsage(db, t.orgId, "2026-10", NOW));
    const rows = await withTenant(t.orgId, (db) => db.usageRecord.findMany({ where: { orgId: t.orgId, period: "2026-10" } }));
    expect(rows).toHaveLength(5);
    expect(Number(rows.find((r) => r.metric === "members")!.value)).toBe(1);
  });

  it("support requests: any member opens one, the provider resolves it with a note", async () => {
    const r = await withTenant(t.orgId, (db) => createSupportRequest(db, t.ownerCtx, { subject: "SSO login loop", body: "Users are sent back to the login page after the IdP.", severity: "high" }));
    expect((await withTenant(t.orgId, (db) => listSupportRequests(db, t.ownerCtx))).map((x) => x.id)).toContain(r.id);
    await expect(platformUpdateSupportRequest(adminId, t.orgId, r.id, { status: "resolved", resolution: "" })).rejects.toThrow();
    const done = await platformUpdateSupportRequest(adminId, t.orgId, r.id, { status: "resolved", resolution: "Callback URL corrected in the IdP." });
    expect(done.status).toBe("resolved");
  });

  it("plan changes are platform-only and recorded; customer health reads the tenant's own records", async () => {
    await expect(platformSetPlan(t.ownerUserId, t.orgId, { plan: "enterprise" })).rejects.toThrow(/Platform administrators only/);
    await platformSetPlan(adminId, t.orgId, { plan: "trial", trialEndsAt: "2026-10-20T00:00:00Z" });
    const org = await rawPrisma().organization.findUniqueOrThrow({ where: { id: t.orgId } });
    const h = await withTenant(t.orgId, (db) => customerHealth(db, org, NOW));
    expect(h.plan).toBe("trial");
    expect(h.trial.state).toBe("ending_soon");
    expect(h.onboarding.total).toBeGreaterThan(0);
    expect(h.support.open).toBe(0);
    // Moving an organization to the trial plan with no end date gives the standard length, never an open-ended trial.
    await rawPrisma().organization.update({ where: { id: t.orgId }, data: { plan: "core", trialEndsAt: null } });
    await platformSetPlan(adminId, t.orgId, { plan: "trial" });
    const ends = (await rawPrisma().organization.findUniqueOrThrow({ where: { id: t.orgId } })).trialEndsAt;
    expect(ends).not.toBeNull();
    expect(Math.round((ends!.getTime() - Date.now()) / 86_400_000)).toBe(30);
  });
});
