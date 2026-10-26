// Payment provider webhooks. The raw body is passed to the provider adapter for signature checking before
// anything is parsed; processing is idempotent (see src/server/payments/links.ts). Nothing personal is logged.
import { NextResponse } from "next/server";
import { handlePaymentWebhook } from "@/server/payments/links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 256 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ ok: false, result: "too_large" }, { status: 413 });
  try {
    const res = await handlePaymentWebhook(provider, raw, req.headers);
    return NextResponse.json(res.body, { status: res.status });
  } catch {
    // A 5xx asks the provider to retry later; the event id was not claimed because the transaction rolled back.
    return NextResponse.json({ ok: false, result: "error" }, { status: 500 });
  }
}
