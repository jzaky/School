import { rawPrisma } from "@aegis/db";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { AegisError, unauthorized, validation } from "../lib/errors.js";
import { hashPassword, passwordPolicyIssues, verifyPassword } from "./password.js";
import { createSession } from "./sessions.js";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp.js";
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
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AegisError("rate_limited", "Account temporarily locked after repeated failures. Try again later.");
  }
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    throw unauthorized("Invalid email or password");
  }
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
  const secret = generateTotpSecret();
  await rawPrisma().user.update({ where: { id: userId }, data: { mfaSecretEnc: encryptSecret(secret, `mfa:${userId}`), mfaEnabled: false } });
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

export async function verifyMfaCode(userId: string, code: string): Promise<boolean> {
  const user = await rawPrisma().user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaEnabled || !user.mfaSecretEnc) return false;
  return verifyTotp(decryptSecret(user.mfaSecretEnc, `mfa:${userId}`), code);
}

export async function disableMfa(userId: string, code: string) {
  if (!(await verifyMfaCode(userId, code))) throw unauthorized("Invalid code");
  await rawPrisma().user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null } });
}
