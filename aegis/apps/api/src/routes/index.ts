import type { FastifyInstance } from "fastify";
import { gatewayRoutes } from "./gateway.js";
import { approvalRoutes } from "./approvals.js";
import { policyRoutes } from "./policies.js";
import { webhookRoutes } from "./webhooks.js";
import { assuranceRoutes } from "./assurance.js";
import { ssoRoutes } from "./sso.js";

/** Module route registrations added phase by phase. */
export async function registerModuleRoutes(app: FastifyInstance): Promise<void> {
  await app.register(gatewayRoutes, { prefix: "/v1/gateway" });
  await app.register(approvalRoutes, { prefix: "/v1/approvals" });
  await app.register(policyRoutes, { prefix: "/v1/policies" });
  await app.register(webhookRoutes, { prefix: "/v1/webhooks" });
  await app.register(assuranceRoutes, { prefix: "/v1/assurance" });
  await app.register(ssoRoutes, { prefix: "/v1/sso" });
}
