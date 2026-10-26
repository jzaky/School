import { cookies } from "next/headers";
import { isLocale } from "@/i18n/routing";
import { redirectTo } from "@/lib/redirect";

/** Start page of the installed app: opens home in the language this device last used. */
export async function GET() {
  const saved = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale = isLocale(saved) ? saved : "en";
  return redirectTo(`/${locale}/home`);
}
