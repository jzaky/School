/**
 * Sales demonstration environment (docs/COMMERCIAL_READINESS.md). A separate synthetic organization with six
 * scenarios, each driven through the real gateway, policy engine, uncertainty, reasoning and autonomy
 * engines. No downstream system is called: every scenario runs in "agent" execution mode, so an allowed
 * action returns a one-time permission slip and nothing else happens. All people, members, claims and
 * accounts are fictional. Nothing here is a live integration.
 */
import { rawPrisma, withTenant, type TenantDb } from "@aegis/db";
import { createAgent, setAgentTool, transitionAgent, upsertTool } from "../agents/registry.js";
import { decideApprovalAndExecute } from "../approvals/service.js";
import { lowerAutonomy } from "../autonomy/service.js";
import { authorizeAndExecute, type GatewayResponse } from "../gateway/gateway.js";
import { listUserMemberships } from "../identity/memberships.js";
import { makeContext, type OrgContext } from "../lib/context.js";
import { conflict, notFound, validation } from "../lib/errors.js";
import { createOrganization } from "../orgs/orgs.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../policy/service.js";
import { updateToolReasoningPolicy } from "../reasoning/service.js";
import { updateToolUncertaintyPolicy } from "../uncertainty/service.js";

export const SALES_SCENARIOS = [
  { key: "finance", title: "Finance: a payment above the agent's authority", summary: "An accounts payable agent pays a supplier. Small payments go ahead; one above its limit waits for an approver.", shows: "Approval required" },
  { key: "healthcare", title: "Healthcare: restricted patient information", summary: "A health insurance claims agent asks for medical records. Unauthorized access is blocked; a legitimate claim gets only the fields it needs.", shows: "Blocked, and narrowed" },
  { key: "it", title: "Enterprise IT: a production infrastructure change", summary: "A platform operations agent changes infrastructure. AEGIS checks identity, policy and approval before anything reaches production.", shows: "Identity, policy and approval" },
  { key: "uncertainty", title: "Uncertainty: contradictory information", summary: "A payments agent changes a supplier's bank details while its sources disagree. AEGIS holds it and asks for more evidence.", shows: "Additional evidence requested" },
  { key: "autonomy", title: "Managed autonomy: repeated policy violations", summary: "A collections agent keeps breaking policy. AEGIS lowers its autonomy step by step and finally suspends it.", shows: "Autonomy reduced, then suspended" },
  { key: "reasoning", title: "Reasoning governance: insufficient evidence", summary: "A credit agent proposes a limit increase with reasons that cite no evidence. AEGIS names what is missing and holds execution.", shows: "Missing evidence identified" },
] as const;
export type SalesScenarioKey = (typeof SALES_SCENARIOS)[number]["key"];

export interface SalesStep {
  title: string;
  detail: string;
  outcome: string;
  requestId?: string;
  /** Whether AEGIS did what the scenario expects at this step. */
  expected: boolean;
}

export interface SalesRun {
  scenario: SalesScenarioKey;
  correlationId: string;
  steps: SalesStep[];
  simulated: true;
}

export const SALES_DEMO_NOTICE = "Simulated environment: synthetic organization and data; decisions are made by the real AEGIS engines, and no external system is called.";

const TOOLS = [
  { key: "pay-supplier", name: "Pay supplier", description: "Pays an approved supplier invoice (simulated; no bank is called)", riskLevel: "high" as const },
  { key: "read-medical-record", name: "Read medical record", description: "Reads fields from a member's medical record for a claim (synthetic records)", riskLevel: "critical" as const },
  { key: "apply-infrastructure-change", name: "Apply infrastructure change", description: "Applies an infrastructure change through the deployment pipeline (simulated)", riskLevel: "critical" as const },
  { key: "update-payee-details", name: "Update payee details", description: "Changes the bank account a supplier is paid into (simulated)", riskLevel: "high" as const },
  { key: "send-payment-reminder", name: "Send payment reminder", description: "Sends a payment reminder to a customer (simulated)", riskLevel: "low" as const },
  { key: "raise-credit-limit", name: "Raise credit limit", description: "Raises a customer's card credit limit (simulated)", riskLevel: "high" as const },
];

