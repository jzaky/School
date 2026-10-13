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
}
