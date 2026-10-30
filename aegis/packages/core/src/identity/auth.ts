import { rawPrisma } from "@aegis/db";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { AegisError, unauthorized, validation } from "../lib/errors.js";
import { hashPassword, passwordPolicyIssues, verifyPassword } from "./password.js";
import { createSession } from "./sessions.js";
import { generateTotpSecret, totpUri, matchTotpStep, verifyTotp } from "./totp.js";
import { listUserMemberships } from "./memberships.js";

const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

export const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(512) });

export interface LoginResult {
  token: string;
  sessionId: string;
  userId: string;
  mfaRequired: boolean;
  activeOrgId: string | null;
}

export async function loginWithPassword(input: z.infer<typeof loginSchema>, meta: { ip?: string; userAgent?: string }): Promise<LoginResult> {
  const db = rawPrisma();
  const email = input.email.toLowerCase().trim();
  const user = await db.user.findUnique({ where: { email } });
  // Constant-shape failure path: always verify against some hash to avoid timing leaks on user existence.
  const dummyHash = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  if (!user || !user.passwordHash || user.status !== "active") {
    await verifyPassword(dummyHash, input.password);
    throw unauthorized("Invalid email or password");
  }
  // Each attempt reserves its place in the failure count with one atomic update before the password is checked,
  // so parallel guesses cannot all read the same count and pass the limit together. A success resets it.
  const reserved = await db.$queryRaw<{ failed_logins: number }[]>`
    UPDATE users SET failed_logins = failed_logins + 1,
      locked_until = CASE WHEN failed_logins + 1 >= ${MAX_FAILED}::int THEN now() + make_interval(mins => ${LOCK_MINUTES}::int) ELSE locked_until END
    WHERE id = ${user.id}::uuid AND (locked_until IS NULL OR locked_until <= now()) AND failed_logins < ${MAX_FAILED}::int
    RETURNING failed_logins`;
  if (!reserved.length) {
    // Locked, or a previous lock has just ended: an ended lock starts a fresh count once, atomically.
    const restarted = await db.user.updateMany({ where: { id: user.id, failedLogins: { gte: MAX_FAILED }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }] }, data: { failedLogins: 1, lockedUntil: null } });
    if (!restarted.count) throw new AegisError("rate_limited", "Account temporarily locked after repeated failures. Try again later.");
  }
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) throw unauthorized("Invalid email or password");
  const memberships = await listUserMemberships(user.id);
  const membership = memberships.find((m) => m.status === "active");
  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const { token, session } = await createSession(user.id, { ...meta, activeOrgId: membership?.orgId ?? null, mfaPassed: !user.mfaEnabled });
  return { token, sessionId: session.id, userId: user.id, mfaRequired: user.mfaEnabled, activeOrgId: membership?.orgId ?? null };
}

export async function registerUser(input: { email: string; name: string; password: string }) {
  const issues = passwordPolicyIssues(input.password);
  if (issues.length) throw validation(`Password needs ${issues.join(", ")}`);
  const email = input.email.toLowerCase().trim();
  const existing = await rawPrisma().user.findUnique({ where: { email } });
  if (existing) throw new AegisError("conflict", "An account with this email already exists");
  return rawPrisma().user.create({ data: { email, name: input.name.trim(), passwordHash: await hashPassword(input.password) } });
}

export async function changePassword(userId: string, current: string, next: string) {
  const user = await rawPrisma().user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) throw unauthorized("Current password is incorrect");
  const issues = passwordPolicyIssues(next);
  if (issues.length) throw validation(`Password needs ${issues.join(", ")}`);
  await rawPrisma().user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
}

/** Step 1 of MFA enrolment: creates a secret (stored encrypted, not yet enabled) and returns the otpauth URI. */
export async function beginMfaEnrolment(userId: string) {
  const user = await rawPrisma().user.findUniqueOrThrow({ where: { id: userId } });
  // Replacing an active second factor would switch it off without proof; turning it off needs a current code.
  if (user.mfaEnabled) throw validation("Two-factor authentication is already on. Turn it off with a current code before enrolling a new device.");
  const secret = generateTotpSecret();
  await rawPrisma().user.update({ where: { id: userId }, data: { mfaSecretEnc: encryptSecret(secret, `mfa:${userId}`), mfaEnabled: false, mfaLastStep: null } });
  return { secret, uri: totpUri(secret, user.email) };
}

/** Step 2: the user proves they hold the secret. */
export async function confirmMfaEnrolment(userId: string, code: string) {
  const user = await rawPrisma().user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaSecretEnc) throw validation("MFA enrolment has not started");
  const secret = decryptSecret(user.mfaSecretEnc, `mfa:${userId}`);
  if (!verifyTotp(secret, code)) throw unauthorized("Invalid code");
  await rawPrisma().user.update({ where: { id: userId }, data: { mfaEnabled: true } });
}

/**
 * Checks a TOTP code. Each code is accepted once: the matched time step must be later than the last
 * accepted one, and the update is conditional, so two concurrent uses of the same code cannot both pass.
 */
export async function verifyMfaCode(userId: string, code: string): Promise<boolean> {
  const user = await rawPrisma().user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaEnabled || !user.mfaSecretEnc) return false;
  const step = matchTotpStep(decryptSecret(user.mfaSecretEnc, `mfa:${userId}`), code);
  if (step === null) return false;
  const claimed = await rawPrisma().user.updateMany({ where: { id: userId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: BigInt(step) } }] }, data: { mfaLastStep: BigInt(step) } });
  return claimed.count === 1;
}

/** Wrong codes allowed in one session before it is revoked and the user must sign in again. */
export const MFA_MAX_FAILURES = 5;

/**
 * MFA step of a sign-in. Counts wrong codes per session and revokes the session at the limit, so a
 * six-digit code cannot be guessed by repeated tries. On success the session is marked MFA-passed.
 */
export async function verifySessionMfa(sessionId: string, userId: string, code: string): Promise<{ ok: true } | { ok: false; revoked: boolean; remaining: number }> {
  const session = await rawPrisma().session.findUnique({ where: { id: sessionId } });
  if (!session || session.revokedAt || session.userId !== userId) return { ok: false, revoked: true, remaining: 0 };
  if (session.mfaFailures >= MFA_MAX_FAILURES) return { ok: false, revoked: true, remaining: 0 };
  if (await verifyMfaCode(userId, code)) {
    await rawPrisma().session.update({ where: { id: sessionId }, data: { mfaPassed: true, mfaFailures: 0 } });
    return { ok: true };
  }
  const updated = await rawPrisma().session.update({ where: { id: sessionId }, data: { mfaFailures: { increment: 1 } } });
  if (updated.mfaFailures >= MFA_MAX_FAILURES) {
    await rawPrisma().session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    return { ok: false, revoked: true, remaining: 0 };
  }
  return { ok: false, revoked: false, remaining: MFA_MAX_FAILURES - updated.mfaFailures };
}

export async function disableMfa(userId: string, code: string) {
  if (!(await verifyMfaCode(userId, code))) throw unauthorized("Invalid code");
  await rawPrisma().user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null } });
}
