/**
 * Security regression suite (docs/SECURITY_VALIDATION.md). Each test pins a hardening measure so a later
 * change cannot remove it silently. Existing suites cover the rest of the matrix in that document.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, ownerPrisma, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { makeTestTenant, type TestTenant } from "./helpers.js";
import { authorizeAndExecute, readConcurrencyLimit, submitActionRequest } from "../src/gateway/gateway.js";
import { decryptSecret } from "../src/lib/crypto.js";
import { issueApiKey, resolveApiKey, revokeApiKey } from "../src/identity/api-keys.js";
import { rotateCredential } from "../src/integrations/service.js";
import { pinnedLookup } from "../src/integrations/destinations.js";
import { policyIntegrityFailures } from "../src/policy/service.js";

let f: GatewayFixture;
let other: TestTenant;
beforeAll(async () => {
  f = await makeGatewayFixture();
  other = await makeTestTenant("other");
}, 120_000);
afterAll(async () => {
  await f.cleanup();
  await other.cleanup();
  await disconnectAll();
});

describe("cross-tenant references", () => {
  it("a tenant cannot point its rows at another organization's rows, by foreign key or by plain id", async () => {
    const theirTool = await withTenant(other.orgId, (db) => db.tool.create({ data: { orgId: other.orgId, key: "their-tool", name: "Their tool" } }));
    const theirAgent = await withTenant(other.orgId, (db) => db.agent.create({ data: { orgId: other.orgId, slug: "their-agent", name: "Their agent" } }));
    // A real foreign key (agent_tools.tool_id): PostgreSQL checks it without row-level security; the guard does not.
    await expect(withTenant(f.orgId, (db) => db.agentTool.create({ data: { orgId: f.orgId, agentId: f.agentId, toolId: theirTool.id } }))).rejects.toThrow(/another organization/);
    // A plain reference column (security_events.agent_id) is guarded the same way.
    await expect(withTenant(f.orgId, (db) => db.securityEvent.create({ data: { orgId: f.orgId, type: "test", severity: "low", title: "x", agentId: theirAgent.id } }))).rejects.toThrow(/another organization/);
    // Same-organization references still work.
    const own = await withTenant(f.orgId, (db) => db.securityEvent.create({ data: { orgId: f.orgId, type: "test", severity: "low", title: "x", agentId: f.agentId } }));
    expect(own.agentId).toBe(f.agentId);
  });
});

describe("policy tampering", () => {
  it("a policy changed outside AEGIS is detected by its hash and the request is refused with a critical security event", async () => {
    const before = await f.call({ amount: 120 });
    expect(before.status).toBe("executed");
    const owner = ownerPrisma();
    const policy = await owner.policy.findUniqueOrThrow({ where: { id: f.refundPolicyId } });
    const version = await owner.policyVersion.findUniqueOrThrow({ where: { id: policy.currentVersionId! } });
    const doc = version.document as { rules: { effect: string }[] };
    const loosened = { ...doc, rules: doc.rules.map((r) => ({ ...r, effect: "allow" })) };
    // An attacker with the owner role disables the freeze trigger and rewrites the active document.
    await owner.$transaction([
      owner.$executeRawUnsafe("ALTER TABLE policy_versions DISABLE TRIGGER freeze_policy_version"),
      owner.policyVersion.update({ where: { id: version.id }, data: { document: loosened } }),
      owner.$executeRawUnsafe("ALTER TABLE policy_versions ENABLE TRIGGER freeze_policy_version"),
    ]);
    try {
      const after = await f.call({ amount: 9000 });
      expect(after.status).toBe("denied");
      expect(after.reasons.join(" ")).toMatch(/does not match its recorded hash/);
      const ev = await withTenant(f.orgId, (db) => db.securityEvent.findFirstOrThrow({ where: { actionRequestId: after.requestId } }));
      expect(ev.type).toBe("policy.integrity_failure");
      expect(ev.severity).toBe("critical");
    } finally {
      await owner.$transaction([
        owner.$executeRawUnsafe("ALTER TABLE policy_versions DISABLE TRIGGER freeze_policy_version"),
        owner.policyVersion.update({ where: { id: version.id }, data: { document: version.document as object } }),
        owner.$executeRawUnsafe("ALTER TABLE policy_versions ENABLE TRIGGER freeze_policy_version"),
      ]);
    }
    expect((await f.call({ amount: 130 })).status).toBe("executed");
  });

  it("the check ignores documents with no recorded hash and flags any difference", () => {
    const doc = { version: 1, rules: [{ id: "a", effect: "allow", when: { always: true } }] } as never;
    expect(policyIntegrityFailures([{ policyKey: "p", policyVersionId: "v", policyVersion: 1, document: doc }])).toEqual([]);
    expect(policyIntegrityFailures([{ policyKey: "p", policyVersionId: "v", policyVersion: 1, document: doc, contentHash: "not-the-hash" }])).toHaveLength(1);
  });
});

describe("concurrent action limits", () => {
  it("simultaneous requests cannot slip under the agent's limit", async () => {
    expect(readConcurrencyLimit({ maxConcurrentActions: 2 })).toBe(2);
    expect(readConcurrencyLimit({ maxConcurrentActions: 0 })).toBeNull();
    expect(readConcurrencyLimit({})).toBeNull();
    await withTenant(f.orgId, (db) => db.agent.update({ where: { id: f.agentId }, data: { metadata: { maxConcurrentActions: 2 } } }));
    try {
      // Agent execution mode: each allowed request holds a live grant until the agent uses it.
      const results = await Promise.all(Array.from({ length: 5 }, (_, i) => f.call({ amount: 50 + i, executionMode: "agent" })));
      const allowed = results.filter((r) => r.status === "allowed");
      const limited = results.filter((r) => r.status === "denied" && r.reasons.join(" ").includes("in flight"));
      expect(allowed).toHaveLength(2);
      expect(limited).toHaveLength(3);
    } finally {
      await withTenant(f.orgId, (db) => db.agent.update({ where: { id: f.agentId }, data: { metadata: {} } }));
      await withTenant(f.orgId, (db) => db.executionGrant.updateMany({ where: { orgId: f.orgId, consumedAt: null, voidedAt: null }, data: { voidedAt: new Date(), voidReason: "test cleanup" } }));
    }
  }, 60_000);
});

describe("database failure during a decision", () => {
  it("a failure while recording the decision leaves no request, decision or grant behind (fail closed)", async () => {
    const key = `dbfail-${Date.now().toString(36)}`;
    await expect(
      withTenant(f.orgId, async (db) => {
        const failing = new Proxy(db, {
          get(target, prop) {
            if (prop === "executionGrant") return { ...target.executionGrant, create: () => Promise.reject(new Error("injected: database connection lost")) };
            return Reflect.get(target, prop);
          },
        });
        return submitActionRequest(failing, f.agentCtx, { tool: "issue-refund", action: "execute", params: { orderId: "ORD-DBF", customerId: "CUST-1", amount: 80, currency: "AED" }, resource: "support-tickets", idempotencyKey: key, justification: "", principal: { type: "none" }, context: {}, executionMode: "agent" });
      }),
    ).rejects.toThrow(/injected/);
    const row = await withTenant(f.orgId, (db) => db.actionRequest.findFirst({ where: { orgId: f.orgId, idempotencyKey: key } }));
    expect(row).toBeNull();
  });
});

describe("credential rotation", () => {
  it("a rotated integration credential has a new version and secret; a revoked agent key stops working at once", async () => {
    const cred = await withTenant(f.orgId, (db) => db.credential.findFirstOrThrow({ where: { orgId: f.orgId, integrationId: f.integrationId } }));
    const rotated = await withTenant(f.orgId, (db) => rotateCredential(db, f.engineer.ctx, cred.id));
    const row = await withTenant(f.orgId, (db) => db.credential.findUniqueOrThrow({ where: { id: cred.id } }));
    expect(row.version).toBe(cred.version + 1);
    expect(row.secretEnc).not.toBe(cred.secretEnc);
    expect(decryptSecret(row.secretEnc, `credential:${row.id}:${row.name}`)).toMatch(/^sim-token-/);
    void rotated;
    const fresh = await withTenant(f.orgId, (db) => issueApiKey(db, f.engineer.ctx, { name: "rotation", subjectType: "agent", subjectId: f.agentId }));
    expect((await resolveApiKey(fresh.key))?.subjectId).toBe(f.agentId);
    await withTenant(f.orgId, (db) => revokeApiKey(db, f.engineer.ctx, fresh.record.id, "rotation test"));
    expect(await resolveApiKey(fresh.key)).toBeNull();
    const still = await f.call({ amount: 60 });
    expect(still.status).toBe("executed");
  });
});

describe("DNS pinning for event destinations", () => {
  const fake = (addrs: string[]) => async () => addrs.map((a) => ({ address: a, family: a.includes(":") ? 6 : 4 }));
  const run = (lookup: ReturnType<typeof pinnedLookup>, all = false) => new Promise<{ err: Error | null; addr: unknown }>((resolve) => lookup("hooks.example.com", { all } as never, ((err: Error | null, addr: unknown) => resolve({ err, addr })) as never));

  it("the address connected to is the address checked: private, loopback and metadata answers are refused at connect time", async () => {
    for (const bad of [["127.0.0.1"], ["169.254.169.254"], ["10.0.0.5"], ["93.184.216.34", "192.168.1.10"], ["::ffff:127.0.0.1"]]) {
      const r = await run(pinnedLookup(false, fake(bad)));
      expect(r.err?.message).toMatch(/private, loopback or metadata/);
    }
    const ok = await run(pinnedLookup(false, fake(["93.184.216.34"])));
    expect(ok.err).toBeNull();
    expect(ok.addr).toBe("93.184.216.34");
    const all = await run(pinnedLookup(false, fake(["93.184.216.34", "2606:2800:220:1::1"])), true);
    expect(Array.isArray(all.addr)).toBe(true);
    expect((await run(pinnedLookup(true, fake(["127.0.0.1"])))).err).toBeNull();
  });
});

describe("authorization outage at the gateway entry", () => {
  it("an agent of another organization cannot act in this one even with a valid context shape", async () => {
    const theirAgent = await withTenant(other.orgId, (db) => db.agent.create({ data: { orgId: other.orgId, slug: "intruder", name: "Intruder", status: "active" } }));
    const r = await authorizeAndExecute(withTenant, { ...f.agentCtx, actor: { type: "agent", id: theirAgent.id } }, { tool: "issue-refund", action: "execute", params: { orderId: "ORD-X", customerId: "C", amount: 10, currency: "AED" }, resource: "support-tickets", idempotencyKey: `x-${Date.now()}`, justification: "", principal: { type: "none" }, context: {}, executionMode: "gateway" }).catch((e: Error) => ({ status: "error", reasons: [e.message] }));
    expect(["denied", "error"]).toContain(r.status);
    const ledger = await f.ledger();
    expect(ledger.some((l) => (l as { orderId?: string }).orderId === "ORD-X")).toBe(false);
  });
});
