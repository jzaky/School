import type { FastifyInstance } from "fastify";

/** Module route registrations added phase by phase (gateway, approvals, evidence, shield, audit). */
export async function registerModuleRoutes(_app: FastifyInstance): Promise<void> {}
