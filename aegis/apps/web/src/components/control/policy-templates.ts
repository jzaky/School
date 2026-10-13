/**
 * Starting documents for new policies. Written for the console; thresholds are placeholders the
 * customer edits. Nothing here is copied from the seed data.
 */
export interface PolicyTemplate {
  id: string;
  name: string;
  description: string;
  category: "authorization" | "data_protection" | "tool_security" | "operational";
  document: Record<string, unknown>;
}

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: "empty",
    name: "Empty skeleton",
    description: "Starts with a single rule that denies everything and no test cases. Build the rest yourself.",
    category: "authorization",
    document: {
      version: 1,
      appliesTo: { tools: [], actions: [], environments: [] },
      rules: [{ id: "deny-everything-else", description: "Explicit default deny", effect: "deny", when: { always: true }, reason: "No rule allowed this action" }],
      tests: [],
    },
  },
  {
    id: "refund-tiers",
    name: "Refund tiers",
    description: "Three amount bands: autonomous, approval, denied.",
    category: "authorization",
    document: {
      version: 1,
      appliesTo: { tools: ["issue-refund"], actions: [], environments: [] },
      rules: [
        { id: "tier-1-autonomous", description: "Small refunds run without a human", effect: "allow", when: { all: [{ attr: "params.amount", op: "gt", value: 0 }, { attr: "params.amount", op: "lte", value: 250 }] }, reason: "Within the autonomous refund band" },
        { id: "tier-2-approval", description: "Medium refunds need one approver", effect: "require_approval", when: { all: [{ attr: "params.amount", op: "gt", value: 250 }, { attr: "params.amount", op: "lte", value: 1500 }] }, approval: { roles: ["approver"], minApprovers: 1, expiresInMinutes: 180, separationOfDuties: true, escalateToRoles: [], instructions: "Check the order and the refund reason before approving." }, reason: "Refund needs supervisor approval", riskIndicators: ["elevated_amount"] },
        { id: "tier-3-denied", description: "Large refunds are outside agent authority", effect: "deny", when: { attr: "params.amount", op: "gt", value: 1500 }, reason: "Refund above the agent's authority", riskIndicators: ["authority_exceeded"], securityEventSeverity: "medium" },
      ],
      tests: [
        { name: "100 is autonomous", input: { action: { tool: "issue-refund" }, params: { amount: 100 } }, expect: "allow" },
        { name: "800 needs approval", input: { action: { tool: "issue-refund" }, params: { amount: 800 } }, expect: "require_approval" },
        { name: "5000 is denied", input: { action: { tool: "issue-refund" }, params: { amount: 5000 } }, expect: "deny" },
      ],
    },
  },
  {
    id: "transfer-limits",
    name: "Transfer limits",
    description: "Runs on its own during business hours, needs approval in a middle band, and refuses anything above a hard ceiling.",
    category: "authorization",
    document: {
      version: 1,
      appliesTo: { tools: ["initiate-transfer"], actions: [], environments: ["production"] },
      rules: [
        { id: "currency-allowlist", description: "Only listed currencies", effect: "deny", when: { attr: "params.currency", op: "not_in", value: ["AED"] }, reason: "Currency not permitted for this agent" },
        { id: "business-hours-autonomy", description: "Autonomous below the floor during 04:00 to 14:00 UTC", effect: "allow", when: { all: [{ attr: "params.amount", op: "gt", value: 0 }, { attr: "params.amount", op: "lt", value: 25000 }, { attr: "context.hour", op: "between", value: [4, 14] }] }, reason: "Within autonomous limit during business hours" },
        { id: "approval-band", description: "Approval between the floor and the ceiling", effect: "require_approval", when: { all: [{ attr: "params.amount", op: "gte", value: 25000 }, { attr: "params.amount", op: "lte", value: 500000 }] }, approval: { roles: ["approver"], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, escalateToRoles: [], instructions: "Verify the beneficiary and the instruction reference." }, reason: "Approval required for this amount", riskIndicators: ["high_value"] },
        { id: "after-hours", description: "After-hours transfers need approval regardless of amount", effect: "require_approval", when: { not: { attr: "context.hour", op: "between", value: [4, 14] } }, approval: { roles: ["approver"], minApprovers: 1, expiresInMinutes: 120, separationOfDuties: true, escalateToRoles: [], instructions: "After-hours transfer." }, reason: "After-hours transfers require approval", riskIndicators: ["after_hours"] },
        { id: "ceiling", description: "Nothing above the ceiling", effect: "deny", when: { attr: "params.amount", op: "gt", value: 500000 }, reason: "Transfer exceeds the ceiling", riskIndicators: ["authority_exceeded"], securityEventSeverity: "high" },
      ],
      tests: [
        { name: "10,000 at 09:00 UTC allowed", input: { action: { tool: "initiate-transfer" }, agent: { environment: "production" }, params: { amount: 10000, currency: "AED" }, context: { hour: 9 } }, expect: "allow" },
        { name: "100,000 needs approval", input: { action: { tool: "initiate-transfer" }, agent: { environment: "production" }, params: { amount: 100000, currency: "AED" }, context: { hour: 9 } }, expect: "require_approval" },
        { name: "900,000 denied", input: { action: { tool: "initiate-transfer" }, agent: { environment: "production" }, params: { amount: 900000, currency: "AED" }, context: { hour: 9 } }, expect: "deny" },
      ],
    },
  },
  {
    id: "egress-allowlist",
    name: "Egress allowlist",
    description: "Data may only go to destinations on the approved list; anything carrying sensitive data types is blocked.",
    category: "data_protection",
    document: {
      version: 1,
      appliesTo: { tools: ["send-email", "http-request", "export-customer-records"], actions: [], environments: [] },
      rules: [
        { id: "destination-allowlist", description: "Destination domain must be approved", effect: "deny", when: { all: [{ attr: "context.destinationDomain", op: "exists" }, { attr: "context.destinationDomain", op: "domain_not_in", value: ["*.example.com"] }] }, reason: "Destination is not on the egress allowlist", riskIndicators: ["egress_blocked"], securityEventSeverity: "high" },
        { id: "no-sensitive-classes", description: "Block payloads carrying restricted data classes", effect: "deny", when: { attr: "shield.dataClasses", op: "intersects", value: ["card_number", "iban", "api_key", "private_key"] }, reason: "Payload contains restricted data classes", riskIndicators: ["sensitive_data_egress"], securityEventSeverity: "high" },
        { id: "bulk-export-approval", description: "Bulk exports need data protection approval", effect: "require_approval", when: { attr: "action.tool", op: "eq", value: "export-customer-records" }, approval: { roles: ["security_analyst"], minApprovers: 1, expiresInMinutes: 480, separationOfDuties: true, escalateToRoles: [], instructions: "Confirm a data protection sign-off exists." }, reason: "Bulk export requires approval", riskIndicators: ["bulk_customer_data"] },
        { id: "allow-listed-egress", description: "Everything else on the allowlist", effect: "allow", when: { always: true }, reason: "Destination within the allowlist" },
      ],
      tests: [
        { name: "external domain denied", input: { action: { tool: "http-request" }, context: { destinationDomain: "files.evil.example.org" }, shield: { dataClasses: [] } }, expect: "deny" },
        { name: "allowed domain", input: { action: { tool: "http-request" }, context: { destinationDomain: "api.example.com" }, shield: { dataClasses: [] } }, expect: "allow" },
      ],
    },
  },
  {
    id: "read-only-defaults",
    name: "Read-only defaults",
    description: "Low-risk read-only tools are allowed; database queries that change data (mutating SQL) are denied.",
    category: "operational",
    document: {
      version: 1,
      appliesTo: { tools: ["query-crm", "run-warehouse-query"], actions: [], environments: [] },
      rules: [
        { id: "no-mutating-sql", description: "Warehouse queries must not mutate", effect: "deny", when: { all: [{ attr: "action.tool", op: "eq", value: "run-warehouse-query" }, { attr: "params.sql", op: "matches", value: "\\b(insert|update|delete|drop|alter|truncate|grant)\\b" }] }, reason: "Only read-only SQL is permitted", securityEventSeverity: "medium" },
        { id: "allow-reads", description: "Reads by active agents", effect: "allow", when: { attr: "agent.status", op: "eq", value: "active" }, reason: "Low-risk read tool" },
      ],
      tests: [
        { name: "select allowed", input: { action: { tool: "run-warehouse-query" }, agent: { status: "active" }, params: { sql: "select 1" } }, expect: "allow" },
        { name: "drop denied", input: { action: { tool: "run-warehouse-query" }, agent: { status: "active" }, params: { sql: "drop table x" } }, expect: "deny" },
      ],
    },
  },
];

