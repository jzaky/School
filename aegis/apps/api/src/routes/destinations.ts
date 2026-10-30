import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { catalogForOrg, createDestination, destinationCommonSchema, destinationInputSchema, getDestination, listDestinations, replaceDestinationSecret, retryDelivery, sendTestEvent, updateDestination, parsePatch } from "@aegis/core";
import { z } from "zod";
import { requirePerson } from "../plugins/auth.js";

const idParam = z.object({ id: z.string().uuid() });

/**
 * Event destinations and the integration catalog. Every route needs a signed-in person, reads
 * included: destination settings name the systems an organization's alerts go to.
 */
export async function destinationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => requirePerson(req));
  app.get("/catalog", async (req) => {
    const ctx = await req.orgContext();
    return { integrations: await withTenant(ctx.orgId, (db) => catalogForOrg(db, ctx), { readOnly: true }) };
  });
  app.get("/destinations", async (req) => {
    const ctx = await req.orgContext();
    return { destinations: await withTenant(ctx.orgId, (db) => listDestinations(db, ctx), { readOnly: true }) };
  });
  app.post("/destinations", async (req, reply) => {
    const ctx = await req.orgContext();
    const body = { ...destinationInputSchema.parse(req.body), ...destinationCommonSchema.parse(req.body) };
    return reply.code(201).send(await withTenant(ctx.orgId, (db) => createDestination(db, ctx, body)));
  });
  app.get("/destinations/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => getDestination(db, ctx, id), { readOnly: true });
  });
  app.patch("/destinations/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = parsePatch(destinationCommonSchema.extend({ enabled: z.boolean().optional() }), req.body);
    const d = await withTenant(ctx.orgId, (db) => updateDestination(db, ctx, id, body));
    const { secretEnvelope: _s, ...safe } = d;
    return { ...safe, cursorSeq: safe.cursorSeq.toString() };
  });
  app.post("/destinations/:id/secret", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const { secret } = z.object({ secret: z.string().max(500).nullable().default(null) }).parse(req.body ?? {});
    return withTenant(ctx.orgId, (db) => replaceDestinationSecret(db, ctx, id, secret));
  });
  app.post("/destinations/:id/test", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return sendTestEvent((fn) => withTenant(ctx.orgId, fn), ctx, id);
  });
  app.post("/deliveries/:id/retry", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    await withTenant(ctx.orgId, (db) => retryDelivery(db, ctx, id));
    return { ok: true };
  });
}
