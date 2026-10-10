import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { z } from "zod";
import { acknowledgeAlert, alertFilter, alertStats, approvalTurnaround, complianceControlsForFramework, complianceMappingSummary, createMonitoringRule, deleteMonitoringRule, evidenceFilter, evidenceTypes, exportEvidence, getEvidenceEvent, governanceMetrics, governanceReport, governanceTimeSeries, listAlerts, listEvidence, listMonitoringRules, observedTechnicalControls, resolveAlert, ruleInputSchema, runMonitoring, serviceHealth, topAgentsByDenials, updateMonitoringRule, verifyAndRecord } from "@aegis/core";

export async function assuranceRoutes(app: FastifyInstance) {
  app.get("/dashboard", async (req) => {
    const ctx = await req.orgContext();
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    return withTenant(ctx.orgId, async (db) => ({ metrics: await governanceMetrics(db, ctx, days), series: await governanceTimeSeries(db, ctx, days), topDenied: await topAgentsByDenials(db, ctx, days), approvals: await approvalTurnaround(db, ctx, days), health: await serviceHealth(db, ctx) }));
  });
  app.get("/evidence", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listEvidence(db, ctx, evidenceFilter.parse(req.query)));
  });
  app.get("/evidence/types", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => evidenceTypes(db, ctx));
  });
  app.get("/evidence/:seq", async (req) => {
    const ctx = await req.orgContext();
    const { seq } = z.object({ seq: z.coerce.bigint() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => getEvidenceEvent(db, ctx, seq));
  });
  app.post("/evidence/verify", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => verifyAndRecord(db, ctx));
  });
  app.get("/evidence/export", async (req, reply) => {
    const ctx = await req.orgContext();
    const f = evidenceFilter.extend({ format: z.enum(["jsonl", "csv"]).default("jsonl") }).parse(req.query);
    const out = await withTenant(ctx.orgId, (db) => exportEvidence(db, ctx, f), { timeout: 60_000 });
    reply.header("content-type", out.contentType).header("content-disposition", `attachment; filename="${out.filename}"`).header("x-aegis-sha256", out.sha256).header("x-aegis-chain-valid", String(out.verification.valid));
    return reply.send(out.body);
  });
  app.get("/report", async (req) => {
    const ctx = await req.orgContext();
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    return withTenant(ctx.orgId, (db) => governanceReport(db, ctx, days), { timeout: 60_000 });
  });
  app.get("/alerts", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listAlerts(db, ctx, alertFilter.parse(req.query)));
  });
  app.get("/alerts/stats", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => alertStats(db, ctx));
  });
  app.post("/alerts/:id/acknowledge", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => acknowledgeAlert(db, ctx, id));
  });
  app.post("/alerts/:id/resolve", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { note } = z.object({ note: z.string().min(3).max(2000) }).parse(req.body);
    return withTenant(ctx.orgId, (db) => resolveAlert(db, ctx, id, note));
  });
  app.get("/monitoring/rules", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listMonitoringRules(db, ctx));
  });
  app.post("/monitoring/rules", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => createMonitoringRule(db, ctx, ruleInputSchema.parse(req.body)));
  });
  app.patch("/monitoring/rules/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => updateMonitoringRule(db, ctx, id, ruleInputSchema.omit({ key: true }).partial().parse(req.body)));
  });
  app.delete("/monitoring/rules/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await withTenant(ctx.orgId, (db) => deleteMonitoringRule(db, ctx, id));
    return { ok: true };
  });
  app.post("/monitoring/run", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => runMonitoring(db, ctx), { timeout: 60_000 });
  });
  app.get("/compliance/observed", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => observedTechnicalControls(db, ctx));
  });
  app.get("/compliance/frameworks", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => complianceMappingSummary(db, ctx));
  });
  app.get("/compliance/frameworks/:id/controls", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => complianceControlsForFramework(db, ctx, id));
  });
}
