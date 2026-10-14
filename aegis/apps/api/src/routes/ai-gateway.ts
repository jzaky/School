import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { forbidden, makeContext, unauthorized } from "@aegis/core";
import { aiEventFilter, aiGatewayStats, completeAiRequest, listAiGatewayEvents, listAiProviders, prepareAiRequest } from "@aegis/core/secure/ai-gateway";
import { requireScope } from "../plugins/auth.js";

/**
 * Employee AI gateway (docs/AI_GATEWAY_DLP.md), OpenAI-compatible. Mount under /v1/ai.
 * Chat requests need an API key with the ai:chat scope: a person's own key, or an application's key.
 * Agent keys cannot hold that scope. Reading the log and providers uses the console session.
 */
export async function aiGatewayRoutes(app: FastifyInstance) {
  app.post("/chat/completions", async (req, reply) => {
    const key = req.apiKey;
    if (!key) throw unauthorized("Send an AEGIS key with the ai:chat scope in Authorization: Bearer");
    requireScope(req, "ai:chat");
    if (key.subjectType === "agent") throw forbidden("Agents act through the action gateway, not the AI gateway");
    const principal = { type: key.subjectType === "user" ? ("user" as const) : ("integration" as const), id: key.subjectId, apiKeyId: key.id };
    const ctx = makeContext(key.orgId, { type: principal.type, id: principal.id }, { requestId: req.id, ip: req.ip });
    const run = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ctx.orgId, fn);
    const prepared = await run((db) => prepareAiRequest(db, ctx, principal, req.body));
    const out = await completeAiRequest(run, ctx, prepared);
    reply.header("x-aegis-decision", out.decision).header("x-aegis-event-id", out.eventId).header("x-aegis-forwarded", String(out.forwarded));
    return reply.code(out.status).send(out.body);
  });

  app.get("/events", async (req) => {
    if (req.apiKey) throw forbidden("The AI gateway log is read in the console");
    const ctx = await req.orgContext();
    const f = aiEventFilter.parse(req.query);
    return withTenant(ctx.orgId, (db) => listAiGatewayEvents(db, ctx, f), { readOnly: true });
  });
  app.get("/stats", async (req) => {
    if (req.apiKey) throw forbidden("The AI gateway log is read in the console");
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => aiGatewayStats(db, ctx), { readOnly: true });
  });
  app.get("/providers", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listAiProviders(db, ctx), { readOnly: true });
  });
}
