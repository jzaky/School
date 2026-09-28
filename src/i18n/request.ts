import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { isLocale, routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!isLocale(locale)) {
    const fromCookie = (await cookies()).get("NEXT_LOCALE")?.value;
    locale = isLocale(fromCookie) ? fromCookie : routing.defaultLocale;
  }
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: "Asia/Dubai",
    now: new Date(),
  };
});
