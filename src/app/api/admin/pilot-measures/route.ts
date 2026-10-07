import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { canSeePilotMeasures } from "@/server/analytics/pilot-access";
import { parsePeriod, pilotCsvRows, pilotMeasures } from "@/server/analytics/pilot";
import { toCsv } from "@/lib/csv-out";

export const runtime = "nodejs";

/** Pilot measures for a period as CSV (aggregates only, no personal data). */
export async function GET(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeePilotMeasures(ctx)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const period = parsePeriod(sp.get("from") ?? undefined, sp.get("to") ?? undefined);
  const m = await pilotMeasures(ctx.db, ctx.orgId, period);
  const rows = pilotCsvRows(m);
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "analytics.export", entityType: "PilotMeasures", meta: { from: rows[0].value, to: rows[1].value } });
  return new NextResponse(toCsv(rows, ["metric", "value", "detail"]), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="pilot-measures-${rows[0].value}-to-${rows[1].value}.csv"`, "Cache-Control": "private, no-store" },
  });
}
