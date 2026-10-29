import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { disconnectAll, rawPrisma, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { authorizeAndExecute, issueGrantForRequest, pauseGateway, recordAgentExecution, requestGrant, requestHashOf, resumeGateway, startAgentExecution } from "../src/gateway/gateway.js";
import { consumeGrant, issueGrant } from "../src/gateway/grants.js";
import { enforcementCoverage } from "../src/gateway/enforcement.js";
import { loginWithPassword, registerUser } from "../src/identity/auth.js";
import { makeContext } from "../src/lib/context.js";
import { createAgent, transitionAgent } from "../src/agents/registry.js";
import { createDelegation, revokeDelegation } from "../src/agents/delegation.js";
import { evaluateRule } from "../src/monitoring/rules.js";
import { recordAgentObservation } from "../src/agents/discovery.js";

/** Regression tests for the P2 findings of the October 2026 audit (docs/DEFECT_REGISTER.md). */
let f: GatewayFixture;
const run = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(f.orgId, fn);
const agentMode = (amount = 40) =>
  authorizeAndExecute(withTenant, f.agentCtx, { tool: "issue-refund", action: "execute", params: { orderId: `O-${randomUUID().slice(0, 8)}`, customerId: "C", amount, currency: "AED" }, resource: "support-tickets", idempotencyKey: randomUUID(), justification: "", principal: { type: "none" }, context: {}, executionMode: "agent" });

beforeAll(async () => {
  f = await makeGatewayFixture();
}, 120_000);
afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});

describe("P2-1: enforcement coverage is for console users with integrations:read", () => {
  it("an agent or integration key cannot read it", async () => {
    await expect(run((db) => enforcementCoverage(db, f.agentCtx))).rejects.toThrow(/console users/);
    const integ = makeContext(f.orgId, { type: "integration", id: f.integrationId, permissions: ["integrations:read"] } as never);
    await expect(run((db) => enforcementCoverage(db, integ))).rejects.toThrow(/console users/);
    await expect(run((db) => enforcementCoverage(db, f.ownerCtx))).resolves.toBeTruthy();
  });
});

describe("P2-2: a grant is consumed only by the integration it was issued for", () => {
  it("an integration key cannot consume a grant issued with no integration", async () => {
    const r = await agentMode();
    expect(r.decision).toBe("allow");
    const req = await run((db) => db.actionRequest.findUniqueOrThrow({ where: { id: r.requestId } }));
    const hash = requestHashOf(req.toolKey, req.action, req.params as Record<string, unknown>);
    const g = await run(async (db) => {
      await db.executionGrant.updateMany({ where: { actionRequestId: r.requestId }, data: { voidedAt: new Date(), voidReason: "test" } });
      const issued = await issueGrant(db, f.orgId, r.requestId, hash);
      // As for a tool with no connected system: the grant carries no integration.
      await db.executionGrant.update({ where: { id: issued.grant.id }, data: { integrationId: null } });
      return issued;
    });
    expect(await run((db) => consumeGrant(db, g.token, hash, { integrationId: f.integrationId }))).toEqual({ ok: false, reason: "integration_mismatch" });
  });
});

describe("P2-4: password lockout holds under parallel attempts", () => {
  it("at most the limit of guesses are checked, then the account is locked", async () => {
    const email = `lock-${randomUUID().slice(0, 8)}@example.test`;
    const u = await registerUser({ email, name: "Lock", password: "CorrectHorse1Battery" });
    try {
      const results = await Promise.allSettled(Array.from({ length: 30 }, () => loginWithPassword({ email, password: "wrong-wrong-wrong" }, {})));
      const checked = results.filter((x) => x.status === "rejected" && /Invalid email or password/.test(String((x as PromiseRejectedResult).reason))).length;
      expect(checked).toBeLessThanOrEqual(8);
      await expect(loginWithPassword({ email, password: "CorrectHorse1Battery" }, {})).rejects.toThrow(/locked/);
    } finally {
      await rawPrisma().user.delete({ where: { id: u.id } }).catch(() => undefined);
    }
  });
});

