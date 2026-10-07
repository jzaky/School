import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { buildEvidencePack, EvidenceError } from "@/server/inspection/evidence";
import { evidenceCsv } from "@/server/inspection/format";
import { renderEvidencePdf } from "@/server/inspection/pdf";
import { parseDayRange } from "@/server/inspection/range";
import { letterheadFor } from "@/server/documents/letterhead";

export const runtime = "nodejs";

/** Evidence pack download (PDF or CSV). Aggregates only. Every download writes an AuditEvent. */
export async function GET(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ctx.isStaff || !ctx.can("inspection.view")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "csv" ? "csv" : "pdf";
  const range = parseDayRange(sp.get("from"), sp.get("to"));
  if (!range) return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  let pack;
  try {
    pack = await buildEvidencePack(ctx, { from: range.from, to: range.to });
  } catch (e) {
    if (e instanceof EvidenceError) return NextResponse.json({ error: e.code.toLowerCase() }, { status: e.code === "FORBIDDEN" ? 403 : 400 });
    throw e;
  }
  await audit(ctx.db, ctx.orgId, {
    actorId: ctx.membershipId,
    actorUserId: ctx.user.id,
    action: "inspection.export",
    entityType: "InspectionEvidencePack",
    entityId: null,
    meta: { format, from: range.fromKey, to: range.toKey },
  });
  const name = `inspection-evidence-${range.fromKey}-to-${range.toKey}`;
  if (format === "csv") {
    return new NextResponse(evidenceCsv(pack), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "private, no-store" },
    });
  }
  const pdf = await renderEvidencePdf(pack, {
    letterhead: await letterheadFor(ctx.db, ctx.org),
    generatedBy: { en: ctx.user.nameEn, ar: ctx.user.nameAr || ctx.user.nameEn },
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
