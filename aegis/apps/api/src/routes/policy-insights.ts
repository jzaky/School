import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { buildSectorTemplate, decidePolicyException, exceptionRequestSchema, listPolicyExceptions, organizationConflicts, policyEnforcement, policyRecommendations, requestPolicyException, revokePolicyException, runPolicyTests, SECTOR_TEMPLATES, type SectorTemplateId } from "@aegis/core";
import { z } from "zod";
import { personOnlyForWrites } from "../plugins/auth.js";

const idParam = z.object({ id: z.string().uuid() });
const templateIds = SECTOR_TEMPLATES.map((t) => t.id) as [SectorTemplateId, ...SectorTemplateId[]];

/** Policy conflicts, enforcement status, recommendations, exceptions and sector templates. Writes need a person. */
export async function policyInsightRoutes(app: FastifyInstance) {
  personOnlyForWrites(app, ["/templates/:id/preview"]);
  app.get("/enforcement", async (req) => {
    const ctx = await req.orgContext();
    const m = await withTenant(ctx.orgId, (db) => policyEnforcement(db, ctx), { readOnly: true });
    return { policies: Object.fromEntries(m) };
  });
  app.get("/conflicts", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => organizationConflicts(db, ctx), { readOnly: true });
  });
  app.get("/recommendations", async (req) => {
    const ctx = await req.orgContext();
    return { recommendations: await withTenant(ctx.orgId, (db) => policyRecommendations(db, ctx), { readOnly: true }) };
  });
  app.get("/exceptions", async (req) => {
    const ctx = await req.orgContext();
    return { exceptions: await withTenant(ctx.orgId, (db) => listPolicyExceptions(db, ctx), { readOnly: true }) };
  });
  app.post("/exceptions", async (req, reply) => {
    const ctx = await req.orgContext();
    const body = exceptionRequestSchema.parse(req.body);
    return reply.code(201).send(await withTenant(ctx.orgId, (db) => requestPolicyException(db, ctx, body)));
  });
  app.post("/exceptions/:id/decide", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = z.object({ approve: z.boolean(), note: z.string().max(2000) }).parse(req.body);
    return withTenant(ctx.orgId, (db) => decidePolicyException(db, ctx, id, body));
  });
  app.post("/exceptions/:id/revoke", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().max(2000) }).parse(req.body);
    return withTenant(ctx.orgId, (db) => revokePolicyException(db, ctx, id, reason));
  });
  app.get("/templates", async (req) => {
    await req.orgContext();
    return { templates: SECTOR_TEMPLATES };
  });
  /** Builds a template's document and runs its tests. Writes nothing. */
  app.post("/templates/:id/preview", async (req) => {
    await req.orgContext();
    const { id } = z.object({ id: z.enum(templateIds) }).parse(req.params);
    const document = buildSectorTemplate(id, req.body);
    return { document, tests: runPolicyTests(document) };
  });
}
