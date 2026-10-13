import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { withTenant } from "@aegis/db";
import { z } from "zod";
import { env, scimCreateUser, scimDeleteUser, scimError, scimGetUser, scimListGroups, scimListUsers, scimPatchGroup, scimPatchUser, scimReplaceUser, unauthorized } from "@aegis/core";
import { requireScope } from "../plugins/auth.js";

/**
 * SCIM 2.0 for identity providers (Microsoft Entra ID, Okta). Authenticate with an integration API key
 * that has the scim:provision scope. Responses use application/scim+json and SCIM error bodies.
 */
export async function scimRoutes(app: FastifyInstance) {
  app.addContentTypeParser("application/scim+json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (e) {
      done(e as Error, undefined);
    }
  });
  const base = () => `${env().API_PUBLIC_URL}/scim/v2`;
  const handle = (fn: (req: FastifyRequest) => Promise<unknown>, okStatus = 200) => async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!req.apiKey) throw unauthorized("SCIM needs an API key");
      requireScope(req, "scim:provision");
      const out = await fn(req);
      reply.header("content-type", "application/scim+json");
      if (okStatus === 204) return reply.status(204).send();
      return reply.status(okStatus).send(out);
    } catch (e) {
      const { status, body } = scimError(e);
      return reply.status(status).header("content-type", "application/scim+json").send(body);
    }
  };
  const id = (req: FastifyRequest) => z.object({ id: z.string().uuid() }).parse(req.params).id;

  app.get("/ServiceProviderConfig", handle(async () => ({ schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"], patch: { supported: true }, bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 }, filter: { supported: true, maxResults: 200 }, changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false }, authenticationSchemes: [{ type: "oauthbearertoken", name: "AEGIS API key", description: "Integration API key with the scim:provision scope" }] })));
  app.get("/Users", handle(async (req) => {
    const ctx = await req.orgContext();
    const q = z.object({ filter: z.string().optional(), startIndex: z.coerce.number().int().optional(), count: z.coerce.number().int().optional() }).parse(req.query);
    return withTenant(ctx.orgId, (db) => scimListUsers(db, ctx, q, base()));
  }));
  app.get("/Users/:id", handle(async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => scimGetUser(db, ctx, id(req), base()));
  }));
  app.post("/Users", handle(async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => scimCreateUser(db, ctx, req.body, base()));
  }, 201));
  app.put("/Users/:id", handle(async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => scimReplaceUser(db, ctx, id(req), req.body, base()));
  }));
  app.patch("/Users/:id", handle(async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => scimPatchUser(db, ctx, id(req), req.body, base()));
  }));
  app.delete("/Users/:id", handle(async (req) => {
    const ctx = await req.orgContext();
    await withTenant(ctx.orgId, (db) => scimDeleteUser(db, ctx, id(req), base()));
    return null;
  }, 204));
  app.get("/Groups", handle(async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => scimListGroups(db, ctx, base()));
  }));
  app.patch("/Groups/:key", handle(async (req) => {
    const ctx = await req.orgContext();
    const { key } = z.object({ key: z.string().min(1).max(60) }).parse(req.params);
    await withTenant(ctx.orgId, (db) => scimPatchGroup(db, ctx, key, req.body));
    return { ok: true };
  }, 204));
}
