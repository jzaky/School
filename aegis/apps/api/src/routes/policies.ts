import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { z } from "zod";
import { activateVersion, assignPolicy, assignmentSchema, createPolicy, createPolicyVersion, deactivatePolicy, getPolicy, listPolicies, listPolicyHistory, policyInputSchema, rollbackToVersion, simulatePolicy, submitForReview } from "@aegis/core";

export async function policyRoutes(app: FastifyInstance) {
  app.get("/", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listPolicies(db, ctx));
  });
  app.post("/", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => createPolicy(db, ctx, policyInputSchema.parse(req.body)));
  });
  app.get("/history", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listPolicyHistory(db, ctx));
  });
  app.post("/simulate", async (req) => {
    const ctx = await req.orgContext();
    void ctx;
    const body = z.object({ document: z.unknown(), input: z.record(z.unknown()) }).parse(req.body);
    return simulatePolicy(body.document, body.input);
  });
  app.get("/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => getPolicy(db, ctx, id));
  });
  app.post("/:id/versions", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ document: z.unknown(), changeNote: z.string().max(500) }).parse(req.body);
    return withTenant(ctx.orgId, (db) => createPolicyVersion(db, ctx, id, { document: body.document as unknown, changeNote: body.changeNote }));
  });
  app.post("/versions/:versionId/submit", async (req) => {
    const ctx = await req.orgContext();
    const { versionId } = z.object({ versionId: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => submitForReview(db, ctx, versionId));
  });
  app.post("/versions/:versionId/activate", async (req) => {
    const ctx = await req.orgContext();
    const { versionId } = z.object({ versionId: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => activateVersion(db, ctx, versionId));
  });
  app.post("/versions/:versionId/rollback", async (req) => {
    const ctx = await req.orgContext();
    const { versionId } = z.object({ versionId: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
    return withTenant(ctx.orgId, (db) => rollbackToVersion(db, ctx, versionId, reason));
  });
  app.post("/:id/deactivate", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
    await withTenant(ctx.orgId, (db) => deactivatePolicy(db, ctx, id, reason));
    return { ok: true };
  });
  app.post("/:id/assignments", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => assignPolicy(db, ctx, id, assignmentSchema.parse(req.body)));
  });
}