const AGENTS = [
  { slug: "accounts-payable-agent", name: "Accounts Payable Agent", tools: ["pay-supplier"], purpose: "Pays approved supplier invoices" },
  { slug: "health-claims-agent", name: "Health Claims Agent", tools: ["read-medical-record"], purpose: "Assesses health insurance claims" },
  { slug: "platform-ops-agent", name: "Platform Operations Agent", tools: ["apply-infrastructure-change"], purpose: "Applies routine infrastructure changes" },
  { slug: "it-helpdesk-bot", name: "IT Helpdesk Bot", tools: [], purpose: "Answers IT questions; holds no infrastructure permissions" },
  { slug: "payments-ops-agent", name: "Payments Operations Agent", tools: ["update-payee-details"], purpose: "Maintains supplier payment details" },
  { slug: "credit-limit-agent", name: "Credit Limit Agent", tools: ["raise-credit-limit"], purpose: "Reviews requests for higher card limits" },
];

const POLICIES = [
  {
    key: "supplier-payment-authority",
    name: "Supplier payment authority",
    agent: "accounts-payable-agent",
    document: {
      version: 1,
      appliesTo: { tools: ["pay-supplier"] },
      rules: [
        { id: "aed-only", effect: "deny", when: { attr: "params.currency", op: "neq", value: "AED" }, reason: "Only AED payments are in scope" },
        { id: "autonomous-under-20k", effect: "allow", when: { all: [{ attr: "params.amount", op: "gt", value: 0 }, { attr: "params.amount", op: "lt", value: 20000 }] } },
        { id: "approval-20k-500k", effect: "require_approval", when: { attr: "params.amount", op: "between", value: [20000, 500000] }, approval: { roles: ["approver", "owner"], minApprovers: 1, expiresInMinutes: 240, instructions: "Check the invoice and the supplier before approving" } },
        { id: "deny-over-500k", effect: "deny", when: { attr: "params.amount", op: "gt", value: 500000 }, reason: "Above the agent's authority (AED 500,000)", securityEventSeverity: "high" },
      ],
      tests: [],
    },
  },
  {
    key: "medical-records-access",
    name: "Medical records access",
    agent: "health-claims-agent",
    document: {
      version: 1,
      appliesTo: { tools: ["read-medical-record"] },
      rules: [
        { id: "claim-purpose-only", effect: "deny", when: { attr: "context.supplied.purpose", op: "neq", value: "claim_assessment" }, reason: "Medical records are released only to assess an open claim", securityEventSeverity: "high" },
        { id: "no-full-history", effect: "deny", when: { attr: "params.scope", op: "eq", value: "full_history" }, reason: "A member's full medical history is never released to an agent", securityEventSeverity: "high" },
        { id: "claim-fields-only", effect: "restrict", when: { all: [{ attr: "context.supplied.purpose", op: "eq", value: "claim_assessment" }, { attr: "params.claimId", op: "exists" }] }, restrict: { setParams: { fields: ["diagnosis_codes", "treatment_dates", "provider"] }, note: "Only the fields needed to assess the claim" } },
      ],
      tests: [],
    },
  },
  {
    key: "production-change-control",
    name: "Production change control",
    agent: "platform-ops-agent",
    document: {
      version: 1,
      appliesTo: { tools: ["apply-infrastructure-change"] },
      rules: [
        { id: "no-destructive-prod", effect: "deny", when: { all: [{ attr: "params.environment", op: "eq", value: "production" }, { attr: "params.operation", op: "in", value: ["drop_database", "delete_cluster", "disable_backups"] }] }, reason: "Destructive operations on production are never run by an agent", securityEventSeverity: "high" },
        { id: "prod-needs-ticket", effect: "request_more_information", when: { all: [{ attr: "params.environment", op: "eq", value: "production" }, { attr: "params.changeTicket", op: "missing" }] }, moreInformation: { fields: ["params.changeTicket"], message: "Production changes need an approved change ticket", expiresInMinutes: 120 } },
        { id: "prod-cab-approval", effect: "require_approval", when: { all: [{ attr: "params.environment", op: "eq", value: "production" }, { attr: "params.changeTicket", op: "exists" }] }, approval: { roles: ["approver", "owner"], minApprovers: 1, expiresInMinutes: 120, instructions: "Change advisory approval for a production change" } },
        { id: "staging-autonomous", effect: "allow", when: { attr: "params.environment", op: "eq", value: "staging" } },
      ],
      tests: [],
    },
  },
  {
    key: "payee-change-control",
    name: "Payee change control",
    agent: "payments-ops-agent",
    document: { version: 1, appliesTo: { tools: ["update-payee-details"] }, rules: [{ id: "known-supplier", effect: "allow", when: { attr: "params.supplierId", op: "starts_with", value: "SUP-" } }], tests: [] },
  },
  {
    key: "credit-limit-authority",
    name: "Credit limit authority",
    agent: "credit-limit-agent",
    document: {
      version: 1,
      appliesTo: { tools: ["raise-credit-limit"] },
      rules: [
        { id: "increase-up-to-50k", effect: "allow", when: { all: [{ attr: "params.newLimit", op: "gt", value: 0 }, { attr: "params.newLimit", op: "lte", value: 50000 }] } },
        { id: "deny-above-50k", effect: "deny", when: { attr: "params.newLimit", op: "gt", value: 50000 }, reason: "Above the agent's authority (AED 50,000)" },
      ],
      tests: [],
    },
  },
  {
    key: "reminder-channels",
    name: "Payment reminder channels",
    agent: null,
    document: {
      version: 1,
      appliesTo: { tools: ["send-payment-reminder"] },
      rules: [
        { id: "approved-channels", effect: "allow", when: { attr: "params.channel", op: "in", value: ["email", "sms"] } },
        { id: "no-other-channels", effect: "deny", when: { attr: "params.channel", op: "not_in", value: ["email", "sms"] }, reason: "Reminders go only through the approved email and SMS channels" },
      ],
      tests: [],
    },
  },
];

