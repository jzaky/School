/**
 * Demo tenant: Meridian Gulf Bank (fictional). Every person, agent, system and number here is
 * synthetic. The organization is created with demoMode=true, which the console renders as a
 * "Demo data" badge on every screen.
 */
import { ownerPrisma, rawPrisma, withTenant, type TenantDb } from "@aegis/db";
import { hashPassword } from "../identity/password.js";
import { createOrganization } from "../orgs/orgs.js";
import { makeContext, type OrgContext } from "../lib/context.js";
import { createAgent, grantResourcePermission, setAgentTool, transitionAgent, upsertResource, upsertTool } from "../agents/registry.js";
import { issueApiKey } from "../identity/api-keys.js";
import { encryptSecret, randomToken } from "../lib/crypto.js";
import { listUserMemberships } from "../identity/memberships.js";
import { seedDemoPolicies } from "./demo-policies.js";
import { storeCredential } from "../integrations/service.js";

export const DEMO_SLUG = "meridian";
export const DEMO_PASSWORD = "AegisDemo2026!";

export const DEMO_USERS = [
  { email: "nadia.haddad@meridian-demo.example", name: "Nadia Haddad", role: "owner", title: "Chief Information Security Officer" },
  { email: "omar.farouk@meridian-demo.example", name: "Omar Farouk", role: "governance_manager", title: "Head of AI Governance" },
  { email: "lina.mansour@meridian-demo.example", name: "Lina Mansour", role: "approver", title: "Head of Payments Operations" },
  { email: "tariq.saleh@meridian-demo.example", name: "Tariq Saleh", role: "security_analyst", title: "Senior Security Analyst" },
  { email: "hana.youssef@meridian-demo.example", name: "Hana Youssef", role: "auditor", title: "Internal Audit Lead" },
  { email: "karim.nassar@meridian-demo.example", name: "Karim Nassar", role: "engineer", title: "AI Platform Engineer" },
  { email: "sara.khalil@meridian-demo.example", name: "Sara Khalil", role: "viewer", title: "Compliance Associate" },
] as const;

export const PLATFORM_ADMIN = { email: "admin@aegis.local", name: "AEGIS Platform Admin" };

export interface SeededTenant {
  orgId: string;
  users: Record<string, { id: string; email: string; ctx: OrgContext }>;
  agents: Record<string, string>;
  tools: Record<string, string>;
  resources: Record<string, string>;
  integrations: Record<string, string>;
  apiKeys: Record<string, string>;
}

