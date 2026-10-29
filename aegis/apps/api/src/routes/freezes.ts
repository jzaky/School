import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { createFreeze, endFreeze, listFreezes, setTwoPersonRecovery } from "@aegis/core";
import { z } from "zod";
import { requirePerson } from "../plugins/auth.js";

/**
 * Change freezes and two-person recovery (docs/CHANGE_FREEZE.md). A freeze is an order a person gives,
 * so every route needs a signed-in person; an agent cannot start or end one.
 */
export async function freezeRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => requirePerson(req));
  app.get("/", async (req) => {
    const ctx = await req.orgContext();
    return { freezes: await withTenant(ctx.orgId, (db) => listFreezes(db, ctx), { readOnly: true }) };
  });
  app.post("/", async (req, reply) => {
    const ctx = await req.orgContext();
    return reply.code(201).send(await withTenant(ctx.orgId, (db) => createFreeze(db, ctx, req.body ?? {})));
  });
  app.post("/:id/end", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().max(500) }).parse(req.body ?? {});
    return withTenant(ctx.orgId, (db) => endFreeze(db, ctx, id, reason));
  });
  app.post("/two-person-recovery", async (req) => {
    const ctx = await req.orgContext();
    const body = z.object({ enabled: z.boolean(), reason: z.string().max(500) }).parse(req.body);
    return withTenant(ctx.orgId, (db) => setTwoPersonRecovery(db, ctx, body));
  });
}
