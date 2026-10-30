import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { decisionRecord, inspectDecision, reasoningPolicySchema, recheckWithCurrentPolicies, updateToolReasoningPolicy } from "@aegis/core";
import { z } from "zod";
import { personOnlyForWrites } from "../plugins/auth.js";

const idParam = z.object({ id: z.string().uuid() });

/** The Decision Inspector over the API: reconstruction, a recheck against today's policies, and the decision record. */
export async function decisionRoutes(app: FastifyInstance) {
  personOnlyForWrites(app);
  app.get("/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => inspectDecision(db, ctx, id), { readOnly: true });
  });
  app.get("/:id/recheck", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => recheckWithCurrentPolicies(db, ctx, id), { readOnly: true });
  });
  app.get("/:id/record", async (req, reply) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const { record, sha256 } = await withTenant(ctx.orgId, (db) => decisionRecord(db, ctx, id));
    return reply.header("content-disposition", `attachment; filename="decision-record-${id}.json"`).header("x-content-sha256", sha256).send(record);
  });
  app.put("/tools/:id/reasoning-policy", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = reasoningPolicySchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => updateToolReasoningPolicy(db, ctx, id, body));
  });
}
