import { rawPrisma, type User } from "@aegis/db";
import { hmacHex, randomToken } from "../lib/crypto.js";
import { env } from "../env.js";
import { unauthorized } from "../lib/errors.js";

export const SESSION_COOKIE = "aegis_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours absolute
const IDLE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours idle

export function hashSessionToken(token: string): string {
  return hmacHex(env().AEGIS_SESSION_SECRET, `session:${token}`);
}

export interface SessionInfo {
  id: string;
  user: Pick<User, "id" | "email" | "name" | "isPlatformAdmin" | "mfaEnabled" | "status">;
  activeOrgId: string | null;
  mfaPassed: boolean;
  expiresAt: Date;
}

export async function createSession(userId: string, opts: { ip?: string; userAgent?: string; activeOrgId?: string | null; mfaPassed: boolean }) {
  const token = randomToken(32);
  const row = await rawPrisma().session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      ip: opts.ip,
      userAgent: opts.userAgent?.slice(0, 300),
      activeOrgId: opts.activeOrgId ?? null,
      mfaPassed: opts.mfaPassed,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return { token, session: row };
}

export async function resolveSession(token: string | undefined | null): Promise<SessionInfo | null> {
  if (!token) return null;
  const db = rawPrisma();
  const row = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { select: { id: true, email: true, name: true, isPlatformAdmin: true, mfaEnabled: true, status: true } } },
  });
  if (!row || row.revokedAt || row.expiresAt < new Date() || row.user.status !== "active") return null;
  if (row.lastSeenAt.getTime() + IDLE_TTL_MS < Date.now()) {
    await db.session.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    return null;
  }
  // Touch at most once a minute to keep writes low.
  if (Date.now() - row.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } });
  }
  return { id: row.id, user: row.user, activeOrgId: row.activeOrgId, mfaPassed: row.mfaPassed, expiresAt: row.expiresAt };
}

export async function requireSession(token: string | undefined | null): Promise<SessionInfo> {
  const s = await resolveSession(token);
  if (!s) throw unauthorized();
  return s;
}

export async function revokeSession(sessionId: string) {
  await rawPrisma().session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await rawPrisma().session.updateMany({ where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) }, data: { revokedAt: new Date() } });
}

export async function setSessionOrg(sessionId: string, orgId: string | null) {
  await rawPrisma().session.update({ where: { id: sessionId }, data: { activeOrgId: orgId } });
}

export async function markMfaPassed(sessionId: string) {
  await rawPrisma().session.update({ where: { id: sessionId }, data: { mfaPassed: true } });
}

export async function listSessions(userId: string) {
  return rawPrisma().session.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" }, select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true } });
}
