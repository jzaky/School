import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { canExportIds, canPrepare, canView, GovError } from "@/server/govreports/access";
import { generateExport } from "@/server/govreports/export";
import type { ExportFormat } from "@/server/govreports/kinds";

export const runtime = "nodejs";

const FORMATS: Record<string, ExportFormat> = { xlsx: "XLSX", csv: "CSV", pdf: "PDF" };

/**
 * A file generated from a government return. Excel and CSV need government.reports; the summary PDF also opens for
 * government.view (the principal). Full Emirates ID numbers (ids=1, learner registration list only) also need
 * people.reveal_ids. Every file is logged with its version and checksum and written to the audit log.
 */
export async function GET(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const format = FORMATS[q.get("format") ?? ""];
  if (!format) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (format === "PDF" ? !canView(ctx) : !canPrepare(ctx)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const withIds = q.get("ids") === "1";
  if (withIds && !canExportIds(ctx)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = q.get("return") ?? "";
  const ret = /^[a-z0-9]{8,40}$/i.test(id) ? await ctx.db.govReturn.findFirst({ where: { id } }) : null;
  if (!ret) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const loc = q.get("lang") === "ar" ? "ar" : q.get("lang") === "en" ? "en" : ctx.locale === "ar" ? "ar" : "en";
  try {
    const out = await generateExport(ctx.db, ctx.org, { membershipId: ctx.membershipId, userId: ctx.user.id, name: { en: ctx.user.nameEn, ar: ctx.user.nameAr || ctx.user.nameEn } }, ret, { format, loc, withIds, allowIds: canExportIds(ctx) });
    return new NextResponse(new Uint8Array(out.file), {
      headers: {
        "Content-Type": out.contentType,
        "Content-Disposition": `${format === "PDF" ? "inline" : "attachment"}; filename="${out.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Return-Version": String(out.version),
      },
    });
  } catch (e) {
    if (e instanceof GovError) return NextResponse.json({ error: e.code }, { status: e.code.startsWith("FORBIDDEN") ? 403 : 400 });
    throw e;
  }
}
