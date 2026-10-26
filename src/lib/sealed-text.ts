// Field-level encryption for free text that needs it (case notes): AES-256-GCM through src/lib/crypto.ts.
// Stored values look like "v1:<iv>:<tag>:<data>". Rows written before encryption was switched on are plain text
// until the migration step in scripts/db-migrate.ts seals them, so reading accepts both.
import { decryptField, encryptField } from "./crypto";

// 12 byte IV (16 base64 characters) and 16 byte tag (24 characters, ending in "==").
const SEALED = /^v1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]*={0,2}$/;

export function isSealed(value: unknown): value is string {
  return typeof value === "string" && SEALED.test(value);
}

/** Encrypt text for storage. */
export function sealText(plain: string): string {
  return encryptField(plain);
}

/** Read stored text: decrypts sealed values, returns older plain text as it is. */
export function openText(stored: string | null | undefined): string {
  if (stored === null || stored === undefined) return "";
  return isSealed(stored) ? decryptField(stored) : stored;
}
