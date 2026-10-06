// Storage abstraction shared by the web app and the worker (no "server-only" marker).
// Files live in Cloudflare R2 (S3 API) when R2_* env vars are set, otherwise in a local folder.
// Keys are prefixed "r2:" or "local:". Object paths always start with the organization id, so a
// school's files can be listed and removed as one prefix.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Configured, s3 } from "./r2";

export const localDir = () => process.env.LOCAL_UPLOAD_DIR ?? path.join(process.cwd(), ".uploads");

/** Keys of stored files (as opposed to documents rendered on demand: render:, reportcard:, sample:). */
export const isStoredKey = (key: string) => key.startsWith("r2:") || key.startsWith("local:");

function localPath(rel: string) {
  if (!rel || rel.includes("..")) return null;
  return path.join(localDir(), rel);
}

export async function putObject(orgId: string, fileName: string, body: Buffer, contentType: string) {
  const safe = fileName.replace(/[^\w.-]+/g, "_").slice(-80);
  const key = `${orgId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}-${safe}`;
  return putObjectAt(key, body, contentType);
}

/** Store at an exact object path (which must start with the organization id). */
export async function putObjectAt(key: string, body: Buffer, contentType: string) {
  if (r2Configured()) {
    await s3().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, Body: body, ContentType: contentType }));
    return `r2:${key}`;
  }
  const full = localPath(key);
  if (!full) throw new Error("Invalid storage path");
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
  return `local:${key}`;
}

/** Read a stored file through whichever backend holds it. Null when missing or not a stored key. */
export async function getObject(storageKey: string): Promise<Buffer | null> {
  try {
    if (storageKey.startsWith("r2:")) {
      if (!r2Configured()) return null;
      const res = await s3().send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: storageKey.slice(3) }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    }
    if (storageKey.startsWith("local:")) {
      const full = localPath(storageKey.slice(6));
      return full ? await readFile(full) : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Remove one stored file. Returns true when a file was removed (or the backend accepted the delete). */
export async function deleteObject(storageKey: string): Promise<boolean> {
  try {
    if (storageKey.startsWith("r2:")) {
      if (!r2Configured()) return false;
      await s3().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: storageKey.slice(3) }));
      return true;
    }
    if (storageKey.startsWith("local:")) {
      const full = localPath(storageKey.slice(6));
      if (!full) return false;
      await unlink(full);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const full = path.join(dir, n);
    const s = await stat(full);
    if (s.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const validOrgPrefix = (orgId: string) => Boolean(orgId) && !orgId.includes("/") && !orgId.includes("..");

/** Every stored object under an organization's prefix, as storage keys. */
export async function listOrgObjects(orgId: string): Promise<string[]> {
  if (!validOrgPrefix(orgId)) return [];
  const keys: string[] = [];
  if (r2Configured()) {
    let token: string | undefined;
    do {
      const res = await s3().send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET!, Prefix: `${orgId}/`, ContinuationToken: token }));
      for (const o of res.Contents ?? []) if (o.Key) keys.push(`r2:${o.Key}`);
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }
  const base = localDir();
  for (const f of await walk(path.join(base, orgId))) keys.push(`local:${path.relative(base, f).split(path.sep).join("/")}`);
  return keys;
}

/** Remove every stored object of an organization. Returns how many were removed. */
export async function deleteOrgObjects(orgId: string): Promise<number> {
  if (!validOrgPrefix(orgId)) return 0;
  const keys = await listOrgObjects(orgId);
  let removed = 0;
  const r2Keys = keys.filter((k) => k.startsWith("r2:")).map((k) => k.slice(3));
  for (let i = 0; i < r2Keys.length; i += 1000) {
    const batch = r2Keys.slice(i, i + 1000);
    await s3().send(new DeleteObjectsCommand({ Bucket: process.env.R2_BUCKET!, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
    removed += batch.length;
  }
  const local = keys.filter((k) => k.startsWith("local:"));
  if (local.length) {
    removed += local.length;
    await rm(path.join(localDir(), orgId), { recursive: true, force: true });
  }
  return removed;
}

/** A signed URL (R2 only) valid for `expiresIn` seconds, or null for locally stored files. */
export async function signedObjectUrl(storageKey: string, fileName: string, expiresIn = 300, disposition: "inline" | "attachment" = "inline") {
  if (!storageKey.startsWith("r2:") || !r2Configured()) return null;
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: storageKey.slice(3), ResponseContentDisposition: `${disposition}; filename="${encodeURIComponent(fileName)}"` }),
    { expiresIn },
  );
}
