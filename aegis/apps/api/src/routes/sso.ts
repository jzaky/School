import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { getSsoConnection, ssoConnectionSchema, upsertSsoConnection } from "@aegis/core";

/** SSO connection management for organization admins. The login flow itself runs in the web app (/sso/[slug]). */
export async function ssoRoutes(app: FastifyInstance) {
  app.get("/connection", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => getSsoConnection(db, ctx));
  });
  app.put("/connection", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => upsertSsoConnection(db, ctx, ssoConnectionSchema.parse(req.body)));
  });
}
