// School API key format: "hzk_" followed by 43 random URL-safe characters (32 bytes). Only the SHA-256 hash
// is stored; the first 12 characters are kept as a display prefix so people can tell keys apart.
import { createHash, randomBytes } from "node:crypto";

export const KEY_PREFIX = "hzk_";
const SHAPE = /^hzk_[A-Za-z0-9_-]{43}$/;

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key.trim(), "utf8").digest("hex");
}

/** Cheap shape check so junk never reaches the database. */
export function looksLikeApiKey(key: string): boolean {
  return SHAPE.test(key);
}

/** The key from an Authorization: Bearer header (or an X-API-Key header). */
export function keyFromHeaders(h: Headers): string | null {
  const auth = h.get("authorization");
  const m = auth ? /^Bearer\s+(\S+)$/i.exec(auth.trim()) : null;
  const raw = m?.[1] ?? h.get("x-api-key")?.trim() ?? null;
  return raw && looksLikeApiKey(raw) ? raw : null;
}
