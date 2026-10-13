import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { z } from "zod";
import { accessRequestSchema, createDelegation, createDelegationSchema, decideAccessRequest, emergencyRevokeAgent, leastPrivilegeRecommendations, listAccessRequests, listDelegations, listDiscoveredAgents, observationSchema, recordAgentObservation, resolveDiscoveredAgent, requestAccess, revokeAccess, revokeDelegation } from "@aegis/core";
import { requireScope } from "../plugins/auth.js";

const uuid = z.object({ id: z.string().uuid() });

/** Agent identity and access: discovery, temporary access, delegation, least privilege, emergency revocation. */
export async function identityRoutes(app: FastifyInstance) {
  // Integrations and pipelines report agents they see; people review them in the console.
  app.post("/discovery/agents", async (req) => {
    requireScope(req, "discovery:report");
    const ctx = await req.orgContext();
    const body = observationSchema.parse(req.body);
    const row = await withTenant(ctx.orgId, (db) => recordAgentObservation(db, ctx, body));
    return { id: row.id, status: row.status, linkedAgentId: row.linkedAgentId };
  });
  app.get("/discovery/agents", async (req) => {
    const ctx = await req.orgContext();
    const { status } = z.object({ status: z.enum(["unregistered", "linked", "ignored"]).optional() }).parse(req.query);
    return withTenant(ctx.orgId, (db) => listDiscoveredAgents(db, ctx, { status }));
  });
  app.post("/discovery/agents/:id/resolve", async (req) => {
    const ctx = await req.orgContext();
    const { id } = uuid.parse(req.params);
    const body = z.union([z.object({ action: z.literal("link"), agentId: z.string().uuid() }), z.object({ action: z.literal("ignore"), note: z.string().min(3).max(500) })]).parse(req.body);
    return withTenant(ctx.orgId, (db) => resolveDiscoveredAgent(db, ctx, id, body));
  });

  app.get("/access-requests", async (req) => {
    const ctx = await req.orgContext();
    const f = z.object({ agentId: z.string().uuid().optional(), status: z.string().optional() }).parse(req.query);
    return withTenant(ctx.orgId, (db) => listAccessRequests(db, ctx, f));
  });
  app.post("/access-requests", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => requestAccess(db, ctx, accessRequestSchema.parse(req.body)));
  });
  app.post("/access-requests/:id/decide", async (req) => {
    const ctx = await req.orgContext();
    const { id } = uuid.parse(req.params);
    const body = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(1000).default("") }).parse(req.body);
    return withTenant(ctx.orgId, (db) => decideAccessRequest(db, ctx, id, body));
  });
  app.post("/access-requests/:id/revoke", async (req) => {
    const ctx = await req.orgContext();
    const { id } = uuid.parse(req.params);
    const { reason } = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
    await withTenant(ctx.orgId, (db) => revokeAccess(db, ctx, id, reason));
    return { ok: true };
  });

  app.get("/delegations", async (req) => {
    const ctx = await req.orgContext();
    const f = z.object({ agentId: z.string().uuid().optional(), activeOnly: z.coerce.boolean().optional() }).parse(req.query);
    return withTenant(ctx.orgId, (db) => listDelegations(db, ctx, f));
  });
  app.post("/delegations", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => createDelegation(db, ctx, createDelegationSchema.parse(req.body)));
  });
  app.post("/delegations/:id/revoke", async (req) => {
    const ctx = await req.orgContext();
    const { id } = uuid.parse(req.params);
    const { reason } = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
    return withTenant(ctx.orgId, (db) => revokeDelegation(db, ctx, id, reason));
  });

  app.get("/agents/:id/least-privilege", async (req) => {
    const ctx = await req.orgContext();
    const { id } = uuid.parse(req.params);
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(180).default(30) }).parse(req.query);
    return withTenant(ctx.orgId, (db) => leastPrivilegeRecommendations(db, ctx, { agentId: id, days }));
  });
  app.post("/agents/:id/emergency-revoke", async (req) => {
    const ctx = await req.orgContext();
    const { id } = uuid.parse(req.params);
    const body = z.object({ mode: z.enum(["suspend", "revoke"]), reason: z.string().min(5).max(1000) }).parse(req.body);
    return withTenant(ctx.orgId, (db) => emergencyRevokeAgent(db, ctx, id, body));
  });
}
