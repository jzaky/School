import { defineRouting } from "next-intl/routing";

export const locales = ["en", "ar"] as const;
export type AppLocale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
  localePrefix: "always",
  localeCookie: { name: "NEXT_LOCALE", maxAge: 60 * 60 * 24 * 365 },
});

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function dirOf(locale: AppLocale) {
  return locale === "ar" ? "rtl" : "ltr";
}
