import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { buildMergeData } from "@/server/documents/merge";
import { renderLetterPdf } from "@/server/documents/pdf";

export const runtime = "nodejs";

/** Render an unsaved template with sample data so the editor can check the layout before saving. */
export async function POST(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ctx.can("documents.templates")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { nameEn?: string; nameAr?: string; bodyEn?: string; bodyAr?: string; signatoryEn?: string; signatoryAr?: string; output?: string } | null;
  if (!body) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const output = body.output === "EN" || body.output === "AR" ? body.output : "BILINGUAL";
  // A sample student from the school, so previews look like the real letter.
  const sample = await ctx.db.student.findFirst({ where: { status: "ACTIVE", gradeLevel: 9 }, orderBy: { studentNo: "asc" } });
  const merge = await tenantTx(ctx.orgId, (tx) => buildMergeData(tx, ctx.orgId, { studentId: sample?.id ?? null, requestNumber: "DOC-PREVIEW", form: { purpose: "visa" }, now: new Date() }));
  const pdf = await renderLetterPdf({
    output,
    school: { en: ctx.org.nameEn, ar: ctx.org.nameAr },
    title: { en: (body.nameEn ?? "").slice(0, 120), ar: (body.nameAr ?? "").slice(0, 120) },
    reference: "PREVIEW",
    bodyEn: (body.bodyEn ?? "").slice(0, 8000),
    bodyAr: (body.bodyAr ?? "").slice(0, 8000),
    merge,
    signatory: { en: body.signatoryEn ?? "", ar: body.signatoryAr ?? "" },
    signerName: { en: ctx.user.nameEn, ar: ctx.user.nameAr ?? ctx.user.nameEn },
    issuedAt: new Date(),
  });
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="preview.pdf"', "Cache-Control": "no-store" } });
}
