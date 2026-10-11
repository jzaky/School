import type { FastifyInstance } from "fastify";
import multipart, { type MultipartFile, type MultipartValue } from "@fastify/multipart";
import { withTenant } from "@aegis/db";
import { z } from "zod";
import {
  addControl,
  assessmentDashboard,
  assessmentListFilter,
  attachEvidence,
  controlInputSchema,
  createAssessment,
  createAssessmentSchema,
  createCustomFramework,
  createFrameworkSchema,
  createTask,
  createTaskSchema,
  deleteControl,
  deleteDocument,
  documentListFilter,
  generateReport,
  generateReportSchema,
  getAssessment,
  getDocument,
  getDocumentChunks,
  getFramework,
  getTask,
  importControls,
  listAssessments,
  listControlMappings,
  listDocuments,
  listExports,
  listFrameworks,
  listTasks,
  MAX_DOCUMENT_BYTES,
  parseDocument,
  readExport,
  refreshControlMappings,
  reopenFinding,
  resolveFinding,
  runAssessment,
  storeDocument,
  taskListFilter,
  transition,
  transitionSchema,
  updateControl,
  updateTask,
  updateTaskSchema,
  validateFinding,
  validateFindingSchema,
} from "@aegis/core/audit/index";
import { validation } from "@aegis/core";

const idParam = z.object({ id: z.string().uuid() });

function fieldValue(file: MultipartFile, name: string): string | undefined {
  const f = file.fields[name];
  const v = Array.isArray(f) ? f[0] : f;
  if (!v || v.type !== "field") return undefined;
  return String((v as MultipartValue).value ?? "");
}

/** Routes under /v1/audit. Document content is never logged; only metadata leaves this handler. */
export async function auditRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 10 } });

  // ---------- Documents ----------
  app.post("/documents", async (req) => {
    const ctx = await req.orgContext();
    const file = await req.file();
    if (!file) throw validation("Multipart upload with a 'file' part is required");
    const buffer = await file.toBuffer().catch(() => {
      throw validation(`File exceeds the ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB limit`);
    });
    if (file.file.truncated) throw validation(`File exceeds the ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB limit`);
    const title = fieldValue(file, "title")?.trim() || file.filename.replace(/\.[a-z0-9]+$/i, "");
    const retention = fieldValue(file, "retentionDays");
    const retentionDays = retention ? z.coerce.number().int().min(1).max(3650).parse(retention) : undefined;
    return withTenant(ctx.orgId, (db) => storeDocument(db, ctx, { title, filename: file.filename, mime: file.mimetype, buffer, retentionDays }));
  });
  app.get("/documents", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listDocuments(db, ctx, documentListFilter.parse(req.query)));
  });
  app.get("/documents/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => getDocument(db, ctx, id));
  });
  app.get("/documents/:id/chunks", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(20) }).parse(req.query);
    return withTenant(ctx.orgId, (db) => getDocumentChunks(db, ctx, id, limit));
  });
  app.post("/documents/:id/parse", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    // Parsing can take longer than the default 15 s tenant transaction.
    return withTenant(ctx.orgId, (db) => parseDocument(db, ctx, id), { timeout: 90_000 });
  });
  app.delete("/documents/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const { force } = z.object({ force: z.coerce.boolean().default(false) }).parse(req.query);
    return withTenant(ctx.orgId, (db) => deleteDocument(db, ctx, id, { force }));
  });

  // ---------- Frameworks ----------
  app.get("/frameworks", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listFrameworks(db, ctx));
  });
  app.get("/frameworks/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => getFramework(db, ctx, id));
  });
  app.post("/frameworks", async (req) => {
    const ctx = await req.orgContext();
    const body = createFrameworkSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => createCustomFramework(db, ctx, body));
  });
  app.post("/frameworks/:id/controls", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = controlInputSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => addControl(db, ctx, id, body));
  });
  app.post("/frameworks/:id/controls/import", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const { csv } = z.object({ csv: z.string().min(1).max(1_000_000) }).parse(req.body);
    return withTenant(ctx.orgId, (db) => importControls(db, ctx, id, csv));
  });
  app.patch("/controls/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = controlInputSchema.partial().parse(req.body);
    return withTenant(ctx.orgId, (db) => updateControl(db, ctx, id, body));
  });
  app.delete("/controls/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    await withTenant(ctx.orgId, (db) => deleteControl(db, ctx, id));
    return { deleted: true };
  });

  // ---------- Assessments ----------
  app.get("/dashboard", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => assessmentDashboard(db, ctx));
  });
  app.get("/assessments", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listAssessments(db, ctx, assessmentListFilter.parse(req.query)));
  });
  app.post("/assessments", async (req) => {
    const ctx = await req.orgContext();
    const body = createAssessmentSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => createAssessment(db, ctx, body));
  });
  app.get("/assessments/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => getAssessment(db, ctx, id));
  });
  app.post("/assessments/:id/run", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => runAssessment(db, ctx, id), { timeout: 120_000 });
  });
  app.post("/findings/:id/validate", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = validateFindingSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => validateFinding(db, ctx, id, body));
  });
  app.post("/findings/:id/resolve", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const { note } = z.object({ note: z.string().max(2000).default("") }).parse(req.body ?? {});
    return withTenant(ctx.orgId, (db) => resolveFinding(db, ctx, id, note));
  });
  app.post("/findings/:id/reopen", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const { note } = z.object({ note: z.string().max(2000).default("") }).parse(req.body ?? {});
    return withTenant(ctx.orgId, (db) => reopenFinding(db, ctx, id, note));
  });
  app.get("/mappings", async (req) => {
    const ctx = await req.orgContext();
    const { frameworkId } = z.object({ frameworkId: z.string().uuid().optional() }).parse(req.query);
    return withTenant(ctx.orgId, (db) => listControlMappings(db, ctx, frameworkId));
  });
  app.post("/mappings/refresh", async (req) => {
    const ctx = await req.orgContext();
    const { frameworkId } = z.object({ frameworkId: z.string().uuid() }).parse(req.body);
    return withTenant(ctx.orgId, (db) => refreshControlMappings(db, ctx, frameworkId));
  });

  // ---------- Remediation ----------
  app.get("/remediation", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listTasks(db, ctx, taskListFilter.parse(req.query)));
  });
  app.post("/remediation", async (req) => {
    const ctx = await req.orgContext();
    const body = createTaskSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => createTask(db, ctx, body));
  });
  app.get("/remediation/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => getTask(db, ctx, id));
  });
  app.patch("/remediation/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = updateTaskSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => updateTask(db, ctx, id, body));
  });
  app.post("/remediation/:id/transition", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = transitionSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => transition(db, ctx, id, body.status, body.note));
  });
  app.post("/remediation/:id/evidence", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(req.body);
    return withTenant(ctx.orgId, (db) => attachEvidence(db, ctx, id, documentId));
  });

  // ---------- Reports ----------
  app.post("/reports", async (req) => {
    const ctx = await req.orgContext();
    const body = generateReportSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => generateReport(db, ctx, body), { timeout: 60_000 });
  });
  app.get("/reports", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listExports(db, ctx));
  });
  app.get("/reports/:id/download", async (req, reply) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const r = await withTenant(ctx.orgId, (db) => readExport(db, ctx, id));
    return reply
      .header("content-type", r.contentType)
      .header("content-length", String(r.buffer.length))
      .header("content-disposition", `attachment; filename="${r.filename}"`)
      .header("x-content-sha256", r.export.sha256)
      .send(r.buffer);
  });
}
