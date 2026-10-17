import { withTenant } from "@aegis/db";
import { requestAccess, decideAccessRequest } from "../agents/access.js";
import { createDelegation } from "../agents/delegation.js";
import { recordAgentObservation } from "../agents/discovery.js";
import { updateAgent } from "../agents/registry.js";
import { makeContext } from "../lib/context.js";
import type { SeededTenant } from "./demo-tenant.js";

const PURPOSES: Record<string, { purpose: string; destinations?: string[]; certifyDays?: number }> = {
  "treasury-transfer-agent": { purpose: "Move money between Meridian accounts for treasury analysts, within approved limits.", destinations: ["payments.meridian-demo.example"], certifyDays: 90 },
  "support-refund-agent": { purpose: "Refund customers for damaged, missing or late orders raised in the care queue.", certifyDays: 120 },
  "portfolio-trading-agent": { purpose: "Rebalance the paper trading book to its target weights under the trading mandate.", certifyDays: 60 },
  "marketing-outreach-agent": { purpose: "Send approved campaign emails and export audience segments for approved campaigns.", destinations: ["*.meridian-demo.example"], certifyDays: 30 },
  "kyc-document-agent": { purpose: "Read onboarding documents and flag inconsistencies for a human analyst.", certifyDays: 45 },
  "analytics-copilot": { purpose: "Answer business questions with read-only queries on the warehouse." },
};

/** Identity data for the demo: purposes, limits, temporary access, a delegation and discovered agents. Synthetic. */
export async function seedDemoIdentity(t: SeededTenant) {
  const engineer = t.users.engineer!.ctx;
  const governance = t.users.governance_manager!.ctx;
  const security = t.users.security_analyst!.ctx;
  await withTenant(t.orgId, async (db) => {
    for (const [slug, p] of Object.entries(PURPOSES)) {
      const id = t.agents[slug];
      if (!id) continue;
      await updateAgent(db, engineer, id, { purpose: p.purpose, allowedDestinations: p.destinations ?? [], credentialExpiresAt: p.certifyDays ? new Date(Date.now() + p.certifyDays * 86400_000) : null });
    }
    const exportTool = await db.tool.findFirst({ where: { orgId: t.orgId, key: "export-customer-records" } });
    const crmTool = await db.tool.findFirst({ where: { orgId: t.orgId, key: "query-crm" } });
    if (exportTool && t.agents["analytics-copilot"]) {
      await requestAccess(db, engineer, { agentId: t.agents["analytics-copilot"], toolId: exportTool.id, actions: [], reason: "Quarterly churn export for the board pack, prepared with the data protection officer", durationHours: 24 });
    }
    if (crmTool && t.agents["portfolio-trading-agent"]) {
      const r = await requestAccess(db, engineer, { agentId: t.agents["portfolio-trading-agent"], toolId: crmTool.id, actions: [], reason: "Look up client risk profiles while the suitability review runs this week", durationHours: 72 });
      await decideAccessRequest(db, security, r.id, { decision: "approve", note: "Read-only lookup, ends with the review" });
    }
    if (t.agents["support-refund-agent"] && t.agents["kyc-document-agent"]) {
      await createDelegation(db, governance, { delegatorAgentId: t.agents["support-refund-agent"], delegateAgentId: t.agents["kyc-document-agent"], toolKeys: ["update-ticket"], constraints: {}, reason: "KYC agent closes tickets it resolves on behalf of the care queue", expiresInHours: 24 * 14 });
    }
    const pipeline = makeContext(t.orgId, { type: "system", id: null, label: "deployment pipeline" });
    await recordAgentObservation(db, pipeline, { source: "kubernetes:prod-cluster", externalId: "deploy/claims-summariser", name: "Claims summariser", platform: "langgraph", metadata: { namespace: "claims", image: "registry.meridian-demo.example/claims-summariser:1.4" } });
    await recordAgentObservation(db, pipeline, { source: "microsoft-365", externalId: "copilot-agent-hr-faq", name: "HR policy assistant", platform: "copilot-studio", metadata: { owner: "HR" } });
    await recordAgentObservation(db, pipeline, { source: "kubernetes:prod-cluster", externalId: "support-refund-agent", name: "Customer Support Refund Agent", platform: "custom", metadata: { namespace: "care" } });
  });
}
