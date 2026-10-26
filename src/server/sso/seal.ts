// Sealed values for the single sign-on flow cookie: AES-256-GCM with a key derived from AUTH_SECRET (HKDF), so the
// browser can neither read nor change the state, nonce and PKCE verifier it carries. Each value has an expiry
// and a purpose label; a value sealed for one purpose never opens for another.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

function keyFor(purpose: string): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "horizon-sso", `seal:${purpose}`, 32));
}

export function seal(purpose: string, data: unknown, ttlMs: number, now = Date.now()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(JSON.stringify({ d: data, e: now + ttlMs }), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function unseal<T>(purpose: string, value: string | null | undefined, now = Date.now()): T | null {
  if (!value || value.length > 8192) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, body] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", keyFor(purpose), iv);
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(tag);
    const out = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")) as { d: T; e: number };
    return typeof out.e === "number" && out.e > now ? out.d : null;
  } catch {
    return null;
  }
}

/** Constant-time comparison of two strings (different lengths compare false). */
export function sameString(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
