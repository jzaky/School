import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { getLabRun, LAB_SCENARIOS, listLabRuns, runAttackSimulation, startLabRunSchema } from "@aegis/core";
import { z } from "zod";
import { requirePerson } from "../plugins/auth.js";

const idParam = z.object({ id: z.string().uuid() });

/**
 * The Attack Simulation Lab over the API. Every route needs a signed-in person, reads included:
 * lab results describe which attacks an organization's configuration lets through.
 */
export async function labRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => requirePerson(req));
  app.get("/scenarios", async () => ({ scenarios: LAB_SCENARIOS }));
  app.get("/runs", async (req) => {
    const ctx = await req.orgContext();
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    return { runs: await withTenant(ctx.orgId, (db) => listLabRuns(db, ctx, limit), { readOnly: true }) };
  });
  app.get("/runs/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => getLabRun(db, ctx, id), { readOnly: true });
  });
  app.post("/runs", async (req, reply) => {
    const ctx = await req.orgContext();
    const body = startLabRunSchema.parse(req.body);
    const out = await runAttackSimulation((fn) => withTenant(ctx.orgId, fn), ctx, body);
    return reply.code(201).send(out);
  });
}
