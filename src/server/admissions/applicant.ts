// Family sessions for the public application pages.
//
// Families apply before they belong to the school, so they have no school membership and the main sign-in
// (which needs one) does not apply. The application pages use their own short session: an httpOnly cookie
// holding the user id, an expiry and a per-user check value, signed with AUTH_SECRET (HMAC-SHA256). Accounts are
// ordinary global users (the same email and password later work for the family portal once the school invites
// them). Email ownership is confirmed with a six-digit code before any application data is saved.
import "server-only";
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { identityDb } from "@/lib/tenant-db";

export const APPLICANT_COOKIE = "hz_applicant";
const TTL_SEC = 12 * 3600;
const CODE_TTL_MS = 30 * 60_000;
const codeIdentifier = (userId: string) => `apply-code:${userId}`;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const sign = (payload: string) => createHmac("sha256", secret()).update(`applicant:${payload}`).digest("base64url");

/** Ties a session to the account's password: changing the password ends older sessions. */
function stamp(passwordHash: string | null) {
  return createHash("sha256").update(passwordHash ?? "none").digest("base64url").slice(0, 12);
}

export function makeApplicantToken(userId: string, passwordHash: string | null, now = Date.now()): string {
  const payload = b64(JSON.stringify({ u: userId, x: Math.floor(now / 1000) + TTL_SEC, s: stamp(passwordHash) }));
  return `${payload}.${sign(payload)}`;
}

export function readApplicantToken(token: string | undefined | null, now = Date.now()): { userId: string; stamp: string } | null {
  if (!token || token.length > 400) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: string; x?: number; s?: string };
    if (!p.u || !p.x || !p.s || p.x * 1000 < now) return null;
    return { userId: p.u, stamp: p.s };
  } catch {
    return null;
  }
}

export type Applicant = { userId: string; email: string; name: string; verified: boolean };

/** The family signed in on the application pages, or null. */
export async function currentApplicant(): Promise<Applicant | null> {
  const jar = await cookies();
  const t = readApplicantToken(jar.get(APPLICANT_COOKIE)?.value);
  if (!t) return null;
  const u = await identityDb.user.findUnique({ where: { id: t.userId }, select: { id: true, email: true, nameEn: true, emailVerified: true, passwordHash: true } });
  if (!u || stamp(u.passwordHash) !== t.stamp) return null;
  return { userId: u.id, email: u.email, name: u.nameEn, verified: Boolean(u.emailVerified) };
}

export async function setApplicantSession(userId: string) {
  const u = await identityDb.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  (await cookies()).set(APPLICANT_COOKIE, makeApplicantToken(userId, u?.passwordHash ?? null), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SEC,
  });
}

export async function clearApplicantSession() {
  (await cookies()).delete(APPLICANT_COOKIE);
}

// ---------------------------------------------------------------------------
// Email verification codes (six digits, 30 minutes, only the hash is stored)
// ---------------------------------------------------------------------------

const hashCode = (userId: string, code: string) => createHash("sha256").update(`${userId}:${code}`).digest("hex");

/** Create a fresh code for the user; older codes stop working. Returns the code for the email. */
export async function issueEmailCode(userId: string, now = new Date()): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const identifier = codeIdentifier(userId);
  await identityDb.verificationToken.deleteMany({ where: { identifier } });
  await identityDb.verificationToken.create({ data: { identifier, token: hashCode(userId, code), expires: new Date(now.getTime() + CODE_TTL_MS) } });
  return code;
}

/** Check a code. On success the email counts as verified and the code is used up. */
export async function confirmEmailCode(userId: string, code: string, now = new Date()): Promise<boolean> {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) return false;
  const identifier = codeIdentifier(userId);
  const row = await identityDb.verificationToken.findFirst({ where: { identifier, token: hashCode(userId, clean) } });
  if (!row || row.expires.getTime() < now.getTime()) return false;
  await identityDb.verificationToken.deleteMany({ where: { identifier } });
  await identityDb.user.update({ where: { id: userId }, data: { emailVerified: now } });
  return true;
}
