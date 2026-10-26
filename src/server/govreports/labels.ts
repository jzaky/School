// English and Arabic text for downloads (Excel, CSV and PDF carry both languages), read from the same message
// files as the pages so wording matches everywhere. No "server-only": the worker sends reminders with it.
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import ar from "../../../messages/ar.json";
import { gradeLevelValues } from "@/lib/grade-levels";

export type Loc = "en" | "ar";
export type Bi = { en: string; ar: string };
type T = (k: string, v?: Record<string, string | number>) => string;

const translators: Record<Loc, T> = {
  en: createTranslator({ locale: "en", messages: en }) as unknown as T,
  ar: createTranslator({ locale: "ar", messages: ar }) as unknown as T,
};

/** A message under govReports in one language. */
export const gt = (loc: Loc, key: string, values?: Record<string, string | number>) => translators[loc](`govReports.${key}`, values);
/** A message under govReports in both languages. */
export const gbi = (key: string, values?: Record<string, string | number>): Bi => ({ en: gt("en", key, values), ar: gt("ar", key, values) });

/** Any message in both languages (full key), for labels another module already owns. */
export const tbi = (key: string, values?: Record<string, string | number>): Bi => ({ en: translators.en(key, values), ar: translators.ar(key, values) });

export const gradeText =(g: number, loc: Loc) => translators[loc]("gradeLevel.label", gradeLevelValues(g));
export const gradeBi = (g: number): Bi => ({ en: gradeText(g, "en"), ar: gradeText(g, "ar") });

/** "Grade 3 to Grade 5", or a single grade. */
export function gradeSpan(keys: number[], loc: Loc): string {
  if (!keys.length) return "";
  const lo = Math.min(...keys);
  const hi = Math.max(...keys);
  return lo === hi ? gradeText(lo, loc) : gt(loc, "span", { from: gradeText(lo, loc), to: gradeText(hi, loc) });
}

/** The authority's full and short name, or the school's own name for it. */
export function authorityText(key: string, own: { en: string | null; ar: string | null } | null, loc: Loc, form: "full" | "short" = "full"): string {
  const mine = loc === "ar" ? own?.ar || own?.en : own?.en || own?.ar;
  if (mine) return mine;
  try {
    return translators[loc](`admissions.authority.${form}.${key}`);
  } catch {
    return key;
  }
}

/** A calendar date (YYYY-MM-DD or a Date at UTC midnight) in words, with Western digits in both languages. */
export function dayText(d: Date | string, loc: Loc): string {
  const date = typeof d === "string" ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : d;
  return new Intl.DateTimeFormat(loc === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

/** A moment (Dubai time) in words. */
export function momentText(d: Date, loc: Loc): string {
  return new Intl.DateTimeFormat(loc === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(d);
}

export const pctText = (n: number | null, loc: Loc) => (n === null ? "-" : loc === "ar" ? `%${n.toFixed(1)}` : `${n.toFixed(1)}%`);
