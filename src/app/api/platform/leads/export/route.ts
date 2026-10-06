import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { toCsv } from "@/lib/leads";
import { isPlatformAdminEmail, platformDb } from "@/server/platform/admin";
import { LEAD_CSV_HEADER, leadCsvRow, listLeads } from "@/server/marketing/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV of marketing leads for platform admins. Every export is audited in the admin's own school. */
export async function GET(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isPlatformAdminEmail(ctx.user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const typeParam = new URL(req.url).searchParams.get("type");
  const type = typeParam === "TASTER" || typeParam === "OFFER" ? typeParam : null;
  const leads = await listLeads(platformDb(), { type, take: 20000 });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "platform.leads_export", entityType: "MarketingLead", meta: { rows: leads.length, type } });
  return new NextResponse("﻿" + toCsv(LEAD_CSV_HEADER, leads.map(leadCsvRow)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="marketing-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
