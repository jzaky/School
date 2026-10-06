import "server-only";
import { getObject, signedObjectUrl } from "./storage-core";
import { r2Configured } from "./r2";

// Documents live in Cloudflare R2 (S3 API) when R2_* env vars are set. Access is only ever through
// short-lived signed URLs. Without R2 (local development) files go to a local folder.
// The implementation lives in ./storage-core so the worker can share it.

export { putR2Object } from "./r2";
export { putObject, getObject, deleteObject, isStoredKey } from "./storage-core";

/** A signed URL valid for five minutes (R2), or null for locally stored files. */
export async function signedUrl(storageKey: string, fileName: string) {
  return signedObjectUrl(storageKey, fileName, 300, "inline");
}

export async function readLocal(storageKey: string) {
  if (!storageKey.startsWith("local:")) return null;
  return getObject(storageKey);
}

export const storageMode = () => (r2Configured() ? "r2" : "local");
