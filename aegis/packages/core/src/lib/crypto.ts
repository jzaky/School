import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacHex(key: string | Buffer, input: string | Buffer): string {
  return createHmac("sha256", key).update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function masterKey(): Buffer {
  const raw = Buffer.from(env().AEGIS_MASTER_KEY, "base64");
  if (raw.length !== 32) throw new Error("AEGIS_MASTER_KEY must decode to 32 bytes");
  return raw;
}

/**
 * AES-256-GCM envelope. Output format: v1.<iv>.<ciphertext>.<tag> (base64url).
 * The optional `aad` binds the ciphertext to a context (for example the row id) so a
 * ciphertext copied to another row fails to decrypt.
 */
export function encryptSecret(plaintext: string, aad = ""): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(".");
}

export function decryptSecret(envelope: string, aad = ""): string {
  const [v, ivB, ctB, tagB] = envelope.split(".");
  if (v !== "v1" || !ivB || !ctB || !tagB) throw new Error("Malformed secret envelope");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB, "base64url"));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * Canonical JSON (RFC 8785 style): sorted object keys, no whitespace, arrays in order,
 * undefined dropped. Non-integer numbers are normalised to 15 significant digits because JSON
 * stored in PostgreSQL through the database driver can come back with one digit less precision
 * than JavaScript's shortest representation (1/24 round-trips as 0.04166666666666666); 15 digits
 * survive that round trip exactly. Used for every hash in AEGIS so the same logical content
 * always hashes identically, before and after storage.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    if (typeof (value as { toJSON?: unknown }).toJSON === "function") return sortKeys((value as { toJSON: () => unknown }).toJSON());
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return normaliseNumber(value);
  return value;
}

export function normaliseNumber(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return n;
  return Number(n.toPrecision(15));
}

/** Returns a deep copy with numbers normalised and keys sorted: exactly what canonicalJson hashes. */
export function canonicalValue<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

export function hashObject(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Masks a secret for display: keeps a prefix, hides the rest. */
export function maskSecret(value: string, keep = 4): string {
  if (value.length <= keep) return "*".repeat(value.length);
  return value.slice(0, keep) + "*".repeat(Math.min(12, value.length - keep));
}
