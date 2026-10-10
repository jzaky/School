import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { forbidden, getUserMembership, makeContext, resolveApiKey, resolveSession, SESSION_COOKIE, unauthorized, type OrgContext, type ResolvedApiKey, type SessionInfo } from "@aegis/core";

declare module "fastify" {
  interface FastifyRequest {
    session: SessionInfo | null;
    apiKey: ResolvedApiKey | null;
    /** Builds a tenant context for the authenticated principal. Throws when unauthenticated. */
    orgContext(opts?: { orgId?: string }): Promise<OrgContext>;
  }
}

/**
 * Two principals: console users (session cookie) and agents or integrations (API key in
 * Authorization: Bearer). The context is derived per request; nothing is cached across requests.
 */
export const authPlugin = fp(async (app) => {
  app.decorateRequest("session", null);
  app.decorateRequest("apiKey", null);
  app.decorateRequest("orgContext", async function (this: FastifyRequest, opts: { orgId?: string } = {}) {
    if (this.apiKey) {
      if (opts.orgId && opts.orgId !== this.apiKey.orgId) throw forbidden("API key belongs to a different organization");
      return makeContext(this.apiKey.orgId, { type: this.apiKey.subjectType === "agent" ? "agent" : "integration", id: this.apiKey.subjectId }, { requestId: this.id, ip: this.ip });
    }
    if (this.session) {
      const orgId = opts.orgId ?? this.session.activeOrgId;
      if (!orgId) throw forbidden("No organization selected");
      const m = await getUserMembership(this.session.user.id, orgId);
      if (!m) throw forbidden("Not a member of this organization");
      if (this.session.user.mfaEnabled && !this.session.mfaPassed) throw unauthorized("MFA verification required");
      return makeContext(orgId, { type: "user", id: this.session.user.id, label: this.session.user.name, permissions: m.permissions, membershipId: m.membershipId }, { requestId: this.id, ip: this.ip });
    }
    throw unauthorized();
  });

  app.addHook("onRequest", async (req: FastifyRequest, _reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      req.apiKey = await resolveApiKey(auth.slice(7).trim());
      if (!req.apiKey) throw unauthorized("Invalid or revoked API key");
      return;
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) req.session = await resolveSession(token);
  });
});

export function requireUser(req: FastifyRequest): SessionInfo {
  if (!req.session) throw unauthorized();
  return req.session;
}
