import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { z } from "zod";
import { forbidden } from "@aegis/core";
import { IMPORT_FORMATS, importDiscoveryFile, listDiscoveryImports, listShadowAiApps, shadowAiCoverage } from "@aegis/core/secure/shadow-ai";
import { requireScope } from "../plugins/auth.js";

const importBody = z.object({ format: z.enum(IMPORT_FORMATS), text: z.string().max(20 * 1024 * 1024), label: z.string().max(200).optional() }).strict();

/**
 * Shadow AI discovery (docs/SHADOW_AI.md). Mount under /v1/shadow-ai.
 * Log forwarders post exports with an integration key holding discovery:report; people use the console.
 */
export async function shadowAiRoutes(app: FastifyInstance) {
  app.post("/imports", { bodyLimit: 21 * 1024 * 1024 }, async (req, reply) => {
    if (req.apiKey) {
      requireScope(req, "discovery:report");
      if (req.apiKey.subjectType !== "integration") throw forbidden("Only an integration key can report discovery data");
    }
    const ctx = await req.orgContext();
    const body = importBody.parse(req.body);
    const r = await withTenant(ctx.orgId, (db) => importDiscoveryFile(db, ctx, body));
    return reply.code(201).send(r);
  });
  app.get("/apps", async (req) => {
    if (req.apiKey) throw forbidden("Read discovery results in the console");
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listShadowAiApps(db, ctx), { readOnly: true });
  });
  app.get("/coverage", async (req) => {
    if (req.apiKey) throw forbidden("Read discovery results in the console");
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => shadowAiCoverage(db, ctx), { readOnly: true });
  });
  app.get("/imports", async (req) => {
    if (req.apiKey) throw forbidden("Read discovery results in the console");
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listDiscoveryImports(db, ctx), { readOnly: true });
  });
}
