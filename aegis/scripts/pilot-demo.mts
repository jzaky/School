/**
 * Pilot demo: an AI agent attempts financial actions and AEGIS intercepts, evaluates, requires approval,
 * permits or denies, and records evidence. Runs against a running API (default http://localhost:4000) and
 * the seeded synthetic demo tenant. Run with: npx tsx scripts/pilot-demo.mts
 *
 * Every step is labelled:
 *   REAL       AEGIS's production code path over HTTP (gateway, policy, approvals, grants, ledger).
 *   SIMULATED  a stand-in: the "agent" is this script acting as the agent through its API key (no language
 *              model is involved), and the refund system is the seeded simulator unless a Stripe test-mode
 *              integration has been connected, in which case the receipt names Stripe.
 * Nothing here moves real money. Synthetic data only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const API = process.env.AEGIS_API_URL ?? "http://localhost:4000";
const PASSWORD = process.env.AEGIS_DEMO_PASSWORD ?? "AegisDemo2026!";
const keys = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", ".demo-keys.json"), "utf8")) as { agents: Record<string, string> };
const AGENT_KEY = keys.agents["support-refund-agent"];
if (!AGENT_KEY) throw new Error("support-refund-agent key missing from .demo-keys.json; run pnpm db:seed");

type Json = Record<string, unknown>;
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
  return { status: res.status, body: (body ?? {}) as Json, setCookie: res.headers.get("set-cookie") ?? "" };
}
async function login(email: string) {
  const r = await api("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password: PASSWORD }) });
  if (r.status !== 200) throw new Error(`login failed for ${email}: HTTP ${r.status}`);
  return r.setCookie.split(";")[0]!;
}

let failures = 0;
const say = (label: "REAL" | "SIMULATED" | "RESULT", text: string) => console.log(`  [${label.padEnd(9)}] ${text}`);
const expect = (ok: boolean, text: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}        ${text}`);
};
const step = (n: number, title: string) => console.log(`\n${n}. ${title}`);

const run = Date.now().toString(36);
const base = { customerId: "CUST-PILOT", currency: "AED", reason: "Pilot demo" };
function agentAsks(params: Json, idem: string) {
  return api("/v1/gateway/actions", {
    method: "POST",
    headers: { authorization: `Bearer ${AGENT_KEY}` },
    body: JSON.stringify({ tool: "issue-refund", action: "execute", resource: "support-tickets", params, idempotencyKey: idem, justification: "Customer reported a damaged item", principal: { type: "customer", ref: "CUST-PILOT" }, context: { channel: "pilot-demo" } }),
  });
}
const reasons = (b: Json) => ((b.reasons as string[] | undefined) ?? []).join("; ") || "none given";
function receiptLabel(r: { downstreamSystem?: string; downstreamReference?: string | null } | undefined) {
  if (!r?.downstreamSystem) return "no receipt";
  const sim = /sim/.test(r.downstreamSystem);
  return `${r.downstreamSystem} ${sim ? "(SIMULATED refund system)" : "(external system, test mode)"} reference ${r.downstreamReference ?? "none"}`;
}
async function receiptsOf(requestId: unknown) {
  const d = await api(`/v1/gateway/actions/${requestId}`, { headers: { authorization: `Bearer ${AGENT_KEY}` } });
  return { receipts: (d.body.receipts as { downstreamSystem: string; downstreamReference: string | null }[] | undefined) ?? [], correlationId: d.body.correlationId as string | undefined };
}

console.log(`AEGIS pilot demo against ${API}`);
console.log("Agent: support-refund-agent (SIMULATED: this script uses the agent's API key; no language model)");

step(1, "The agent refunds AED 120 for a damaged item (within policy)");
say("SIMULATED", "agent calls issue-refund through the Action Gateway");
const small = await agentAsks({ ...base, orderId: `ORD-${run}-1`, amount: 120 }, `pilot-${run}-1`);
say("REAL", `gateway decision: HTTP ${small.status}, status ${small.body.status}`);
const r1 = await receiptsOf(small.body.requestId);
say("RESULT", `executed once: ${receiptLabel(r1.receipts[0])}`);
expect(small.status === 200 && small.body.status === "executed" && r1.receipts.length === 1, "allowed and executed exactly once");

step(2, "The agent refunds AED 1,450 (above the automatic limit)");
const mid = await agentAsks({ ...base, orderId: `ORD-${run}-2`, amount: 1450 }, `pilot-${run}-2`);
const approvalId = (mid.body.approval as { approvalRequestId?: string } | undefined)?.approvalRequestId;
say("REAL", `gateway decision: HTTP ${mid.status}, status ${mid.body.status}; nothing has executed`);
expect(mid.status === 202 && mid.body.status === "pending_approval" && !!approvalId, "held for a person");

if (approvalId) {
  step(3, "A viewer tries to approve, then the finance approver approves the exact parameters");
  const viewer = await login("sara.khalil@meridian-demo.example");
  const seen = await api(`/v1/approvals/${approvalId}`, { cookie: viewer });
  const requestHash = seen.body.requestHash as string;
  const v = await api(`/v1/approvals/${approvalId}/decide`, { method: "POST", cookie: viewer, body: JSON.stringify({ decision: "approve", comment: "x", requestHash }) });
  say("REAL", `viewer approval: HTTP ${v.status}`);
  expect(v.status === 403, "a viewer cannot approve");
  const approver = await login("lina.mansour@meridian-demo.example");
  const a = await api(`/v1/approvals/${approvalId}/decide`, { method: "POST", cookie: approver, body: JSON.stringify({ decision: "approve", comment: "Order and damage photo checked", requestHash }) });
  const r2 = await receiptsOf(mid.body.requestId);
  say("REAL", `approver decision: HTTP ${a.status}, executed=${a.body.executed}`);
  say("RESULT", `executed once with a single-use grant: ${receiptLabel(r2.receipts[0])}`);
  expect(a.status === 200 && a.body.executed === true && r2.receipts.length === 1, "approved and executed exactly once");
}

step(4, "The agent retries the AED 1,450 request with the amount changed to AED 2,450");
const tampered = await agentAsks({ ...base, orderId: `ORD-${run}-2`, amount: 2450 }, `pilot-${run}-2`);
say("REAL", `gateway: HTTP ${tampered.status}`);
expect(tampered.status === 409, "changed parameters under the same request key are refused");

step(5, "The agent refunds AED 6,200 (above the hard limit)");
const big = await agentAsks({ ...base, orderId: `ORD-${run}-3`, amount: 6200 }, `pilot-${run}-3`);
const r3 = await receiptsOf(big.body.requestId);
say("REAL", `gateway decision: HTTP ${big.status}, status ${big.body.status}, reasons: ${reasons(big.body)}`);
say("RESULT", r3.receipts.length === 0 ? "BLOCKED: no call was made to the refund system (no receipt exists)" : `unexpected receipt: ${receiptLabel(r3.receipts[0])}`);
expect(big.status === 403 && big.body.status === "denied" && r3.receipts.length === 0, "denied before anything executed");

step(6, "The auditor reads the evidence and verifies the ledger");
const auditor = await login("hana.youssef@meridian-demo.example");
for (const [label, id] of [["AED 120", small.body.requestId], ["AED 1,450", mid.body.requestId], ["AED 6,200", big.body.requestId]] as const) {
  const ev = await api(`/v1/assurance/evidence?subjectId=${id}&pageSize=50`, { cookie: auditor });
  const items = ((ev.body.items ?? ev.body.events ?? []) as { type: string }[]).map((e) => e.type);
  say("REAL", `${label}: ${items.length} evidence events (${items.join(", ") || "none visible"})`);
}
const verify = await api("/v1/assurance/evidence/verify", { method: "POST", cookie: auditor, body: "{}" });
say("REAL", `ledger verification: HTTP ${verify.status}, valid=${verify.body.valid}, events checked=${verify.body.checked ?? "?"}`);
expect(verify.status === 200 && verify.body.valid === true, "the hash chain and signed checkpoints verify");

console.log(`\nWhat was real: the AEGIS API, policy evaluation, approvals, single-use grants, the database and the evidence ledger.`);
console.log(`What was simulated: the agent (this script, no language model) and the refund system unless a receipt above names an external system.`);
console.log(`${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures ? 1 : 0);
