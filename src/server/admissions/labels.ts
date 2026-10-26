// Bilingual labels for emails, notifications and PDFs (outside React), from the same message files as the UI.
import { createTranslator } from "next-intl";
import { gradeLevelValues } from "@/lib/grade-levels";
import en from "../../../messages/en.json";
import ar from "../../../messages/ar.json";

type T = (k: string, v?: Record<string, string | number>) => string;
const tr = (locale: "en" | "ar", namespace: string) => createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: namespace as never }) as unknown as T;

export function gradeBoth(g: number): { en: string; ar: string } {
  const v = gradeLevelValues(g);
  return { en: tr("en", "gradeLevel")("label", v), ar: tr("ar", "gradeLevel")("label", v) };
}

/** A label from the admissions namespace in both languages, for example a leaving reason. */
export function admissionsBoth(key: string, vars: Record<string, string | number> = {}): { en: string; ar: string } {
  return { en: tr("en", "admissions")(key, vars), ar: tr("ar", "admissions")(key, vars) };
}

export function dateBoth(d: Date): { en: string; ar: string } {
  const f = (loc: string) => new Intl.DateTimeFormat(loc, { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(d);
  return { en: f("en-GB"), ar: f("ar-AE-u-nu-latn") };
}

export function dateTimeBoth(d: Date): { en: string; ar: string } {
  const f = (loc: string) => new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: "Asia/Dubai" }).format(d);
  return { en: f("en-GB"), ar: f("ar-AE-u-nu-latn") };
}

export function childNameBoth(a: { firstNameEn: string; lastNameEn: string; firstNameAr?: string | null; lastNameAr?: string | null }) {
  const enName = `${a.firstNameEn} ${a.lastNameEn}`.trim();
  const arName = a.firstNameAr ? `${a.firstNameAr} ${a.lastNameAr ?? ""}`.trim() : enName;
  return { en: enName, ar: arName };
}
