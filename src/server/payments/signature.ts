// HMAC-SHA256 signatures in the "t=<unix seconds>,v1=<hex>" header format over "<t>.<raw body>" (the scheme Stripe
// documents for its Stripe-Signature header; the built-in test provider uses the same scheme with its own secret).
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, rawBody: string, timestamp: number): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/** True when one of the v1 signatures matches and the timestamp is within the tolerance (replay protection). */
export function verifySignatureHeader(secret: string, rawBody: string, header: string | null, now: Date, toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS): boolean {
  if (!secret || !header) return false;
  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t" && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) sigs.push(v.toLowerCase());
  }
  if (t === null || !sigs.length) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - t) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex"), "utf8");
  return sigs.some((s) => {
    const got = Buffer.from(s, "utf8");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
