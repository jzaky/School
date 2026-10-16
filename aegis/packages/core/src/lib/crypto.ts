import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { currentDataKey, dataKeyById, dataKeys } from "./keyring.js";

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

/**
 * AES-256-GCM envelope. Output format: v2.<key id>.<iv>.<ciphertext>.<tag> (base64url), written with
 * the current data key (lib/keyring.ts). The optional `aad` binds the ciphertext to a context (for
 * example the row id) so a ciphertext copied to another row fails to decrypt.
 */
export function encryptSecret(plaintext: string, aad = ""): string {
  const { id, key } = currentDataKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v2", id, iv.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(".");
}

function openWith(key: Buffer, ivB: string, ctB: string, tagB: string, aad: string): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * Opens an envelope. v2 names its key; v1 (written before key ids existed) is tried with each known
 * key, current first, which GCM's tag makes unambiguous.
 */
export function decryptSecret(envelope: string, aad = ""): string {
  const parts = envelope.split(".");
  if (parts[0] === "v2" && parts.length === 5) {
    const [, id, ivB, ctB, tagB] = parts as [string, string, string, string, string];
    const k = dataKeyById(id);
    if (!k) throw new Error(`No data key with id ${id} is configured (add it to AEGIS_PREVIOUS_MASTER_KEYS)`);
    return openWith(k.key, ivB, ctB, tagB, aad);
  }
  if (parts[0] === "v1" && parts.length === 4) {
    const [, ivB, ctB, tagB] = parts as [string, string, string, string];
    let last: unknown;
    for (const k of dataKeys()) {
      try {
        return openWith(k.key, ivB, ctB, tagB, aad);
      } catch (e) {
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error("No configured data key opens this envelope");
  }
  throw new Error("Malformed secret envelope");
}

/** The id of the key an envelope was written with ("v1" envelopes predate key ids). */
export function envelopeKeyId(envelope: string): string | null {
  const parts = envelope.split(".");
  return parts[0] === "v2" && parts.length === 5 ? parts[1]! : null;
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
