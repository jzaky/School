import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { canOpenDocument } from "@/server/access/document-access";
import { audit } from "@/server/audit/audit";
import { renderLetterPdf, renderSamplePdf } from "@/server/documents/pdf";
import { letterheadFor } from "@/server/documents/letterhead";
import { readLocal, signedUrl } from "@/server/documents/storage";
import type { MergeData } from "@/server/documents/merge";
import { renderReportCardPdf } from "@/server/grades/report-pdf";
import type { ReportCardData } from "@/server/grades/report-card";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const doc = await ctx.db.document.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" } } } });
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!(await canOpenDocument(ctx, doc))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const versionNo = Number(url.searchParams.get("v") ?? 0);
  const version = (versionNo ? doc.versions.find((v) => v.version === versionNo) : doc.versions.find((v) => v.id === doc.currentVersionId)) ?? doc.versions[0];
  if (!version) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await audit(ctx.db, ctx.orgId, {
    actorId: ctx.membershipId,
    actorUserId: ctx.user.id,
    action: "document.download",
    entityType: "Document",
    entityId: doc.id,
    sensitivity: doc.sensitivity,
    meta: { version: version.version },
  });

  const inline = url.searchParams.get("inline") === "1";
  const disposition = `${inline ? "inline" : "attachment"}; filename="${version.fileName}"`;
  if (version.storageKey.startsWith("render:")) {
    const template = doc.templateId ? await ctx.db.documentTemplate.findUnique({ where: { id: doc.templateId } }) : null;
    if (!template) return NextResponse.json({ error: "template_missing" }, { status: 404 });
    const org = ctx.org;
    const request = doc.requestId ? await ctx.db.request.findUnique({ where: { id: doc.requestId } }) : null;
    const approver = request
      ? await ctx.db.approvalAssignee.findFirst({ where: { approval: { requestId: request.id }, status: "APPROVED" }, orderBy: { decidedAt: "desc" } })
      : null;
    const signer = approver?.decidedById ? await ctx.db.membership.findUnique({ where: { id: approver.decidedById }, include: { user: true } }) : null;
    const override = url.searchParams.get("output");
    const output = (override === "EN" || override === "AR" || override === "BILINGUAL" ? override : version.output ?? template.output) as "EN" | "AR" | "BILINGUAL";
    const pdf = await renderLetterPdf({
      output,
      school: { en: org.nameEn, ar: org.nameAr },
      title: { en: template.nameEn, ar: template.nameAr },
      reference: request?.number ?? doc.id.slice(0, 8).toUpperCase(),
      bodyEn: template.bodyEn,
      bodyAr: template.bodyAr,
      merge: (version.renderData ?? { en: {}, ar: {} }) as MergeData,
      signatory: { en: template.signatoryEn ?? "", ar: template.signatoryAr ?? "" },
      signerName: signer ? { en: signer.user.nameEn, ar: signer.user.nameAr ?? signer.user.nameEn } : null,
      issuedAt: version.createdAt,
      letterhead: await letterheadFor(ctx.db, org),
    });
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": disposition, "Cache-Control": "private, no-store" } });
  }
  if (version.storageKey.startsWith("reportcard:") && version.renderData) {
    const pdf = await renderReportCardPdf(version.renderData as unknown as ReportCardData, await letterheadFor(ctx.db, ctx.org));
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": disposition, "Cache-Control": "private, no-store" } });
  }
  if (version.storageKey.startsWith("sample:")) {
    const pdf = await renderSamplePdf({ en: doc.titleEn, ar: doc.titleAr }, { en: version.fileName, ar: version.fileName });
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": disposition, "Cache-Control": "private, no-store" } });
  }
  const signed = await signedUrl(version.storageKey, version.fileName);
  if (signed) return NextResponse.redirect(signed, 302);
  const local = await readLocal(version.storageKey);
  if (local) return new NextResponse(new Uint8Array(local), { headers: { "Content-Type": version.mimeType, "Content-Disposition": disposition, "Cache-Control": "private, no-store" } });
  return NextResponse.json({ error: "file_missing" }, { status: 404 });
}
