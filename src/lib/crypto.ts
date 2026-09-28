// Field-level encryption for sensitive identifiers (Emirates ID, passport, medical notes). AES-256-GCM.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) throw new Error("FIELD_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return buf;
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptField(value: string): string {
  const [v, iv, tag, data] = value.split(":");
  if (v !== "v1") throw new Error("Unknown encryption format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export function mask(last4: string | null | undefined, kind: "eid" | "passport") {
  if (!last4) return "";
  return kind === "eid" ? `784-••••-•••${last4.slice(0, 1)}${last4.slice(1)}-•` : `•••••${last4}`;
}
