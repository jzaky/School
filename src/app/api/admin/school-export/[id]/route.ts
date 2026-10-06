import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { getObject, signedObjectUrl } from "@/server/documents/storage-core";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Download a finished school export. Works only for the school's compliance managers and only until
 * the export expires. With R2 the response is a signed link valid for five minutes.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ctx.can("compliance.manage") || !ctx.can("school.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const exp = await ctx.db.dataExport.findFirst({ where: { id, orgId: ctx.orgId, kind: "SCHOOL" } });
  if (!exp || exp.status !== "READY" || !exp.storageKey) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!exp.expiresAt || exp.expiresAt < new Date()) return NextResponse.json({ error: "expired" }, { status: 410 });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "school_export.download", entityType: "DataExport", entityId: exp.id, sensitivity: "CONFIDENTIAL" });
  const fileName = `${ctx.org.slug}-export-${exp.createdAt.toISOString().slice(0, 10)}.zip`;
  const signed = await signedObjectUrl(exp.storageKey, fileName, 300, "attachment");
  if (signed) return NextResponse.redirect(signed, 302);
  const body = await getObject(exp.storageKey);
  if (!body) return NextResponse.json({ error: "file_missing" }, { status: 404 });
  return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "private, no-store" } });
}
