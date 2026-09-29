// Invitation tokens and school join codes. Tokens are random, sent once, and stored only as a SHA-256 hash.
import { createHash, randomBytes, randomInt } from "node:crypto";

export const INVITE_TTL_DAYS = 14;
const DAY = 86_400_000;

/** A URL-safe random token (32 bytes of entropy). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

/** Cheap shape check so junk never reaches the database. */
export function looksLikeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{32,64}$/.test(token);
}

export function inviteExpiry(now: Date, days = INVITE_TTL_DAYS): Date {
  return new Date(now.getTime() + days * DAY);
}

export type InviteState = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";

export function inviteState(
  inv: { revokedAt: Date | null; expiresAt: Date; uses: number; maxUses: number },
  now: Date,
): InviteState {
  if (inv.revokedAt) return "REVOKED";
  if (inv.uses >= inv.maxUses) return "ACCEPTED";
  if (inv.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return "PENDING";
}

export function isUsable(inv: { revokedAt: Date | null; expiresAt: Date; uses: number; maxUses: number }, now: Date) {
  return inviteState(inv, now) === "PENDING";
}

// No 0/O, 1/I/L: codes are read aloud and typed from posters.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A school join code such as "HZN-7K4Q". The prefix comes from the school's short name. */
export function generateJoinCode(shortName: string): string {
  const letters = shortName
    .normalize("NFD")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
    .replace(/[AEIOU]/g, (c, i) => (i === 0 ? c : ""))
    .slice(0, 3);
  const prefix = (letters.length >= 2 ? letters : "SCH").padEnd(3, "X");
  let tail = "";
  for (let i = 0; i < 5; i++) tail += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${prefix}-${tail}`;
}

/** Normalize a join code for comparison: case, spaces and dashes do not matter. Empty when it cannot be a code. */
export function normalizeJoinCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length < 4 || raw.length > 16) return "";
  return raw;
}
