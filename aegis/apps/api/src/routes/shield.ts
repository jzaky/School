import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { z } from "zod";
import { createCustomDataClass, createDataClassSchema, deleteDataClass, listDataClasses, loadEnabledDataClasses, updateDataClass, updateDataClassSchema } from "@aegis/core/shield/data-classes";
import { inspectParams } from "@aegis/core/shield/detectors";
import { inspectUntrustedContent, detectInjectionInParams } from "@aegis/core/shield/injection";
import { getSecurityEvent, listSecurityEvents, securityEventFilter, securityEventStats, triageSecurityEvent, triageSchema } from "@aegis/core/shield/security-events";
import { evaluateToolSecurity, listToolSecurityOverview } from "@aegis/core/shield/tool-security";
import { addIncidentNote, assignIncident, createIncident, createIncidentSchema, getIncident, incidentListFilter, incidentStats, linkSecurityEvent, listIncidents, setIncidentStatus, setIncidentStatusSchema } from "@aegis/core/incidents/service";
import { assertPermission } from "@aegis/core/orgs/orgs";

const idParam = z.object({ id: z.string().uuid() });

/** Mount under /v1/shield. Every handler resolves the org context and runs inside a tenant transaction. */
export async function shieldRoutes(app: FastifyInstance) {
  // ---------- security events ----------
  app.get("/events", async (req) => {
    const ctx = await req.orgContext();
    const f = securityEventFilter.parse(req.query);
    return withTenant(ctx.orgId, (db) => listSecurityEvents(db, ctx, f));
  });
  app.get("/events/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => getSecurityEvent(db, ctx, id));
  });
  app.post("/events/:id/triage", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = triageSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => triageSecurityEvent(db, ctx, id, body));
  });
  app.get("/stats", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, async (db) => ({ events: await securityEventStats(db, ctx), incidents: await incidentStats(db, ctx) }));
  });

  // ---------- data classes ----------
  app.get("/data-classes", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listDataClasses(db, ctx));
  });
  app.post("/data-classes", async (req, reply) => {
    const ctx = await req.orgContext();
    const body = createDataClassSchema.parse(req.body);
    const row = await withTenant(ctx.orgId, (db) => createCustomDataClass(db, ctx, body));
    return reply.code(201).send(row);
  });
  app.patch("/data-classes/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = updateDataClassSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => updateDataClass(db, ctx, id, body));
  });
  app.delete("/data-classes/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => deleteDataClass(db, ctx, id));
  });

  // ---------- dry runs (no persistence) ----------
  const inspectSchema = z.object({ params: z.record(z.string(), z.unknown()), toolKey: z.string().min(1).max(80).optional(), agentId: z.string().uuid().optional(), resourceKey: z.string().max(80).optional(), action: z.string().max(80).optional() }).strict();
  app.post("/inspect", async (req) => {
    const ctx = await req.orgContext();
    assertPermission(ctx, "security:read");
    const body = inspectSchema.parse(req.body);
    return withTenant(ctx.orgId, async (db) => {
      const classes = await loadEnabledDataClasses(db, ctx.orgId);
      const inspection = inspectParams(body.params, classes);
      const injection = detectInjectionInParams(body.params, 20);
      const toolSecurity = body.toolKey && body.agentId ? await evaluateToolSecurity(db, ctx.orgId, { agentId: body.agentId, toolKey: body.toolKey, params: body.params, resourceKey: body.resourceKey ?? null, action: body.action }) : null;
      return { dryRun: true, inspection, injection, toolSecurity };
    });
  });
  const injectionSchema = z.object({ text: z.string().max(200_000), provenance: z.enum(["trusted", "untrusted", "retrieved"]).default("untrusted") }).strict();
  app.post("/injection-check", async (req) => {
    const ctx = await req.orgContext();
    assertPermission(ctx, "security:read");
    const body = injectionSchema.parse(req.body);
    return { dryRun: true, ...inspectUntrustedContent(body) };
  });

  // ---------- tool security ----------
  app.get("/tool-security", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listToolSecurityOverview(db, ctx));
  });
  const toolEvalQuery = z.object({ agentId: z.string().uuid(), toolKey: z.string().min(1).max(80), resourceKey: z.string().max(80).optional(), destinationDomain: z.string().max(253).optional() });
  app.get("/tool-security/evaluate", async (req) => {
    const ctx = await req.orgContext();
    assertPermission(ctx, "security:read");
    const q = toolEvalQuery.parse(req.query);
    return withTenant(ctx.orgId, (db) => evaluateToolSecurity(db, ctx.orgId, { agentId: q.agentId, toolKey: q.toolKey, resourceKey: q.resourceKey ?? null, destinationDomain: q.destinationDomain ?? undefined, params: {} }));
  });

  // ---------- incidents ----------
  app.get("/incidents", async (req) => {
    const ctx = await req.orgContext();
    const f = incidentListFilter.parse(req.query);
    return withTenant(ctx.orgId, (db) => listIncidents(db, ctx, f));
  });
  app.post("/incidents", async (req, reply) => {
    const ctx = await req.orgContext();
    const body = createIncidentSchema.parse(req.body);
    const row = await withTenant(ctx.orgId, (db) => createIncident(db, ctx, body));
    return reply.code(201).send(row);
  });
  app.get("/incidents/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => getIncident(db, ctx, id));
  });
  app.post("/incidents/:id/status", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = setIncidentStatusSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => setIncidentStatus(db, ctx, id, body));
  });
  app.post("/incidents/:id/assign", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = z.object({ assigneeId: z.string().uuid().nullable(), note: z.string().max(2000).default("") }).strict().parse(req.body);
    return withTenant(ctx.orgId, (db) => assignIncident(db, ctx, id, body.assigneeId, body.note));
  });
  app.post("/incidents/:id/notes", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = z.object({ note: z.string().min(2).max(5000) }).strict().parse(req.body);
    return withTenant(ctx.orgId, (db) => addIncidentNote(db, ctx, id, body.note));
  });
  app.post("/incidents/:id/link", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = z.object({ securityEventId: z.string().uuid(), note: z.string().max(2000).default("") }).strict().parse(req.body);
    return withTenant(ctx.orgId, (db) => linkSecurityEvent(db, ctx, id, body.securityEventId, body.note));
  });
}
