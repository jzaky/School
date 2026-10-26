import { NextResponse } from "next/server";
import { tenantTx } from "@/lib/tenant-db";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { getObject, signedObjectUrl } from "@/server/documents/storage-core";
import { renderSamplePdf } from "@/server/documents/pdf";
import { currentApplicant } from "@/server/admissions/applicant";
import { applySchoolBySlug } from "@/server/admissions/public-school";
import { canOpenAdmissionDoc } from "@/server/admissions/access";
import { loadSettings } from "@/server/admissions/settings";

export const runtime = "nodejs";

/**
 * Open an application document. Staff need admissions.view (and medical access for health documents); every staff
 * view is audited. A family opens its own files with ?slug=<school>. Files are always sent as downloads with nosniff,
 * through a five-minute signed link when stored in R2.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  let doc: { id: string; storageKey: string; fileName: string; mimeType: string; typeKey: string } | null = null;
  let typeLabel: { en: string; ar: string } | null = null;

  if (slug) {
    const school = await applySchoolBySlug(slug);
    const applicant = await currentApplicant();
    if (!school || !applicant?.verified) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    doc = await tenantTx(school.id, async (tx) => {
      const d = await tx.admissionDocument.findFirst({ where: { id, orgId: school.id, application: { applicantUserId: applicant.userId } } });
      return d;
    });
    if (doc) {
      const s = await tenantTx(school.id, (tx) => loadSettings(tx, school.id));
      const t = s.docTypes.find((x) => x.key === doc!.typeKey);
      typeLabel = t ? { en: t.labelEn, ar: t.labelAr } : null;
    }
  } else {
    const ctx = await getOptionalCtx();
    if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const d = await ctx.db.admissionDocument.findFirst({ where: { id, orgId: ctx.orgId } });
    if (d) {
      const s = await loadSettings(ctx.db as never, ctx.orgId);
      const category = s.docTypes.find((t) => t.key === d.typeKey)?.category ?? "identity";
      if (!canOpenAdmissionDoc(ctx, category)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
      await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "admission.document_view", entityType: "AdmissionDocument", entityId: d.id, sensitivity: category === "medical" ? "MEDICAL" : category === "identity" ? "CONFIDENTIAL" : "STANDARD" });
      doc = d;
      const t = s.docTypes.find((x) => x.key === d.typeKey);
      typeLabel = t ? { en: t.labelEn, ar: t.labelAr } : null;
    }
  }
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Demo files: a placeholder PDF named after the document type (no real family documents in the demo).
  if (doc.storageKey.startsWith("sample:")) {
    const pdf = await renderSamplePdf(typeLabel ?? { en: doc.fileName, ar: doc.fileName }, { en: doc.fileName, ar: doc.fileName });
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.fileName)}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
  const signed = await signedObjectUrl(doc.storageKey, doc.fileName, 300, "attachment");
  if (signed) return NextResponse.redirect(signed, 302);
  const bytes = await getObject(doc.storageKey);
  if (!bytes) return NextResponse.json({ error: "file_missing" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.fileName)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}