function slugFor(userId: string) {
  return `sales-demo-${userId.replace(/-/g, "").slice(-10)}`;
}

/** The current user's sales demonstration organization, if it exists and they belong to it. */
export async function findSalesDemo(userId: string) {
  const org = await rawPrisma().organization.findUnique({ where: { slug: slugFor(userId) } });
  if (!org) return null;
  const m = (await listUserMemberships(userId)).find((x) => x.orgId === org.id && x.status === "active");
  return m ? org : null;
}

/**
 * Creates the sales demonstration organization for this person, with them as owner. Policies are written
 * by AEGIS itself (a system author) and activated by the person, so the four-eyes rule holds.
 */
export async function setupSalesDemo(userId: string) {
  if (await findSalesDemo(userId)) throw conflict("Your sales demonstration environment already exists");
  const org = await createOrganization({ name: "Sales Demonstration (synthetic)", slug: slugFor(userId), ownerUserId: userId, demoMode: true });
  await rawPrisma().organization.update({ where: { id: org.id }, data: { settings: { salesDemo: true, timezone: "Asia/Dubai", currency: "AED" } } });
  const m = (await listUserMemberships(userId)).find((x) => x.orgId === org.id)!;
  const owner = makeContext(org.id, { type: "user", id: userId, permissions: m.permissions, membershipId: m.membershipId });
  const system = makeContext(org.id, { type: "system", id: null, label: "sales-demo-setup" });
  await withTenant(org.id, async (db) => {
    const tools: Record<string, string> = {};
    for (const t of TOOLS) tools[t.key] = (await upsertTool(db, owner, { ...t, integrationId: null, parameterSchema: {}, destinationRules: { allowedDomains: [], allowedResourceKeys: [] } })).id;
    const agents: Record<string, string> = {};
    for (const a of AGENTS) {
      const row = await createAgent(db, owner, { slug: a.slug, name: a.name, description: `${a.purpose}. Synthetic agent for the sales demonstration.`, environment: "production", purpose: a.purpose, dataClassificationLimit: "restricted", riskTier: "high" });
      for (const k of a.tools) await setAgentTool(db, owner, row.id, tools[k]!, true);
      await transitionAgent(db, owner, row.id, "registered", "sales demonstration setup");
      await transitionAgent(db, owner, row.id, "active", "sales demonstration setup");
      agents[a.slug] = row.id;
    }
    for (const p of POLICIES) {
      const { policy, version } = await createPolicy(db, system, { key: p.key, name: p.name, description: "Illustrative policy for the sales demonstration.", category: "authorization", document: p.document, changeNote: "Sales demonstration setup" });
      await submitForReview(db, system, version.id);
      await activateVersion(db, owner, version.id);
      await assignPolicy(db, owner, policy.id, p.agent ? { targetType: "agent", targetId: agents[p.agent]!, priority: 100 } : { targetType: "org", targetId: null, priority: 100 });
    }
    await updateToolUncertaintyPolicy(db, owner, tools["update-payee-details"]!, { enabled: true, requireEvidenceFor: ["accountReference"], trustedSources: ["core-banking", "supplier-callback"], onHigh: "request_more_information" });
    await updateToolReasoningPolicy(db, owner, tools["raise-credit-limit"]!, { enabled: true, requireRationale: true, requireCitations: true, onFailure: "request_more_information" });
  });
  return org;
}

