import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import {
  addRegulatoryAction,
  assessmentSchema,
  assessRegulatoryChange,
  changeModelStage,
  completeDeletion,
  createRegulatoryChange,
  datasetAccessAudit,
  datasetInputSchema,
  decideDeletion,
  decideModelApproval,
  deletionCompletionSchema,
  deletionDecisionSchema,
  deletionRequestSchema,
  evaluationInputSchema,
  getModel,
  getModelGovernance,
  getRegulatoryChange,
  linkAgentModel,
  listDatasets,
  listModels,
  listRegulatoryChanges,
  markRegulatoryImplemented,
  modelDecisionSchema,
  modelGovernanceSettingSchema,
  modelInputSchema,
  modelStageSchema,
  recordEvaluation,
  registerDataset,
  registerModel,
  regulatoryActionSchema,
  regulatoryChangeSchema,
  requestDeletion,
  requestModelApproval,
  suggestImpact,
  updateModelGovernance,
} from "@aegis/core";
import { z } from "zod";
import { personOnlyForWrites } from "../plugins/auth.js";

const idParam = z.object({ id: z.string().uuid() });
const noteBody = z.object({ note: z.string().trim().max(2000).default("") });

/** Model registry, dataset inventory, deletion requests and the regulatory change register. Writes need a person. */
export async function governanceRegistryRoutes(app: FastifyInstance) {
  personOnlyForWrites(app);
  // Models
  app.get("/models", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, async (db) => ({ ...(await listModels(db, ctx)), enforcement: await getModelGovernance(db, ctx.orgId) }), { readOnly: true });
  });
  app.post("/models", async (req, reply) => {
    const ctx = await req.orgContext();
    const body = modelInputSchema.parse(req.body);
    return reply.code(201).send(await withTenant(ctx.orgId, (db) => registerModel(db, ctx, body)));
  });
  app.get("/models/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => getModel(db, ctx, id), { readOnly: true });
  });
  app.post("/models/:id/evaluations", async (req, reply) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = evaluationInputSchema.parse(req.body);
    return reply.code(201).send(await withTenant(ctx.orgId, (db) => recordEvaluation(db, ctx, id, body)));
  });
  app.post("/models/:id/request-approval", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const { note } = noteBody.parse(req.body ?? {});
    return withTenant(ctx.orgId, (db) => requestModelApproval(db, ctx, id, note));
  });
  app.post("/models/:id/decide", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = modelDecisionSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => decideModelApproval(db, ctx, id, body));
  });
  app.post("/models/:id/stage", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = modelStageSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => changeModelStage(db, ctx, id, body));
  });
  app.put("/agents/:id/model", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const { modelId } = z.object({ modelId: z.string().uuid().nullable() }).parse(req.body);
    await withTenant(ctx.orgId, (db) => linkAgentModel(db, ctx, id, modelId));
    return { ok: true };
  });
  app.put("/models/enforcement", async (req) => {
    const ctx = await req.orgContext();
    const body = modelGovernanceSettingSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => updateModelGovernance(db, ctx, body));
  });

  // Datasets and deletion requests
  app.get("/datasets", async (req) => {
    const ctx = await req.orgContext();
    return { datasets: await withTenant(ctx.orgId, (db) => listDatasets(db, ctx), { readOnly: true }) };
  });
  app.post("/datasets", async (req, reply) => {
    const ctx = await req.orgContext();
    const body = datasetInputSchema.parse(req.body);
    return reply.code(201).send(await withTenant(ctx.orgId, (db) => registerDataset(db, ctx, body)));
  });
  app.get("/datasets/:id/audit", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => datasetAccessAudit(db, ctx, id), { readOnly: true });
  });
  app.post("/deletion-requests", async (req, reply) => {
    const ctx = await req.orgContext();
    const body = deletionRequestSchema.parse(req.body);
    return reply.code(201).send(await withTenant(ctx.orgId, (db) => requestDeletion(db, ctx, body)));
  });
  app.post("/deletion-requests/:id/decide", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = deletionDecisionSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => decideDeletion(db, ctx, id, body));
  });
  app.post("/deletion-requests/:id/complete", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = deletionCompletionSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => completeDeletion(db, ctx, id, body));
  });

  // Regulatory change register
  app.get("/regulatory-changes", async (req) => {
    const ctx = await req.orgContext();
    return { changes: await withTenant(ctx.orgId, (db) => listRegulatoryChanges(db, ctx), { readOnly: true }) };
  });
  app.post("/regulatory-changes", async (req, reply) => {
    const ctx = await req.orgContext();
    const body = regulatoryChangeSchema.parse(req.body);
    return reply.code(201).send(await withTenant(ctx.orgId, (db) => createRegulatoryChange(db, ctx, body)));
  });
  app.get("/regulatory-changes/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => getRegulatoryChange(db, ctx, id), { readOnly: true });
  });
  app.get("/regulatory-changes/:id/suggestions", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => suggestImpact(db, ctx, id), { readOnly: true });
  });
  app.post("/regulatory-changes/:id/assessment", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = assessmentSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => assessRegulatoryChange(db, ctx, id, body));
  });
  app.post("/regulatory-changes/:id/actions", async (req, reply) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = regulatoryActionSchema.parse(req.body);
    return reply.code(201).send(await withTenant(ctx.orgId, (db) => addRegulatoryAction(db, ctx, id, body)));
  });
  app.post("/regulatory-changes/:id/implemented", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const { note } = z.object({ note: z.string().trim().min(5).max(2000) }).parse(req.body);
    return withTenant(ctx.orgId, (db) => markRegulatoryImplemented(db, ctx, id, note));
  });
}
