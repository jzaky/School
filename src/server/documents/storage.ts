import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Configured, s3 } from "./r2";

export { putR2Object } from "./r2";

// Documents live in Cloudflare R2 (S3 API) when R2_* env vars are set. Access is only ever through
// short-lived signed URLs. Without R2 (local development) files go to a local folder.
// The R2 client lives in ./r2 so the worker can share it.

const LOCAL_DIR = process.env.LOCAL_UPLOAD_DIR ?? path.join(process.cwd(), ".uploads");

export async function putObject(orgId: string, fileName: string, body: Buffer, contentType: string) {
  const safe = fileName.replace(/[^\w.-]+/g, "_").slice(-80);
  const key = `${orgId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}-${safe}`;
  if (r2Configured()) {
    await s3().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, Body: body, ContentType: contentType }));
    return `r2:${key}`;
  }
  const full = path.join(LOCAL_DIR, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
  return `local:${key}`;
}

/** A signed URL valid for five minutes (R2), or null for locally stored files. */
export async function signedUrl(storageKey: string, fileName: string) {
  if (!storageKey.startsWith("r2:") || !r2Configured()) return null;
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: storageKey.slice(3), ResponseContentDisposition: `inline; filename="${encodeURIComponent(fileName)}"` }),
    { expiresIn: 300 },
  );
}

export async function readLocal(storageKey: string) {
  if (!storageKey.startsWith("local:")) return null;
  const rel = storageKey.slice(6);
  if (rel.includes("..")) return null;
  try {
    return await readFile(path.join(LOCAL_DIR, rel));
  } catch {
    return null;
  }
}

export const storageMode = () => (r2Configured() ? "r2" : "local");
