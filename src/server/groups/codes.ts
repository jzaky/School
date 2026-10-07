// Group invite codes: 10 characters from an alphabet without look-alikes, shown as XXXXX-XXXXX.
// Only a SHA-256 hash is stored; the code is shown once to the group admin who created it.
import { createHash, randomBytes } from "node:crypto";
import { JOIN_CODE_ALPHABET } from "@/lib/signup";

export const GROUP_INVITE_TTL_DAYS = 14;
const LENGTH = 10;

export function generateGroupCode(bytes: Uint8Array = randomBytes(LENGTH)): string {
  let out = "";
  for (let i = 0; i < LENGTH; i++) out += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** Upper case, without spaces or dashes. Returns null when it cannot be a group code. */
export function normalizeGroupCode(input: string): string | null {
  const s = String(input ?? "").toUpperCase().replace(/[\s-]+/g, "");
  if (s.length !== LENGTH) return null;
  for (const ch of s) if (!JOIN_CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export function hashGroupCode(normalized: string): string {
  return createHash("sha256").update(`group-invite:${normalized}`).digest("hex");
}

export function groupInviteState(inv: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date): "OPEN" | "USED" | "REVOKED" | "EXPIRED" {
  if (inv.usedAt) return "USED";
  if (inv.revokedAt) return "REVOKED";
  if (inv.expiresAt <= now) return "EXPIRED";
  return "OPEN";
}
