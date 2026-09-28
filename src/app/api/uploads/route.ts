import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { putObject } from "@/server/documents/storage";

export const runtime = "nodejs";

const MAX = 10 * 1024 * 1024;
const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/csv"];

/** Upload a file for a form or document. Returns a storage reference; the file is only reachable via signed URLs. */
export async function POST(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "too_large" }, { status: 413 });
  if (file.type && !ALLOWED.includes(file.type)) return NextResponse.json({ error: "type" }, { status: 415 });
  const key = await putObject(ctx.orgId, file.name, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
  return NextResponse.json({ key, name: file.name, size: file.size, type: file.type });
}
