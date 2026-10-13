import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { agentCalibration, labelOutcome, labelSchema, recomputeCalibration, uncertaintyOverview, uncertaintyPolicySchema, updateToolUncertaintyPolicy, assertPermission } from "@aegis/core";
import { z } from "zod";
import { personOnlyForWrites, requireScope } from "../plugins/auth.js";

const idParam = z.object({ id: z.string().uuid() });

/**
 * Uncertainty governance. Outcome labels can come from a person (monitoring:write) or from a customer system
 * with an integration key holding the outcomes:report scope; an agent's key can never carry that scope.
 */
export async function uncertaintyRoutes(app: FastifyInstance) {
  personOnlyForWrites(app, ["/labels"]);
  app.get("/overview", async (req) => {
    const ctx = await req.orgContext();
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(180).optional() }).parse(req.query);
    return withTenant(ctx.orgId, (db) => uncertaintyOverview(db, ctx, days), { readOnly: true });
  });
  app.get("/agents/:id/calibration", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => agentCalibration(db, ctx, id), { readOnly: true });
  });
  app.post("/labels", async (req, reply) => {
    const ctx = await req.orgContext();
    if (req.apiKey) requireScope(req, "outcomes:report");
    const body = labelSchema.parse(req.body);
    const row = await withTenant(ctx.orgId, (db) => labelOutcome(db, ctx, body, req.apiKey ? "system" : "reviewer"));
    return reply.status(201).send(row);
  });
  app.put("/tools/:id/policy", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = uncertaintyPolicySchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => updateToolUncertaintyPolicy(db, ctx, id, body));
  });
  app.post("/calibration/recompute", async (req) => {
    const ctx = await req.orgContext();
    assertPermission(ctx, "monitoring:write");
    const written = await withTenant(ctx.orgId, (db) => recomputeCalibration(db, ctx), { lock: "lazy", timeout: 60_000 });
    return { profiles: written.length };
  });
}
