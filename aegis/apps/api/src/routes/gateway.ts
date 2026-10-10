import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { z } from "zod";
import { actionRequestInputSchema, authorizeAndExecute, consumeGrant, executeRequest, forbidden, getActionRequest, hashObject, listActionRequests, requestListFilter, issueGrant, notFound, provideApprovalInfo } from "@aegis/core";

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

  /** Agent-mode execution: after approval, the agent fetches a grant to present downstream. */
  app.post("/actions/:id/grant", async (req) => {
    const ctx = await req.orgContext();
    if (ctx.actor.type !== "agent") throw forbidden("Use an agent API key");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(ctx.orgId, async (db) => {
      const r = await db.actionRequest.findUnique({ where: { id }, include: { agent: true, grants: { where: { consumedAt: null, expiresAt: { gt: new Date() } } } } });
      if (!r || r.agentId !== ctx.actor.id) throw notFound("Action request");
      if (!["allowed", "approved"].includes(r.status)) throw forbidden(`Request is ${r.status}`);
      if (r.agent.status !== "active") throw forbidden(`Agent is ${r.agent.status}`);
      const g = await issueGrant(db, ctx.orgId, r.id, r.paramsHash);
      return { grant: g.token, expiresAt: g.grant.expiresAt, requestHash: r.paramsHash };
    });
  });

  /** Agent-mode: the agent reports that it executed through its own channel (writes the receipt). */
  app.post("/actions/:id/execute", async (req) => {
    const ctx = await req.orgContext();
    if (ctx.actor.type !== "agent") throw forbidden("Use an agent API key");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { grant } = z.object({ grant: z.string().min(10) }).parse(req.body);
    return withTenant(ctx.orgId, async (db) => {
      const r = await db.actionRequest.findUnique({ where: { id } });
      if (!r || r.agentId !== ctx.actor.id) throw notFound("Action request");
      return executeRequest(db, ctx, id, grant, r.params as Record<string, unknown>);
    });
  });

  /**
   * Downstream systems verify a grant before acting. They compute the hash of what they were handed
   * (sha256 of canonical {toolKey, action, params}) so parameter swaps are caught here.
   */
  app.post("/grants/verify", async (req, reply) => {
    const ctx = await req.orgContext();
    if (ctx.actor.type !== "integration") throw forbidden("Use an integration API key");
    const body = z.object({ grant: z.string().min(10), toolKey: z.string(), action: z.string().default("execute"), params: z.record(z.unknown()) }).parse(req.body);
    const result = await withTenant(ctx.orgId, (db) => consumeGrant(db, body.grant, hashObject({ toolKey: body.toolKey, action: body.action, params: body.params })));
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
