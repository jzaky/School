// Encryption and keyed hashes for application data. Uses the same field key as student identifiers and medical notes.
import { createHmac } from "node:crypto";
import { decryptField, encryptField } from "@/lib/crypto";

function hashKey() {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) throw new Error("FIELD_ENCRYPTION_KEY is not set");
  // A separate key for hashing, derived from the field key, so the hash cannot be used to decrypt anything.
  return createHmac("sha256", Buffer.from(raw, "base64")).update("admissions:eid-hash:v1").digest();
}

/** Keyed hash of Emirates ID digits for duplicate matching. The number itself is stored encrypted. */
export function eidHash(digits: string): string {
  return createHmac("sha256", hashKey()).update(digits).digest("hex");
}

export function encryptJson(value: unknown): string {
  return encryptField(JSON.stringify(value));
}

export function decryptJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(decryptField(value)) as T;
  } catch {
    return null;
  }
}

export function decryptText(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return decryptField(value);
  } catch {
    return null;
  }
}

export { encryptField };
