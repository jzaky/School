import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { auditWhere } from "@/server/admin/audit-query";

export const runtime = "nodejs";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formulas and quote every cell.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** CSV export of the filtered audit log. Contains identifiers and actions, never record content. */
export async function GET(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ctx.can("audit.view")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const rows = await ctx.db.auditEvent.findMany({ where: auditWhere(ctx, sp), orderBy: { createdAt: "desc" }, take: 5000 });
  const actors = await ctx.db.membership.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter(Boolean) as string[])] } }, include: { user: true } });
  const lines = [["time_utc", "actor", "action", "entity_type", "entity_id", "sensitivity", "reason"].join(",")];
  for (const r of rows) {
    const a = actors.find((m) => m.id === r.actorId);
    lines.push([r.createdAt.toISOString(), a?.user.nameEn ?? (r.actorId ? r.actorId : "system"), r.action, r.entityType, r.entityId, r.sensitivity, r.reason].map(cell).join(","));
  }
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "audit.export", entityType: "AuditEvent", meta: { rows: rows.length, filters: sp } });
  return new NextResponse("﻿" + lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" },
  });
}
