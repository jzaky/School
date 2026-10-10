import { withTenant } from "@aegis/db";
import { addUserWithRole, makeTestTenant, type TestTenant } from "./helpers.js";
import { createAgent, grantResourcePermission, setAgentTool, transitionAgent, upsertResource, upsertTool } from "../src/agents/registry.js";
import { createIntegration, storeCredential } from "../src/integrations/service.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../src/policy/service.js";
import { issueApiKey } from "../src/identity/api-keys.js";
import { makeContext, type OrgContext } from "../src/lib/context.js";
import { authorizeAndExecute, type ActionRequestInput, type GatewayResponse } from "../src/gateway/gateway.js";
import { DEMO_POLICIES } from "../src/seed/demo-policies.js";

export interface GatewayFixture extends TestTenant {
  agentId: string;
  agentCtx: OrgContext;
  agentKey: string;
  integrationId: string;
  approver: { userId: string; ctx: OrgContext };
  approver2: { userId: string; ctx: OrgContext };
  engineer: { userId: string; ctx: OrgContext };
  viewer: { userId: string; ctx: OrgContext };
  refundPolicyId: string;
  call: (input: Partial<ActionRequestInput> & { amount?: number }) => Promise<GatewayResponse>;
  ledger: () => Promise<Record<string, unknown>[]>;
}

export async function makeGatewayFixture(): Promise<GatewayFixture> {
  const t = await makeTestTenant("gw");
  const approver = await addUserWithRole(t, "approver", "appr");
  const approver2 = await addUserWithRole(t, "approver", "appr2");
  const engineer = await addUserWithRole(t, "engineer", "eng");
  const viewer = await addUserWithRole(t, "viewer", "view");
  const built = await withTenant(t.orgId, async (db) => {
    const { integration } = await createIntegration(db, engineer.ctx, { key: "support-platform-sim", name: "Support (sim)", type: "support", description: "" });
    await storeCredential(db, engineer.ctx, integration.id, "service-token", "sim-secret");
    const tool = await upsertTool(db, engineer.ctx, {
      key: "issue-refund",
      name: "Issue refund",
      description: "",
      integrationId: integration.id,
      riskLevel: "high",
      parameterSchema: { type: "object", required: ["orderId", "customerId", "amount", "currency"], properties: { orderId: { type: "string" }, customerId: { type: "string" }, amount: { type: "number", minimum: 0 }, currency: { type: "string" } }, additionalProperties: false },
      destinationRules: { allowedDomains: [], allowedResourceKeys: ["support-tickets"] },
    });
    const otherTool = await upsertTool(db, engineer.ctx, { key: "export-customer-records", name: "Export", description: "", integrationId: integration.id, riskLevel: "critical", parameterSchema: {}, destinationRules: { allowedDomains: ["warehouse.meridian-demo.example"], allowedResourceKeys: [] } });
    const resource = await upsertResource(db, engineer.ctx, { key: "support-tickets", name: "Tickets", type: "application", classification: "internal", attributes: {} });
    const restricted = await upsertResource(db, engineer.ctx, { key: "payments-core", name: "Ledger", type: "ledger", classification: "restricted", attributes: {} });
    const agent = await createAgent(db, engineer.ctx, { slug: "support-refund-agent", name: "Support Refund Agent", description: "", environment: "production", modelProvider: "x", modelId: "y", dataClassificationLimit: "confidential", riskTier: "high", metadata: {}, technicalOwnerId: engineer.userId });
    await setAgentTool(db, engineer.ctx, agent.id, tool.id, true);
    await grantResourcePermission(db, engineer.ctx, agent.id, resource.id, ["read", "write", "execute"]);
    await transitionAgent(db, engineer.ctx, agent.id, "registered", "ok");
    await transitionAgent(db, engineer.ctx, agent.id, "active", "ok");
    const key = await issueApiKey(db, engineer.ctx, { name: "k", subjectType: "agent", subjectId: agent.id });
    const refund = DEMO_POLICIES.find((p) => p.key === "refund-authority")!;
    const { policy, version } = await createPolicy(db, t.ownerCtx, { key: refund.key, name: refund.name, description: "", category: "authorization", document: refund.document, changeNote: "init" });
    await submitForReview(db, t.ownerCtx, version.id);
    await activateVersion(db, t.ownerCtx, version.id, { fourEyes: false });
    await assignPolicy(db, t.ownerCtx, policy.id, { targetType: "agent", targetId: agent.id, priority: 100 });
    void otherTool;
    void restricted;
    return { agentId: agent.id, agentKey: key.key, integrationId: integration.id, refundPolicyId: policy.id };
  });
  const agentCtx = makeContext(t.orgId, { type: "agent", id: built.agentId });
  let n = 0;
  return {
    ...t,
    ...built,
    agentCtx,
    approver,
    approver2,
    engineer,
    viewer,
    call: (input) => {
      n += 1;
      const { amount, ...rest } = input;
      return authorizeAndExecute(withTenant, agentCtx, {
        tool: "issue-refund",
        action: "execute",
        params: { orderId: `ORD-${n}`, customerId: "CUST-1", amount: amount ?? 100, currency: "AED" },
        resource: "support-tickets",
        idempotencyKey: `idem-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 8)}`,
        justification: "test",
        principal: { type: "none" },
        context: {},
        executionMode: "gateway",
        ...rest,
      });
    },
    ledger: () =>
      withTenant(t.orgId, async (db) => {
        const i = await db.integration.findUniqueOrThrow({ where: { id: built.integrationId } });
        return (((i.settings as Record<string, unknown>).ledger as Record<string, unknown>[]) ?? []);
      }),
  };
}
