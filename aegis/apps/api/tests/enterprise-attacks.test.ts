import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { withTenant, rawPrisma, ownerPrisma, disconnectAll } from "@aegis/db";
import { activateVersion, API_KEY_SCOPES, assignPolicy, buildRefundPolicyDocument, createAgent, createIntegration, createPolicy, grantResourcePermission, pauseGateway, resumeGateway, setAgentTool, submitForReview, transitionAgent, upsertResource, upsertTool, createOrganization, issueApiKey, listUserMemberships, makeContext, registerUser, runSalesScenario, SALES_SCENARIOS, setupSalesDemo } from "@aegis/core";
import { buildApp } from "../src/app.js";

/**
 * Enterprise attack validation, black box over HTTP. Two organizations: a victim with months-like activity (the
 * synthetic sales demonstration: agents, policies, requests, approvals, security events, evidence) and an attacker
 * with its own owner, viewer, agent key and integration key. Every registered route is swept, so a route added
 * later is covered without editing this file.
 *
 * Invariants:
 * - Cross-tenant: whatever the attacker sends (victim ids in every path parameter, victim organization id in
 *   headers, query and body), the victim's rows are byte-for-byte unchanged and no victim id the attacker did not
 *   send appears in any response.
 * - No route answers 5xx to hostile input.
 * - Without credentials only the public routes answer 2xx.
 * - A viewer, an agent key and an integration key change nothing outside their allow-list.
 */
const PASSWORD = "CorrectHorse1Battery";
const stamp = `atk-${Date.now().toString(36)}`;
const domain = `${stamp}.example`;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

interface Route {
  method: string;
  url: string;
}
const routes: Route[] = [];
let app: FastifyInstance;

const victim = { orgId: "", ownerId: "", ids: new Set<string>(), byTable: new Map<string, string[]>() };
const attacker = { orgId: "", ownerCookie: "", viewerCookie: "", agentKeys: [] as string[], integrationKeys: [] as string[], userIds: [] as string[] };

let ipSeq = 0;
const nextIp = () => {
  ipSeq += 1;
  return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
};
let keySeq = 0;
const rotate = (keys: string[]) => keys[keySeq++ % keys.length]!;

async function login(email: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: PASSWORD }, remoteAddress: nextIp() });
  if (res.statusCode !== 200) throw new Error(`login ${email}: ${res.statusCode} ${res.body}`);
  const c = res.cookies.find((x) => x.name === "aegis_session")!;
  return `${c.name}=${c.value}`;
}

async function orgTables(): Promise<{ table: string; hasId: boolean }[]> {
  const rows = await ownerPrisma().$queryRawUnsafe<{ table_name: string; has_id: boolean }[]>(
    `SELECT c.table_name, bool_or(i.column_name IS NOT NULL) AS has_id
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema AND t.table_type = 'BASE TABLE'
       LEFT JOIN information_schema.columns i ON i.table_name = c.table_name AND i.table_schema = c.table_schema AND i.column_name = 'id'
      WHERE c.table_schema = 'public' AND c.column_name = 'org_id'
      GROUP BY c.table_name ORDER BY c.table_name`,
  );
  return rows.map((r) => ({ table: r.table_name, hasId: r.has_id }));
}

/** A digest of every row an organization owns, table by table (an API key's last-use time aside). */
async function fingerprint(orgId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const { table } of await orgTables()) {
    const [r] = await ownerPrisma().$queryRawUnsafe<{ n: bigint; h: string | null }[]>(`SELECT count(*) AS n, md5(string_agg((to_jsonb(x) - 'last_used_at')::text, '|' ORDER BY (to_jsonb(x) - 'last_used_at')::text)) AS h FROM "${table}" x WHERE x.org_id = $1::uuid`, orgId);
    out[table] = `${r!.n}:${r!.h ?? ""}`;
  }
  const [o] = await ownerPrisma().$queryRawUnsafe<{ h: string }[]>(`SELECT md5(x::text) AS h FROM organizations x WHERE x.id = $1::uuid`, orgId);
  out.organizations = o!.h;
  return out;
}

