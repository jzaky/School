import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { disconnectAll, rawPrisma, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { evaluateResourceBindings, readResourceBindings, setResourceBindings, type ResourceBindingRule } from "../src/gateway/resource-binding.js";
import { updateOrganization } from "../src/orgs/orgs.js";
import { makeContext } from "../src/lib/context.js";
import { authorizeAndExecute } from "../src/gateway/gateway.js";
import { setAgentTool, upsertTool } from "../src/agents/registry.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../src/policy/service.js";
import type { PolicyDocument } from "../src/policy/schema.js";

/** Resource binding (audit P2-3): the resource an agent claims must be the one its parameters address. */
let f: GatewayFixture;
const run = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(f.orgId, fn);
const setRules = (rules: unknown[]) => run((db) => setResourceBindings(db, f.ownerCtx, rules));
// A tool whose schema accepts the bound parameter; the agent may use it on support-tickets.
const TOOL = "route-ticket";
const refund = (extra: Record<string, unknown>, opts: { resource?: string | undefined; context?: Record<string, unknown> } = {}) =>
  authorizeAndExecute(withTenant, f.agentCtx, { tool: TOOL, action: "execute", params: { ticketId: `T-${randomUUID().slice(0, 8)}`, ...extra }, resource: "resource" in opts ? opts.resource : "support-tickets", idempotencyKey: randomUUID(), justification: "", principal: { type: "none" }, context: opts.context ?? {}, executionMode: "agent" });
const decisionOf = (requestId: string) => run((db) => db.authorizationDecision.findFirstOrThrow({ where: { actionRequestId: requestId }, orderBy: { createdAt: "desc" } }));
const evidenceOf = (requestId: string) => run((db) => db.evidenceEvent.findFirstOrThrow({ where: { subjectId: requestId, type: { startsWith: "gateway.decision." } }, orderBy: { seq: "desc" } }));

beforeAll(async () => {
  f = await makeGatewayFixture();
  await run(async (db) => {
    const tool = await upsertTool(db, f.engineer.ctx, { key: TOOL, name: "Route ticket", description: "", integrationId: f.integrationId, riskLevel: "low", parameterSchema: {}, destinationRules: { allowedDomains: [], allowedResourceKeys: [] } });
    await setAgentTool(db, f.engineer.ctx, f.agentId, tool.id, true);
    const doc = { version: 1, appliesTo: { tools: [TOOL], actions: [], environments: [] }, rules: [{ id: "allow", description: "", effect: "allow", when: { attr: "action.tool", op: "eq", value: TOOL }, reason: "allowed", riskIndicators: [] }], tests: [] } as unknown as PolicyDocument;
    const { policy, version } = await createPolicy(db, f.ownerCtx, { key: `route-${randomUUID().slice(0, 6)}`, name: "route", description: "", category: "authorization", document: doc, changeNote: "test" });
    await submitForReview(db, f.ownerCtx, version.id);
    await activateVersion(db, f.ownerCtx, version.id, { fourEyes: false });
    await assignPolicy(db, f.ownerCtx, policy.id, { targetType: "agent", targetId: f.agentId, priority: 100 });
  });
}, 120_000);
afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});
beforeEach(async () => {
  await setRules([]);
});

