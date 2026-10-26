import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { attViewer } from "@/server/attendance/registers";
import { buildReport, exportTable, reportAccess, resolveRange, scopeAllowed, scopeFromQuery, scopeKey, toCsv } from "@/server/attendance/reports";
import { localClock } from "@/server/attendance/settings";
import { writeXlsx } from "@/server/attendance/xlsx-write";

export const runtime = "nodejs";

/** Attendance report as CSV or Excel: one row per student with sessions, percentage, lateness and absence counts. No reasons. */
export async function GET(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const v = attViewer(ctx);
  const access = await reportAccess(v);
  if (!access) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const q = url.searchParams;
  const scope = scopeFromQuery({ student: q.get("student"), scope: q.get("scope") });
  if (scope.kind === "student" || !(await scopeAllowed(ctx.db, access, scope))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const today = localClock(new Date(), v.timezone).dateKey;
  const { range } = await resolveRange(ctx.db, { termId: q.get("term"), from: q.get("from"), to: q.get("to") }, today);
  const report = await buildReport(ctx.db, scope, range);
  const locale = q.get("locale") === "ar" ? "ar" : "en";
  const table = exportTable(report.rows.sort((a, b) => a.gradeLevel - b.gradeLevel || (a.homeroom?.en ?? "").localeCompare(b.homeroom?.en ?? "") || a.lastNameEn.localeCompare(b.lastNameEn)), locale);
  const format = q.get("format") === "xlsx" ? "xlsx" : "csv";
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "attendance.export", entityType: "AttendanceRecord", meta: { scope: scopeKey(scope), from: range.from, to: range.to, rows: report.rows.length, format } });
  const name = `attendance-${scopeKey(scope).replace(/[^a-z0-9-]+/gi, "-")}-${range.from}-to-${range.to}`;
  if (format === "xlsx") {
    const buf = writeXlsx(table, { sheetName: locale === "ar" ? "الحضور" : "Attendance", rtl: locale === "ar" });
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "private, no-store" },
    });
  }
  return new NextResponse("﻿" + toCsv(table), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "private, no-store" } });
}
