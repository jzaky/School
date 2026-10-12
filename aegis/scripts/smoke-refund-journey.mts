/**
 * HTTP smoke test of the complete refund workflow against a running API (default http://localhost:4000)
 * and the seeded demo tenant. Run with: npx tsx scripts/smoke-refund-journey.mts
 *
 * Proves, through the public API only:
 *   1. a small refund is allowed and executed once, with a receipt
 *   2. a replay of the same idempotency key returns the original outcome and does not execute again
 *   3. a mid-size refund waits for a named approver; a viewer cannot approve; the approver can; it executes once
 *   4. a refund above the limit is denied before anything executes
 *   5. the same idempotency key with changed parameters is rejected (409)
 *   6. a bad API key is rejected
 * Exit code is non-zero on any failed check. Prints a table.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const API = process.env.AEGIS_API_URL ?? "http://localhost:4000";
const PASSWORD = process.env.AEGIS_DEMO_PASSWORD ?? "AegisDemo2026!";
const keys = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", ".demo-keys.json"), "utf8")) as { agents: Record<string, string> };
const AGENT_KEY = keys.agents["support-refund-agent"];
if (!AGENT_KEY) throw new Error("support-refund-agent key missing from .demo-keys.json; run pnpm db:seed");

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

async function api(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...((init.headers as Record<string, string>) ?? {}) };
  if (init.cookie) headers.cookie = init.cookie;
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body: body as Record<string, unknown>, setCookie: res.headers.get("set-cookie") ?? "" };
}

async function login(email: string): Promise<string> {
  const r = await api("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password: PASSWORD }) });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
  return r.setCookie.split(";")[0]!;
}

async function refund(params: Record<string, unknown>, idempotencyKey: string, key = AGENT_KEY) {
  return api("/v1/gateway/actions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: JSON.stringify({ tool: "issue-refund", action: "execute", resource: "support-tickets", params, idempotencyKey, justification: "smoke test", principal: { type: "customer", ref: "CUST-SMOKE" }, context: { channel: "smoke" } }),
  });
}

const run = Date.now().toString(36);
const base = { customerId: "CUST-SMOKE", currency: "AED", reason: "Smoke test" };

// 1. small refund
const small = await refund({ ...base, orderId: `ORD-${run}-A`, amount: 120 }, `smoke-${run}-small`);
check("small refund allowed and executed", small.status === 200 && small.body.status === "executed" && (small.body.receipt as { status?: string })?.status === "succeeded", `HTTP ${small.status}, status ${small.body.status}, receipt ${(small.body.receipt as { reference?: string })?.reference ?? "none"}`);

// 2. replay
const replay = await refund({ ...base, orderId: `ORD-${run}-A`, amount: 120 }, `smoke-${run}-small`);
check("replay returns the original outcome without re-executing", replay.status === 200 && replay.body.duplicate === true && replay.body.requestId === small.body.requestId, `duplicate=${replay.body.duplicate}, same request id=${replay.body.requestId === small.body.requestId}`);

// 3. mid refund needs approval
const mid = await refund({ ...base, orderId: `ORD-${run}-B`, amount: 1450 }, `smoke-${run}-mid`);
const approvalId = (mid.body.approval as { approvalRequestId?: string } | undefined)?.approvalRequestId;
check("mid refund waits for approval", mid.status === 202 && mid.body.status === "pending_approval" && !!approvalId, `HTTP ${mid.status}, status ${mid.body.status}`);

if (approvalId) {
  const viewer = await login("sara.khalil@meridian-demo.example");
  const seen = await api(`/v1/approvals/${approvalId}`, { cookie: viewer });
  const requestHash = seen.body.requestHash as string;
  const denied = await api(`/v1/approvals/${approvalId}/decide`, { method: "POST", cookie: viewer, body: JSON.stringify({ decision: "approve", comment: "x", requestHash }) });
  check("viewer cannot approve", denied.status === 403, `HTTP ${denied.status}`);

  const approver = await login("lina.mansour@meridian-demo.example");
  const tampered = await api(`/v1/approvals/${approvalId}/decide`, { method: "POST", cookie: approver, body: JSON.stringify({ decision: "approve", comment: "x", requestHash: "0".repeat(64) }) });
  check("approval with a stale request hash is refused", tampered.status >= 400 && tampered.status < 500, `HTTP ${tampered.status}`);

  const approved = await api(`/v1/approvals/${approvalId}/decide`, { method: "POST", cookie: approver, body: JSON.stringify({ decision: "approve", comment: "Order verified in the support platform", requestHash }) });
  const receipt = approved.body.receipt as { status?: string; reference?: string } | undefined;
  check("approver approves and the refund executes once", approved.status === 200 && approved.body.status === "approved" && approved.body.executed === true && receipt?.status === "succeeded", `HTTP ${approved.status}, executed=${approved.body.executed}, reference ${receipt?.reference ?? "none"}`);

  const again = await api(`/v1/approvals/${approvalId}/decide`, { method: "POST", cookie: approver, body: JSON.stringify({ decision: "approve", comment: "again", requestHash }) });
  check("a second approval of the same request is refused", again.status >= 400, `HTTP ${again.status}`);

  const detail = await api(`/v1/gateway/actions/${mid.body.requestId}`, { headers: { authorization: `Bearer ${AGENT_KEY}` } });
  const receipts = (detail.body.receipts as { status: string }[] | undefined) ?? [];
  const grants = (detail.body.grants as { consumedAt: string | null }[] | undefined) ?? [];
  check("exactly one receipt and one consumed grant on the approved request", receipts.length === 1 && grants.length === 1 && !!grants[0]?.consumedAt, `receipts=${receipts.length}, grants=${grants.length}`);
}

// 3b. a second refund for the same order (new idempotency key) is refused by the duplicate rule
const dupOrder = await refund({ ...base, orderId: `ORD-${run}-A`, amount: 95 }, `smoke-${run}-dup-order`);
check("second refund for the same order is denied", dupOrder.status === 403 && /already/.test(((dupOrder.body.reasons as string[] | undefined) ?? []).join(" ")), `HTTP ${dupOrder.status}, ${(dupOrder.body.reasons as string[] | undefined)?.[0] ?? ""}`);

// 4. over limit
const big = await refund({ ...base, orderId: `ORD-${run}-C`, amount: 6200 }, `smoke-${run}-big`);
check("refund above the limit is denied", big.status === 403 && big.body.status === "denied", `HTTP ${big.status}, ${(big.body.reasons as string[] | undefined)?.[0] ?? ""}`);

// 5. modified parameters under a used key
const modified = await refund({ ...base, orderId: `ORD-${run}-B`, amount: 2450 }, `smoke-${run}-mid`);
check("same idempotency key with different parameters is rejected", modified.status === 409, `HTTP ${modified.status}`);

// 6. bad key
const bad = await refund({ ...base, orderId: "ORD-X", amount: 1 }, `smoke-${run}-bad`, "aegis_ak_bad_key");
check("bad API key is rejected", bad.status === 401, `HTTP ${bad.status}`);

const width = Math.max(...checks.map((c) => c.name.length));
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(width)}  ${c.detail}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
