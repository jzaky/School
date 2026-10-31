import type { FastifyInstance } from "fastify";
import { withTenant, rawPrisma, ownerPrisma, disconnectAll } from "@aegis/db";
import { activateVersion, API_KEY_SCOPES, assignPolicy, buildRefundPolicyDocument, createAgent, createIntegration, createOrganization, createPolicy, grantResourcePermission, issueApiKey, listUserMemberships, makeContext, registerUser, runSalesScenario, SALES_SCENARIOS, setAgentTool, setupSalesDemo, submitForReview, transitionAgent, upsertResource, upsertTool } from "@aegis/core";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";

/**
 * The two-organization world the enterprise attack suites share (tests/enterprise-attacks*.test.ts). A victim with
 * realistic activity (the synthetic sales demonstration: agents, policies, requests, approvals, security events,
 * evidence) and an attacker with its own owner, viewer, agent keys and integration keys. Every registered route is
 * collected at start-up, so a route added later is attacked without editing the suites.
 */
export const PASSWORD = "CorrectHorse1Battery";
export const stamp = `atk-${Date.now().toString(36)}`;
export const domain = `${stamp}.example`;
export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export interface Route {
  method: string;
  url: string;
}
export const routes: Route[] = [];
export let app: FastifyInstance;

export const victim = { orgId: "", ownerId: "", ids: new Set<string>(), byTable: new Map<string, string[]>() };
export const attacker = { byTable: new Map<string, string[]>(), orgId: "", ownerCookie: "", viewerCookie: "", agentKeys: [] as string[], integrationKeys: [] as string[], userIds: [] as string[] };

let ipSeq = 0;
export const nextIp = () => {
  ipSeq += 1;
  return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
};
let keySeq = 0;
export const rotate = (keys: string[]) => keys[keySeq++ % keys.length]!;

export async function login(email: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: PASSWORD }, remoteAddress: nextIp() });
  if (res.statusCode !== 200) throw new Error(`login ${email}: ${res.statusCode} ${res.body}`);
  const c = res.cookies.find((x) => x.name === "aegis_session")!;
  return `${c.name}=${c.value}`;
}

export async function orgTables(): Promise<{ table: string; hasId: boolean }[]> {
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

/** A digest of every row an organization owns, table by table. Bookkeeping times (last use, last activity, updated) are left out. */
export async function fingerprint(orgId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const { table } of await orgTables()) {
    const [r] = await ownerPrisma().$queryRawUnsafe<{ n: bigint; h: string | null }[]>(`SELECT count(*) AS n, md5(string_agg((to_jsonb(x) - 'last_used_at' - 'last_activity_at' - 'updated_at')::text, '|' ORDER BY (to_jsonb(x) - 'last_used_at' - 'last_activity_at' - 'updated_at')::text)) AS h FROM "${table}" x WHERE x.org_id = $1::uuid`, orgId);
    out[table] = `${r!.n}:${r!.h ?? ""}`;
  }
  const [o] = await ownerPrisma().$queryRawUnsafe<{ h: string }[]>(`SELECT md5(x::text) AS h FROM organizations x WHERE x.id = $1::uuid`, orgId);
  out.organizations = o!.h;
  return out;
}

/** Up to three ids per tenant table of an organization, by table name. */
export async function indexIds(orgId: string, into: Map<string, string[]>): Promise<void> {
  into.clear();
  for (const { table, hasId } of await orgTables()) {
    if (!hasId) continue;
    const rows = await ownerPrisma().$queryRawUnsafe<{ id: string }[]>(`SELECT id::text AS id FROM "${table}" WHERE org_id = $1::uuid ORDER BY id LIMIT 3`, orgId);
    if (rows.length) into.set(table, rows.map((r) => r.id));
  }
}

export const changed = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]);

export function fill(url: string, value: (param: string) => string): string {
  return url.replace(/:([A-Za-z]+)/g, (_m, p: string) => encodeURIComponent(value(p)));
}

export interface Hit {
  method: string;
  url: string;
  status: number;
  leaked: string[];
  body: string;
}

