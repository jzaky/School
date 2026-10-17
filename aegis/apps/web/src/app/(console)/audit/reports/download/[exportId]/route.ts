import { NextResponse } from "next/server";
import { withTenant } from "@aegis/db";
import { isAegisError, readExport } from "@aegis/core";
import { getConsoleContext, getSession } from "@/server/session";

export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Streams a stored report. Reads are permission checked (reports:read) and recorded in the ledger by readExport. */
export async function GET(_req: Request, { params }: { params: Promise<{ exportId: string }> }) {
  const { exportId } = await params;
  if (!UUID_RE.test(exportId)) return NextResponse.json({ error: "Invalid export id" }, { status: 400 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const c = await getConsoleContext();
  if (!c.can("reports:read")) return NextResponse.json({ error: "Requires reports:read" }, { status: 403 });
  try {
    const r = await withTenant(c.ctx.orgId, (db) => readExport(db, c.ctx, exportId));
    const body = new Blob([new Uint8Array(r.buffer)], { type: r.contentType });
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": r.contentType,
        "Content-Length": String(r.buffer.byteLength),
        "Content-Disposition": `attachment; filename="${r.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-SHA256": r.export.sha256,
      },
    });
  } catch (e) {
    if (isAegisError(e)) return NextResponse.json({ error: e.message }, { status: e.code === "not_found" ? 404 : e.code === "forbidden" ? 403 : 400 });
    console.error("[download] failed", e instanceof Error ? `${e.name}: ${e.message}` : typeof e);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