describe("P2-6: an agent-mode grant is issued only for a request submitted in agent mode", () => {
  it("a gateway-mode request cannot be fetched as an agent-mode grant", async () => {
    const r = await f.call({ amount: 40 });
    expect(r.decision).toBe("allow");
    await expect(run((db) => issueGrantForRequest(db, f.agentCtx, r.requestId))).rejects.toThrow(/executionMode agent/);
  });
});

describe("P2-12: whoever may grant a delegation may also revoke it", () => {
  it("a person with agents:write and not agents:control can revoke", async () => {
    const other = await run(async (db) => {
      const a = await createAgent(db, f.engineer.ctx, { slug: `deleg-${randomUUID().slice(0, 6)}`, name: "delegate", description: "", environment: "production", modelProvider: "x", modelId: "y", dataClassificationLimit: "confidential", riskTier: "low", metadata: {}, technicalOwnerId: f.engineer.userId });
      await transitionAgent(db, f.engineer.ctx, a.id, "registered", "ok");
      await transitionAgent(db, f.engineer.ctx, a.id, "active", "ok");
      return a.id;
    });
    const d = await run((db) => createDelegation(db, f.ownerCtx, { delegatorAgentId: f.agentId, delegateAgentId: other, toolKeys: ["issue-refund"], constraints: {}, reason: "audit test", expiresInHours: 1 }));
    const writer = makeContext(f.orgId, { type: "user", id: f.engineer.userId, permissions: ["agents:read", "agents:write"] });
    await run((db) => revokeDelegation(db, writer, d.id, "no longer needed"));
    expect((await run((db) => db.agentDelegation.findUniqueOrThrow({ where: { id: d.id } }))).revokedAt).not.toBeNull();
  });
});

describe("P2-15: the transaction volume rule is not tied to one tool name", () => {
  it("without a tool key it totals every executed action with an amount", async () => {
    for (let i = 0; i < 3; i++) expect((await f.call({ amount: 40 })).status).toBe("executed");
    const hits = await run((db) => evaluateRule(db, f.orgId, { type: "transaction_volume", amountThreshold: 100, windowMinutes: 60 }));
    expect(hits.some((h) => h.agentId === f.agentId)).toBe(true);
  });
});

describe("P2-9: an agent consumes its grant before the tool runs", () => {
  it("the start is refused while the gateway is paused, and a started request then reports its outcome", async () => {
    const r = await agentMode();
    expect(r.decision).toBe("allow");
    await run((db) => pauseGateway(db, f.ownerCtx, "drill"));
    // A pause voids live grants, so the start is refused and the tool never runs.
    await expect(run((db) => startAgentExecution(db, f.agentCtx, r.requestId, r.grant!.token))).rejects.toThrow(/voided|paused/);
    await run((db) => resumeGateway(db, f.ownerCtx, "drill over"));
    const fresh = await requestGrant(withTenant, f.agentCtx, r.requestId);
    await run((db) => startAgentExecution(db, f.agentCtx, r.requestId, fresh.grant));
    await expect(run((db) => startAgentExecution(db, f.agentCtx, r.requestId, fresh.grant))).rejects.toThrow(/consumed/);
    const out = await run((db) => recordAgentExecution(db, f.agentCtx, r.requestId, { grant: fresh.grant, outcome: "succeeded", reference: "R-1" }));
    expect(JSON.stringify(out)).toMatch(/succeeded/);
  });
});

describe("P2-10: a discovered agent is linked by a stable identifier, never by display name alone", () => {
  it("an unknown id that copies a registered agent's name stays unregistered, with the name match as a suggestion", async () => {
    const integ = makeContext(f.orgId, { type: "integration", id: f.integrationId });
    const agent = await run((db) => db.agent.findUniqueOrThrow({ where: { id: f.agentId } }));
    const seen = await run((db) => recordAgentObservation(db, integ, { source: "kubernetes", externalId: `rogue-${randomUUID().slice(0, 6)}`, name: agent.name, platform: "custom", metadata: {} }));
    expect(seen.status).toBe("unregistered");
    expect(seen.linkedAgentId).toBeNull();
    expect((seen.metadata as { possibleMatchAgentId?: string }).possibleMatchAgentId).toBe(f.agentId);
  });
});
