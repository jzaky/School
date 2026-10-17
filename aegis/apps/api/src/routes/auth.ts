import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSession, isProduction, listUserMemberships, loginSchema, loginWithPassword, revokeSession, SESSION_COOKIE, setSessionOrg, unauthorized, verifySessionMfa } from "@aegis/core";
import { requireUser } from "../plugins/auth.js";

export async function authRoutes(app: FastifyInstance) {
  const cookieOpts = { httpOnly: true, secure: isProduction(), sameSite: "lax" as const, path: "/" };

  app.post("/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const r = await loginWithPassword(body, { ip: req.ip, userAgent: req.headers["user-agent"] });
    reply.setCookie(SESSION_COOKIE, r.token, cookieOpts);
    return { ok: true, mfaRequired: r.mfaRequired, activeOrgId: r.activeOrgId };
  });

  app.post("/mfa", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const s = requireUser(req);
    const { code } = z.object({ code: z.string().length(6) }).parse(req.body);
    const r = await verifySessionMfa(s.id, s.user.id, code);
    if (!r.ok) throw unauthorized(r.revoked ? "Too many wrong codes; this session is closed. Sign in again." : `Invalid code (${r.remaining} attempts left)`);
    return { ok: true };
  });

  app.post("/logout", async (req, reply) => {
    if (req.session) await revokeSession(req.session.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/me", async (req) => {
    const s = requireUser(req);
    const memberships = await listUserMemberships(s.user.id);
    return { user: s.user, activeOrgId: s.activeOrgId, mfaPassed: s.mfaPassed, memberships };
  });

  app.post("/switch-org", async (req) => {
    const s = requireUser(req);
    const { orgId } = z.object({ orgId: z.string().uuid() }).parse(req.body);
    const memberships = await listUserMemberships(s.user.id);
    if (!memberships.some((m) => m.orgId === orgId && m.status === "active")) throw unauthorized("Not a member");
    await setSessionOrg(s.id, orgId);
    return { ok: true };
  });

  // Used by the SDK quick start: creates a short session for API docs (not for production use).
  app.get("/session-check", async (req) => ({ authenticated: !!req.session || !!req.apiKey, principal: req.apiKey ? { type: req.apiKey.subjectType, id: req.apiKey.subjectId } : req.session ? { type: "user", id: req.session.user.id } : null }));
  void createSession;
}