// ---------- running ----------

interface Run {
  orgId: string;
  person: OrgContext;
  agentIds: Record<string, string>;
  correlationId: string;
}

function agentCtx(r: Run, slug: string, now?: Date) {
  const id = r.agentIds[slug];
  if (!id) throw notFound(`Demo agent ${slug}`);
  return makeContext(r.orgId, { type: "agent", id, label: slug }, { requestId: r.correlationId, now });
}

let seq = 0;
async function ask(r: Run, slug: string, input: { tool: string; params: Record<string, unknown>; context?: Record<string, unknown>; justification?: string; key?: string }, now?: Date): Promise<GatewayResponse> {
  return authorizeAndExecute(withTenant, agentCtx(r, slug, now), { tool: input.tool, action: "execute", params: input.params, context: input.context ?? {}, justification: input.justification ?? "", idempotencyKey: input.key ?? `${r.correlationId}-${++seq}`, principal: { type: "system" }, executionMode: "agent" });
}

function describe(g: GatewayResponse): string {
  if (g.status === "allowed" || g.status === "approved") return g.restrictions ? `Allowed with limits: ${g.restrictions.note || g.restrictions.applied.join("; ")}. One-time permission issued; nothing else ran` : "Allowed. One-time permission issued; nothing else ran";
  if (g.status === "pending_approval") return `Waiting for an approver: ${g.reasons[0] ?? "policy requires approval"}`;
  if (g.status === "awaiting_information") return `More information requested: ${g.moreInformation?.fields.join(", ") ?? "details"}`;
  if (g.status === "denied") return `Refused: ${g.reasons[0] ?? "policy"}`;
  if (g.status === "quarantined") return "Quarantined for security review";
  return g.status;
}

const allowedLike = (g: GatewayResponse) => g.status === "allowed" || g.status === "approved";

async function finance(r: Run): Promise<SalesStep[]> {
  const small = await ask(r, "accounts-payable-agent", { tool: "pay-supplier", params: { supplierId: "SUP-1042", invoice: "INV-SYN-7781", amount: 8400, currency: "AED" } });
  const big = await ask(r, "accounts-payable-agent", { tool: "pay-supplier", params: { supplierId: "SUP-2210", invoice: "INV-SYN-7790", amount: 186000, currency: "AED" } });
  const huge = await ask(r, "accounts-payable-agent", { tool: "pay-supplier", params: { supplierId: "SUP-2210", invoice: "INV-SYN-7791", amount: 740000, currency: "AED" } });
  return [
    { title: "AED 8,400 supplier payment", detail: "Below the AED 20,000 limit for autonomous payments", outcome: describe(small), requestId: small.requestId, expected: allowedLike(small) },
    { title: "AED 186,000 supplier payment", detail: "Between AED 20,000 and 500,000: an approver must check the invoice first", outcome: describe(big), requestId: big.requestId, expected: big.status === "pending_approval" },
    { title: "AED 740,000 supplier payment", detail: "Above the agent's authority: refused before anything happens, and a security event is raised", outcome: describe(huge), requestId: huge.requestId, expected: huge.status === "denied" },
  ];
}