export async function send(r: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }): Promise<Hit> {
  const res = await app.inject({ method: r.method as "GET", url: r.url, headers: r.headers, payload: r.method === "GET" || r.method === "DELETE" ? undefined : (r.payload as object), remoteAddress: nextIp() });
  const sent = new Set(`${r.url} ${JSON.stringify(r.payload ?? {})} ${JSON.stringify(r.headers ?? {})}`.match(UUID_RE) ?? []);
  const leaked = [...new Set(res.body.match(UUID_RE) ?? [])].filter((id) => victim.ids.has(id) && !sent.has(id));
  return { method: r.method, url: r.url, status: res.statusCode, leaked, body: res.body };
}

export const spoofHeaders = () => ({ "x-org-id": victim.orgId, "x-aegis-org": victim.orgId, "x-organization-id": victim.orgId });
export const withQuery = (url: string) => `${url}${url.includes("?") ? "&" : "?"}orgId=${victim.orgId}&org=${victim.orgId}`;
export const spoofBody = () => ({ orgId: victim.orgId, org_id: victim.orgId, organizationId: victim.orgId });

/** Public routes: they answer without credentials by design. */
export const PUBLIC = [
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

export async function setupWorld(): Promise<void> {
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
  await indexIds(vOrg.id, victim.byTable);
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
  await indexIds(aOrg.id, attacker.byTable);
  attacker.ownerCookie = await login(`attacker@${domain}`);
  attacker.viewerCookie = await login(`viewer@${domain}`);
}

export async function teardownWorld(): Promise<void> {
  await app?.close();
  for (const id of [victim.orgId, attacker.orgId].filter(Boolean)) await ownerPrisma().organization.delete({ where: { id } }).catch(() => undefined);
  await rawPrisma().user.deleteMany({ where: { email: { endsWith: `@${domain}` } } }).catch(() => undefined);
  await disconnectAll();
}

// Signing out would end the session the sweep is using; it is covered by the auth tests.
export const sweepRoutes = () => routes.filter((r) => r.method !== "HEAD" && r.method !== "OPTIONS" && r.url !== "/v1/auth/logout");
export const victimIdPool = () => [...victim.byTable.values()].map((ids) => ids[0]!);
export const as = {
  owner: () => ({ cookie: attacker.ownerCookie }),
  viewer: () => ({ cookie: attacker.viewerCookie }),
  agent: () => ({ authorization: `Bearer ${rotate(attacker.agentKeys)}` }),
  integration: () => ({ authorization: `Bearer ${rotate(attacker.integrationKeys)}` }),
};

let orderSeq = 0;
const order = () => `ORD-ATK-${Date.now().toString(36)}-${++orderSeq}`;
const refund = (amount: unknown, extra: Record<string, unknown> = {}) => ({ tool: "issue-refund", action: "execute", resource: "support-tickets", executionMode: "agent", idempotencyKey: `atk-${randomUUID()}`, params: { orderId: order(), customerId: "CUST-1", amount, currency: "AED" }, ...extra });
const submit = async (key: string, payload: unknown, raw = false) => {
  const res = await app.inject({ method: "POST", url: "/v1/gateway/actions", headers: { authorization: `Bearer ${key}`, ...(raw ? { "content-type": "application/json" } : {}) }, payload: raw ? (payload as string) : (payload as object), remoteAddress: nextIp() });
  return { status: res.statusCode, body: res.json() as { requestId?: string; decision?: string; status?: string } };
};
const notAllowed = (r: { status: number; body: { decision?: string } }) => r.status !== 200 && r.body.decision !== "allow" && r.body.decision !== "restrict";

/** Gateway helpers for the attacker organization's refund agents (setupRefundAgents). */
export const gateway = { order, refund, submit, notAllowed };

/**
 * The attacker organization's own refund agents under the refund policy: up to 500 alone, 500 to 2,500 with an
 * approver, above 2,500 refused, a second refund for the same order refused. A compromised agent key tries to get
 * past it.
 */
export const refundWorld = { refundKey: "", otherKey: "", agentId: "", otherAgentId: "", ownerCtx: null as unknown as ReturnType<typeof makeContext> };

export async function setupRefundAgents(): Promise<void> {
  const g = refundWorld;
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
}
