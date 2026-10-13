import type { TenantDb } from "@aegis/db";
import type { OrgContext } from "../lib/context.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../policy/service.js";
import { buildScoreBandPolicyDocument } from "../policy/score-band.js";
import { buildRefundPolicyDocument } from "../policy/templates.js";
import { buildTradingPolicyDocument } from "../policy/trading.js";

/** Illustrative, customer-configurable thresholds. Not universal governance rules. */
export const DEMO_POLICIES = [
  {
    key: "refund-authority",
    name: "Customer refund authority",
    description: "Support agents may refund up to AED 500 autonomously. AED 500 to 2,500 needs an Approver. Above AED 2,500 is denied. A second refund for the same order is refused. Generated from the guided refund template; illustrative thresholds.",
    category: "authorization" as const,
    // Generated from the guided template so the console opens it in the Thresholds form. Everything the
    // hand-written version expressed is here: currency allowlist, autonomous band, approval band with
    // named roles and separation of duties, hard ceiling with a security event, duplicate refusal and
    // a daily denial cap. Reasons are optional for the demo agent; the form can require them.
    document: buildRefundPolicyDocument({
      tools: ["issue-refund", "refund-payment"],
      currency: "AED",
      allowedCurrencies: [],
      autoApproveBelow: 500,
      approvalUpTo: 2500,
      approverRoles: ["approver", "governance_manager", "owner"],
      minApprovers: 1,
      approvalExpiresMinutes: 240,
      separationOfDuties: true,
      blockDuplicates: true,
      duplicateHandling: "deny",
      requireReason: false,
      businessHoursOnly: { enabled: false, startHourUtc: 4, endHourUtc: 14 },
      maxDailyDeniedAttempts: 10,
    }),
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
  {
    key: "trading-mandate",
    name: "Trading mandate (paper)",
    description: "AEGIS Trading: the portfolio agent may trade SPY, QQQ, AAPL, MSFT and NVDA. Orders below USD 5,000 run on their own, USD 5,000 to 50,000 need an Approver within 30 minutes, above is refused. Up to 500 units per order, market hours 14:00 to 20:00 UTC (outside needs a person), duplicates refused, a USD 2,500 daily loss cap. Generated from the guided trading template; illustrative limits.",
    category: "authorization" as const,
    document: buildTradingPolicyDocument({ tools: ["submit-order", "place-order"], currency: "USD", instruments: ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"], allowedSides: ["buy", "sell"], allowedOrderTypes: ["market", "limit"], maxOrderQty: 500, autoApproveNotionalBelow: 5000, approvalNotionalUpTo: 50_000, approverRoles: ["approver", "governance_manager", "owner"], minApprovers: 1, approvalExpiresMinutes: 30, separationOfDuties: true, blockDuplicates: true, requireReason: true, marketHoursOnly: { enabled: true, startHourUtc: 14, endHourUtc: 20, handling: "require_approval" }, maxDailyLoss: 2500, maxDailyOrders: 0 }),
    assign: { targetType: "agent" as const, agentSlug: "portfolio-trading-agent" },
  },
  {
    key: "refund-fraud-score",
    name: "Refund fraud score routing (example)",
    description: "Guided score-band example: routes the fraud model's score sent with each refund into clear, review, hold and block. Not assigned to any agent until yours sends a score.",
    category: "authorization" as const,
    document: buildScoreBandPolicyDocument({ tools: ["issue-refund", "refund-payment"], scoreSource: "context", scoreAttribute: "fraudScore", scale: "unit", reviewFrom: 0.4, holdFrom: 0.55, blockFrom: 0.7, missingScore: "deny", approverRoles: ["approver", "governance_manager", "owner"], minApprovers: 1, approvalExpiresMinutes: 240, holdExpiresMinutes: 60, holdEscalateToRoles: ["governance_manager"], separationOfDuties: true }),
    assign: null,
  },
  {
    key: "refund-review-guards",
    name: "Refund review guards",
    description: "Goodwill refunds are capped at AED 250 and still go through. Refunds taken on a phone call need the support ticket before AEGIS decides. A refund for an account flagged for suspected takeover is held for security review. Illustrative rules.",
    category: "authorization" as const,
    document: {
      version: 1,
      appliesTo: { tools: ["issue-refund"], actions: [], environments: [] },
      rules: [
        { id: "goodwill-cap", description: "Goodwill refunds are capped at AED 250", effect: "restrict", when: { attr: "context.supplied.goodwill", op: "eq", value: true }, restrict: { capNumeric: { amount: 250 }, setParams: {}, removeParams: [], note: "Goodwill refunds are capped at AED 250" }, reason: "Goodwill refund reduced to the AED 250 cap", riskIndicators: ["goodwill"] },
        { id: "voice-needs-ticket", description: "Phone refunds need the support ticket reference", effect: "request_more_information", when: { all: [{ attr: "context.supplied.channel", op: "eq", value: "voice" }, { attr: "context.supplied.ticketRef", op: "missing" }] }, moreInformation: { fields: ["ticketRef"], message: "Give the support ticket that records the customer's call.", expiresInMinutes: 240 }, reason: "Support ticket reference missing for a phone refund", riskIndicators: [] },
        { id: "takeover-hold", description: "Accounts flagged for suspected takeover are held for security review", effect: "quarantine", when: { attr: "context.supplied.riskSignal", op: "eq", value: "account_takeover_suspected" }, quarantine: { severity: "high", reviewRoles: [], expiresInMinutes: 24 * 60, note: "The customer account is flagged for suspected takeover" }, reason: "Held: the customer account is flagged for suspected takeover", riskIndicators: ["account_takeover"] },
      ],
      tests: [
        { name: "goodwill refund is narrowed", input: { action: { tool: "issue-refund", name: "execute" }, params: { amount: 400 }, context: { supplied: { goodwill: true } } }, expect: "restrict" },
        { name: "phone refund without ticket asks for it", input: { action: { tool: "issue-refund", name: "execute" }, params: { amount: 100 }, context: { supplied: { channel: "voice" } } }, expect: "request_more_information" },
        { name: "takeover flag quarantines", input: { action: { tool: "issue-refund", name: "execute" }, params: { amount: 100 }, context: { supplied: { riskSignal: "account_takeover_suspected" } } }, expect: "quarantine" },
      ],
    },
    assign: { targetType: "agent" as const, agentSlug: "support-refund-agent" },
  },
];

export async function seedDemoPolicies(db: TenantDb, authorCtx: OrgContext, activatorCtx: OrgContext, agentsBySlug: Record<string, string>) {
  const ids: Record<string, string> = {};
  for (const p of DEMO_POLICIES) {
    const { policy, version } = await createPolicy(db, authorCtx, { key: p.key, name: p.name, description: p.description, category: p.category, document: p.document, changeNote: "Initial version" });
    await submitForReview(db, authorCtx, version.id);
    await activateVersion(db, activatorCtx, version.id);
    if (p.assign) {
      const target = p.assign.targetType === "agent" ? agentsBySlug[p.assign.agentSlug] : null;
      await assignPolicy(db, activatorCtx, policy.id, { targetType: p.assign.targetType, targetId: target ?? null, priority: 100 });
    }
    ids[p.key] = policy.id;
  }
  return ids;
}
