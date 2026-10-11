import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { z } from "zod";
import { actionRequestInputSchema, appendEvidence, authorizeAndExecute, consumeGrant, forbidden, getActionRequest, hashObject, issueGrantForRequest, listActionRequests, recordAgentExecution, requestListFilter, provideApprovalInfo } from "@aegis/core";

/**
 * The Action Gateway. Agents call POST /v1/gateway/actions before doing anything protected.
 * Fail closed: any thrown error maps to a non-2xx response and the SDK treats that as deny.
 */
export async function gatewayRoutes(app: FastifyInstance) {
  app.post("/actions", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ctx = await req.orgContext();
    if (ctx.actor.type !== "agent") throw forbidden("Use an agent API key");
    const headerKey = req.headers["idempotency-key"];
    const body = actionRequestInputSchema.parse({ ...(req.body as object), ...(typeof headerKey === "string" && !(req.body as { idempotencyKey?: string }).idempotencyKey ? { idempotencyKey: headerKey } : {}) });
    const result = await authorizeAndExecute(withTenant, ctx, body);
    reply.status(result.decision === "allow" ? 200 : result.decision === "require_approval" ? 202 : 403);
    return result;
  });

  app.get("/actions", async (req) => {
    const ctx = await req.orgContext();
    const f = requestListFilter.parse(req.query);
    return withTenant(ctx.orgId, (db) => listActionRequests(db, ctx, f));
  });

  app.get("/actions/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => getActionRequest(db, ctx, id));
  });

  /** Agent-mode: after allow or approval, the agent fetches its single execution grant to present downstream. */
  app.post("/actions/:id/grant", async (req) => {
    const ctx = await req.orgContext();
    if (ctx.actor.type !== "agent") throw forbidden("Use an agent API key");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, (db) => issueGrantForRequest(db, ctx, id));
  });

  /** Agent-mode: the agent reports the outcome of executing through its own channel (writes the receipt). */
  app.post("/actions/:id/execute", async (req) => {
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
    const ctx = await req.orgContext();
    if (ctx.actor.type !== "integration") throw forbidden("Use an integration API key");
    const body = z.object({ grant: z.string().min(10), toolKey: z.string(), action: z.string().default("execute"), params: z.record(z.unknown()) }).parse(req.body);
    const result = await withTenant(ctx.orgId, async (db) => {
      const r = await consumeGrant(db, body.grant, hashObject({ toolKey: body.toolKey, action: body.action, params: body.params }));
      await appendEvidence(db, ctx, { type: r.ok ? "gateway.grant_verified_downstream" : "gateway.grant_rejected_downstream", subjectType: "action_request", subjectId: r.ok ? r.actionRequestId : "unknown", payload: { tool: body.toolKey, ok: r.ok, reason: r.ok ? null : r.reason } });
      return r;
    });
    if (!result.ok) reply.status(403);
    return result;
  });

  app.post("/approvals/:id/info", async (req) => {
    const ctx = await req.orgContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { info } = z.object({ info: z.string().min(3).max(2000) }).parse(req.body);
    await withTenant(ctx.orgId, (db) => provideApprovalInfo(db, ctx, id, info));
    return { ok: true };
  });
}
