import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isLocale } from "@/i18n/routing";

/** Start page of the installed app: opens home in the language this device last used. */
export async function GET(req: Request) {
  const saved = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale = isLocale(saved) ? saved : "en";
  return NextResponse.redirect(new URL(`/${locale}/home`, req.url), 307);
}
