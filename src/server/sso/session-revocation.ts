// Session revocation for JWT sessions: a password reset sets User.sessionsValidFrom, and any session that started
// before it no longer counts (checked in src/server/context.ts on every request).

/** True when a session that started at `signedInAt` (ms) was ended by a later password reset. */
export function sessionRevoked(sessionsValidFrom: Date | null | undefined, signedInAt: number | null | undefined): boolean {
  if (!sessionsValidFrom) return false;
  return (signedInAt ?? 0) < sessionsValidFrom.getTime();
}
