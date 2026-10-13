import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { effectiveScopes, forbidden, getOrganization, getUserMembership, makeContext, resolveApiKey, resolveSession, SESSION_COOKIE, unauthorized, type OrgContext, type ResolvedApiKey, type SessionInfo } from "@aegis/core";

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
      if (this.session.ssoOrgId && orgId !== this.session.ssoOrgId) throw forbidden("This single sign-on session is limited to the organization that issued it");
      const m = await getUserMembership(this.session.user.id, orgId);
      if (!m) throw forbidden("Not a member of this organization");
      if (this.session.user.mfaEnabled && !this.session.mfaPassed) throw unauthorized("MFA verification required");
      if (!this.session.user.mfaEnabled && (await orgRequiresMfa(orgId))) throw forbidden("This organization requires two-factor authentication; turn it on in the console first");
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

/**
 * Key-authenticated calls must carry the scope for the route. Session (console) users are governed by
 * their role permissions instead, checked in the core services.
 */
/**
 * Governance changes (policies, approvals, autonomy, access, delegations, revocation) are made by people.
 * API keys, which agents and integrations hold, are refused before the request body is even read.
 */
export function requirePerson(req: FastifyRequest) {
  if (req.apiKey) throw forbidden("Governance changes need a signed-in person; API keys cannot make them");
}

/**
 * Adds a hook to a route module: every write (anything but GET and HEAD) needs a person, except the listed
 * route paths (suffixes of the registered path), which keep their own scope checks.
 */
export function personOnlyForWrites(app: FastifyInstance, exceptions: string[] = []) {
  app.addHook("preHandler", async (req) => {
    if (req.method === "GET" || req.method === "HEAD") return;
    const route = req.routeOptions.url ?? "";
    if (exceptions.some((e) => route.endsWith(e))) return;
    requirePerson(req);
  });
}

export function requireScope(req: FastifyRequest, scope: string) {
  if (!req.apiKey) return;
  if (!effectiveScopes(req.apiKey).includes(scope)) throw forbidden(`This API key lacks the scope ${scope}`);
}

async function orgRequiresMfa(orgId: string): Promise<boolean> {
  const org = await getOrganization(orgId);
  return ((org.settings ?? {}) as { requireMfa?: boolean }).requireMfa === true;
}

export function requireUser(req: FastifyRequest): SessionInfo {
  if (!req.session) throw unauthorized();
  return req.session;
}
