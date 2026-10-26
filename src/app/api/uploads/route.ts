import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { putObject } from "@/server/documents/storage";
import { hit } from "@/server/access/rate-limit";
import { checkFile, DOCUMENT_KINDS } from "@/lib/files/check";
import { BodyTooLargeError, readFormLimited } from "@/lib/http-body";
import { scanBytes, scanRefuses } from "@/server/files/scan";

export const runtime = "nodejs";

const MAX = 10 * 1024 * 1024;

/**
 * Upload a file for a form or document. Returns a storage reference; the file is only reachable via signed URLs.
 * The file is checked by its content (documents and photos only, never active content), its name is rebuilt from
 * safe characters, and it is scanned for malware when a scanner is configured.
 */
export async function POST(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await hit(`upload:${ctx.membershipId}`, 120, 60 * 60)).ok) return NextResponse.json({ error: "rate" }, { status: 429 });
  let form: FormData | null;
  try {
    form = await readFormLimited(req, MAX + 256 * 1024);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return NextResponse.json({ error: "too_large" }, { status: 413 });
    throw e;
  }
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkFile(file.name, bytes, { allow: DOCUMENT_KINDS, maxBytes: MAX });
  if (!check.ok) {
    const status = check.problem === "TOO_LARGE" ? 413 : 415;
    return NextResponse.json({ error: check.problem === "TOO_LARGE" ? "too_large" : check.problem === "ACTIVE_CONTENT" ? "active_content" : "type" }, { status });
  }
  if (scanRefuses(await scanBytes(bytes))) return NextResponse.json({ error: "scan" }, { status: 422 });
  const key = await putObject(ctx.orgId, check.fileName, Buffer.from(bytes), check.type.mime);
  return NextResponse.json({ key, name: check.fileName, size: bytes.length, type: check.type.mime });
}
