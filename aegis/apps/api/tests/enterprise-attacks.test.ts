import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, ownerPrisma } from "@aegis/db";
import { pauseGateway, resumeGateway, transitionAgent } from "@aegis/core";
import { app, as, attacker, gateway, refundWorld, setupRefundAgents, changed, fill, fingerprint, nextIp, orgTables, PUBLIC, send, setupWorld, spoofBody, spoofHeaders, sweepRoutes, teardownWorld, victim, victimIdPool, withQuery, type Hit } from "./attack-harness.js";

/**
 * Enterprise attack validation, black box over HTTP, in the two-organization world of attack-harness.ts.
 *
 * Invariants:
 * - Cross-tenant: whatever the attacker sends (victim ids in every path parameter, victim organization id in
 *   headers, query and body), the victim's rows are byte-for-byte unchanged and no victim id the attacker did not
 *   send appears in any response.
 * - No route answers 5xx to hostile input.
 * - Without credentials only the public routes answer 2xx.
 * - A viewer, an agent key and an integration key change nothing outside their allow-list.
 *
 * Passing shows resistance to these attacks, not to every attack.
 */
beforeAll(setupWorld, 300_000);
afterAll(teardownWorld);

describe("cross-tenant: the attacker organization against the victim", () => {
  it("every route, every principal, victim ids in every parameter and spoofed organization headers: nothing changes and nothing leaks", async () => {
    const before = await fingerprint(victim.orgId);
    const hits: Hit[] = [];
    const pool = victimIdPool();
    for (const r of sweepRoutes()) {
      const hasParams = r.url.includes(":");
      for (const [who, auth] of Object.entries(as)) {
        // The most privileged principal gets one id of every kind the victim owns; the others an agent and a request id.
        const candidates = hasParams ? (who === "owner" ? pool : [victim.byTable.get("agents")![0]!, victim.byTable.get("action_requests")![0]!]) : [""];
        for (const id of candidates) {
          const url = withQuery(fill(r.url, (p) => (p === "key" || p === "integrationKey" ? "victim-crm" : p === "seq" ? "1" : id)));
          hits.push(await send({ method: r.method, url, headers: { ...auth(), ...spoofHeaders() }, payload: spoofBody() }));
        }
      }
    }
    const after = await fingerprint(victim.orgId);
    const byStatus: Record<string, number> = {};
    for (const h of hits) byStatus[h.status] = (byStatus[h.status] ?? 0) + 1;
    console.log(`cross-tenant sweep: ${sweepRoutes().length} routes, ${hits.length} requests, statuses ${JSON.stringify(byStatus)}`);
    // The sweep is only evidence if the requests reached the handlers: none rate limited, and the attacker's own
    // reads succeeded (so the sessions and keys were live throughout).
    expect(byStatus["429"] ?? 0).toBe(0);
    expect(hits.filter((h) => h.status === 200).length).toBeGreaterThan(100);
    expect(changed(before, after)).toEqual([]);
    expect(hits.filter((h) => h.leaked.length).map((h) => `${h.method} ${h.url} -> ${h.leaked.join(",")}`)).toEqual([]);
    expect(hits.filter((h) => h.status >= 500).map((h) => `${h.status} ${h.method} ${h.url}`)).toEqual([]);
  }, 900_000);
});

