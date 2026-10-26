// Session revocation for JWT sessions. Checked in the Auth.js jwt callback (src/auth.ts) every time a session is
// read, so it applies to the school area, the group area and every route handler alike:
// - a password reset (or an unproven password being removed) sets User.sessionsValidFrom, and any session that
//   started before it no longer counts;
// - signing out records that session's id as ended, so a copy of the cookie stops working too;
// - a session ends SESSION_ABSOLUTE_HOURS after sign-in (default 7 days) however active it is; the cookie itself
//   also expires after 12 hours without use.
import { hit, peek } from "@/server/access/rate-limit";

/** True when a session that started at `signedInAt` (ms) was ended by a later password reset. */
export function sessionRevoked(sessionsValidFrom: Date | null | undefined, signedInAt: number | null | undefined): boolean {
  if (!sessionsValidFrom) return false;
  return (signedInAt ?? 0) < sessionsValidFrom.getTime();
}

/** Longest a session may last from sign-in, in milliseconds. */
export function absoluteSessionMs(env: NodeJS.ProcessEnv | { SESSION_ABSOLUTE_HOURS?: string } = process.env): number {
  const hours = Number.parseInt(env.SESSION_ABSOLUTE_HOURS ?? "", 10);
  return (Number.isFinite(hours) && hours >= 1 && hours <= 24 * 90 ? hours : 24 * 7) * 3600_000;
}

/** True when a session that started at `signedInAt` (ms) is older than the absolute limit. */
export function sessionTooOld(signedInAt: number, now = Date.now(), env?: NodeJS.ProcessEnv | { SESSION_ABSOLUTE_HOURS?: string }): boolean {
  return now - signedInAt > absoluteSessionMs(env);
}

const REVOKED_TTL_SEC = 13 * 3600; // longer than the 12 hour cookie lifetime

/** Record that a session id has ended (sign-out). Held in Redis, or in this server's memory without it. */
export async function revokeSessionId(sid: string): Promise<void> {
  if (!sid) return;
  await hit(`session-ended:${sid}`, 1_000_000, REVOKED_TTL_SEC);
}

export async function sessionIdRevoked(sid: string | null | undefined): Promise<boolean> {
  if (!sid) return false;
  return (await peek(`session-ended:${sid}`)) > 0;
}
