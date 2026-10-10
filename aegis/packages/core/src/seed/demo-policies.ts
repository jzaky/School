import type { TenantDb } from "@aegis/db";
import type { OrgContext } from "../lib/context.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../policy/service.js";

/** Illustrative, customer-configurable thresholds. Not universal governance rules. */
export const DEMO_POLICIES = [
  {
    key: "refund-authority",
    name: "Customer refund authority",
    description: "Support agents may refund up to AED 500 autonomously. AED 500 to 2,500 needs an Approver. Above AED 2,500 is denied. Illustrative thresholds.",
    category: "authorization" as const,
    document: {
      version: 1,
      appliesTo: { tools: ["issue-refund"] },
      rules: [
        { id: "aed-only", description: "Refunds are issued in AED only", effect: "deny", when: { attr: "params.currency", op: "neq", value: "AED" }, reason: "Refunds must be in AED" },
        { id: "autonomous-under-500", description: "Autonomous refunds below AED 500", effect: "allow", when: { all: [{ attr: "params.amount", op: "gt", value: 0 }, { attr: "params.amount", op: "lt", value: 500 }] }, reason: "Within autonomous refund limit (below AED 500)" },
        { id: "supervisor-500-2500", description: "Supervisor approval between AED 500 and 2,500", effect: "require_approval", when: { attr: "params.amount", op: "between", value: [500, 2500] }, approval: { roles: ["approver", "governance_manager", "owner"], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, instructions: "Confirm the order exists and the customer is entitled to the refund." }, reason: "Supervisor approval required for refunds between AED 500 and 2,500", riskIndicators: ["elevated_amount"] },
        { id: "deny-over-2500", description: "Refunds above AED 2,500 are outside agent authority", effect: "deny", when: { attr: "params.amount", op: "gt", value: 2500 }, reason: "Refund exceeds the agent's authority (above AED 2,500)", riskIndicators: ["authority_exceeded"], securityEventSeverity: "medium" },
        { id: "velocity", description: "Too many denied attempts today", effect: "deny", when: { attr: "context.deniedCount24h", op: "gte", value: 10 }, reason: "Agent exceeded the daily denied-attempt threshold", riskIndicators: ["repeated_denials"], securityEventSeverity: "high" },
      ],
      tests: [
        { name: "AED 120 allowed", input: { action: { tool: "issue-refund" }, params: { amount: 120, currency: "AED" }, context: { deniedCount24h: 0 } }, expect: "allow" },
        { name: "AED 1,200 approval", input: { action: { tool: "issue-refund" }, params: { amount: 1200, currency: "AED" }, context: { deniedCount24h: 0 } }, expect: "require_approval" },
        { name: "AED 9,000 denied", input: { action: { tool: "issue-refund" }, params: { amount: 9000, currency: "AED" }, context: { deniedCount24h: 0 } }, expect: "deny" },
        { name: "USD denied", input: { action: { tool: "issue-refund" }, params: { amount: 10, currency: "USD" }, context: { deniedCount24h: 0 } }, expect: "deny" },
      ],
    },
    assign: { targetType: "agent" as const, agentSlug: "support-refund-agent" },
  },
  {
    key: "treasury-transfer-limits",
    name: "Treasury transfer limits",
    description: "Transfers up to AED 50,000 are autonomous within business hours. Up to AED 1,000,000 needs an Approver. Above that is denied. Illustrative thresholds.",
    category: "authorization" as const,
    document: {
      version: 1,
      appliesTo: { tools: ["initiate-transfer"], environments: ["production"] },
      rules: [
        { id: "restricted-ledger-only", description: "Transfers must target the payments core ledger", effect: "deny", when: { attr: "resource.key", op: "neq", value: "payments-core" }, reason: "Transfers may only target the payments core ledger" },
        { id: "aed-only", effect: "deny", when: { attr: "params.currency", op: "neq", value: "AED" }, reason: "Only AED transfers are in scope for this agent" },
        { id: "autonomous-under-50k", description: "Autonomous below AED 50,000 during 04:00 to 14:00 UTC (08:00 to 18:00 Dubai)", effect: "allow", when: { all: [{ attr: "params.amount", op: "gt", value: 0 }, { attr: "params.amount", op: "lt", value: 50000 }, { attr: "context.hour", op: "between", value: [4, 14] }] }, reason: "Within autonomous transfer limit during business hours" },
        { id: "after-hours-approval", description: "Any transfer outside business hours needs approval", effect: "require_approval", when: { all: [{ attr: "params.amount", op: "lt", value: 50000 }, { not: { attr: "context.hour", op: "between", value: [4, 14] } }] }, approval: { roles: ["approver", "owner"], minApprovers: 1, expiresInMinutes: 120, separationOfDuties: true, instructions: "After-hours transfer. Confirm the treasury request ticket." }, reason: "After-hours transfers require approval", riskIndicators: ["after_hours"] },
        { id: "manager-50k-1m", description: "AED 50,000 to 1,000,000 needs an Approver", effect: "require_approval", when: { attr: "params.amount", op: "between", value: [50000, 1000000] }, approval: { roles: ["approver", "owner"], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, instructions: "Verify the beneficiary account and the treasury instruction reference." }, reason: "Manager approval required for transfers between AED 50,000 and 1,000,000", riskIndicators: ["high_value"] },
        { id: "deny-over-1m", description: "Above AED 1,000,000 is outside agent authority", effect: "deny", when: { attr: "params.amount", op: "gt", value: 1000000 }, reason: "Transfer exceeds the agent's authority (above AED 1,000,000)", riskIndicators: ["authority_exceeded"], securityEventSeverity: "high" },
      ],
      tests: [
        { name: "AED 250,000 approval", input: { action: { tool: "initiate-transfer" }, agent: { environment: "production" }, resource: { key: "payments-core" }, params: { amount: 250000, currency: "AED" }, context: { hour: 9 } }, expect: "require_approval" },
        { name: "AED 2,000,000 denied", input: { action: { tool: "initiate-transfer" }, agent: { environment: "production" }, resource: { key: "payments-core" }, params: { amount: 2000000, currency: "AED" }, context: { hour: 9 } }, expect: "deny" },
        { name: "AED 10,000 at 09:00 allowed", input: { action: { tool: "initiate-transfer" }, agent: { environment: "production" }, resource: { key: "payments-core" }, params: { amount: 10000, currency: "AED" }, context: { hour: 9 } }, expect: "allow" },
      ],
    },
    assign: { targetType: "agent" as const, agentSlug: "treasury-transfer-agent" },
  },
  {
    key: "customer-data-egress",
    name: "Customer data egress control",
    description: "Customer records may only be exported to the internal warehouse. Any other destination is denied and raises a security event.",
    category: "data_protection" as const,
    document: {
      version: 1,
      appliesTo: { tools: ["export-customer-records", "send-email", "http-request"] },
      rules: [
        { id: "export-internal-only", description: "Exports must go to the internal warehouse", effect: "deny", when: { all: [{ attr: "action.tool", op: "eq", value: "export-customer-records" }, { attr: "params.destination", op: "domain_not_in", value: ["warehouse.meridian-demo.example"] }] }, reason: "Customer records may only be exported to the internal warehouse", riskIndicators: ["data_exfiltration_attempt"], securityEventSeverity: "critical" },
        { id: "export-needs-approval", description: "Even internal exports need approval", effect: "require_approval", when: { attr: "action.tool", op: "eq", value: "export-customer-records" }, approval: { roles: ["security_analyst", "governance_manager", "owner"], minApprovers: 1, expiresInMinutes: 480, separationOfDuties: true, instructions: "Confirm the campaign has a data protection sign-off." }, reason: "Bulk customer exports require data protection approval", riskIndicators: ["bulk_customer_data"] },
        { id: "no-sensitive-in-email", description: "Emails containing restricted data classes are blocked", effect: "deny", when: { all: [{ attr: "action.tool", op: "eq", value: "send-email" }, { attr: "shield.dataClasses", op: "intersects", value: ["card_number", "iban", "emirates_id", "api_key", "private_key"] }] }, reason: "Email contains restricted data classes", riskIndicators: ["sensitive_data_egress"], securityEventSeverity: "high" },
        { id: "email-allowed", effect: "allow", when: { attr: "action.tool", op: "eq", value: "send-email" }, reason: "Email within allowed destinations" },
        { id: "http-allowed", effect: "allow", when: { attr: "action.tool", op: "eq", value: "http-request" }, reason: "HTTP call within allowed destinations" },
      ],
    },
    assign: { targetType: "org" as const },
  },
  {
    key: "read-only-defaults",
    name: "Read-only tool defaults",
    description: "Low-risk read and ticket tools are allowed for any active agent that holds the grant.",
    category: "operational" as const,
    document: {
      version: 1,
      appliesTo: { tools: ["query-crm", "update-ticket", "run-warehouse-query"] },
      rules: [
        { id: "warehouse-read-only", description: "Warehouse queries must be SELECT statements", effect: "deny", when: { all: [{ attr: "action.tool", op: "eq", value: "run-warehouse-query" }, { attr: "params.sql", op: "matches", value: "\\b(insert|update|delete|drop|alter|truncate|grant)\\b" }] }, reason: "Only read-only SQL is permitted", securityEventSeverity: "medium" },
        { id: "allow-reads", effect: "allow", when: { always: true }, reason: "Low-risk tool" },
      ],
    },
    assign: { targetType: "org" as const },
  },
  {
    key: "suspended-agent-guard",
    name: "Suspended agent guard",
    description: "Defense in depth: policy-level deny for agents that are not active (the gateway already blocks them structurally).",
    category: "operational" as const,
    document: { version: 1, rules: [{ id: "not-active", effect: "deny", when: { attr: "agent.status", op: "neq", value: "active" }, reason: "Agent is not active" }] },
    assign: { targetType: "org" as const },
  },
];

export async function seedDemoPolicies(db: TenantDb, authorCtx: OrgContext, activatorCtx: OrgContext, agentsBySlug: Record<string, string>) {
  const ids: Record<string, string> = {};
  for (const p of DEMO_POLICIES) {
    const { policy, version } = await createPolicy(db, authorCtx, { key: p.key, name: p.name, description: p.description, category: p.category, document: p.document, changeNote: "Initial version" });
    await submitForReview(db, authorCtx, version.id);
    await activateVersion(db, activatorCtx, version.id);
    const target = p.assign.targetType === "agent" ? agentsBySlug[p.assign.agentSlug] : null;
    await assignPolicy(db, activatorCtx, policy.id, { targetType: p.assign.targetType, targetId: target ?? null, priority: 100 });
    ids[p.key] = policy.id;
  }
  return ids;
}
