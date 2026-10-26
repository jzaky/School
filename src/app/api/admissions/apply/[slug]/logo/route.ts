import { NextResponse } from "next/server";
import { getObject, signedObjectUrl } from "@/server/documents/storage-core";
import { applySchoolBySlug } from "@/server/admissions/public-school";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** The school's logo on its public application pages (public branding only). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const school = await applySchoolBySlug(slug);
  const key = school?.logoUrl;
  if (!key) return new NextResponse(null, { status: 404 });
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES[ext];
  if (!type) return new NextResponse(null, { status: 404 });
  const url = await signedObjectUrl(key, `logo.${ext}`, 300, "inline");
  if (url) return NextResponse.redirect(url);
  const bytes = await getObject(key);
  if (!bytes) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": type, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
