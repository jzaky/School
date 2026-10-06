import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { viewerAudience } from "@/server/partners/service";
import { moduleEnabled } from "@/lib/modules";

export const runtime = "nodejs";

/**
 * Opens a partner link. Students' and parents' clicks add one to the link's counter (aggregate only: who
 * clicked is never stored). Staff previews are not counted.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!moduleEnabled(ctx.org, "career")) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { id } = await params;
  const row = await ctx.db.partnerResource.findFirst({ where: { orgId: ctx.orgId, id } });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const audience = viewerAudience(ctx);
  if (audience) {
    if (!row.active || !row.audience.includes(audience)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await ctx.db.partnerResource.update({ where: { id: row.id }, data: { clickCount: { increment: 1 } } });
  } else if (!ctx.can("career.partners") && !ctx.can("career.advise")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.redirect(row.url, { status: 302, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
