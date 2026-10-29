import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { approveToolDefinition, forbidden, listPendingToolChanges, rejectToolDefinition, reportToolDefinitions } from "@aegis/core";
import { z } from "zod";
import { requirePerson, requireScope } from "../plugins/auth.js";

/**
 * Tool definition pinning (docs/TOOL_PINNING.md). The MCP gateway reports what each connector serves with
 * the agent's key; a downstream system can report its own tools with its integration key. Reviewing a
 * change (approve or reject) is a person's decision.
 */
export async function toolDefinitionRoutes(app: FastifyInstance) {
  app.post("/report", async (req) => {
    const ctx = await req.orgContext();
    if (ctx.actor.type === "agent") requireScope(req, "gateway:submit");
    else if (ctx.actor.type === "integration") requireScope(req, "grants:verify");
    else if (req.apiKey) throw forbidden("Use an agent or integration key, or sign in");
    return withTenant(ctx.orgId, (db) => reportToolDefinitions(db, ctx, req.body ?? {}));
  });
  app.get("/", async (req) => {
    requirePerson(req);
    const ctx = await req.orgContext();
    return { tools: await withTenant(ctx.orgId, (db) => listPendingToolChanges(db, ctx), { readOnly: true }) };
  });
  for (const verb of ["approve", "reject"] as const) {
    app.post(`/:toolId/${verb}`, async (req) => {
      requirePerson(req);
      const ctx = await req.orgContext();
      const { toolId } = z.object({ toolId: z.string().uuid() }).parse(req.params);
      const { reason } = z.object({ reason: z.string().max(500) }).parse(req.body ?? {});
      return withTenant(ctx.orgId, (db) => (verb === "approve" ? approveToolDefinition : rejectToolDefinition)(db, ctx, toolId, reason));
    });
  }
}
