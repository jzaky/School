import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { disconnectAll, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { acknowledgeAlert, runMonitoring } from "../src/monitoring/service.js";
import { assignPolicy } from "../src/policy/service.js";
import { startAccessReview } from "../src/agents/access-reviews.js";
import { actionRequestInputSchema, jsonDepth } from "../src/gateway/gateway.js";
import { contextFromTrace } from "../src/policy/boundary.js";

// Findings of the enterprise attack validation (apps/api/tests/enterprise-attacks.test.ts), held at the core layer.
let f: GatewayFixture;
let other: GatewayFixture;

beforeAll(async () => {
  f = await makeGatewayFixture();
  other = await makeGatewayFixture();
}, 120_000);
afterAll(async () => {
  await f.cleanup();
  await other.cleanup();
  await disconnectAll();
});

describe("monitoring runs", () => {
  it("an agent or integration cannot start one; a person needs monitoring:write", async () => {
    await expect(withTenant(f.orgId, (db) => runMonitoring(db, f.agentCtx))).rejects.toThrow(/monitoring:write/);
    await expect(withTenant(f.orgId, (db) => runMonitoring(db, f.viewer.ctx))).rejects.toThrow(/monitoring:write/);
    await expect(withTenant(f.orgId, (db) => runMonitoring(db, f.ownerCtx))).resolves.toMatchObject({ errors: [] });
  });

  it("acknowledging an alert this organization cannot see is not found, not a server error", async () => {
    await expect(withTenant(f.orgId, (db) => acknowledgeAlert(db, f.ownerCtx, randomUUID()))).rejects.toThrow(/not found/i);
  });
});

describe("references to objects outside the organization", () => {
  it("a policy cannot be assigned to another organization's agent, an unknown agent or an unknown team", async () => {
    for (const target of [{ targetType: "agent" as const, targetId: other.agentId }, { targetType: "agent" as const, targetId: randomUUID() }, { targetType: "team" as const, targetId: randomUUID() }]) {
      await expect(withTenant(f.orgId, (db) => assignPolicy(db, f.ownerCtx, f.refundPolicyId, { ...target, priority: 1 }))).rejects.toThrow(/of this organization/);
    }
    await expect(withTenant(f.orgId, (db) => assignPolicy(db, f.ownerCtx, randomUUID(), { targetType: "org", priority: 1 }))).rejects.toThrow(/not found/i);
  });

  it("an access review naming an agent that is not this organization's is refused, not started empty", async () => {
    await expect(withTenant(f.orgId, (db) => startAccessReview(db, f.ownerCtx, { title: "Cross tenant", agentIds: [other.agentId] }))).rejects.toThrow(/agent of this organization/);
    expect(await withTenant(f.orgId, (db) => db.accessReview.count())).toBe(0);
  });
});

describe("gateway input the database cannot store", () => {
  const base = { tool: "issue-refund", idempotencyKey: "idem-12345678", params: { amount: 1 } };
  it("NUL characters are refused in names, keys and values", () => {
    for (const bad of [{ tool: "issue-refund\u0000" }, { idempotencyKey: "idem-\u000012345" }, { resource: "a\u0000" }, { justification: "x\u0000" }, { params: { note: "a\u0000b" } }, { params: { "k\u0000": 1 } }, { context: { x: "\u0000" } }]) {
      expect(actionRequestInputSchema.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(actionRequestInputSchema.safeParse(base).success).toBe(true);
  });

  it("nesting beyond 32 levels is refused, and depth is measured without recursion", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100_000; i++) deep = { a: deep };
    expect(jsonDepth(deep)).toBe(100_000);
    expect(actionRequestInputSchema.safeParse({ ...base, params: { deep } }).success).toBe(false);
    let ok: unknown = 1;
    for (let i = 0; i < 30; i++) ok = { a: ok };
    expect(actionRequestInputSchema.safeParse({ ...base, params: { ok } }).success).toBe(true);
  });
});

describe("prototype pollution through policy attribute paths (CodeQL)", () => {
  it("a context path naming __proto__, constructor or prototype is skipped; ordinary paths still rebuild", () => {
    const cmp = (attr: string, actual: unknown) => ({ attr, op: "eq", actual, result: true });
    const out = contextFromTrace([{ ruleId: "r", matched: true, comparisons: [cmp("context.__proto__.polluted", "yes"), cmp("context.constructor.prototype.polluted", "yes"), cmp("context.a.prototype", 1), cmp("context.channel.name", "chat")] }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(out).toEqual({ channel: { name: "chat" } });
  });
});
