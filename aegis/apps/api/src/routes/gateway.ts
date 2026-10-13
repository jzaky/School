import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { z } from "zod";
import { requireScope } from "../plugins/auth.js";
import { actionRequestInputSchema, appendEvidence, auditEnforcementPath, authorizeAndExecute, enforcementCoverage, consumeGrant, forbidden, getActionRequest, hashObject, issueGrantForRequest, listActionRequests, recordAgentExecution, releaseQuarantine, releaseQuarantineSchema, requestListFilter, provideApprovalInfo } from "@aegis/core";

/**
 * The Action Gateway. Agents call POST /v1/gateway/actions before doing anything protected.
 * Fail closed: any thrown error maps to a non-2xx response and the SDK treats that as deny.
 */
export async function gatewayRoutes(app: FastifyInstance) {
  app.post("/actions", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (req, reply) => {
    requireScope(req, "gateway:submit");
    const ctx = await req.orgContext();
    if (ctx.actor.type !== "agent") throw forbidden("Use an agent API key");
    const headerKey = req.headers["idempotency-key"];
    const body = actionRequestInputSchema.parse({ ...(req.body as object), ...(typeof headerKey === "string" && !(req.body as { idempotencyKey?: string }).idempotencyKey ? { idempotencyKey: headerKey } : {}) });
    const result = await authorizeAndExecute(withTenant, ctx, body);
    // 200: proceeds now (allow, restrict). 202: held for a person or for more information. 403: refused.
    const held = result.decision === "require_approval" || result.decision === "quarantine" || result.decision === "request_more_information";
    reply.status(result.decision === "allow" || result.decision === "restrict" ? 200 : held ? 202 : 403);
    return result;
  });

  app.get("/actions", async (req) => {
    requireScope(req, "gateway:read");
    const ctx = await req.orgContext();
    const f = requestListFilter.parse(req.query);
    return withTenant(ctx.orgId, (db) => listActionRequests(db, ctx, f));
  });

  app.get("/actions/:id", async (req) => {
    requireScope(req, "gateway:read");
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => getActionRequest(db, ctx, id));
  });

  /** Agent-mode: after allow or approval, the agent fetches its single execution grant to present downstream. */
  app.post("/actions/:id/grant", async (req) => {
    requireScope(req, "gateway:submit");
    const ctx = await req.orgContext();
    if (ctx.actor.type !== "agent") throw forbidden("Use an agent API key");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => issueGrantForRequest(db, ctx, id));
  });

  /** Agent-mode: the agent reports the outcome of executing through its own channel (writes the receipt). */
  app.post("/actions/:id/execute", async (req) => {
    requireScope(req, "gateway:submit");
    const ctx = await req.orgContext();
    if (ctx.actor.type !== "agent") throw forbidden("Use an agent API key");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ grant: z.string().min(10), outcome: z.enum(["succeeded", "failed"]).default("succeeded"), reference: z.string().max(200).nullable().optional(), summary: z.record(z.unknown()).optional() }).parse(req.body);
    return withTenant(ctx.orgId, (db) => recordAgentExecution(db, ctx, id, body));
  });

  /**
   * Downstream systems verify a grant before acting. They compute the hash of what they were handed
   * (sha256 of canonical {toolKey, action, params}) so parameter swaps are caught here.
   */
  app.post("/grants/verify", async (req, reply) => {
    requireScope(req, "grants:verify");
    const ctx = await req.orgContext();
    if (ctx.actor.type !== "integration") throw forbidden("Use an integration API key");
    const body = z.object({ grant: z.string().min(10), toolKey: z.string(), action: z.string().default("execute"), params: z.record(z.unknown()) }).parse(req.body);
    const result = await withTenant(ctx.orgId, async (db) => {
      // The grant must have been issued for this integration: another downstream system's key cannot consume it.
      const r = await consumeGrant(db, body.grant, hashObject({ toolKey: body.toolKey, action: body.action, params: body.params }), { integrationId: ctx.actor.id! });
      await appendEvidence(db, ctx, { type: r.ok ? "gateway.grant_verified_downstream" : "gateway.grant_rejected_downstream", subjectType: "action_request", subjectId: r.ok ? r.actionRequestId : "unknown", payload: { tool: body.toolKey, ok: r.ok, reason: r.ok ? null : r.reason } });
      return r;
    });
    if (!result.ok) reply.status(403);
    return result;
  });

  /** Security review of a quarantined request: refuse it or release it into the approval flow. */
  app.post("/actions/:id/quarantine", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = releaseQuarantineSchema.parse(req.body);
    return withTenant(ctx.orgId, (db) => releaseQuarantine(db, ctx, id, body));
  });

  /** How each agent's tools are enforced, and what the last enforcement-path audit found. */
  app.get("/enforcement/coverage", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => enforcementCoverage(db, ctx));
  });

  /** Compares an integration's own recent operations with what AEGIS authorized. */
  app.post("/enforcement/:integrationId/audit", async (req) => {
    const ctx = await req.orgContext();
    const { integrationId } = z.object({ integrationId: z.string().uuid() }).parse(req.params);
    const { windowHours } = z.object({ windowHours: z.number().int().min(1).max(24 * 30).default(24) }).parse(req.body ?? {});
    return auditEnforcementPath((fn) => withTenant(ctx.orgId, fn), ctx, integrationId, { windowHours });
  });

  app.post("/approvals/:id/info", async (req) => {
    requireScope(req, "gateway:submit");
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { info } = z.object({ info: z.string().min(3).max(2000) }).parse(req.body);
    await withTenant(ctx.orgId, (db) => provideApprovalInfo(db, ctx, id, info));
    return { ok: true };
  });
}
