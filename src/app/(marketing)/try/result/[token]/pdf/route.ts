import { NextResponse } from "next/server";
import { catalogDb } from "@/server/platform/catalog-db";
import { tasterByToken } from "@/server/marketing/leads";
import { renderTasterPdf } from "@/server/marketing/taster-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The bilingual PDF of a taster result. The private link is the only key, as for the result page. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = catalogDb();
  const data = db ? await tasterByToken(db, decodeURIComponent(token)).catch(() => null) : null;
  if (!data) return new NextResponse("Not found", { status: 404 });
  const pdf = await renderTasterPdf({ name: data.lead.name, result: data.result, now: data.lead.createdAt });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="horizon-career-taster.pdf"',
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
