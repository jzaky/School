/**
 * The three demonstration scenarios. Each one drives the real gateway, policy engine, approval
 * service and simulated downstream systems; nothing here is a frontend simulation. Every record it
 * creates is labelled synthetic through the demo organization's demoMode flag.
 */
import { withTenant } from "@aegis/db";
import { decideApproval } from "../approvals/service.js";
import { authorizeAndExecute, type GatewayResponse } from "../gateway/gateway.js";
import { makeContext, type OrgContext } from "../lib/context.js";

export interface DemoStep {
  title: string;
  detail: string;
  requestId?: string;
  outcome: string;
  ok: boolean;
}
export interface DemoRun {
  scenario: "banking" | "refunds" | "sensitive-data";
  correlationId: string;
  steps: DemoStep[];
  startedAt: string;
  finishedAt: string;
}

interface Actors {
  orgId: string;
  agentIds: Record<string, string>;
  approverCtx: OrgContext;
  now?: Date;
  /** When true the approver decides automatically so the run completes without a human; otherwise the approval stays pending for the console. */
  autoApprove: boolean;
}

function agentCtx(a: Actors, slug: string, correlationId: string): OrgContext {
  const id = a.agentIds[slug];
  if (!id) throw new Error(`demo agent ${slug} is missing`);
  return makeContext(a.orgId, { type: "agent", id, label: slug }, { requestId: correlationId, now: a.now });
}

function summarize(r: GatewayResponse): string {
  if (r.status === "executed") return `Executed (${r.receipt?.reference ?? "receipt"})`;
  if (r.status === "pending_approval") return `Approval required (${r.matchedRuleIds.join(", ") || "policy"})`;
  if (r.status === "denied") return `Denied: ${r.reasons[0] ?? "policy"}`;
  if (r.duplicate) return `Duplicate request returned original outcome (${r.status})`;
  return r.status;
}

async function approve(a: Actors, requestId: string, comment: string) {
  return withTenant(a.orgId, async (db) => {
    const ap = await db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: requestId } });
    return decideApproval(db, { ...a.approverCtx, now: a.now }, ap.id, { decision: "approve", comment, requestHash: ap.requestHash });
  });
}
async function reject(a: Actors, requestId: string, comment: string) {
  return withTenant(a.orgId, async (db) => {
    const ap = await db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: requestId } });
    return decideApproval(db, { ...a.approverCtx, now: a.now }, ap.id, { decision: "reject", comment, requestHash: ap.requestHash });
  });
}

/** Demo 1: a treasury agent attempts a simulated AED 250,000 transfer that exceeds its autonomous authority. */
export async function runBankingDemo(a: Actors, opts: { decision?: "approve" | "reject" | "leave" } = {}): Promise<DemoRun> {
  const startedAt = new Date().toISOString();
  const correlationId = `demo-banking-${Date.now().toString(36)}`;
  const ctx = agentCtx(a, "treasury-transfer-agent", correlationId);
  const steps: DemoStep[] = [];
  const small = await authorizeAndExecute(withTenant, ctx, { tool: "initiate-transfer", action: "transfer", resource: "payments-core", params: { fromAccount: "AE07 0331 2345 6789 0123 456", toAccount: "AE12 0260 0010 0000 1234 567", amount: 12500, currency: "AED", reference: "Payroll top-up (synthetic)" }, idempotencyKey: `${correlationId}-small`, justification: "Treasury ticket TR-2291: payroll float top-up", principal: { type: "user", ref: "treasury.analyst@meridian-demo.example" }, context: { ticket: "TR-2291" }, executionMode: "gateway" });
  steps.push({ title: "AED 12,500 transfer within authority", detail: "Below the AED 50,000 autonomous limit during business hours", requestId: small.requestId, outcome: summarize(small), ok: small.status === "executed" || small.status === "pending_approval" });
  const big = await authorizeAndExecute(withTenant, ctx, { tool: "initiate-transfer", action: "transfer", resource: "payments-core", params: { fromAccount: "AE07 0331 2345 6789 0123 456", toAccount: "AE45 0030 0000 9876 5432 100", amount: 250000, currency: "AED", reference: "Supplier settlement Q4 (synthetic)" }, idempotencyKey: `${correlationId}-250k`, justification: "Treasury ticket TR-2302: quarterly supplier settlement", principal: { type: "user", ref: "treasury.analyst@meridian-demo.example" }, context: { ticket: "TR-2302" }, executionMode: "gateway" });
  steps.push({ title: "AED 250,000 transfer exceeds autonomous authority", detail: "Policy treasury-transfer-limits requires a manager approval between AED 50,000 and 1,000,000", requestId: big.requestId, outcome: summarize(big), ok: big.status === "pending_approval" });
  const decision = opts.decision ?? (a.autoApprove ? "approve" : "leave");
  if (big.status === "pending_approval" && decision !== "leave") {
    const d = decision === "approve" ? await approve(a, big.requestId, "Verified beneficiary and instruction TR-2302 with treasury") : await reject(a, big.requestId, "Beneficiary not on the approved supplier list");
    steps.push({ title: decision === "approve" ? "Manager approves" : "Manager rejects", detail: "Approval bound to the exact parameters; the simulated core banking service verified the execution grant before posting", requestId: big.requestId, outcome: d.status === "approved" ? (d.executed ? "Approved and executed by core banking (grant verified)" : "Approved") : "Rejected, nothing executed", ok: true });
  } else if (big.status === "pending_approval") {
    steps.push({ title: "Waiting for a manager in the Approval Center", detail: "The transfer stays unexecuted until an authorised approver decides or the request expires", requestId: big.requestId, outcome: "Pending approval", ok: true });
  }
  const huge = await authorizeAndExecute(withTenant, ctx, { tool: "initiate-transfer", action: "transfer", resource: "payments-core", params: { fromAccount: "AE07 0331 2345 6789 0123 456", toAccount: "AE45 0030 0000 9876 5432 100", amount: 1500000, currency: "AED", reference: "Unexpected (synthetic)" }, idempotencyKey: `${correlationId}-1-5m`, justification: "No ticket", principal: { type: "none" }, context: {}, executionMode: "gateway" });
  steps.push({ title: "AED 1,500,000 transfer is denied outright", detail: "Above the AED 1,000,000 ceiling: denied before execution and a security event is raised", requestId: huge.requestId, outcome: summarize(huge), ok: huge.status === "denied" });
  return { scenario: "banking", correlationId, steps, startedAt, finishedAt: new Date().toISOString() };
}