describe("configuring resource bindings", () => {
  it("only a person with policies:activate can change the rules; an agent and a viewer cannot", async () => {
    const rule = { id: "queue-binding", param: "ticketQueue", mode: "enforce" };
    await expect(run((db) => setResourceBindings(db, f.agentCtx, [rule]))).rejects.toThrow(/Only a person/);
    await expect(run((db) => setResourceBindings(db, f.viewer.ctx, [rule]))).rejects.toThrow(/policies:activate/);
    await expect(setRules([{ id: "Bad Id", param: "x" }])).rejects.toThrow();
    await expect(setRules([{ id: "m", param: "x", match: "mapped" }])).rejects.toThrow(/mapping/);
    const saved = await setRules([rule]);
    expect(saved[0]).toMatchObject({ id: "queue-binding", version: 1, mode: "enforce", match: "exact" });
  });

  it("a rule's version changes only when its content changes", async () => {
    await setRules([{ id: "rule-a", param: "x" }, { id: "rule-b", param: "y" }]);
    const next = await setRules([{ id: "rule-a", param: "x" }, { id: "rule-b", param: "y", mode: "enforce" }]);
    expect(next.find((r) => r.id === "rule-a")!.version).toBe(1);
    expect(next.find((r) => r.id === "rule-b")!.version).toBe(2);
  });

  it("an ordinary settings save cannot change or remove the rules", async () => {
    await setRules([{ id: "keep", param: "ticketQueue", mode: "enforce" }]);
    const before = (await rawPrisma().organization.findUniqueOrThrow({ where: { id: f.orgId } })).settings as Record<string, unknown>;
    await updateOrganization(f.ownerCtx, { settings: { ...before, resourceBindings: [] } });
    await updateOrganization(f.ownerCtx, { settings: { resourceBindings: null } });
    const after = (await rawPrisma().organization.findUniqueOrThrow({ where: { id: f.orgId } })).settings;
    expect(readResourceBindings(after).map((r) => r.id)).toEqual(["keep"]);
  });
});

describe("enforce mode", () => {
  it("allows a request whose parameter addresses the claimed resource", async () => {
    await setRules([{ id: "queue-binding", param: "ticketQueue", mode: "enforce" }]);
    const r = await refund({ ticketQueue: "support-tickets" });
    expect(r.decision).toBe("allow");
    const d = await decisionOf(r.requestId);
    expect((d.explanation as { resourceBinding: unknown[] }).resourceBinding).toEqual([expect.objectContaining({ ruleId: "queue-binding", version: 1, claimed: "support-tickets", actual: "support-tickets", outcome: "match" })]);
  });

  it("denies a mismatch and records claimed resource, actual resource, decision and rule version", async () => {
    await setRules([{ id: "queue-binding", param: "ticketQueue", mode: "enforce" }]);
    const r = await refund({ ticketQueue: "payments-core" });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/claims resource support-tickets but its parameter ticketQueue addresses payments-core/);
    const d = await decisionOf(r.requestId);
    expect(d.result).toBe("deny");
    const failures = (d.explanation as { failures: { code: string; details: unknown }[] }).failures;
    expect(failures).toContainEqual(expect.objectContaining({ code: "resource_binding_mismatch", details: { ruleId: "queue-binding", version: 1, claimed: "support-tickets", actual: "payments-core", outcome: "mismatch" } }));
    const ev = await evidenceOf(r.requestId);
    expect(ev.type).toBe("gateway.decision.deny");
    expect((ev.payload as { resourceBinding: unknown[] }).resourceBinding).toEqual([expect.objectContaining({ ruleId: "queue-binding", version: 1, claimed: "support-tickets", actual: "payments-core", outcome: "mismatch" })]);
  });

  it("fails closed: no claimed resource, a missing parameter, or an unmapped value is refused", async () => {
    await setRules([{ id: "queue-binding", param: "ticketQueue", mode: "enforce" }]);
    expect((await refund({ ticketQueue: "support-tickets" }, { resource: undefined })).reasons.join(" ")).toMatch(/names no resource/);
    expect((await refund({})).reasons.join(" ")).toMatch(/parameter ticketQueue is missing/);
    expect((await refund({ ticketQueue: { key: "support-tickets" } })).reasons.join(" ")).toMatch(/missing or not a plain value/);
    await setRules([{ id: "queue-map", param: "queue", mode: "enforce", match: "mapped", map: { "Q-SUPPORT": "support-tickets" } }]);
    expect((await refund({ queue: "Q-SUPPORT" })).decision).toBe("allow");
    expect((await refund({ queue: "Q-PAYMENTS" })).reasons.join(" ")).toMatch(/does not map to any resource/);
  });

  it("request metadata cannot satisfy the rule: only the parameters count", async () => {
    await setRules([{ id: "queue-binding", param: "ticketQueue", mode: "enforce" }]);
    const r = await refund({ ticketQueue: "payments-core" }, { context: { ticketQueue: "support-tickets", resource: "support-tickets", resourceBinding: "match" } });
    expect(r.decision).toBe("deny");
    expect(r.reasons.join(" ")).toMatch(/addresses payments-core/);
  });

  it("a disabled rule and a rule scoped to another tool, agent or action do not apply", async () => {
    await setRules([
      { id: "off", param: "ticketQueue", mode: "enforce", enabled: false },
      { id: "other-tool", param: "ticketQueue", mode: "enforce", scope: { tools: ["issue-refund"] } },
      { id: "other-agent", param: "ticketQueue", mode: "enforce", scope: { agentIds: [randomUUID()] } },
      { id: "other-action", param: "ticketQueue", mode: "enforce", scope: { actions: ["refund-partial"] } },
    ]);
    const r = await refund({ ticketQueue: "payments-core" });
    expect(r.decision).toBe("allow");
    expect((await decisionOf(r.requestId)).explanation).not.toHaveProperty("resourceBinding");
  });

  it("a rule scoped to this agent, tool and action applies", async () => {
    await setRules([{ id: "scoped", param: "ticketQueue", mode: "enforce", scope: { agentIds: [f.agentId], tools: [TOOL], actions: ["execute"] } }]);
    expect((await refund({ ticketQueue: "payments-core" })).decision).toBe("deny");
  });
});