const changed = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]);

function fill(url: string, value: (param: string) => string): string {
  return url.replace(/:([A-Za-z]+)/g, (_m, p: string) => encodeURIComponent(value(p)));
}

interface Hit {
  method: string;
  url: string;
  status: number;
  leaked: string[];
}

async function send(r: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }): Promise<Hit> {
  const res = await app.inject({ method: r.method as "GET", url: r.url, headers: r.headers, payload: r.method === "GET" || r.method === "DELETE" ? undefined : (r.payload as object), remoteAddress: nextIp() });
  const sent = new Set(`${r.url} ${JSON.stringify(r.payload ?? {})} ${JSON.stringify(r.headers ?? {})}`.match(UUID_RE) ?? []);
  const leaked = [...new Set(res.body.match(UUID_RE) ?? [])].filter((id) => victim.ids.has(id) && !sent.has(id));
  return { method: r.method, url: r.url, status: res.statusCode, leaked };
}

const spoofHeaders = () => ({ "x-org-id": victim.orgId, "x-aegis-org": victim.orgId, "x-organization-id": victim.orgId });
const withQuery = (url: string) => `${url}${url.includes("?") ? "&" : "?"}orgId=${victim.orgId}&org=${victim.orgId}`;
const spoofBody = () => ({ orgId: victim.orgId, org_id: victim.orgId, organizationId: victim.orgId });

/** Public routes: they answer without credentials by design. */
const PUBLIC = [
  "GET /health",
  "GET /ready",
  "GET /metrics",
  "POST /v1/auth/login",
  "POST /v1/auth/logout",
  "POST /v1/auth/register",
  "POST /v1/auth/password-reset",
  // Answers { authenticated: false } to an anonymous caller.
  "GET /v1/auth/session-check",
];

