import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { archiveLabScenario, createLabScenario, getLabRun, getLabScenarioVersions, LAB_SCENARIO_TEMPLATES, LAB_SCENARIOS, listLabRuns, listLabScenarios, readLabSchedule, runAttackSimulation, setLabSchedule, startLabRunSchema, updateLabScenario } from "@aegis/core";
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
  /** The schedule for continuous attack simulation (docs/ATTACK_SIMULATION_LAB.md). */
  app.get("/schedule", async (req) => {
    const ctx = await req.orgContext();
    const settings = await withTenant(ctx.orgId, async (db) => (await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { settings: true } })).settings, { readOnly: true });
    return { schedule: readLabSchedule(settings) };
  });
  app.put("/schedule", async (req) => {
    const ctx = await req.orgContext();
    return { schedule: await withTenant(ctx.orgId, (db) => setLabSchedule(db, ctx, req.body)) };
  });
  /** The organization's own scenarios (docs/ATTACK_SIMULATION_LAB.md, custom scenarios). */
  app.get("/custom-scenario-templates", async () => ({ templates: LAB_SCENARIO_TEMPLATES }));
  app.get("/custom-scenarios", async (req) => {
    const ctx = await req.orgContext();
    const { includeArchived } = z.object({ includeArchived: z.coerce.boolean().default(false) }).parse(req.query);
    return { scenarios: await withTenant(ctx.orgId, (db) => listLabScenarios(db, ctx, { includeArchived }), { readOnly: true }) };
  });
  app.get("/custom-scenarios/:id/versions", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => getLabScenarioVersions(db, ctx, id), { readOnly: true });
  });
  app.post("/custom-scenarios", async (req, reply) => {
    const ctx = await req.orgContext();
    return reply.code(201).send(await withTenant(ctx.orgId, (db) => createLabScenario(db, ctx, req.body)));
  });
  app.put("/custom-scenarios/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => updateLabScenario(db, ctx, id, req.body));
  });
  app.post("/custom-scenarios/:id/archive", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().min(3).max(300) }).parse(req.body);
    await withTenant(ctx.orgId, (db) => archiveLabScenario(db, ctx, id, reason));
    return { ok: true };
  });
}