describe("cross-tenant: well-formed requests that name the victim's objects", () => {
  it("the attacker owner cannot approve, assign, delegate, review, freeze, test or revoke anything of the victim's", async () => {
    const owner = ownerPrisma();
    const vAgent = (await owner.agent.findFirstOrThrow({ where: { orgId: victim.orgId, isLab: false, status: "active" } })).id;
    const vApproval = await owner.approvalRequest.findFirstOrThrow({ where: { orgId: victim.orgId, status: "pending" } });
    const vTool = (await owner.tool.findFirstOrThrow({ where: { orgId: victim.orgId } })).id;
    const vRequest = vApproval.actionRequestId;
    const aPolicy = await owner.policy.findFirstOrThrow({ where: { orgId: attacker.orgId } });
    const aAgent = (await owner.agent.findFirstOrThrow({ where: { orgId: attacker.orgId } })).id;
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const attacks: [string, string, Record<string, unknown>][] = [
      ["POST", `/v1/approvals/${vApproval.id}/decide`, { decision: "approve", comment: "cross-tenant", requestHash: vApproval.requestHash }],
      ["POST", `/v1/identity/access-requests`, { agentId: vAgent, toolId: vTool, reason: "cross-tenant attempt here", durationHours: 1 }],
      ["POST", `/v1/identity/delegations`, { delegatorAgentId: vAgent, delegateAgentId: aAgent, reason: "cross-tenant", expiresInHours: 1 }],
      ["POST", `/v1/identity/delegations`, { delegatorAgentId: aAgent, delegateAgentId: vAgent, reason: "cross-tenant", expiresInHours: 1 }],
      ["POST", `/v1/identity/agents/${vAgent}/emergency-revoke`, { mode: "suspend", reason: "cross-tenant attempt" }],
      ["POST", `/v1/identity/discovery/agents/${randomUUID()}/resolve`, { action: "link", agentId: vAgent }],
      ["POST", `/v1/autonomy/agents/${vAgent}/lower`, { level: 0, reason: "cross-tenant attempt" }],
      ["POST", `/v1/autonomy/agents/${vAgent}/raise-requests`, { level: 4, reason: "cross-tenant attempt" }],
      ["POST", `/v1/lab/runs`, { targetAgentId: vAgent }],
      ["PUT", `/v1/lab/schedule`, { enabled: true, agentIds: [vAgent], everyHours: 24 }],
      ["POST", `/v1/lab/custom-scenarios`, { key: "cross-tenant", name: "Cross tenant", definition: { expected: "deny", target: { agentIds: [vAgent] } } }],
      ["POST", `/v1/pilots/agents/${vAgent}/watch-only`, { enabled: true, reason: "cross-tenant" }],
      ["POST", `/v1/gateway/freezes`, { title: "Cross tenant", reason: "cross-tenant attempt", startsAt: new Date().toISOString(), endsAt: soon, agentIds: [vAgent] }],
      ["POST", `/v1/access-reviews`, { title: "Cross tenant", agentIds: [vAgent] }],
      ["POST", `/v1/gateway/actions/${vRequest}/quarantine`, { reason: "cross-tenant attempt" }],
      ["POST", `/v1/gateway/approvals/${vApproval.id}/info`, { answers: { x: "y" } }],
      ["POST", `/v1/policies/${aPolicy.id}/assignments`, { targetType: "agent", targetId: vAgent, priority: 1 }],
      ["POST", `/v1/policies/${aPolicy.id}/assignments`, { targetType: "team", targetId: victim.byTable.get("teams")?.[0] ?? randomUUID(), priority: 1 }],
    ];
    const before = await fingerprint(victim.orgId);
    const answered: string[] = [];
    for (const [method, url, payload] of attacks) {
      const h = await send({ method, url, headers: as.owner(), payload });
      if (h.status < 400 || h.status >= 500 || h.leaked.length) answered.push(`${h.status} ${method} ${url} ${h.leaked.join(",")}`);
    }
    // The agent and integration keys try the request-level routes.
    for (const [method, url, auth] of [
      ["GET", `/v1/gateway/actions/${vRequest}`, as.agent],
      ["POST", `/v1/gateway/actions/${vRequest}/grant`, as.agent],
      ["POST", `/v1/gateway/actions/${vRequest}/start`, as.agent],
      ["POST", `/v1/gateway/actions/${vRequest}/execute`, as.agent],
      ["GET", `/v1/gateway/actions/${vRequest}`, as.integration],
    ] as const) {
      const h = await send({ method, url, headers: auth(), payload: method === "POST" ? { outcome: "succeeded", result: {} } : undefined });
      if (h.status < 400 || h.status >= 500 || h.leaked.length) answered.push(`${h.status} ${method} ${url} ${h.leaked.join(",")}`);
    }
    expect(answered).toEqual([]);
    expect(changed(before, await fingerprint(victim.orgId))).toEqual([]);
    // Nothing in the attacker's organization now points at a victim object.
    const refs: string[] = [];
    for (const { table } of await orgTables()) {
      const [r] = await owner.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}" x WHERE x.org_id = $1::uuid AND (to_jsonb(x)::text LIKE '%' || $2 || '%' OR to_jsonb(x)::text LIKE '%' || $3 || '%')`, attacker.orgId, vAgent, vApproval.id);
      if (r!.n > 0n) refs.push(table);
    }
    expect(refs).toEqual([]);
  }, 120_000);
});

