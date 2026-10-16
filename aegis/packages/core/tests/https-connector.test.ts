/**
 * The generic HTTPS connector through the real gateway, against a stand-in customer adapter that
 * implements the AEGIS execution protocol v1 and checks every signature. What "the customer system
 * holds" is read from the adapter's own records.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { withTenant, type TenantDb } from "@aegis/db";
import { addUserWithRole, makeTestTenant, type TestTenant } from "./helpers.js";
import { createAgent, grantResourcePermission, setAgentTool, transitionAgent, upsertResource, upsertTool } from "../src/agents/registry.js";
import { createIntegration, storeCredential, testIntegrationConnection } from "../src/integrations/service.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../src/policy/service.js";
import { makeContext, type OrgContext } from "../src/lib/context.js";
import { authorizeAndExecute, reconcileExecution, type GatewayResponse } from "../src/gateway/gateway.js";
import { auditEnforcementPath } from "../src/gateway/enforcement.js";
import { resolveDownstreamSystem } from "../src/gateway/simulators.js";
import { BEARER_TOKEN, HTTPS_SYSTEM_KEY, SIGNING_SECRET, classify, httpsConnector } from "../src/gateway/connectors/https.js";
import { env } from "../src/env.js";

const SECRET = "adapter-signing-secret-" + "0123456789abcdef0123456789";
const BEARER = "customer-own-token-xyz";

/** A customer's AEGIS adapter: verifies the signature and token, performs operations once per idempotency key. */
interface Adapter {
  url: string;
  ops: Map<string, { reference: string; params: Record<string, unknown>; at: string }>;
  requests: { method: string; path: string; signatureOk: boolean; bearerOk: boolean; idempotencyKey: string | undefined; body: Record<string, unknown> | null }[];
  mode: "normal" | "refuse" | "error-after-doing" | "drop-after-doing";
  extraOps: { reference: string; idempotencyKey: string; at: string }[];
  close(): Promise<void>;
}

