/**
 * Local file storage for uploaded documents and generated exports.
 *
 * Files live under AEGIS_STORAGE_DIR/<orgId>/<kind>/<id>.<ext>. The original filename is never
 * used on disk: only the row id and a derived extension. A relative AEGIS_STORAGE_DIR (the default
 * ".uploads") is resolved against the monorepo root, not the process cwd, so the web, api and
 * worker processes share one directory regardless of where they were started.
 */
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../env.js";
import { assertUuid } from "@aegis/db";

const here = dirname(fileURLToPath(import.meta.url));
// packages/core/src/audit -> monorepo root
const MONOREPO_ROOT = resolve(here, "..", "..", "..", "..");

export function storageRoot(): string {
  const configured = env().AEGIS_STORAGE_DIR || ".uploads";
  return isAbsolute(configured) ? configured : resolve(MONOREPO_ROOT, configured);
}

export type StorageKind = "documents" | "exports";

const SAFE_EXT = /^[a-z0-9]{1,8}$/;

/** Builds the storage key (path relative to the storage root). Ids are validated so a key can never escape the tenant folder. */
export function storageKeyFor(orgId: string, kind: StorageKind, id: string, ext: string): string {
  assertUuid(orgId, "orgId");
  assertUuid(id, "id");
  if (!SAFE_EXT.test(ext)) throw new Error("Invalid file extension");
  return `${orgId}/${kind}/${id}.${ext}`;
}

export function storagePath(storageKey: string): string {
  const full = resolve(storageRoot(), storageKey);
  const root = storageRoot();
  if (!full.startsWith(root + "/") && full !== root) throw new Error("Storage key escapes the storage root");
  return full;
}

export async function writeStoredFile(storageKey: string, data: Buffer): Promise<string> {
  const path = storagePath(storageKey);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, data, { mode: 0o600 });
  return path;
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  return readFile(storagePath(storageKey));
}

export function storedFileStream(storageKey: string) {
  return createReadStream(storagePath(storageKey));
}

export async function storedFileExists(storageKey: string): Promise<boolean> {
  try {
    await stat(storagePath(storageKey));
    return true;
  } catch {
    return false;
  }
}

export async function deleteStoredFile(storageKey: string): Promise<void> {
  await rm(storagePath(storageKey), { force: true });
}
