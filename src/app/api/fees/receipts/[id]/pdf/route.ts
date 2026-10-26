import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { receiptPdfResponse } from "@/server/fees/documents";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  return receiptPdfResponse(ctx, id, new URL(req.url).searchParams.get("inline") === "1");
}
