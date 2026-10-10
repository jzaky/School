import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { agentListFilter, getAgent, listAgents } from "@aegis/core";
import { z } from "zod";

export async function agentRoutes(app: FastifyInstance) {
  app.get("/", async (req) => {
    const ctx = await req.orgContext();
    const filter = agentListFilter.parse(req.query);
    return withTenant(ctx.orgId, (db) => listAgents(db, ctx, filter));
  });
  // An agent can introspect itself with its own key.
  app.get("/me", async (req) => {
    const ctx = await req.orgContext();
    if (ctx.actor.type !== "agent" || !ctx.actor.id) return { error: "Not an agent key" };
    const id = ctx.actor.id;
    return withTenant(ctx.orgId, (db) => db.agent.findUnique({ where: { id }, select: { id: true, slug: true, name: true, status: true, environment: true, currentVersion: true } }));
  });
  app.get("/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => getAgent(db, ctx, id));
  });
}