function verify(req: IncomingMessage, body: string): boolean {
  const ts = String(req.headers["aegis-timestamp"] ?? "");
  const sig = String(req.headers["aegis-signature"] ?? "");
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = `v1=${createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")}`;
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

async function startAdapter(): Promise<Adapter> {
  const a = { ops: new Map(), requests: [], mode: "normal", extraOps: [] } as unknown as Adapter;
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const signatureOk = verify(req, body);
      const bearerOk = req.headers.authorization === `Bearer ${BEARER}`;
      const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : null;
      const url = new URL(req.url ?? "/", "http://x");
      a.requests.push({ method: req.method ?? "", path: url.pathname, signatureOk, bearerOk, idempotencyKey: req.headers["idempotency-key"] as string | undefined, body: parsed });
      const send = (status: number, json: unknown) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(json));
      };
      if (!signatureOk || !bearerOk) return send(401, { error: "bad signature" });
      if (url.pathname === "/aegis/v1/health") return send(200, { ok: true });
      if (req.method === "POST" && url.pathname === "/aegis/v1/execute") {
        const key = String(parsed!.idempotencyKey);
        if (a.mode === "refuse") return send(200, { status: "failed", error: "Record is locked" });
        const existing = a.ops.get(key);
        const op = existing ?? { reference: `REC-${a.ops.size + 1}`, params: parsed!.params as Record<string, unknown>, at: new Date().toISOString() };
        a.ops.set(key, op);
        if (a.mode === "error-after-doing") return send(503, { error: "upstream timeout" });
        if (a.mode === "drop-after-doing") return req.socket.destroy();
        return send(200, { status: "succeeded", reference: op.reference, summary: { updated: true } });
      }
      if (req.method === "GET" && url.pathname.startsWith("/aegis/v1/operations/")) {
        const key = decodeURIComponent(url.pathname.slice("/aegis/v1/operations/".length));
        const op = a.ops.get(key);
        return op ? send(200, { status: "succeeded", reference: op.reference }) : send(404, { error: "no such operation" });
      }
      if (req.method === "GET" && url.pathname === "/aegis/v1/operations") {
        const list = [...a.ops.entries()].map(([k, o]) => ({ reference: o.reference, idempotencyKey: k, at: o.at }));
        return send(200, { operations: [...list, ...a.extraOps] });
      }
      send(404, { error: "not found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  a.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  a.close = () => new Promise((r) => server.close(() => r()));
  return a;
}

let adapter: Adapter;
let t: TestTenant;
let agentCtx: OrgContext;
let integrationId: string;
let engineer: { userId: string; ctx: OrgContext };
const run = <T>(fn: (db: TenantDb) => Promise<T>) => withTenant(t.orgId, fn);
let privateWas = false;

const POLICY = { version: 1, appliesTo: { tools: ["update-licence"] }, rules: [{ id: "allow-renewals", effect: "allow", when: { attr: "params.fee", op: "lt", value: 1000 }, reason: "Routine renewal" }] };

function renew(fee = 250): Promise<GatewayResponse> {
  return authorizeAndExecute(withTenant, agentCtx, { tool: "update-licence", action: "execute", params: { licenceId: `LIC-${randomUUID().slice(0, 8)}`, fee }, resource: "licence-registry", idempotencyKey: `https-${randomUUID()}`, justification: "renewal", principal: { type: "none" }, context: {}, executionMode: "gateway" });
}
const request = (id: string) => run((db) => db.actionRequest.findUniqueOrThrow({ where: { id }, include: { receipts: { orderBy: { createdAt: "asc" } } } }));

beforeAll(async () => {
  // The adapter listens on this machine over plain HTTP; production refuses both (see the last test).
  privateWas = env().AEGIS_ALLOW_PRIVATE_DESTINATIONS;
  env().AEGIS_ALLOW_PRIVATE_DESTINATIONS = true;
  adapter = await startAdapter();
  t = await makeTestTenant("https");
  engineer = await addUserWithRole(t, "engineer", "eng");
  const built = await run(async (db) => {
    const { integration } = await createIntegration(db, engineer.ctx, { key: "licence-system", name: "Licensing system", type: "https", description: "", baseUrl: adapter.url });
    await storeCredential(db, engineer.ctx, integration.id, SIGNING_SECRET, SECRET);
    await storeCredential(db, engineer.ctx, integration.id, BEARER_TOKEN, BEARER);
    const tool = await upsertTool(db, engineer.ctx, { key: "update-licence", name: "Renew licence", description: "", integrationId: integration.id, riskLevel: "medium", parameterSchema: { type: "object", required: ["licenceId", "fee"], properties: { licenceId: { type: "string" }, fee: { type: "number", minimum: 0 } }, additionalProperties: false }, destinationRules: { allowedDomains: [], allowedResourceKeys: ["licence-registry"] } });
    const resource = await upsertResource(db, engineer.ctx, { key: "licence-registry", name: "Licence registry", type: "application", classification: "internal", attributes: {} });
    const agent = await createAgent(db, engineer.ctx, { slug: "licensing-agent", name: "Licensing Agent", description: "", environment: "production", modelProvider: "x", modelId: "y", dataClassificationLimit: "confidential", riskTier: "medium", metadata: {}, technicalOwnerId: engineer.userId });
    await setAgentTool(db, engineer.ctx, agent.id, tool.id, true);
    await grantResourcePermission(db, engineer.ctx, agent.id, resource.id, ["read", "write", "execute"]);
    await transitionAgent(db, engineer.ctx, agent.id, "registered", "ok");
    await transitionAgent(db, engineer.ctx, agent.id, "active", "ok");
    const { policy, version } = await createPolicy(db, t.ownerCtx, { key: "licence-renewals", name: "Licence renewals", description: "", category: "authorization", document: POLICY, changeNote: "init" });
    await submitForReview(db, t.ownerCtx, version.id);
    await activateVersion(db, t.ownerCtx, version.id, { fourEyes: false });
    await assignPolicy(db, t.ownerCtx, policy.id, { targetType: "agent", targetId: agent.id, priority: 100 });
    return { agentId: agent.id, integrationId: integration.id };
  });
  integrationId = built.integrationId;
  agentCtx = makeContext(t.orgId, { type: "agent", id: built.agentId });
}, 60_000);

afterEach(() => {
  adapter.mode = "normal";
});

afterAll(async () => {
  env().AEGIS_ALLOW_PRIVATE_DESTINATIONS = privateWas;
  await adapter.close();
  await t.cleanup();
});

describe("generic HTTPS connector", () => {
  it("serves any integration of type https and checks its credentials", () => {
    expect(resolveDownstreamSystem({ key: "anything", type: "https" })?.key).toBe(HTTPS_SYSTEM_KEY);
    expect(resolveDownstreamSystem({ key: "anything", type: "crm" })).toBeUndefined();
    expect(httpsConnector.validateCredential!(SIGNING_SECRET, "short")).toMatch(/32 characters/);
    expect(httpsConnector.validateCredential!("api-key", SECRET)).toMatch(/signing-secret/);
  });

  it("refuses a weak signing secret before it reaches the vault", async () => {
    await expect(run((db) => storeCredential(db, engineer.ctx, integrationId, SIGNING_SECRET, "too-short"))).rejects.toThrow(/32 characters/);
  });

  it("tests the connection with a signed call", async () => {
    const ok = await testIntegrationConnection(run, engineer.ctx, integrationId);
    expect(ok.ok).toBe(true);
    expect(adapter.requests.at(-1)).toMatchObject({ path: "/aegis/v1/health", signatureOk: true, bearerOk: true });
  });

  it("executes an allowed action once, signed, carrying the grant and AEGIS's idempotency key", async () => {
    const r = await renew();
    expect(r.decision).toBe("allow");
    const req = await request(r.requestId);
    expect(req.status).toBe("executed");
    const sent = adapter.requests.filter((x) => x.path === "/aegis/v1/execute").at(-1)!;
    expect(sent.signatureOk).toBe(true);
    expect(sent.idempotencyKey).toBe(`aegis:${r.requestId}`);
    expect(sent.body).toMatchObject({ protocol: "aegis-execution/1", requestId: r.requestId, tool: "update-licence", agent: "licensing-agent" });
    expect((sent.body!.grant as { requestHash: string }).requestHash).toMatch(/^[0-9a-f]{64}$/);
    const op = adapter.ops.get(`aegis:${r.requestId}`)!;
    expect(req.receipts.at(-1)!.downstreamReference).toBe(op.reference);
  });

  it("records a refusal by the system as failed", async () => {
    adapter.mode = "refuse";
    const r = await renew();
    const req = await request(r.requestId);
    expect(req.status).toBe("failed");
    expect(adapter.ops.has(`aegis:${r.requestId}`)).toBe(false);
  });

  it("does not guess when the system fails after acting: unknown, then reconciled from the system's record, executed once", async () => {
    for (const mode of ["error-after-doing", "drop-after-doing"] as const) {
      adapter.mode = mode;
      const r = await renew();
      const before = await request(r.requestId);
      expect(["executing", "unknown"]).toContain(before.status);
      adapter.mode = "normal";
      await reconcileExecution(run, t.ownerCtx, r.requestId);
      const after = await request(r.requestId);
      expect(after.status).toBe("executed");
      expect([...adapter.ops.keys()].filter((k) => k === `aegis:${r.requestId}`)).toHaveLength(1);
      expect(adapter.requests.filter((x) => x.path === "/aegis/v1/execute" && x.idempotencyKey === `aegis:${r.requestId}`)).toHaveLength(1);
    }
  });

  it("treats 'no record' on reconciliation as did not happen, and classifies answers conservatively", () => {
    expect(classify({ status: 404, body: "{}" }, "lookup").outcome).toBe("failed");
    expect(classify({ status: 404, body: "{}" }, "execute").outcome).toBe("failed");
    expect(classify({ status: 503, body: "" }, "execute").outcome).toBe("unknown");
    expect(classify({ status: 429, body: "" }, "execute").outcome).toBe("unknown");
    expect(classify({ status: 409, body: "" }, "execute").outcome).toBe("unknown");
    expect(classify({ status: 302, body: "" }, "execute").outcome).toBe("failed");
    expect(classify({ status: 200, body: "not json" }, "execute").outcome).toBe("unknown");
    expect(classify({ status: 200, body: '{"status":"pending"}' }, "execute").outcome).toBe("unknown");
  });

  it("finds operations the system made around the gateway", async () => {
    adapter.extraOps.push({ reference: "REC-DIRECT", idempotencyKey: "made-without-aegis", at: new Date().toISOString() });
    const r = await auditEnforcementPath(run, t.ownerCtx, integrationId);
    expect(r.observable).toBe(true);
    expect(r.findings.map((f) => [f.reference, f.kind])).toContainEqual(["REC-DIRECT", "bypass"]);
  });

  it("refuses plain HTTP and private addresses outside tests", async () => {
    env().AEGIS_ALLOW_PRIVATE_DESTINATIONS = false;
    try {
      const r = await renew();
      const req = await request(r.requestId);
      expect(req.status).toBe("failed");
      expect(JSON.stringify(req.receipts.at(-1)!.responseSummary)).toMatch(/HTTPS|private/);
    } finally {
      env().AEGIS_ALLOW_PRIVATE_DESTINATIONS = true;
    }
  });
});
