import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { buildAccessReport, canSeeAccessReport, reportMemberSelect, reportMemberWhere } from "@/server/access/report";
import { dubaiDayKey } from "@/server/access/until";

export const runtime = "nodejs";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formulas and quote every cell.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** CSV of "Who can see what": one row per person, area, permission and granting role. People and roles only, never records. */
export async function GET() {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeeAccessReport((p) => ctx.can(p))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const now = new Date();
  const members = await ctx.db.membership.findMany({ where: reportMemberWhere(now), select: reportMemberSelect, take: 3000 });
  const areas = buildAccessReport(members, now);
  const lines = [["area", "person", "email", "permission", "granted_by_role", "role_until", "access_until", "last_active_utc"].join(",")];
  let rows = 0;
  for (const a of areas) {
    for (const e of a.entries) {
      for (const p of e.permissions) {
        for (const v of e.via) {
          if (!members.find((m) => m.id === e.membershipId)?.roles.some((r) => r.roleId === v.roleId && r.role.permissions.includes(p))) continue;
          lines.push([a.key, e.nameEn, e.email, p, v.nameEn, v.expiresAt ? dubaiDayKey(v.expiresAt) : "", e.until ? dubaiDayKey(e.until) : "", e.lastSeenAt?.toISOString() ?? ""].map(cell).join(","));
          rows++;
        }
      }
    }
  }
  await audit(ctx.db, ctx.orgId, {
    actorId: ctx.membershipId,
    actorUserId: ctx.user.id,
    action: "access.report_export",
    entityType: "Organization",
    entityId: ctx.orgId,
    sensitivity: "CONFIDENTIAL",
    meta: { rows, people: new Set(areas.flatMap((a) => a.entries.map((e) => e.membershipId))).size },
  });
  return new NextResponse("﻿" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="who-can-see-what-${now.toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
