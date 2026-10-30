import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { accessReviewOverview, completeAccessReview, decideAccessReviewItem, startAccessReview } from "@aegis/core";
import { z } from "zod";
import { requirePerson } from "../plugins/auth.js";

/** Agent access reviews (docs/ACCESS_REVIEWS.md). Certifying access is a person's job: API keys are refused. */
export async function accessReviewRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => requirePerson(req));
  app.get("/", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => accessReviewOverview(db, ctx), { readOnly: true });
  });
  app.post("/", async (req, reply) => {
    const ctx = await req.orgContext();
    return reply.code(201).send(await withTenant(ctx.orgId, (db) => startAccessReview(db, ctx, req.body ?? {})));
  });
  app.post("/items/:id/decide", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => decideAccessReviewItem(db, ctx, id, req.body ?? {}));
  });
  app.post("/:id/complete", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => completeAccessReview(db, ctx, id));
  });
}