/** Demo 2: refund tiers, duplicates, expired approvals and modified parameters. */
export async function runRefundDemo(a: Actors): Promise<DemoRun> {
  const startedAt = new Date().toISOString();
  const correlationId = `demo-refunds-${Date.now().toString(36)}`;
  const ctx = agentCtx(a, "support-refund-agent", correlationId);
  const steps: DemoStep[] = [];
  const base = { tool: "issue-refund", action: "execute", resource: "support-tickets", principal: { type: "customer" as const, ref: "CUST-88213" }, context: { channel: "chat" }, executionMode: "gateway" as const };

  const auto = await authorizeAndExecute(withTenant, ctx, { ...base, params: { orderId: "ORD-55120", customerId: "CUST-88213", amount: 180, currency: "AED", reason: "Damaged packaging" }, idempotencyKey: `${correlationId}-auto`, justification: "Customer reported damaged packaging with photos" });
  steps.push({ title: "AED 180 refund issued automatically", detail: "Below the AED 500 autonomous limit", requestId: auto.requestId, outcome: summarize(auto), ok: auto.status === "executed" });

  const dup = await authorizeAndExecute(withTenant, ctx, { ...base, params: { orderId: "ORD-55120", customerId: "CUST-88213", amount: 180, currency: "AED", reason: "Damaged packaging" }, idempotencyKey: `${correlationId}-auto`, justification: "Retry after timeout" });
  steps.push({ title: "Duplicate request with the same idempotency key", detail: "The gateway returns the original decision and the support platform is not called twice", requestId: dup.requestId, outcome: summarize(dup), ok: dup.duplicate === true });

  const mid = await authorizeAndExecute(withTenant, ctx, { ...base, params: { orderId: "ORD-55377", customerId: "CUST-88213", amount: 1450, currency: "AED", reason: "Late delivery compensation" }, idempotencyKey: `${correlationId}-mid`, justification: "Customer escalated twice; goodwill compensation" });
  steps.push({ title: "AED 1,450 refund needs a supervisor", detail: "Between AED 500 and 2,500: approval required, nothing executes yet", requestId: mid.requestId, outcome: summarize(mid), ok: mid.status === "pending_approval" });
  if (mid.status === "pending_approval" && a.autoApprove) {
    const d = await approve(a, mid.requestId, "Order verified, compensation agreed with team lead");
    steps.push({ title: "Supervisor approves the AED 1,450 refund", detail: "Executed once through the support platform", requestId: mid.requestId, outcome: d.executed ? "Approved and executed" : d.status, ok: d.executed });
  }

  const big = await authorizeAndExecute(withTenant, ctx, { ...base, params: { orderId: "ORD-55390", customerId: "CUST-88213", amount: 6200, currency: "AED", reason: "Full order refund" }, idempotencyKey: `${correlationId}-big`, justification: "Customer demands full refund" });
  steps.push({ title: "AED 6,200 refund is prohibited", detail: "Above AED 2,500: denied, security event recorded", requestId: big.requestId, outcome: summarize(big), ok: big.status === "denied" });

  // Expired approval: create a pending approval and expire it.
  const stale = await authorizeAndExecute(withTenant, ctx, { ...base, params: { orderId: "ORD-55401", customerId: "CUST-88213", amount: 900, currency: "AED", reason: "Wrong item" }, idempotencyKey: `${correlationId}-stale`, justification: "Wrong item shipped" });
  if (stale.status === "pending_approval") {
    const { expireApproval } = await import("../approvals/service.js");
    await withTenant(a.orgId, async (db) => {
      const ap = await db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: stale.requestId } });
      await db.approvalRequest.update({ where: { id: ap.id }, data: { expiresAt: new Date((a.now ?? new Date()).getTime() - 60_000) } });
      await expireApproval(db, { ...a.approverCtx, now: a.now }, ap.id);
    });
    let outcome = "Expired without execution";
    try {
      await approve(a, stale.requestId, "late approval");
      outcome = "Unexpected: late approval accepted";
    } catch (e) {
      outcome = `Late approval refused: ${e instanceof Error ? e.message : "error"}`;
    }
    steps.push({ title: "Expired approval cannot be used", detail: "The approval window elapsed; a late approval is refused and the refund never executes", requestId: stale.requestId, outcome, ok: outcome.startsWith("Late approval refused") });
  }

  // Modified parameters after approval: reuse the idempotency key with a different amount.
  let modified: string;
  try {
    await authorizeAndExecute(withTenant, ctx, { ...base, params: { orderId: "ORD-55377", customerId: "CUST-88213", amount: 2450, currency: "AED", reason: "Late delivery compensation" }, idempotencyKey: `${correlationId}-mid`, justification: "Adjusted amount" });
    modified = "Unexpected: accepted";
  } catch (e) {
    modified = `Rejected: ${e instanceof Error ? e.message : "conflict"}`;
  }
  steps.push({ title: "Modified parameters after approval", detail: "Replaying the approved request with a different amount is rejected; a new amount needs a new request and a new evaluation", requestId: mid.requestId, outcome: modified, ok: modified.startsWith("Rejected") });
  return { scenario: "refunds", correlationId, steps, startedAt, finishedAt: new Date().toISOString() };
}

