import type { FastifyInstance } from "fastify";
import { personOnlyForWrites } from "../plugins/auth.js";
import { withTenant } from "@aegis/db";
import { autonomyAnalytics, autonomySettingsSchema, cancelAutonomyRaise, decideAutonomyRaise, getAgentAutonomy, lowerAutonomy, requestAutonomyRaise, simulateAutonomy, updateAutonomySettings } from "@aegis/core";
import { z } from "zod";

const idParam = z.object({ id: z.string().uuid() });
const changeBody = z.object({ level: z.number().int().min(0).max(4), ceilingAmount: z.number().nonnegative().nullable().optional(), reason: z.string() });
const simulateQuery = z.object({ level: z.coerce.number().int().min(0).max(4), ceilingAmount: z.coerce.number().nonnegative().optional(), days: z.coerce.number().int().min(1).max(90).optional() });

/**
 * Managed autonomy. Every change is made by a person in the console or through a user session; API keys
 * (agents and integrations) carry no permissions, so an agent can never change its own level.
 */
export async function autonomyRoutes(app: FastifyInstance) {
  personOnlyForWrites(app);
  app.get("/analytics", async (req) => {
    const ctx = await req.orgContext();
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(180).optional() }).parse(req.query);
    return withTenant(ctx.orgId, (db) => autonomyAnalytics(db, ctx, days), { readOnly: true });
  });
  app.put("/settings", async (req) => {
    const ctx = await req.orgContext();
    const body = autonomySettingsSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => updateAutonomySettings(db, ctx, body));
  });
  app.get("/agents/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => getAgentAutonomy(db, ctx, id), { readOnly: true });
  });
  /** Lowers at once, or tightens the ceiling. */
  app.post("/agents/:id/lower", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = changeBody.parse(req.body);
    return withTenant(ctx.orgId, (db) => lowerAutonomy(db, ctx, id, body));
  });
  /** Asks for more autonomy; a different person decides. */
  app.post("/agents/:id/raise-requests", async (req, reply) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = changeBody.parse(req.body);
    const row = await withTenant(ctx.orgId, (db) => requestAutonomyRaise(db, ctx, id, body));
    return reply.status(201).send(row);
  });
  app.get("/agents/:id/simulate", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const q = simulateQuery.parse(req.query);
    return withTenant(ctx.orgId, (db) => simulateAutonomy(db, ctx, id, q), { readOnly: true });
  });
  app.post("/raise-requests/:id/decision", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = z.object({ approve: z.boolean(), note: z.string().default("") }).parse(req.body);
    return withTenant(ctx.orgId, (db) => decideAutonomyRaise(db, ctx, id, body));
  });
  app.post("/raise-requests/:id/cancel", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => cancelAutonomyRaise(db, ctx, id));
  });
}
