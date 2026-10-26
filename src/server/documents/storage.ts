import "server-only";
import { getObject, signedObjectUrl } from "./storage-core";
import { r2Configured } from "./r2";
import { dispositionFor, mimeForName } from "@/lib/files/check";

// Documents live in Cloudflare R2 (S3 API) when R2_* env vars are set. Access is only ever through
// short-lived signed URLs. Without R2 (local development) files go to a local folder.
// The implementation lives in ./storage-core so the worker can share it.

export { putR2Object } from "./r2";
export { putObject, getObject, deleteObject, isStoredKey } from "./storage-core";

/** A signed URL for this one object, valid for five minutes (R2), or null for locally stored files. */
export async function signedUrl(storageKey: string, fileName: string, opts: { inline?: boolean } = {}) {
  return signedObjectUrl(storageKey, fileName, 300, opts.inline === false ? "attachment" : "inline");
}

/** Headers for serving a locally stored file: type from the stored name, inline only for images and PDFs. */
export function localFileHeaders(storageKey: string, fileName: string, wantInline: boolean): Record<string, string> {
  const mime = mimeForName(storageKey);
  const disposition = dispositionFor(mime, fileName, wantInline);
  return {
    "Content-Type": mime,
    "Content-Disposition": disposition,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    ...(disposition.startsWith("inline") ? {} : { "Content-Security-Policy": "sandbox" }),
  };
}

export async function readLocal(storageKey: string) {
  if (!storageKey.startsWith("local:")) return null;
  return getObject(storageKey);
}

export const storageMode = () => (r2Configured() ? "r2" : "local");
