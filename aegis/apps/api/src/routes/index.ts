import type { FastifyInstance } from "fastify";
import { gatewayRoutes } from "./gateway.js";
import { approvalRoutes } from "./approvals.js";
import { policyRoutes } from "./policies.js";
import { webhookRoutes } from "./webhooks.js";
import { assuranceRoutes } from "./assurance.js";
import { ssoRoutes } from "./sso.js";
import { shieldRoutes } from "./shield.js";
import { auditRoutes } from "./audit.js";
import { identityRoutes } from "./identity.js";
import { scimRoutes } from "./scim.js";
import { autonomyRoutes } from "./autonomy.js";
import { uncertaintyRoutes } from "./uncertainty.js";
import { decisionRoutes } from "./decisions.js";
import { labRoutes } from "./lab.js";
import { pilotRoutes } from "./pilots.js";
import { freezeRoutes } from "./freezes.js";
import { governanceRegistryRoutes } from "./governance-registry.js";
import { destinationRoutes } from "./destinations.js";
import { policyInsightRoutes } from "./policy-insights.js";
import { aiGatewayRoutes } from "./ai-gateway.js";
import { shadowAiRoutes } from "./shadow-ai.js";
import { softwareRoutes } from "./software.js";

/** Module route registrations added phase by phase. */
export async function registerModuleRoutes(app: FastifyInstance): Promise<void> {
  await app.register(gatewayRoutes, { prefix: "/v1/gateway" });
  await app.register(approvalRoutes, { prefix: "/v1/approvals" });
  await app.register(policyRoutes, { prefix: "/v1/policies" });
  await app.register(webhookRoutes, { prefix: "/v1/webhooks" });
  await app.register(assuranceRoutes, { prefix: "/v1/assurance" });
  await app.register(ssoRoutes, { prefix: "/v1/sso" });
  await app.register(shieldRoutes, { prefix: "/v1/shield" });
  await app.register(auditRoutes, { prefix: "/v1/audit" });
  await app.register(identityRoutes, { prefix: "/v1/identity" });
  await app.register(scimRoutes, { prefix: "/scim/v2" });
  await app.register(autonomyRoutes, { prefix: "/v1/autonomy" });
  await app.register(uncertaintyRoutes, { prefix: "/v1/uncertainty" });
  await app.register(decisionRoutes, { prefix: "/v1/decisions" });
  await app.register(labRoutes, { prefix: "/v1/lab" });
  await app.register(pilotRoutes, { prefix: "/v1/pilots" });
  await app.register(freezeRoutes, { prefix: "/v1/gateway/freezes" });
  await app.register(governanceRegistryRoutes, { prefix: "/v1/governance" });
  await app.register(destinationRoutes, { prefix: "/v1/integrations" });
  await app.register(policyInsightRoutes, { prefix: "/v1/policies/insights" });
  await app.register(aiGatewayRoutes, { prefix: "/v1/ai" });
  await app.register(shadowAiRoutes, { prefix: "/v1/shadow-ai" });
  await app.register(softwareRoutes, { prefix: "/v1/software" });
}