describe("tool-call manipulation and policy enforcement through the gateway", () => {
  // The attacker organization's own refund agent, under the refund policy: up to 500 alone, 500 to 2,500 with an
  // approver, above 2,500 refused, a second refund for the same order refused. A compromised agent key tries to
  // get past it.
  const g = refundWorld;
  const { order, refund, submit, notAllowed } = gateway;
  beforeAll(setupRefundAgents, 120_000);

  it("amount type confusion, negative and non-finite amounts never pass the limit", async () => {
    for (const amount of ["9999", [1, 9999], { value: 1 }, -5000, 1e21, null, true, "1e3", " 100"]) {
      const r = await submit(g.refundKey, refund(amount));
      expect(notAllowed(r), JSON.stringify({ amount, r })).toBe(true);
    }
    expect((await submit(g.refundKey, refund(3000))).body.decision).toBe("deny");
    expect((await submit(g.refundKey, refund(1000))).body.decision).toBe("require_approval");
  });

  it("prototype pollution and duplicate keys in the raw JSON cannot lower the amount", async () => {
    const base = refund(9999) as { params: Record<string, unknown> };
    const json = JSON.stringify(base);
    const variants = [
      json.replace('"amount":9999', '"__proto__":{"amount":1},"amount":9999'),
      json.replace('"amount":9999', '"constructor":{"prototype":{"amount":1}},"amount":9999'),
      json.replace('"amount":9999', '"amount":1,"amount":9999'),
      json.replace('"params":{', '"__proto__":{"params":{"amount":1}},"params":{'),
    ];
    for (const v of variants) {
      const r = await submit(g.refundKey, v, true);
      expect(notAllowed(r), v).toBe(true);
      expect(r.status).toBeLessThan(500);
    }
    // Duplicate keys: the last value is the one decided on, hashed into the grant and sent downstream.
    const dup = await submit(g.refundKey, json.replace('"amount":9999', '"amount":9999,"amount":1').replace(/"idempotencyKey":"[^"]+"/, `"idempotencyKey":"atk-${randomUUID()}"`), true);
    if (dup.body.requestId) {
      const row = await ownerPrisma().actionRequest.findUniqueOrThrow({ where: { id: dup.body.requestId } });
      expect((row.params as { amount: number }).amount).toBe(1);
    }
  });

  it("look-alike tool names are unknown tools, not the refund tool", async () => {
    for (const tool of ["Issue-Refund", "issue-refund ", " issue-refund", "issue_refund", "issue-refund\u0000", "\u0456ssue-refund", "issue-refund\u200b"]) {
      const r = await submit(g.refundKey, { ...refund(100), tool });
      expect(r.body.decision === "allow", tool).toBe(false);
      expect(r.status).toBeLessThan(500);
    }
  });

  it("identity, organization and execution fields in the body are ignored: the key decides who is asking", async () => {
    const r = await submit(g.refundKey, refund(100, { agentId: g.otherAgentId, orgId: victim.orgId, actor: { type: "user", permissions: ["*"] }, isLab: true, context: { lab: true, approved: true, aegisOverride: true } }));
    expect(r.status).toBe(200);
    const row = await ownerPrisma().actionRequest.findUniqueOrThrow({ where: { id: r.body.requestId! }, include: { agent: true } });
    expect(row.orgId).toBe(attacker.orgId);
    expect(row.agentId).toBe(g.agentId);
    expect(row.agent.isLab).toBe(false);
    // Context flags change nothing: the same body over the limit is still refused.
    const big = await submit(g.refundKey, refund(9999, { context: { lab: true, approved: true, aegisOverride: true, policyOverride: "allow" } }));
    expect(big.body.decision).toBe("deny");
  });

  it("an idempotency key replayed with larger parameters does not reuse the earlier allow", async () => {
    const first = refund(100);
    const a = await submit(g.refundKey, first);
    expect(a.status).toBe(200);
    const b = await submit(g.refundKey, { ...first, params: { ...first.params, amount: 9999 } });
    expect(notAllowed(b) || b.body.requestId === a.body.requestId).toBe(true);
    const row = await ownerPrisma().actionRequest.findUniqueOrThrow({ where: { id: a.body.requestId! } });
    expect((row.params as { amount: number }).amount).toBe(100);
    // If the replay returned the first request, the grant it leads to is bound to amount 100.
    if (b.body.requestId === a.body.requestId) expect(b.body.decision).toBe("allow");
  });

  it("a grant is bound to its parameters, its integration and one use; another agent cannot fetch it", async () => {
    const body = refund(200);
    const a = await submit(g.refundKey, body);
    expect(a.status).toBe(200);
    const id = a.body.requestId!;
    const stolen = await app.inject({ method: "POST", url: `/v1/gateway/actions/${id}/grant`, headers: { authorization: `Bearer ${g.otherKey}` }, remoteAddress: nextIp() });
    expect(stolen.statusCode).toBeGreaterThanOrEqual(400);
    // The allow carried the single live grant; asking for a second one is refused.
    const token = (a.body as { grant?: { token: string } }).grant!.token;
    const second = await app.inject({ method: "POST", url: `/v1/gateway/actions/${id}/grant`, headers: { authorization: `Bearer ${g.refundKey}` }, remoteAddress: nextIp() });
    expect(second.statusCode).toBe(409);
    const verify = (params: unknown, key = attacker.integrationKeys[0]!) => app.inject({ method: "POST", url: "/v1/gateway/grants/verify", headers: { authorization: `Bearer ${key}` }, payload: { grant: token, toolKey: "issue-refund", action: "execute", params }, remoteAddress: nextIp() });
    expect((await verify({ ...body.params, amount: 20000 })).statusCode).toBe(403);
    expect((await verify({ ...body.params, orderId: "ORD-OTHER" })).statusCode).toBe(403);
    expect((await verify({ ...body.params, amount: 200, extra: "x" })).statusCode).toBe(403);
    expect((await verify(body.params)).statusCode).toBe(200);
    expect((await verify(body.params)).statusCode).toBe(403);
  });

  it("a held request yields no grant, and the agent cannot approve it", async () => {
    const a = await submit(g.refundKey, refund(1000));
    expect(a.status).toBe(202);
    const grant = await app.inject({ method: "POST", url: `/v1/gateway/actions/${a.body.requestId}/grant`, headers: { authorization: `Bearer ${g.refundKey}` }, remoteAddress: nextIp() });
    expect(grant.statusCode).toBeGreaterThanOrEqual(400);
    const approval = await ownerPrisma().approvalRequest.findFirstOrThrow({ where: { actionRequestId: a.body.requestId! } });
    const decide = await app.inject({ method: "POST", url: `/v1/approvals/${approval.id}/decide`, headers: { authorization: `Bearer ${g.refundKey}` }, payload: { decision: "approve", comment: "self", requestHash: approval.requestHash }, remoteAddress: nextIp() });
    expect(decide.statusCode).toBe(403);
    expect((await ownerPrisma().approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("pending");
  });

  it("a second refund for the same order is refused", async () => {
    const first = refund(50);
    expect((await submit(g.refundKey, first)).status).toBe(200);
    const again = await submit(g.refundKey, { ...first, idempotencyKey: `atk-${randomUUID()}` });
    expect(again.body.decision).toBe("deny");
  });

  it("oversized and deeply nested parameters are refused without a server error", async () => {
    const big = await submit(g.refundKey, refund(100, { justification: "x".repeat(2 * 1024 * 1024) }));
    expect(big.status).toBe(413);
    let nested: unknown = 1;
    for (let i = 0; i < 2000; i++) nested = { a: nested };
    const deep = await submit(g.refundKey, { ...refund(100), params: { orderId: order(), customerId: "C", amount: 100, currency: "AED", deep: nested } });
    expect(deep.status).toBe(400);
  });

  it("a paused gateway and a suspended agent allow nothing", async () => {
    await withTenant(attacker.orgId, (db) => pauseGateway(db, g.ownerCtx, "attack suite"));
    try {
      expect((await submit(g.refundKey, refund(10))).body.decision).not.toBe("allow");
    } finally {
      await withTenant(attacker.orgId, (db) => resumeGateway(db, g.ownerCtx, "attack suite done"));
    }
    expect((await submit(g.refundKey, refund(10))).status).toBe(200);
    await withTenant(attacker.orgId, (db) => transitionAgent(db, g.ownerCtx, g.otherAgentId, "suspended", "attack suite"));
    const r = await submit(g.otherKey, refund(10));
    expect(notAllowed(r)).toBe(true);
  });
});

describe("authorization: who may do what", () => {
  it("without credentials only public routes answer 2xx, and nothing answers 5xx", async () => {
    const bad: string[] = [];
    for (const r of sweepRoutes()) {
      const h = await send({ method: r.method, url: fill(r.url, () => randomUUID()), payload: {} });
      if ((h.status < 300 && !PUBLIC.includes(`${r.method} ${r.url}`)) || h.status >= 500) bad.push(`${h.status} ${r.method} ${r.url}`);
    }
    expect(bad).toEqual([]);
  }, 300_000);

  // What each principal may write. A viewer may verify the evidence chain (a read that records that it ran);
  // a failed webhook signature is recorded as evidence. Nothing else.
  const ALLOWED_WRITES: Record<"viewer" | "agent" | "integration", string[]> = { viewer: ["POST /v1/assurance/evidence/verify"], agent: [], integration: [] };
  const ALLOWED_EVIDENCE: Record<"viewer" | "agent" | "integration", string[]> = { viewer: ["evidence.verified"], agent: [], integration: ["webhook.rejected"] };

  it("a viewer, an agent key and an integration key cannot change anything through any write route", async () => {
    const report: Record<string, string[]> = {};
    for (const who of ["viewer", "agent", "integration"] as const) {
      const since = (await ownerPrisma().evidenceEvent.aggregate({ where: { orgId: attacker.orgId }, _max: { seq: true } }))._max.seq ?? -1n;
      const before = await fingerprint(attacker.orgId);
      const bad: string[] = [];
      for (const r of sweepRoutes().filter((x) => x.method !== "GET")) {
        const h = await send({ method: r.method, url: fill(r.url, () => randomUUID()), headers: as[who](), payload: {} });
        if ((h.status < 300 && !ALLOWED_WRITES[who].includes(`${r.method} ${r.url}`)) || h.status >= 500) bad.push(`${h.status} ${r.method} ${r.url}`);
      }
      const after = await fingerprint(attacker.orgId);
      const events = await ownerPrisma().evidenceEvent.findMany({ where: { orgId: attacker.orgId, seq: { gt: since } }, select: { type: true } });
      const unexpected = [...new Set(events.map((e) => e.type))].filter((t) => !ALLOWED_EVIDENCE[who].includes(t));
      report[who] = [...bad, ...changed(before, after).filter((t) => t !== "evidence_events").map((t) => `changed ${t}`), ...unexpected.map((t) => `evidence ${t}`)];
    }
    expect(report).toEqual({ viewer: [], agent: [], integration: [] });
  }, 300_000);

  it("hostile bodies on every write route (NUL characters, deep nesting, wrong types) never cause a server error", async () => {
    let deep: unknown = "x";
    for (let i = 0; i < 300; i++) deep = i % 2 ? { a: deep } : [deep];
    const bodies: unknown[] = [{ name: "a\u0000b", key: "k\u0000", reason: "x\u0000y" }, { document: deep, definition: deep, settings: deep, params: deep }, ["not", "an", "object"], { id: 1, agentIds: "x", enabled: "yes", level: "high" }];
    const bad: string[] = [];
    for (const r of sweepRoutes().filter((x) => x.method !== "GET")) {
      for (const payload of bodies) {
        const h = await send({ method: r.method, url: fill(r.url, () => randomUUID()), headers: as.owner(), payload });
        if (h.status >= 500) bad.push(`${h.status} ${r.method} ${r.url}`);
      }
    }
    expect(bad).toEqual([]);
  }, 300_000);

  it("an agent key reads only its own requests and identity", async () => {
    const ok: string[] = [];
    for (const r of sweepRoutes().filter((x) => x.method === "GET" && !x.url.includes(":"))) {
      const h = await send({ method: "GET", url: r.url, headers: as.agent() });
      if (h.status < 300) ok.push(r.url);
    }
    // Policies, approvals, evidence and the lab stay closed: an agent cannot learn its own thresholds.
    expect(ok.sort()).toEqual(["/health", "/ready", "/v1/agents/me", "/v1/auth/session-check", "/v1/gateway/actions", "/v1/policies/insights/templates"].sort());
  }, 300_000);
});
