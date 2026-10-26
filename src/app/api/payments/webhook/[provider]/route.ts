// Payment provider webhooks. The raw body is passed to the provider adapter for signature checking before
// anything is parsed; processing is idempotent (see src/server/payments/links.ts). Nothing personal is logged.
import { NextResponse } from "next/server";
import { handlePaymentWebhook } from "@/server/payments/links";
import { BodyTooLargeError, readTextLimited } from "@/lib/http-body";
import { clientIp, hit } from "@/server/access/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 256 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!(await hit(`payhook:${clientIp(req.headers)}`, 600, 60)).ok) return NextResponse.json({ ok: false, result: "rate_limited" }, { status: 429 });
  let raw: string;
  try {
    raw = await readTextLimited(req, MAX_BODY);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return NextResponse.json({ ok: false, result: "too_large" }, { status: 413 });
    throw e;
  }
  try {
    const res = await handlePaymentWebhook(provider, raw, req.headers);
    return NextResponse.json(res.body, { status: res.status });
  } catch {
    // A 5xx asks the provider to retry later; the event id was not claimed because the transaction rolled back.
    return NextResponse.json({ ok: false, result: "error" }, { status: 500 });
  }
}