beforeAll(async () => {
  app = await buildApp({ onRoute: (r) => (Array.isArray(r.method) ? r.method : [r.method]).forEach((m) => routes.push({ method: m, url: r.url })) });
  await app.ready();

  // Victim: a synthetic organization with real activity across the product.
  const vOwner = await registerUser({ email: `victim@${domain}`, name: "Victim Owner", password: PASSWORD });
  victim.ownerId = vOwner.id;
  const vOrg = await setupSalesDemo(vOwner.id);
  victim.orgId = vOrg.id;
  const vm = (await listUserMemberships(vOwner.id)).find((x) => x.orgId === vOrg.id)!;
  const vCtx = makeContext(vOrg.id, { type: "user", id: vOwner.id, permissions: vm.permissions, membershipId: vm.membershipId });
  for (const s of SALES_SCENARIOS) await runSalesScenario(vOrg.id, vCtx, s.key);
  await withTenant(vOrg.id, async (db) => {
    const { integration } = await createIntegration(db, vCtx, { key: "victim-crm", name: "Victim CRM", type: "custom", description: "" });
    await issueApiKey(db, vCtx, { name: "victim-int", subjectType: "integration", subjectId: integration.id });
  });
  for (const { table, hasId } of await orgTables()) {
    if (!hasId) continue;
    const rows = await ownerPrisma().$queryRawUnsafe<{ id: string }[]>(`SELECT id::text AS id FROM "${table}" WHERE org_id = $1::uuid ORDER BY id LIMIT 3`, vOrg.id);
    if (rows.length) victim.byTable.set(table, rows.map((r) => r.id));
  }
  const allIds = await Promise.all([...(await orgTables())].filter((t) => t.hasId).map((t) => ownerPrisma().$queryRawUnsafe<{ id: string }[]>(`SELECT id::text AS id FROM "${t.table}" WHERE org_id = $1::uuid`, vOrg.id)));
  for (const r of allIds.flat()) victim.ids.add(r.id);
  victim.ids.add(vOrg.id);
  victim.ids.add(vOwner.id);

  // Attacker: its own organization, owner, viewer, agent and integration.
  const aOwner = await registerUser({ email: `attacker@${domain}`, name: "Attacker Owner", password: PASSWORD });
  const aViewer = await registerUser({ email: `viewer@${domain}`, name: "Attacker Viewer", password: PASSWORD });
  attacker.userIds = [aOwner.id, aViewer.id];
  const aOrg = await createOrganization({ name: "Attacker Org", slug: stamp, ownerUserId: aOwner.id });
  attacker.orgId = aOrg.id;
  const am = (await listUserMemberships(aOwner.id)).find((x) => x.orgId === aOrg.id)!;
  const aCtx = makeContext(aOrg.id, { type: "user", id: aOwner.id, permissions: am.permissions, membershipId: am.membershipId });
  await withTenant(aOrg.id, async (db) => {
    const role = await db.role.findUniqueOrThrow({ where: { orgId_key: { orgId: aOrg.id, key: "viewer" } } });
    await db.membership.create({ data: { orgId: aOrg.id, userId: aViewer.id, roleId: role.id } });
    const agent = await createAgent(db, aCtx, { slug: "atk-agent", name: "Attacker Agent", environment: "development" });
    await transitionAgent(db, aCtx, agent.id, "registered", "ok");
    await transitionAgent(db, aCtx, agent.id, "active", "ok");
    await createPolicy(db, aCtx, { key: "atk-policy", name: "Attacker policy", description: "", category: "authorization", document: { version: 1, appliesTo: { tools: [], actions: [], environments: [] }, rules: [{ id: "allow-all", description: "", effect: "allow", when: { attr: "action", op: "exists" }, reason: "allow", riskIndicators: [] }], tests: [] }, changeNote: "attacker" });
    const { integration } = await createIntegration(db, aCtx, { key: "atk-int", name: "Attacker integration", type: "custom", description: "" });
    for (let i = 0; i < 12; i++) {
      attacker.agentKeys.push((await issueApiKey(db, aCtx, { name: `a${i}`, subjectType: "agent", subjectId: agent.id })).key);
      attacker.integrationKeys.push((await issueApiKey(db, aCtx, { name: `i${i}`, subjectType: "integration", subjectId: integration.id, scopes: Object.keys(API_KEY_SCOPES) })).key);
    }
  });
  attacker.ownerCookie = await login(`attacker@${domain}`);
  attacker.viewerCookie = await login(`viewer@${domain}`);
}, 300_000);

afterAll(async () => {
  await app?.close();
  for (const id of [victim.orgId, attacker.orgId].filter(Boolean)) await ownerPrisma().organization.delete({ where: { id } }).catch(() => undefined);
  await rawPrisma().user.deleteMany({ where: { email: { endsWith: `@${domain}` } } }).catch(() => undefined);
  await disconnectAll();
});