/** Demo 3: an agent attempts to send customer records to an unauthorised destination. */
export async function runSensitiveDataDemo(a: Actors): Promise<DemoRun> {
  const startedAt = new Date().toISOString();
  const correlationId = `demo-egress-${Date.now().toString(36)}`;
  const ctx = agentCtx(a, "marketing-outreach-agent", correlationId);
  const steps: DemoStep[] = [];
  const ok = await authorizeAndExecute(withTenant, ctx, { tool: "send-email", action: "send", params: { to: "campaigns@customers.meridian-demo.example", subject: "October offers (synthetic)", body: "Dear customer, here are this month's offers." }, idempotencyKey: `${correlationId}-ok`, justification: "Approved campaign OCT-14", principal: { type: "system" }, context: {}, executionMode: "gateway" });
  steps.push({ title: "Campaign email to an approved domain", detail: "Allowed destination, no sensitive data classes detected", requestId: ok.requestId, outcome: summarize(ok), ok: ok.status === "executed" });
  const exfil = await authorizeAndExecute(withTenant, ctx, { tool: "export-customer-records", action: "export", params: { segment: "gold-tier", destination: "https://files.partner-upload.example/inbox", fields: ["name", "email", "phone", "iban"] }, idempotencyKey: `${correlationId}-exfil`, justification: "Share the gold segment with the agency", principal: { type: "system" }, context: { source: "untrusted-email-instruction" }, executionMode: "gateway" });
  steps.push({ title: "Export of customer records to an external destination", detail: "Blocked by the tool's destination allowlist and the customer-data-egress policy; security event raised", requestId: exfil.requestId, outcome: summarize(exfil), ok: exfil.status === "denied" });
  const leak = await authorizeAndExecute(withTenant, ctx, { tool: "send-email", action: "send", params: { to: "agency@partner-upload.example", subject: "Customer list", body: "Customer 1: Ahmed, card 4111 1111 1111 1111, IBAN AE07 0331 2345 6789 0123 456" }, idempotencyKey: `${correlationId}-leak`, justification: "Agency asked for the list", principal: { type: "system" }, context: {}, executionMode: "gateway" });
  steps.push({ title: "Email containing card and IBAN data to an external domain", detail: "Denied: destination outside the allowlist and sensitive data classes present", requestId: leak.requestId, outcome: summarize(leak), ok: leak.status === "denied" });
  return { scenario: "sensitive-data", correlationId, steps, startedAt, finishedAt: new Date().toISOString() };
}

export type { Actors as DemoActors };
