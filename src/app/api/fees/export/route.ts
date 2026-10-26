// Finance exports (fees.reports): CSV or Excel for a report and a period. Every export is audited.
import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { tenantTx } from "@/lib/tenant-db";
import { buildExport, EXPORTS, type ExportKind } from "@/server/fees/exports";
import { createXlsx, sheetToCsv } from "@/lib/xlsx-out";

export const runtime = "nodejs";
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ctx.isStaff || !ctx.can("fees.reports")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const report = sp.get("report") as ExportKind;
  const format = sp.get("format") === "xlsx" ? "xlsx" : "csv";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!EXPORTS.includes(report) || !KEY_RE.test(from) || !KEY_RE.test(to) || from > to) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const sheet = await tenantTx(ctx.orgId, (tx) => buildExport(tx, ctx.orgId, report, { from, to }), { timeout: 120_000 });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "fees.export", entityType: "FinanceReport", entityId: null, meta: { report, format, from, to, rows: sheet.rows.length } });
  const name = `finance-${report}-${from}-to-${to}`;
  if (format === "xlsx") {
    return new NextResponse(new Uint8Array(createXlsx([sheet])), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "private, no-store" },
    });
  }
  return new NextResponse(sheetToCsv(sheet), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "private, no-store" } });
}
