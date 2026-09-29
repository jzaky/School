import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { readLocal, signedUrl } from "@/server/documents/storage";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** The signed-in member's school logo. Stored privately; served through a short-lived signed link or from local storage. */
export async function GET() {
  const ctx = await getOptionalCtx();
  const key = ctx?.org.logoUrl;
  if (!ctx || !key) return new NextResponse(null, { status: 404 });
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES[ext];
  if (!type) return new NextResponse(null, { status: 404 });
  const url = await signedUrl(key, `logo.${ext}`);
  if (url) return NextResponse.redirect(url);
  const bytes = await readLocal(key);
  if (!bytes) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
