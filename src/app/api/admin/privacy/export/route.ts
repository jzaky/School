import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { buildSubjectExport, ExportError } from "@/server/privacy/export";
import { isSubjectKind } from "@/server/privacy/subject";

export const runtime = "nodejs";
export const maxDuration = 120;

/** One-person data export (ZIP). Compliance managers only; audited inside buildSubjectExport. */
export async function GET(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ctx.can("compliance.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  const id = sp.get("id") ?? "";
  if (!isSubjectKind(kind) || !id) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    const res = await buildSubjectExport(ctx, { kind, id }, { dsrId: sp.get("dsr") || null });
    return new NextResponse(new Uint8Array(res.zip), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${res.fileName}"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof ExportError) return NextResponse.json({ error: e.code.toLowerCase() }, { status: e.code === "NOT_FOUND" ? 404 : 400 });
    console.error("[privacy] export failed", e instanceof Error ? e.name : "Error");
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
