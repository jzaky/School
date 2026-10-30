import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, ownerPrisma, withTenant } from "@aegis/db";
import { registerUser } from "../src/identity/auth.js";
import { listUserMemberships } from "../src/identity/memberships.js";
import { makeContext, type OrgContext } from "../src/lib/context.js";
import { SALES_SCENARIOS, findSalesDemo, runSalesScenario, setupSalesDemo } from "../src/demos/sales.js";

describe("sales demonstration environment", () => {
  let userId: string;
  let orgId: string;
  let person: OrgContext;
  beforeAll(async () => {
    const u = await registerUser({ email: `sales-${Date.now().toString(36)}@test.aegis.local`, name: "Sales Engineer", password: "CorrectHorse1Battery" });
    userId = u.id;
    const org = await setupSalesDemo(userId);
    orgId = org.id;
    const m = (await listUserMemberships(userId)).find((x) => x.orgId === orgId)!;
    person = makeContext(orgId, { type: "user", id: userId, permissions: m.permissions, membershipId: m.membershipId });
  }, 120_000);
  afterAll(async () => {
    await ownerPrisma().organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await ownerPrisma().user.delete({ where: { id: userId } }).catch(() => undefined);
    await disconnectAll();
  });

  it("is created once per person, in demo mode, with policies authored by AEGIS and activated by the person", async () => {
    expect((await findSalesDemo(userId))?.id).toBe(orgId);
    await expect(setupSalesDemo(userId)).rejects.toThrow(/already exists/);
    const versions = await withTenant(orgId, (db) => db.policyVersion.findMany({ where: { orgId, state: "active" }, select: { createdBy: true, approvedBy: true } }));
    expect(versions).toHaveLength(6);
    for (const v of versions) {
      expect(v.createdBy).toBeNull();
      expect(v.approvedBy).toBe(userId);
    }
  });

  for (const s of SALES_SCENARIOS) {
    it(`${s.key}: every step behaves as the scenario describes`, async () => {
      const run = await runSalesScenario(orgId, person, s.key);
      expect(run.simulated).toBe(true);
      const failed = run.steps.filter((x) => !x.expected).map((x) => `${x.title}: ${x.outcome}`);
      expect(failed).toEqual([]);
    }, 120_000);
  }

  it("the managed autonomy scenario leaves a recorded trail: two automatic downgrades, then a suspension", async () => {
    const agent = await withTenant(orgId, (db) => db.agent.findFirstOrThrow({ where: { orgId, slug: "collections-agent-1" } }));
    expect(agent.status).toBe("suspended");
    const transitions = await withTenant(orgId, (db) => db.autonomyTransition.findMany({ where: { agentId: agent.id, kind: "automatic_downgrade" }, orderBy: { createdAt: "asc" } }));
    expect(transitions.map((t) => t.toLevel)).toEqual([2, 1]);
  });

  it("refuses to run outside a sales demonstration environment", async () => {
    const other = await ownerPrisma().organization.findFirst({ where: { slug: "meridian" } });
    if (other) await expect(runSalesScenario(other.id, person, "finance")).rejects.toThrow(/sales demonstration environment/);
  });
});
