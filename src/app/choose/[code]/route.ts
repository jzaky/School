import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isLocale } from "@/i18n/routing";

/** Short link from a class choosing session QR code: opens the session in the language this device last used. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const saved = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale = isLocale(saved) ? saved : "en";
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return NextResponse.redirect(new URL(`/${locale}/subjects/join/${clean}`, req.url), 307);
}
