import type { FastifyInstance } from "fastify";
import { gatewayRoutes } from "./gateway.js";
import { approvalRoutes } from "./approvals.js";
import { policyRoutes } from "./policies.js";
import { webhookRoutes } from "./webhooks.js";

/** Module route registrations added phase by phase. */
export async function registerModuleRoutes(app: FastifyInstance): Promise<void> {
  await app.register(gatewayRoutes, { prefix: "/v1/gateway" });
  await app.register(approvalRoutes, { prefix: "/v1/approvals" });
  await app.register(policyRoutes, { prefix: "/v1/policies" });
  await app.register(webhookRoutes, { prefix: "/v1/webhooks" });
}