export async function resetDemoTenant(): Promise<void> {
  const owner = ownerPrisma();
  const existing = await owner.organization.findUnique({ where: { slug: DEMO_SLUG } });
  if (existing) {
    await owner.$executeRawUnsafe(`DELETE FROM evidence_checkpoints WHERE org_id = $1::uuid`, existing.id);
    await owner.$executeRawUnsafe(`DELETE FROM jobs WHERE org_id = $1::uuid`, existing.id);
    // Append-only tables refuse DELETE through triggers; the owner disables them for the reset only.
    for (const t of ["evidence_events", "authorization_decisions", "approval_responses", "execution_receipts", "policy_events", "policy_versions"]) {
      await owner.$executeRawUnsafe(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
    }
    try {
      await owner.$executeRawUnsafe(`DELETE FROM evidence_events WHERE org_id = $1::uuid`, existing.id);
      // Dependents first; tables without FK cascades to organizations are cleaned explicitly.
      for (const t of ["team_members", "teams", "invitations", "sso_connections", "api_keys", "memberships", "roles", "notifications", "alerts", "monitoring_rules", "security_events", "incidents", "action_requests", "policies", "agents", "tools", "integrations", "resources", "control_mappings", "data_classes", "remediation_tasks", "assessments", "documents", "audit_exports", "frameworks"]) {
        await owner.$executeRawUnsafe(`DELETE FROM ${t} WHERE org_id = $1::uuid`, existing.id);
      }
      await owner.organization.delete({ where: { id: existing.id } });
    } finally {
      for (const t of ["evidence_events", "authorization_decisions", "approval_responses", "execution_receipts", "policy_events", "policy_versions"]) {
        await owner.$executeRawUnsafe(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
      }
    }
  }
  await owner.user.deleteMany({ where: { email: { in: [...DEMO_USERS.map((u) => u.email), PLATFORM_ADMIN.email] } } });
}

export async function seedDemoTenant(): Promise<SeededTenant> {
  await resetDemoTenant();
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const admin = await rawPrisma().user.create({ data: { email: PLATFORM_ADMIN.email, name: PLATFORM_ADMIN.name, passwordHash, isPlatformAdmin: true } });
  const created = [] as { id: string; email: string; role: string; title: string }[];
  for (const u of DEMO_USERS) {
    const row = await rawPrisma().user.create({ data: { email: u.email, name: u.name, passwordHash, lastLoginAt: new Date(Date.now() - Math.random() * 3 * 86400_000) } });
    created.push({ id: row.id, email: u.email, role: u.role, title: u.title });
  }
  const ownerUser = created.find((u) => u.role === "owner")!;
  const org = await createOrganization({ name: "Meridian Gulf Bank", slug: DEMO_SLUG, ownerUserId: ownerUser.id, demoMode: true });
  await rawPrisma().organization.update({ where: { id: org.id }, data: { settings: { currency: "AED", timezone: "Asia/Dubai", approvalDefaultExpiryMinutes: 240, aiProviderEnabled: false } } });

  const users: SeededTenant["users"] = {};
  await withTenant(org.id, async (db) => {
    const roles = await db.role.findMany({ where: { orgId: org.id } });
    for (const u of created) {
      const role = roles.find((r) => r.key === u.role)!;
      if (u.role === "owner") {
        await db.membership.update({ where: { orgId_userId: { orgId: org.id, userId: u.id } }, data: { title: u.title } });
      } else {
        await db.membership.create({ data: { orgId: org.id, userId: u.id, roleId: role.id, title: u.title } });
      }
    }
    const teams = [
      { key: "payments-ops", name: "Payments Operations", description: "Owns treasury and payment agents" },
      { key: "customer-care", name: "Customer Care", description: "Owns customer support agents" },
      { key: "ai-platform", name: "AI Platform", description: "Builds and operates agents" },
      { key: "security", name: "Information Security", description: "Security monitoring and incident response" },
    ];
    for (const t of teams) await db.team.create({ data: { orgId: org.id, ...t } });
  });
  for (const u of created) {
    const m = (await listUserMemberships(u.id)).find((x) => x.orgId === org.id)!;
    users[u.role] = { id: u.id, email: u.email, ctx: makeContext(org.id, { type: "user", id: u.id, label: DEMO_USERS.find((d) => d.email === u.email)!.name, permissions: m.permissions, membershipId: m.membershipId }) };
  }
  const ownerCtx = users.owner!.ctx;
  const engineerCtx = users.engineer!.ctx;

  const out: SeededTenant = { orgId: org.id, users, agents: {}, tools: {}, resources: {}, integrations: {}, apiKeys: {} };

  await withTenant(org.id, async (db) => {
    const teamRows = await db.team.findMany({ where: { orgId: org.id } });
    const team = (k: string) => teamRows.find((t) => t.key === k)!.id;
    const integrations = [
      { key: "core-banking-sim", name: "Core Banking (simulated)", type: "banking", description: "Synthetic core banking ledger used by the demo transfer scenario", baseUrl: "sim://core-banking" },
      { key: "support-platform-sim", name: "Support Platform (simulated)", type: "support", description: "Synthetic ticketing and refund system", baseUrl: "sim://support" },
      { key: "email-gateway-sim", name: "Email Gateway (simulated)", type: "messaging", description: "Synthetic outbound email relay", baseUrl: "sim://email" },
      { key: "crm-sim", name: "Customer CRM (simulated)", type: "crm", description: "Synthetic customer records", baseUrl: "sim://crm" },
      { key: "data-warehouse-sim", name: "Data Warehouse (simulated)", type: "data", description: "Synthetic analytics store", baseUrl: "sim://warehouse" },
    ];
    for (const i of integrations) {
      const row = await db.integration.create({ data: { orgId: org.id, ...i, webhookSecretEnc: encryptSecret(randomToken(24), `integration:${i.key}`), lastHealthAt: new Date(), lastHealthOk: true, settings: { simulated: true } } });
      out.integrations[i.key] = row.id;
      const cred = await storeCredential(db, engineerCtx, row.id, "service-token", `sim-token-${randomToken(12)}`, 90);
      await db.credential.update({ where: { id: cred.id }, data: { rotatedAt: new Date(Date.now() - 30 * 86400_000), rotationDueAt: new Date(Date.now() + 60 * 86400_000) } });
    }

    const resources = [
      { key: "payments-core", name: "Payments Core Ledger", type: "ledger", classification: "restricted" as const, ownerTeamId: team("payments-ops"), attributes: { system: "core-banking-sim", currency: "AED" } },
      { key: "customer-accounts", name: "Customer Accounts", type: "database", classification: "confidential" as const, ownerTeamId: team("customer-care"), attributes: { system: "crm-sim" } },
      { key: "support-tickets", name: "Support Tickets", type: "application", classification: "internal" as const, ownerTeamId: team("customer-care"), attributes: { system: "support-platform-sim" } },
      { key: "marketing-lists", name: "Marketing Lists", type: "dataset", classification: "internal" as const, ownerTeamId: team("customer-care"), attributes: {} },
      { key: "analytics-warehouse", name: "Analytics Warehouse", type: "warehouse", classification: "restricted" as const, ownerTeamId: team("ai-platform"), attributes: { system: "data-warehouse-sim" } },
      { key: "public-faq", name: "Public FAQ Knowledge Base", type: "knowledge", classification: "public" as const, ownerTeamId: team("customer-care"), attributes: {} },
    ];
    for (const r of resources) out.resources[r.key] = (await upsertResource(db, engineerCtx, r)).id;

    const tools = [
      { key: "initiate-transfer", name: "Initiate transfer", description: "Moves funds between accounts in the core banking ledger", integrationId: out.integrations["core-banking-sim"], riskLevel: "critical" as const, parameterSchema: { type: "object", required: ["fromAccount", "toAccount", "amount", "currency"], properties: { fromAccount: { type: "string" }, toAccount: { type: "string" }, amount: { type: "number", minimum: 0 }, currency: { type: "string", enum: ["AED", "USD", "EUR"] }, reference: { type: "string", maxLength: 140 } } }, destinationRules: { allowedDomains: [], allowedResourceKeys: ["payments-core"] } },
      { key: "issue-refund", name: "Issue refund", description: "Refunds a customer order through the support platform", integrationId: out.integrations["support-platform-sim"], riskLevel: "high" as const, parameterSchema: { type: "object", required: ["orderId", "customerId", "amount", "currency"], properties: { orderId: { type: "string" }, customerId: { type: "string" }, amount: { type: "number", minimum: 0 }, currency: { type: "string", enum: ["AED"] }, reason: { type: "string", maxLength: 280 } } }, destinationRules: { allowedDomains: [], allowedResourceKeys: ["support-tickets", "customer-accounts"] } },
      { key: "send-email", name: "Send email", description: "Sends an outbound email through the gateway", integrationId: out.integrations["email-gateway-sim"], riskLevel: "medium" as const, parameterSchema: { type: "object", required: ["to", "subject", "body"], properties: { to: { type: "string" }, subject: { type: "string", maxLength: 200 }, body: { type: "string", maxLength: 20000 }, attachments: { type: "array", items: { type: "string" } } } }, destinationRules: { allowedDomains: ["meridian-demo.example", "customers.meridian-demo.example"], allowedResourceKeys: [] } },
      { key: "export-customer-records", name: "Export customer records", description: "Exports customer records from the CRM to a destination", integrationId: out.integrations["crm-sim"], riskLevel: "critical" as const, parameterSchema: { type: "object", required: ["segment", "destination"], properties: { segment: { type: "string" }, destination: { type: "string" }, fields: { type: "array", items: { type: "string" } } } }, destinationRules: { allowedDomains: ["warehouse.meridian-demo.example"], allowedResourceKeys: ["customer-accounts", "analytics-warehouse"] } },
      { key: "query-crm", name: "Query CRM", description: "Reads customer records", integrationId: out.integrations["crm-sim"], riskLevel: "medium" as const, parameterSchema: { type: "object", required: ["customerId"], properties: { customerId: { type: "string" }, fields: { type: "array", items: { type: "string" } } } }, destinationRules: { allowedDomains: [], allowedResourceKeys: ["customer-accounts"] } },
      { key: "update-ticket", name: "Update ticket", description: "Updates a support ticket", integrationId: out.integrations["support-platform-sim"], riskLevel: "low" as const, parameterSchema: { type: "object", required: ["ticketId"], properties: { ticketId: { type: "string" }, status: { type: "string" }, note: { type: "string", maxLength: 2000 } } }, destinationRules: { allowedDomains: [], allowedResourceKeys: ["support-tickets"] } },
      { key: "http-request", name: "HTTP request", description: "Calls an external HTTP endpoint", integrationId: null, riskLevel: "high" as const, parameterSchema: { type: "object", required: ["url", "method"], properties: { url: { type: "string" }, method: { type: "string", enum: ["GET", "POST"] }, body: { type: "string", maxLength: 50000 } } }, destinationRules: { allowedDomains: ["api.meridian-demo.example"], allowedResourceKeys: [] } },
      { key: "run-warehouse-query", name: "Run warehouse query", description: "Executes a read-only analytics query", integrationId: out.integrations["data-warehouse-sim"], riskLevel: "medium" as const, parameterSchema: { type: "object", required: ["sql"], properties: { sql: { type: "string", maxLength: 10000 } } }, destinationRules: { allowedDomains: [], allowedResourceKeys: ["analytics-warehouse"] } },
    ];
    for (const t of tools) out.tools[t.key] = (await upsertTool(db, engineerCtx, { ...t, description: t.description })).id;

    const agents = [
      { slug: "treasury-transfer-agent", name: "Treasury Transfer Agent", description: "Prepares and initiates intra-bank transfers requested by treasury analysts. Operates under AED limits with supervisor approval above threshold.", environment: "production" as const, modelProvider: "anthropic", modelId: "claude-opus-5-5", teamId: team("payments-ops"), businessOwnerId: users.governance_manager!.id, technicalOwnerId: users.engineer!.id, dataClassificationLimit: "restricted" as const, riskTier: "critical" as const, status: "active" as const, tools: ["initiate-transfer", "query-crm"], resources: [["payments-core", ["read", "transfer"]], ["customer-accounts", ["read"]]] as [string, string[]][] },
      { slug: "support-refund-agent", name: "Customer Support Refund Agent", description: "Handles refund requests in the customer care queue. Issues small refunds autonomously, escalates larger ones.", environment: "production" as const, modelProvider: "anthropic", modelId: "claude-sonnet-5-5", teamId: team("customer-care"), businessOwnerId: users.governance_manager!.id, technicalOwnerId: users.engineer!.id, dataClassificationLimit: "confidential" as const, riskTier: "high" as const, status: "active" as const, tools: ["issue-refund", "update-ticket", "query-crm", "send-email"], resources: [["support-tickets", ["read", "write", "execute"]], ["customer-accounts", ["read"]]] as [string, string[]][] },
      { slug: "marketing-outreach-agent", name: "Marketing Outreach Agent", description: "Drafts campaign emails and exports audience segments for approved campaigns.", environment: "production" as const, modelProvider: "openai", modelId: "gpt-5", teamId: team("customer-care"), businessOwnerId: users.governance_manager!.id, technicalOwnerId: users.engineer!.id, dataClassificationLimit: "internal" as const, riskTier: "high" as const, status: "active" as const, tools: ["send-email", "export-customer-records", "http-request"], resources: [["marketing-lists", ["read", "export"]]] as [string, string[]][] },
      { slug: "kyc-document-agent", name: "KYC Document Review Agent", description: "Extracts fields from onboarding documents and flags inconsistencies for analysts.", environment: "staging" as const, modelProvider: "anthropic", modelId: "claude-sonnet-5-5", teamId: team("ai-platform"), businessOwnerId: users.security_analyst!.id, technicalOwnerId: users.engineer!.id, dataClassificationLimit: "restricted" as const, riskTier: "high" as const, status: "active" as const, tools: ["query-crm", "update-ticket"], resources: [["customer-accounts", ["read"]]] as [string, string[]][] },
      { slug: "analytics-copilot", name: "Analytics Copilot", description: "Answers business questions over the warehouse with read-only SQL.", environment: "production" as const, modelProvider: "google", modelId: "gemini-3-pro", teamId: team("ai-platform"), businessOwnerId: users.governance_manager!.id, technicalOwnerId: users.engineer!.id, dataClassificationLimit: "restricted" as const, riskTier: "medium" as const, status: "active" as const, tools: ["run-warehouse-query"], resources: [["analytics-warehouse", ["read"]]] as [string, string[]][] },
      { slug: "it-helpdesk-agent", name: "IT Helpdesk Agent", description: "Resets passwords and answers IT questions. Suspended after repeated denied actions.", environment: "production" as const, modelProvider: "anthropic", modelId: "claude-haiku-5-5", teamId: team("ai-platform"), businessOwnerId: users.security_analyst!.id, technicalOwnerId: users.engineer!.id, dataClassificationLimit: "internal" as const, riskTier: "medium" as const, status: "suspended" as const, tools: ["update-ticket", "send-email"], resources: [["support-tickets", ["read", "write"]]] as [string, string[]][] },
      { slug: "fraud-triage-agent", name: "Fraud Triage Agent", description: "Planned agent to prioritise fraud alerts. Not yet registered for production.", environment: "development" as const, modelProvider: "anthropic", modelId: "claude-opus-5-5", teamId: team("security"), businessOwnerId: users.security_analyst!.id, technicalOwnerId: users.engineer!.id, dataClassificationLimit: "confidential" as const, riskTier: "high" as const, status: "draft" as const, tools: [], resources: [] as [string, string[]][] },
      { slug: "legacy-faq-bot", name: "Legacy FAQ Bot", description: "Retired rule-based FAQ bot kept for history.", environment: "production" as const, modelProvider: "internal", modelId: "rules-v2", teamId: team("customer-care"), businessOwnerId: users.governance_manager!.id, technicalOwnerId: users.engineer!.id, dataClassificationLimit: "public" as const, riskTier: "low" as const, status: "archived" as const, tools: [], resources: [["public-faq", ["read"]]] as [string, string[]][] },
    ];
    for (const a of agents) {
      const { status, tools: toolKeys, resources: res, ...input } = a;
      const row = await createAgent(db, engineerCtx, { ...input, metadata: { owner_team: a.teamId } });
      out.agents[a.slug] = row.id;
      for (const k of toolKeys) await setAgentTool(db, engineerCtx, row.id, out.tools[k]!, true);
      for (const [rk, actions] of res) await grantResourcePermission(db, engineerCtx, row.id, out.resources[rk]!, actions);
      if (status !== "draft") await transitionAgent(db, engineerCtx, row.id, "registered", "registered by platform team");
      if (status === "active" || status === "suspended") await transitionAgent(db, engineerCtx, row.id, "active", "promoted to production");
      if (status === "suspended") await transitionAgent(db, ownerCtx, row.id, "suspended", "Repeated denied actions on 3 consecutive days (alert RM-004)");
      if (status === "archived") await transitionAgent(db, engineerCtx, row.id, "archived", "replaced by Customer Support Refund Agent");
      if (status === "active" || status === "suspended") {
        const key = await issueApiKey(db, engineerCtx, { name: `${a.slug} production key`, subjectType: "agent", subjectId: row.id });
        out.apiKeys[a.slug] = key.key;
      }
      await db.agent.update({ where: { id: row.id }, data: { lastActivityAt: status === "active" ? new Date(Date.now() - Math.random() * 3600_000) : status === "suspended" ? new Date(Date.now() - 3 * 86400_000) : null } });
    }
  });
  await withTenant(org.id, (db) => seedDemoPolicies(db, users.governance_manager!.ctx, ownerCtx, out.agents));
  void admin;
  return out;
}

export async function demoTenantDb<T>(fn: (db: TenantDb) => Promise<T>): Promise<T> {
  const org = await rawPrisma().organization.findUniqueOrThrow({ where: { slug: DEMO_SLUG } });
  return withTenant(org.id, fn);
}