async function healthcare(r: Run): Promise<SalesStep[]> {
  const fishing = await ask(r, "health-claims-agent", { tool: "read-medical-record", params: { memberRef: "MBR-SYN-0042", scope: "selected_fields" }, context: { purpose: "eligibility_check" }, justification: "Check whether the member is likely to claim again" });
  const full = await ask(r, "health-claims-agent", { tool: "read-medical-record", params: { memberRef: "MBR-SYN-0042", claimId: "CLM-SYN-5531", scope: "full_history" }, context: { purpose: "claim_assessment" } });
  const ok = await ask(r, "health-claims-agent", { tool: "read-medical-record", params: { memberRef: "MBR-SYN-0042", claimId: "CLM-SYN-5531", scope: "selected_fields", fields: ["diagnosis_codes", "treatment_dates", "provider", "medication_history", "mental_health_notes"] }, context: { purpose: "claim_assessment" } });
  return [
    { title: "Records requested without an open claim", detail: "The agent gives an eligibility check as its purpose", outcome: describe(fishing), requestId: fishing.requestId, expected: fishing.status === "denied" },
    { title: "Full medical history requested for a claim", detail: "Even with a claim, the full history is never released to an agent", outcome: describe(full), requestId: full.requestId, expected: full.status === "denied" },
    { title: "Fields for open claim CLM-SYN-5531", detail: "The agent asked for five fields including mental health notes; only the three needed for the claim are released", outcome: describe(ok), requestId: ok.requestId, expected: allowedLike(ok) && !!ok.restrictions },
  ];
}

async function it(r: Run): Promise<SalesStep[]> {
  const staging = await ask(r, "platform-ops-agent", { tool: "apply-infrastructure-change", params: { environment: "staging", operation: "scale_service", service: "payments-api", replicas: 6 } });
  const impostor = await ask(r, "it-helpdesk-bot", { tool: "apply-infrastructure-change", params: { environment: "production", operation: "scale_service", service: "payments-api", replicas: 2, changeTicket: "CHG-SYN-3301" } });
  const key = `${r.correlationId}-prod`;
  const noTicket = await ask(r, "platform-ops-agent", { tool: "apply-infrastructure-change", params: { environment: "production", operation: "rotate_certificates", service: "edge-gateway" }, key });
  const withTicket = await ask(r, "platform-ops-agent", { tool: "apply-infrastructure-change", params: { environment: "production", operation: "rotate_certificates", service: "edge-gateway", changeTicket: "CHG-SYN-3302" }, key });
  const destroy = await ask(r, "platform-ops-agent", { tool: "apply-infrastructure-change", params: { environment: "production", operation: "drop_database", service: "ledger-db", changeTicket: "CHG-SYN-3303" } });
  return [
    { title: "Scale a staging service", detail: "Staging changes run on their own", outcome: describe(staging), requestId: staging.requestId, expected: allowedLike(staging) },
    { title: "The helpdesk bot tries a production change", detail: "Identity check: this agent holds no permission for infrastructure changes, whatever its request says", outcome: describe(impostor), requestId: impostor.requestId, expected: impostor.status === "denied" },
    { title: "Production certificate rotation without a change ticket", detail: "Policy check: production needs an approved change ticket", outcome: describe(noTicket), requestId: noTicket.requestId, expected: noTicket.status === "awaiting_information" },
    { title: "The agent resubmits with ticket CHG-SYN-3302", detail: "Approval check: the change advisory approver must agree before it runs", outcome: describe(withTicket), requestId: withTicket.requestId, expected: withTicket.status === "pending_approval" },
    { title: "Drop the production ledger database", detail: "Destructive production operations are never run by an agent, ticket or not", outcome: describe(destroy), requestId: destroy.requestId, expected: destroy.status === "denied" },
  ];
}