/** Input paths from docs/POLICY_LANGUAGE.md, offered as suggestions in the rule builder. */
export const INPUT_ATTRIBUTES: string[] = [
  "agent.id",
  "agent.slug",
  "agent.status",
  "agent.environment",
  "agent.riskTier",
  "agent.dataClassificationLimit",
  "agent.teamId",
  "agent.tools",
  "agent.version",
  "principal.type",
  "principal.userId",
  "principal.ref",
  "action.tool",
  "action.name",
  "action.riskLevel",
  "action.integration",
  "resource.key",
  "resource.type",
  "resource.classification",
  "resource.permittedActions",
  "params.amount",
  "params.currency",
  "params.destination",
  "params.to",
  "params.orderId",
  "params.sql",
  "context.time",
  "context.hour",
  "context.weekday",
  "context.ip",
  "context.requestCount24h",
  "context.deniedCount24h",
  "context.approvalsPending",
  "context.destinationDomain",
  "context.amount",
  "context.currency",
  "shield.dataClasses",
  "shield.highestSeverity",
  "shield.injectionSignals",
  "shield.blocked",
];

export const POLICY_CATEGORIES = [
  { value: "authorization", label: "Authorization" },
  { value: "data_protection", label: "Data protection" },
  { value: "tool_security", label: "Tool security" },
  { value: "operational", label: "Operational" },
];

export const EFFECT_LABEL: Record<string, string> = { allow: "Allow", deny: "Deny", require_approval: "Require approval" };
