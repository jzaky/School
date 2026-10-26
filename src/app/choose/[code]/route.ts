import { cookies } from "next/headers";
import { isLocale } from "@/i18n/routing";
import { redirectTo } from "@/lib/redirect";

/** Short link from a class choosing session QR code: opens the session in the language this device last used. */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const saved = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale = isLocale(saved) ? saved : "en";
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return redirectTo(`/${locale}/subjects/join/${clean}`);
}