async function uncertainty(r: Run): Promise<SalesStep[]> {
  const params = { supplierId: "SUP-1042", accountReference: "ACC-SYN-88214" };
  const conflicting = await ask(r, "payments-ops-agent", {
    tool: "update-payee-details",
    params,
    context: { evidence: [{ field: "accountReference", value: "ACC-SYN-88214", source: "supplier-email" }, { field: "accountReference", value: "ACC-SYN-10077", source: "core-banking" }] },
    justification: "Supplier emailed new bank details",
  });
  let reviewer = "No approval was created";
  let reviewerOk = false;
  if (conflicting.status === "pending_approval") {
    const ap = await withTenant(r.orgId, (db) => db.approvalRequest.findFirstOrThrow({ where: { actionRequestId: conflicting.requestId } }));
    const d = await decideApprovalAndExecute((fn) => withTenant(r.orgId, fn), r.person, ap.id, { decision: "request_info", comment: "Call the supplier on the number we hold and confirm the account before changing it", requestHash: ap.requestHash });
    reviewer = `Reviewer asked for more evidence (${d.status})`;
    reviewerOk = d.status === "more_info";
  }
  const missing = await ask(r, "payments-ops-agent", { tool: "update-payee-details", params, context: { evidence: [{ field: "accountReference", value: "ACC-SYN-88214", source: "supplier-email" }], missing: ["supplier callback confirmation"] } });
  const confirmed = await ask(r, "payments-ops-agent", { tool: "update-payee-details", params, context: { evidence: [{ field: "accountReference", value: "ACC-SYN-88214", source: "supplier-callback" }, { field: "accountReference", value: "ACC-SYN-88214", source: "core-banking" }] } });
  return [
    { title: "Two sources disagree on the new account", detail: "The supplier's email says ACC-SYN-88214; the core banking record says ACC-SYN-10077", outcome: describe(conflicting), requestId: conflicting.requestId, expected: conflicting.status === "pending_approval" },
    { title: "The reviewer asks for additional evidence", detail: "The change stays held until the agent brings a confirmation", outcome: reviewer, requestId: conflicting.requestId, expected: reviewerOk },
    { title: "The agent says it could not confirm with the supplier", detail: "The tool requires evidence for the account; the agent reports what is missing", outcome: describe(missing), requestId: missing.requestId, expected: missing.status === "awaiting_information" },
    { title: "Callback and core banking now agree", detail: "Two trusted sources confirm the same account", outcome: describe(confirmed), requestId: confirmed.requestId, expected: allowedLike(confirmed) },
  ];
}

async function autonomy(r: Run): Promise<SalesStep[]> {
  // A fresh agent per run, so the scenario starts from the same place every time.
  const n = await withTenant(r.orgId, (db) => db.agent.count({ where: { orgId: r.orgId, slug: { startsWith: "collections-agent" } } }));
  const slug = `collections-agent-${n + 1}`;
  const tool = await withTenant(r.orgId, (db) => db.tool.findFirstOrThrow({ where: { orgId: r.orgId, key: "send-payment-reminder" } }));
  const agentId = await withTenant(r.orgId, async (db) => {
    const row = await createAgent(db, r.person, { slug, name: `Collections Agent (run ${n + 1})`, description: "Sends payment reminders. Synthetic agent for the managed autonomy scenario; automatic downgrades and suspension are on for this agent only.", environment: "production", purpose: "Payment reminders", metadata: { autonomyAutomation: { automaticDowngrades: true, suspendAtFloor: true } } });
    await setAgentTool(db, r.person, row.id, tool.id, true);
    await transitionAgent(db, r.person, row.id, "registered", "sales demonstration");
    await transitionAgent(db, r.person, row.id, "active", "sales demonstration");
    await lowerAutonomy(db, r.person, row.id, { level: 3, ceilingAmount: null, reason: "Pilot starts at bounded autonomy" });
    return row.id;
  });
  r.agentIds[slug] = agentId;
  const level = () => withTenant(r.orgId, (db) => db.agent.findUniqueOrThrow({ where: { id: agentId }, select: { autonomyLevel: true, status: true } }));
  const steps: SalesStep[] = [];
  const ok = await ask(r, slug, { tool: "send-payment-reminder", params: { customerRef: "CUS-SYN-301", channel: "email" } }, new Date(Date.now() - 215 * 60_000));
  steps.push({ title: "A reminder by email", detail: "An approved channel at autonomy level 3", outcome: describe(ok), requestId: ok.requestId, expected: allowedLike(ok) });
  // Three bursts of five refused requests, each in its own one-hour window (timestamps in the last four hours).
  const windows: [number, number, string][] = [[200, 2, "lowered to level 2"], [130, 1, "lowered to level 1"], [60, -1, "suspended"]];
  for (const [minutesAgo, expectLevel, label] of windows) {
    let last: GatewayResponse | null = null;
    for (let i = 0; i < 5; i++) last = await ask(r, slug, { tool: "send-payment-reminder", params: { customerRef: `CUS-SYN-${310 + i}`, channel: "personal_whatsapp" } }, new Date(Date.now() - (minutesAgo - i) * 60_000));
    const s = await level();
    const met = expectLevel === -1 ? s.status === "suspended" : s.autonomyLevel === expectLevel && s.status === "active";
    steps.push({ title: `Five reminders through a personal messaging account, ${minutesAgo} minutes ago`, detail: "Each is refused by policy; five refusals within an hour trigger the automatic rule", outcome: `All refused. Agent ${s.status === "suspended" ? "suspended" : `now at autonomy level ${s.autonomyLevel}`}`, requestId: last?.requestId, expected: met && label.length > 0 });
  }
  const after = await ask(r, slug, { tool: "send-payment-reminder", params: { customerRef: "CUS-SYN-330", channel: "email" } });
  steps.push({ title: "A normal email reminder after suspension", detail: "Even an allowed action is refused while the agent is suspended; a person must review it", outcome: describe(after), requestId: after.requestId, expected: after.status === "denied" });
  return steps;
}

