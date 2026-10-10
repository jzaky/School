/**
 * Months of realistic, synthetic gateway history generated through the real gateway with a
 * backdated clock. Deterministic per seed run except for ids. Volumes are modest so the seed
 * finishes in seconds.
 */
import { withTenant } from "@aegis/db";
import { authorizeAndExecute } from "../gateway/gateway.js";
import { decideApproval, expireApproval } from "../approvals/service.js";
import { makeContext, type OrgContext } from "../lib/context.js";
import type { SeededTenant } from "./demo-tenant.js";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export async function seedDemoHistory(t: SeededTenant, days = 75) {
  const rand = rng(42);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const approverCtx = (now: Date): OrgContext => ({ ...t.users.approver!.ctx, now });
  const secCtx = (now: Date): OrgContext => ({ ...t.users.security_analyst!.ctx, now });
  const stats = { requests: 0, approvals: 0, denied: 0 };
  const start = Date.now() - days * 86400_000;
  for (let d = 0; d < days; d++) {
    const dayStart = start + d * 86400_000;
    const weekday = new Date(dayStart).getUTCDay();
    const volume = weekday === 5 || weekday === 6 ? 2 : 6 + Math.floor(rand() * 5);
    for (let i = 0; i < volume; i++) {
      const now = new Date(dayStart + (5 + Math.floor(rand() * 10)) * 3600_000 + Math.floor(rand() * 3600_000));
      const kind = rand();
      if (kind < 0.55) {
        const amount = rand() < 0.75 ? Math.round(20 + rand() * 470) : rand() < 0.85 ? Math.round(500 + rand() * 1900) : Math.round(2600 + rand() * 5000);
        const ctx = makeContext(t.orgId, { type: "agent", id: t.agents["support-refund-agent"]! }, { now, requestId: `hist-rf-${d}-${i}` });
        const r = await authorizeAndExecute(withTenant, ctx, { tool: "issue-refund", action: "execute", resource: "support-tickets", params: { orderId: `ORD-${50000 + d * 20 + i}`, customerId: `CUST-${10000 + Math.floor(rand() * 900)}`, amount, currency: "AED", reason: pick(["Damaged item", "Late delivery", "Wrong size", "Duplicate charge", "Goodwill"]) }, idempotencyKey: `hist-rf-${d}-${i}`, justification: pick(["Customer provided photos", "Verified in order system", "Team lead agreed", "Standard policy"]), principal: { type: "customer", ref: `CUST-${10000 + i}` }, context: { channel: pick(["chat", "email", "phone"]) }, executionMode: "gateway" });
        stats.requests++;
        if (r.status === "pending_approval") {
          stats.approvals++;
          const roll = rand();
          const later = new Date(now.getTime() + (10 + rand() * 120) * 60_000);
          await withTenant(t.orgId, async (db) => {
            const ap = await db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: r.requestId } });
            if (roll < 0.7) await decideApproval(db, approverCtx(later), ap.id, { decision: "approve", comment: pick(["Verified order and entitlement", "Agreed with team lead", "Customer retention case"]), requestHash: ap.requestHash });
            else if (roll < 0.9) await decideApproval(db, approverCtx(later), ap.id, { decision: "reject", comment: pick(["Customer not entitled", "Duplicate of an earlier refund", "Order outside refund window"]), requestHash: ap.requestHash });
            else if (d < days - 1) {
              await db.approvalRequest.update({ where: { id: ap.id }, data: { expiresAt: new Date(now.getTime() + 60_000) } });
              await expireApproval(db, { ...approverCtx(new Date(now.getTime() + 5 * 3600_000)) }, ap.id);
            }
          });
        }
        if (r.status === "denied") stats.denied++;
      } else if (kind < 0.75) {
        const amount = rand() < 0.8 ? Math.round(1000 + rand() * 48000) : rand() < 0.9 ? Math.round(60000 + rand() * 600000) : Math.round(1100000 + rand() * 500000);
        const ctx = makeContext(t.orgId, { type: "agent", id: t.agents["treasury-transfer-agent"]! }, { now, requestId: `hist-tr-${d}-${i}` });
        const r = await authorizeAndExecute(withTenant, ctx, { tool: "initiate-transfer", action: "transfer", resource: "payments-core", params: { fromAccount: "AE07 0331 2345 6789 0123 456", toAccount: pick(["AE12 0260 0010 0000 1234 567", "AE45 0030 0000 9876 5432 100", "AE90 0450 0000 1122 3344 556"]), amount, currency: "AED", reference: pick(["Payroll float", "Supplier settlement", "Intercompany sweep", "FX cover"]) + " (synthetic)" }, idempotencyKey: `hist-tr-${d}-${i}`, justification: `Treasury ticket TR-${2000 + d * 10 + i}`, principal: { type: "user", ref: "treasury.analyst@meridian-demo.example" }, context: { ticket: `TR-${2000 + d * 10 + i}` }, executionMode: "gateway" });
        stats.requests++;
        if (r.status === "pending_approval") {
          stats.approvals++;
          const later = new Date(now.getTime() + (15 + rand() * 90) * 60_000);
          await withTenant(t.orgId, async (db) => {
            const ap = await db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: r.requestId } });
            if (rand() < 0.8) await decideApproval(db, approverCtx(later), ap.id, { decision: "approve", comment: "Beneficiary and instruction verified", requestHash: ap.requestHash });
            else await decideApproval(db, approverCtx(later), ap.id, { decision: "reject", comment: "Beneficiary not on approved list", requestHash: ap.requestHash });
          });
        }
        if (r.status === "denied") stats.denied++;
      } else if (kind < 0.9) {
        const slug = pick(["analytics-copilot", "kyc-document-agent", "support-refund-agent"]);
        const ctx = makeContext(t.orgId, { type: "agent", id: t.agents[slug]! }, { now, requestId: `hist-rd-${d}-${i}` });
        const tool = slug === "analytics-copilot" ? "run-warehouse-query" : slug === "kyc-document-agent" ? "query-crm" : "update-ticket";
        const params = tool === "run-warehouse-query" ? { sql: rand() < 0.93 ? "SELECT segment, count(*) FROM customers GROUP BY segment" : "DELETE FROM customers WHERE segment = 'test'" } : tool === "query-crm" ? { customerId: `CUST-${10000 + Math.floor(rand() * 900)}`, fields: ["name", "tier"] } : { ticketId: `TK-${7000 + d * 10 + i}`, status: pick(["resolved", "pending", "escalated"]), note: "Updated by agent" };
        const resource = tool === "run-warehouse-query" ? "analytics-warehouse" : tool === "query-crm" ? "customer-accounts" : "support-tickets";
        const action = tool === "update-ticket" ? "write" : "read";
        const r = await authorizeAndExecute(withTenant, ctx, { tool, action, resource, params, idempotencyKey: `hist-rd-${d}-${i}`, justification: "Routine", principal: { type: "system" }, context: {}, executionMode: "gateway" });
        stats.requests++;
        if (r.status === "denied") stats.denied++;
      } else {
        const ctx = makeContext(t.orgId, { type: "agent", id: t.agents["marketing-outreach-agent"]! }, { now, requestId: `hist-mk-${d}-${i}` });
        const bad = rand() < 0.25;
        const r = bad
          ? await authorizeAndExecute(withTenant, ctx, { tool: "export-customer-records", action: "export", params: { segment: "gold-tier", destination: pick(["https://files.partner-upload.example/inbox", "https://drive.personal-cloud.example/u/x", "https://warehouse.meridian-demo.example/import"]), fields: ["name", "email"] }, idempotencyKey: `hist-mk-${d}-${i}`, justification: "Campaign data share", principal: { type: "system" }, context: {}, executionMode: "gateway" })
          : await authorizeAndExecute(withTenant, ctx, { tool: "send-email", action: "send", params: { to: "campaigns@customers.meridian-demo.example", subject: `Campaign ${d} (synthetic)`, body: "Monthly offers." }, idempotencyKey: `hist-mk-${d}-${i}`, justification: "Approved campaign", principal: { type: "system" }, context: {}, executionMode: "gateway" });
        stats.requests++;
        if (r.status === "denied") stats.denied++;
        if (r.status === "pending_approval") {
          await withTenant(t.orgId, async (db) => {
            const ap = await db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: r.requestId } });
            await decideApproval(db, secCtx(new Date(now.getTime() + 3600_000)), ap.id, { decision: rand() < 0.6 ? "approve" : "reject", comment: "Data protection review", requestHash: ap.requestHash });
          });
        }
      }
    }
  }
  return stats;
}
