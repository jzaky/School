import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { replayPolicy } from "../src/policy/replay.js";
import { buildRefundPolicyDocument } from "../src/policy/templates.js";
import { DEMO_POLICIES } from "../src/seed/demo-policies.js";

let f: GatewayFixture;
beforeAll(async () => {
  f = await makeGatewayFixture();
  // Three recorded decisions under the seeded refund policy (automatic below 500, approval up to 2,500).
  await f.call({ amount: 100 });
  await f.call({ amount: 1000 });
  await f.call({ amount: 9000 });
  // One request refused before policy evaluation: a resource the agent has no permission on.
  await f.call({ resource: "payments-core", amount: 10 });
});
afterAll(async () => {
  await f.cleanup();
});

describe("replay calibration", () => {
  it("replaying the active document changes nothing and skips requests refused before policy", async () => {
    const active = DEMO_POLICIES.find((p) => p.key === "refund-authority")!.document;
    const r = await withTenant(f.orgId, (db) => replayPolicy(db, f.ownerCtx, { policyId: f.refundPolicyId, document: active, options: { days: 7 } }));
    expect(r.policyKey).toBe("refund-authority");
    expect(r.considered).toBeGreaterThanOrEqual(4);
    expect(r.replayed).toBeGreaterThanOrEqual(3);
    expect(r.skipped.beforePolicy).toBeGreaterThanOrEqual(1);
    expect(r.before).toEqual(r.after);
    expect(r.changed).toBe(0);
    expect(r.changes).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/Nothing was recorded/);
  });

  it("a stricter draft moves requests between bands and lists each change with the deciding rule", async () => {
    // The fixture sends no reason, so the reason guard stays off; only the bands change.
    const stricter = buildRefundPolicyDocument({ autoApproveBelow: 50, approvalUpTo: 500, requireReason: false });
    const r = await withTenant(f.orgId, (db) => replayPolicy(db, f.ownerCtx, { policyId: f.refundPolicyId, document: stricter, options: { days: 7 } }));
    expect(r.before.allow).toBeGreaterThanOrEqual(1);
    expect(r.after.allow).toBe(0);
    // 100 becomes approval, 1,000 becomes a refusal, 9,000 stays refused.
    const byAmount = new Map(r.changes.map((c) => [c.amount, c]));
    expect(byAmount.get(100)?.before).toBe("allow");
    expect(byAmount.get(100)?.after).toBe("require_approval");
    expect(byAmount.get(100)?.decidingRule).toBe("refund-authority/approval-band");
    expect(byAmount.get(1000)?.before).toBe("require_approval");
    expect(byAmount.get(1000)?.after).toBe("deny");
    expect(byAmount.has(9000)).toBe(false);
    expect(r.changed).toBe(2);
    expect(r.approvalsPerDayAfter).toBeGreaterThan(0);
    expect(r.changes[0]!.agentName).toBe("Support Refund Agent");
    expect(r.changes[0]!.currency).toBe("AED");
  });

  it("a new policy is replayed as an addition to the active set", async () => {
    const extra = { version: 1, appliesTo: { tools: ["issue-refund"], actions: [], environments: [] }, rules: [{ id: "all-refunds-need-a-person", effect: "require_approval", when: { attr: "params.amount", op: "gt", value: 0 }, approval: { roles: [], minApprovers: 1, expiresInMinutes: 60, separationOfDuties: true, escalateToRoles: [], instructions: "Check" }, reason: "Every refund needs a person during the pilot" }] };
    const r = await withTenant(f.orgId, (db) => replayPolicy(db, f.ownerCtx, { document: extra, options: { days: 7 } }));
    expect(r.policyKey).toBeNull();
    expect(r.after.allow).toBe(0);
    // The 9,000 refund is still refused by the active refund policy; the 100 refund now needs a person.
    expect(r.after.deny).toBeGreaterThanOrEqual(1);
    expect(r.changes.some((c) => c.amount === 100 && c.after === "require_approval" && c.decidingRule === "draft/all-refunds-need-a-person")).toBe(true);
  });

  it("later refusals do not change the replay of earlier requests (24-hour counters are bounded at the request's own time)", async () => {
    // The seeded refund policy stops the agent after 10 refused attempts in 24 hours. Twelve refusals
    // after the recorded requests must not make the earlier 100 refund replay as refused.
    for (let i = 0; i < 12; i++) await f.call({ amount: 9000 });
    const active = DEMO_POLICIES.find((p) => p.key === "refund-authority")!.document;
    const r = await withTenant(f.orgId, (db) => replayPolicy(db, f.ownerCtx, { policyId: f.refundPolicyId, document: active, options: { days: 7 } }));
    expect(r.changed).toBe(0);
    expect(r.before).toEqual(r.after);
  });

  it("requires policies:read and validates the window", async () => {
    const active = DEMO_POLICIES.find((p) => p.key === "refund-authority")!.document;
    await expect(withTenant(f.orgId, (db) => replayPolicy(db, f.ownerCtx, { document: active, options: { days: 400 } }))).rejects.toThrow();
    await expect(withTenant(f.orgId, (db) => replayPolicy(db, { ...f.ownerCtx, actor: { type: "user", id: f.ownerCtx.actor.id, permissions: ["agents:read"] } }, { document: active }))).rejects.toThrow(/policies:read/);
  });
});