async function reasoning(r: Run): Promise<SalesStep[]> {
  const params = { customerRef: "CUS-SYN-512", currentLimit: 15000, newLimit: 30000 };
  const uncited = await ask(r, "credit-limit-agent", { tool: "raise-credit-limit", params, context: { rationale: { summary: "The customer is reliable and asked for a higher limit", steps: [{ statement: "The customer has paid on time", cites: [] }, { statement: "Their income supports the new limit", cites: [] }] } } });
  const phantom = await ask(r, "credit-limit-agent", { tool: "raise-credit-limit", params, context: { evidence: [{ field: "paymentHistory", value: "24 of 24 on time", source: "card-ledger", ref: "ledger-2026-q3" }], rationale: { summary: "Reliable payer with sufficient income", steps: [{ statement: "Paid on time for two years", cites: ["ledger-2026-q3"] }, { statement: "Income certificate supports the limit", cites: ["salary-certificate-2026"] }] } } });
  const supported = await ask(r, "credit-limit-agent", {
    tool: "raise-credit-limit",
    params,
    context: {
      evidence: [
        { field: "paymentHistory", value: "24 of 24 on time", source: "card-ledger", ref: "ledger-2026-q3" },
        { field: "monthlyIncome", value: 32000, source: "salary-certificate", ref: "salary-certificate-2026" },
      ],
      rationale: { summary: "Reliable payer with sufficient income", steps: [{ statement: "Paid on time for two years", cites: ["ledger-2026-q3"] }, { statement: "Income of AED 32,000 a month supports the limit", cites: ["salary-certificate-2026"] }] },
    },
  });
  return [
    { title: "Limit increase with reasons that cite nothing", detail: "This tool requires every step of the agent's reasons to cite evidence", outcome: describe(uncited), requestId: uncited.requestId, expected: uncited.status === "awaiting_information" },
    { title: "Reasons cite a salary certificate that was never supplied", detail: "A citation must point at evidence the agent actually sent", outcome: describe(phantom), requestId: phantom.requestId, expected: phantom.status === "pending_approval" },
    { title: "Every step cites supplied evidence", detail: "The payment history and the salary certificate are both in the request", outcome: describe(supported), requestId: supported.requestId, expected: allowedLike(supported) },
  ];
}

const RUNNERS: Record<SalesScenarioKey, (r: Run) => Promise<SalesStep[]>> = { finance, healthcare, it, uncertainty, autonomy, reasoning };

export async function runSalesScenario(orgId: string, person: OrgContext, key: SalesScenarioKey): Promise<SalesRun> {
  const org = await rawPrisma().organization.findUnique({ where: { id: orgId } });
  if (!org || !org.demoMode || (org.settings as { salesDemo?: boolean } | null)?.salesDemo !== true) throw validation("Sales scenarios run only in a sales demonstration environment");
  const agentIds = await withTenant(orgId, async (db: TenantDb) => Object.fromEntries((await db.agent.findMany({ where: { orgId }, select: { slug: true, id: true } })).map((a) => [a.slug, a.id])));
  const correlationId = `sales-${key}-${Date.now().toString(36)}`;
  const steps = await RUNNERS[key]({ orgId, person, agentIds, correlationId });
  return { scenario: key, correlationId, steps, simulated: true };
}
