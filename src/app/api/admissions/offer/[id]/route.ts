import { NextResponse } from "next/server";
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { letterheadFor } from "@/server/documents/letterhead";
import { currentApplicant } from "@/server/admissions/applicant";
import { applySchoolBySlug } from "@/server/admissions/public-school";
import { canViewAdmissions } from "@/server/admissions/access";
import { renderOfferPdf } from "@/server/admissions/pdf";

export const runtime = "nodejs";

/** The bilingual offer letter, rendered from the school's template. Staff with admissions.view, or the family itself. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const slug = new URL(req.url).searchParams.get("slug");
  let orgId: string;
  let audited: { actorId: string | null; actorUserId: string } | null = null;
  if (slug) {
    const school = await applySchoolBySlug(slug);
    const applicant = await currentApplicant();
    if (!school || !applicant?.verified) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const own = await tenantDb(school.id).admissionApplication.findFirst({ where: { id, orgId: school.id, applicantUserId: applicant.userId }, select: { id: true } });
    if (!own) return NextResponse.json({ error: "not_found" }, { status: 404 });
    orgId = school.id;
  } else {
    const ctx = await getOptionalCtx();
    if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!canViewAdmissions(ctx)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    orgId = ctx.orgId;
    audited = { actorId: ctx.membershipId, actorUserId: ctx.user.id };
  }
  const db = tenantDb(orgId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  const pdf = await tenantTx(orgId, async (tx) => {
    const app = await tx.admissionApplication.findFirst({ where: { id, orgId } });
    if (!app || !app.offerMadeAt) return null;
    if (audited) await audit(tx, orgId, { ...audited, action: "admission.offer_letter", entityType: "AdmissionApplication", entityId: app.id });
    return { buf: await renderOfferPdf(tx, orgId, app, await letterheadFor(db, org)), number: app.number };
  });
  if (!pdf) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(new Uint8Array(pdf.buf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="offer-${pdf.number}.pdf"`, "Cache-Control": "private, no-store" } });
}
