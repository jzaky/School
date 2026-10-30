import type { FastifyInstance } from "fastify";
import { personOnlyForWrites } from "../plugins/auth.js";
import { withTenant } from "@aegis/db";
import { z } from "zod";
import { approvalListFilter, decideApprovalAndExecute, decideSchema, getApproval, listApprovals } from "@aegis/core";

export async function approvalRoutes(app: FastifyInstance) {
  personOnlyForWrites(app);
  app.get("/", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listApprovals(db, ctx, approvalListFilter.parse(req.query)));
  });
  app.get("/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => getApproval(db, ctx, id));
  });
  app.post("/:id/decide", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = decideSchema.parse(req.body);
    return decideApprovalAndExecute((fn) => withTenant(ctx.orgId, fn), ctx, id, body);
  });
}
