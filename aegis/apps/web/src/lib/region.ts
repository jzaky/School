import { cache } from "react";

/**
 * Regional settings for formatting: console language, the organization's time zone and currency.
 * Server components read them from a per-request store filled by getConsoleContext; client components
 * get them from RegionProvider (components/region-provider.tsx). Numbers and amounts always use Western
 * digits, as is usual in UAE business documents, so an approver reads the same figure in either language.
 */

export type Locale = "en" | "ar";
export interface Region {
  locale: Locale;
  timeZone: string;
  currency: string;
}

export const DEFAULT_REGION: Region = { locale: "en", timeZone: "Asia/Dubai", currency: "AED" };
export const LOCALE_COOKIE = "aegis-locale";

const requestStore = cache((): { region: Region | null } => ({ region: null }));
let browserRegion: Region | null = null;

export function setRegion(r: Region): void {
  if (typeof window !== "undefined") browserRegion = r;
  else requestStore().region = r;
}

export function currentRegion(): Region {
  if (typeof window !== "undefined") return browserRegion ?? DEFAULT_REGION;
  return requestStore().region ?? DEFAULT_REGION;
}

export function intlLocale(locale: Locale): string {
  return locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB";
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function regionFromSettings(settings: Record<string, unknown>, cookieLocale?: string): Region {
  const locale: Locale = cookieLocale === "ar" || cookieLocale === "en" ? cookieLocale : settings.locale === "ar" ? "ar" : "en";
  const timeZone = typeof settings.timezone === "string" && isValidTimeZone(settings.timezone) ? settings.timezone : DEFAULT_REGION.timeZone;
  const currency = typeof settings.currency === "string" && /^[A-Z]{3}$/.test(settings.currency) ? settings.currency : DEFAULT_REGION.currency;
  return { locale, timeZone, currency };
}