describe("audit mode", () => {
  it("records a mismatch without blocking, so a rule can be trialled before enforcement", async () => {
    await setRules([{ id: "queue-binding", param: "ticketQueue", mode: "audit" }]);
    const r = await refund({ ticketQueue: "payments-core" });
    expect(r.decision).toBe("allow");
    const d = await decisionOf(r.requestId);
    expect((d.explanation as { resourceBinding: unknown[] }).resourceBinding).toEqual([expect.objectContaining({ mode: "audit", claimed: "support-tickets", actual: "payments-core", outcome: "mismatch" })]);
    const ev = await evidenceOf(r.requestId);
    expect((ev.payload as { riskIndicators: string[] }).riskIndicators).toContain("resource_binding:audit_mismatch");
  });
});

describe("evaluateResourceBindings (pure)", () => {
  const rule = (over: Partial<ResourceBindingRule>): ResourceBindingRule => ({ id: "r", description: "", enabled: true, mode: "enforce", scope: { agentIds: [], tools: [], actions: [] }, param: "a.b", match: "exact", map: {}, version: 3, updatedAt: "", updatedBy: null, ...over });
  const req = (params: Record<string, unknown>, claimed: string | null = "res-1") => ({ agentId: "x", toolKey: "t", action: "execute", claimed, params });
  it("reads nested parameters and numbers, and never inherited properties", () => {
    expect(evaluateResourceBindings([rule({})], req({ a: { b: "res-1" } }))[0]!.outcome).toBe("match");
    expect(evaluateResourceBindings([rule({ param: "n" })], req({ n: 7 }, "7"))[0]!.outcome).toBe("match");
    expect(evaluateResourceBindings([rule({ param: "constructor" })], req({}))[0]!.outcome).toBe("missing_param");
    expect(evaluateResourceBindings([rule({ param: "a.toString" })], req({ a: {} }))[0]!.outcome).toBe("missing_param");
    expect(evaluateResourceBindings([rule({ match: "mapped", param: "q", map: { x: "res-1" } })], req({ q: "toString" }))[0]!.outcome).toBe("unmapped");
    expect(evaluateResourceBindings([rule({})], req({ a: { b: "res-1" } }, "  "))[0]!.outcome).toBe("missing_claim");
  });
});

void makeContext;