// Signing out would end the session the sweep is using; it is covered by the auth tests.
const sweepRoutes = () => routes.filter((r) => r.method !== "HEAD" && r.method !== "OPTIONS" && r.url !== "/v1/auth/logout");
const victimIdPool = () => [...victim.byTable.values()].map((ids) => ids[0]!);
const as = {
  owner: () => ({ cookie: attacker.ownerCookie }),
  viewer: () => ({ cookie: attacker.viewerCookie }),
  agent: () => ({ authorization: `Bearer ${rotate(attacker.agentKeys)}` }),
  integration: () => ({ authorization: `Bearer ${rotate(attacker.integrationKeys)}` }),
};

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
  const g = { refundKey: "", otherKey: "", agentId: "", otherAgentId: "", ownerCtx: null as unknown as ReturnType<typeof makeContext> };
  let n = 0;
  const order = () => `ORD-ATK-${Date.now().toString(36)}-${++n}`;
  const refund = (amount: unknown, extra: Record<string, unknown> = {}) => ({ tool: "issue-refund", action: "execute", resource: "support-tickets", executionMode: "agent", idempotencyKey: `atk-${randomUUID()}`, params: { orderId: order(), customerId: "CUST-1", amount, currency: "AED" }, ...extra });
  const submit = async (key: string, payload: unknown, raw = false) => {
    const res = await app.inject({ method: "POST", url: "/v1/gateway/actions", headers: { authorization: `Bearer ${key}`, ...(raw ? { "content-type": "application/json" } : {}) }, payload: raw ? (payload as string) : (payload as object), remoteAddress: nextIp() });
    return { status: res.statusCode, body: res.json() as { requestId?: string; decision?: string; status?: string } };
  };
  const notAllowed = (r: { status: number; body: { decision?: string } }) => r.status !== 200 && r.body.decision !== "allow" && r.body.decision !== "restrict";

  beforeAll(async () => {
    const owner = ownerPrisma();
    const aOwner = await owner.user.findFirstOrThrow({ where: { email: `attacker@${domain}` } });
    const m = (await listUserMemberships(aOwner.id)).find((x) => x.orgId === attacker.orgId)!;
    g.ownerCtx = makeContext(attacker.orgId, { type: "user", id: aOwner.id, permissions: m.permissions, membershipId: m.membershipId });
    const ctx = g.ownerCtx;
    await withTenant(attacker.orgId, async (db) => {
      const integration = await db.integration.findFirstOrThrow({ where: { key: "atk-int" } });
      const tool = await upsertTool(db, ctx, { key: "issue-refund", name: "Issue refund", description: "", integrationId: integration.id, riskLevel: "high", parameterSchema: { type: "object", required: ["orderId", "customerId", "amount", "currency"], properties: { orderId: { type: "string" }, customerId: { type: "string" }, amount: { type: "number", minimum: 0 }, currency: { type: "string" } }, additionalProperties: false }, destinationRules: { allowedDomains: [], allowedResourceKeys: ["support-tickets"] } });
      const resource = await upsertResource(db, ctx, { key: "support-tickets", name: "Tickets", type: "application", classification: "internal", attributes: {} });
      const ids: string[] = [];
      for (const slug of ["atk-refund-agent", "atk-other-agent"]) {
        const a = await createAgent(db, ctx, { slug, name: slug, description: "", environment: "production", modelProvider: "x", modelId: "y", dataClassificationLimit: "confidential", riskTier: "high", metadata: {} });
        await setAgentTool(db, ctx, a.id, tool.id, true);
        await grantResourcePermission(db, ctx, a.id, resource.id, ["read", "write", "execute"]);
        await transitionAgent(db, ctx, a.id, "registered", "ok");
        await transitionAgent(db, ctx, a.id, "active", "ok");
        ids.push(a.id);
      }
      [g.agentId, g.otherAgentId] = ids as [string, string];
      g.refundKey = (await issueApiKey(db, ctx, { name: "refund", subjectType: "agent", subjectId: g.agentId })).key;
      g.otherKey = (await issueApiKey(db, ctx, { name: "other", subjectType: "agent", subjectId: g.otherAgentId })).key;
      const document = buildRefundPolicyDocument({ tools: ["issue-refund"], currency: "AED", allowedCurrencies: [], autoApproveBelow: 500, approvalUpTo: 2500, approverRoles: ["approver", "owner"], minApprovers: 1, approvalExpiresMinutes: 240, separationOfDuties: true, blockDuplicates: true, duplicateHandling: "deny", requireReason: false, businessHoursOnly: { enabled: false, startHourUtc: 4, endHourUtc: 14 }, maxDailyDeniedAttempts: 1000 });
      const { policy, version } = await createPolicy(db, ctx, { key: "refund-authority", name: "Refund authority", description: "", category: "authorization", document, changeNote: "attack suite" });
      await submitForReview(db, ctx, version.id);
      await activateVersion(db, ctx, version.id, { fourEyes: false });
      for (const id of ids) await assignPolicy(db, ctx, policy.id, { targetType: "agent", targetId: id, priority: 100 });
    });
    const ok = await submit(g.refundKey, refund(100));
    if (ok.status !== 200) throw new Error(`baseline refund not allowed: ${JSON.stringify(ok)}`);
  }, 120_000);

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
