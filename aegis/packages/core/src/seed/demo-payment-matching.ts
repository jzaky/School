import { withTenant } from "@aegis/db";
import { setAgentTool, upsertTool } from "../agents/registry.js";
import { authorizeAndExecute, recordAgentExecution } from "../gateway/gateway.js";
import { makeContext } from "../lib/context.js";
import { registerPaymentDocuments, setDocumentMatching } from "../payments/matching.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../policy/service.js";
import type { SeededTenant } from "./demo-tenant.js";

/**
 * Payment document matching demo (docs/PAYMENT_MATCHING.md). Accounts payable in the core banking system
 * registers supplier invoices. The treasury agent pays one, then is refused when it tries to pay the same
 * invoice again, and when an amount does not match the invoice. Synthetic suppliers and amounts.
 */
export async function seedDemoPaymentMatching(t: SeededTenant): Promise<{ documents: number; refused: number }> {
  const engineer = t.users.engineer!.ctx;
  const owner = t.users.owner!.ctx;
  const agentId = t.agents["treasury-transfer-agent"]!;
  const toolId = await withTenant(t.orgId, async (db) => {
    const tool = await upsertTool(db, engineer, {
      key: "pay-supplier-invoice",
      name: "Pay supplier invoice",
      description: "Pays a registered supplier invoice from the operating account",
      integrationId: t.integrations["core-banking-sim"],
      riskLevel: "high",
      parameterSchema: { type: "object", required: ["invoiceRef", "vendorRef", "amount", "currency"], properties: { invoiceRef: { type: "string" }, vendorRef: { type: "string" }, amount: { type: "number" }, currency: { type: "string" } } },
      destinationRules: { allowedDomains: [], allowedResourceKeys: [] },
    });
    await setAgentTool(db, engineer, agentId, tool.id, true);
    await setDocumentMatching(db, owner, tool.id, { documentParam: "invoiceRef", kinds: ["invoice"], amountTolerance: 0 });
    // Illustrative thresholds: matching decides whether there is a record to pay; the policy decides how much may be paid alone.
    const { policy, version } = await createPolicy(db, t.users.governance_manager!.ctx, {
      key: "supplier-invoice-payments",
      name: "Supplier invoice payments",
      description: "Matched supplier invoices up to AED 50,000 are paid autonomously; up to AED 500,000 need an Approver; above that is refused. Illustrative thresholds.",
      category: "authorization",
      document: {
        version: 1,
        appliesTo: { tools: ["pay-supplier-invoice"] },
        rules: [
          { id: "aed-only", effect: "deny", when: { attr: "params.currency", op: "neq", value: "AED" }, reason: "Only AED invoices are in scope" },
          { id: "autonomous-under-50k", effect: "allow", when: { attr: "params.amount", op: "lt", value: 50000 }, reason: "Matched invoice within the autonomous limit" },
          { id: "approval-50k-500k", effect: "require_approval", when: { attr: "params.amount", op: "between", value: [50000, 500000] }, approval: { roles: ["approver", "owner"], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, instructions: "Check the invoice against the goods received note." }, reason: "Invoices from AED 50,000 need an Approver" },
          { id: "deny-over-500k", effect: "deny", when: { attr: "params.amount", op: "gt", value: 500000 }, reason: "Above the agent's payment authority" },
        ],
      },
      changeNote: "Initial version",
    });
    await submitForReview(db, t.users.governance_manager!.ctx, version.id);
    await activateVersion(db, owner, version.id);
    await assignPolicy(db, owner, policy.id, { targetType: "agent", targetId: agentId, priority: 100 });
    const ap = makeContext(t.orgId, { type: "integration", id: t.integrations["core-banking-sim"]!, label: "Accounts payable (core banking)" });
    await registerPaymentDocuments(db, ap, {
      documents: [
        { ref: "INV-2026-0412", kind: "invoice", vendorRef: "SUP-GULF-OFFICE", amount: 18400, currency: "AED", detail: { supplier: "Gulf Office Supplies (synthetic)" } },
        { ref: "INV-2026-0415", kind: "invoice", vendorRef: "SUP-DESERT-IT", amount: 63250, currency: "AED", detail: { supplier: "Desert IT Services (synthetic)" } },
        { ref: "INV-2026-0419", kind: "invoice", vendorRef: "SUP-MARINA-FM", amount: 9800, currency: "AED", detail: { supplier: "Marina Facilities (synthetic)" } },
      ],
    });
    return tool.id;
  });
  const agentCtx = makeContext(t.orgId, { type: "agent", id: agentId, label: "treasury-transfer-agent" });
  let n = 0;
  const pay = (params: Record<string, unknown>) => authorizeAndExecute(withTenant, agentCtx, { tool: "pay-supplier-invoice", action: "execute", params, context: {}, justification: "Supplier invoice due this week", idempotencyKey: `demo-ap-${toolId}-${++n}`, principal: { type: "system" }, executionMode: "agent" });
  let refused = 0;
  const first = await pay({ invoiceRef: "INV-2026-0412", vendorRef: "SUP-GULF-OFFICE", amount: 18400, currency: "AED" });
  if (first.grant) await withTenant(t.orgId, (db) => recordAgentExecution(db, agentCtx, first.requestId, { grant: first.grant!.token, outcome: "succeeded", reference: "AP-SIM-77120" }));
  // The same invoice again, as a duplicated email or a looping agent would send it.
  if ((await pay({ invoiceRef: "INV-2026-0412", vendorRef: "SUP-GULF-OFFICE", amount: 18400, currency: "AED" })).status === "denied") refused++;
  // An amount above the invoice.
  if ((await pay({ invoiceRef: "INV-2026-0415", vendorRef: "SUP-DESERT-IT", amount: 68250, currency: "AED" })).status === "denied") refused++;
  return { documents: 3, refused };
}
