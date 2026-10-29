import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, ownerPrisma } from "@aegis/db";
import { registerUser } from "../src/identity/auth.js";
import { listUserMemberships } from "../src/identity/memberships.js";
import { makeContext, type OrgContext } from "../src/lib/context.js";
import { SECTOR_PACKS, runSectorLab, setupSectorLab } from "../src/validation/sector-lab.js";

describe("sector validation lab", () => {
  let userId: string;
  let orgId: string;
  let person: OrgContext;
  beforeAll(async () => {
    const u = await registerUser({ email: `lab-${Date.now().toString(36)}@test.aegis.local`, name: "Lab Operator", password: "CorrectHorse1Battery" });
    userId = u.id;
    orgId = (await setupSectorLab(userId)).id;
    const m = (await listUserMemberships(userId)).find((x) => x.orgId === orgId)!;
    person = makeContext(orgId, { type: "user", id: userId, permissions: m.permissions, membershipId: m.membershipId });
  }, 180_000);
  afterAll(async () => {
    await ownerPrisma().organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await ownerPrisma().$executeRawUnsafe(`DELETE FROM evidence_checkpoints WHERE org_id = $1::uuid`, orgId).catch(() => undefined);
    await ownerPrisma().user.delete({ where: { id: userId } }).catch(() => undefined);
    await disconnectAll();
  });

  it("covers eleven sectors, each with routine, held and refused cases and synthetic references only", () => {
    expect(SECTOR_PACKS.map((p) => p.key)).toEqual(["government", "healthcare", "defence", "energy", "banking", "aviation", "telecom", "education", "public-safety", "government-services", "ports-customs"]);
    for (const p of SECTOR_PACKS) {
      const outcomes = new Set(p.cases.map((c) => c.expect));
      expect(outcomes.has("allowed"), p.key).toBe(true);
      expect(outcomes.has("denied"), p.key).toBe(true);
      expect(p.cases.some((c) => c.routine), p.key).toBe(true);
      expect(JSON.stringify(p).includes(String.fromCharCode(0x2014)), `${p.key} em dash`).toBe(false);
    }
  });

  it("is idempotent to set up", async () => {
    expect((await setupSectorLab(userId)).id).toBe(orgId);
  });

  it("every case decides as expected through the real gateway, and the evidence ledger verifies", async () => {
    const run = await runSectorLab(orgId, person, { repeats: 2 });
    const failed = run.cases.filter((c) => !c.passed);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(run.cases.length).toBe(SECTOR_PACKS.reduce((n, p) => n + p.cases.length, 0));
    const bankChange = run.cases.find((c) => c.caseId === "gov-bank-change")!;
    expect(bankChange.followUp?.status).toBe("rejected");
    expect(run.ledger.valid).toBe(true);
    expect(run.ledger.checked).toBeGreaterThan(run.cases.length);
    expect(run.timing.routineSamples).toBe(SECTOR_PACKS.reduce((n, p) => n + p.cases.filter((c) => c.routine).length, 0) * 3);
    expect(run.notice).toMatch(/Synthetic/);
  }, 180_000);

  it("refuses to run in any other organization", async () => {
    const other = await ownerPrisma().organization.findFirstOrThrow({ where: { NOT: { id: orgId } }, select: { id: true } });
    await expect(runSectorLab(other.id, person)).rejects.toThrow(/sector lab/);
  });
});
