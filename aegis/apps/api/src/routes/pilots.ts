import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { PILOT_KITS, PILOT_MEASURES, installKitSchema, installPilotKit, pilotReport, pilotReportSchema, setWatchOnly } from "@aegis/core";
import { z } from "zod";
import { requirePerson } from "../plugins/auth.js";

/**
 * Pilot kits, watch-only mode and the pilot report (docs/PILOTS.md). Every route needs a signed-in person:
 * installing a kit activates policies and watch-only mode relaxes enforcement, so neither is an agent's call.
 */
export async function pilotRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => requirePerson(req));
  app.get("/kits", async () => ({ kits: PILOT_KITS, measures: PILOT_MEASURES }));
  app.post("/kits/:key/install", async (req, reply) => {
    const ctx = await req.orgContext();
    const { key } = z.object({ key: z.string().min(1).max(60) }).parse(req.params);
    const body = installKitSchema.parse(req.body ?? {});
    return reply.code(201).send(await withTenant(ctx.orgId, (db) => installPilotKit(db, ctx, key, body)));
  });
  app.post("/agents/:id/watch-only", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ enabled: z.boolean(), reason: z.string().max(500).default("") }).parse(req.body);
    return withTenant(ctx.orgId, (db) => setWatchOnly(db, ctx, id, body));
  });
  app.get("/report", async (req) => {
    const ctx = await req.orgContext();
    const q = z.object({ from: z.string(), to: z.string(), agentIds: z.string().optional() }).parse(req.query);
    const input = pilotReportSchema.parse({ from: q.from, to: q.to, agentIds: q.agentIds ? q.agentIds.split(",").filter(Boolean) : undefined });
    return withTenant(ctx.orgId, (db) => pilotReport(db, ctx, input), { readOnly: true });
  });
}
