// Bilingual text for invitation emails and the join poster, from the same message files as the UI.
// A variable can differ by language (for example the school name), so values are either a plain string
// or { en, ar }.
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import ar from "../../../messages/ar.json";

type Val = string | number | { en: string; ar: string };
type Vars = Record<string, Val>;

function varsFor(vars: Vars, locale: "en" | "ar"): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) out[k] = typeof v === "object" ? v[locale] || v.en : v;
  return out;
}

/** Both languages of one message from the access namespaces (emails, PDFs and other non-UI output). */
export function bothLanguages(namespace: "accessEmail" | "accessPoster", key: string, vars: Vars = {}) {
  type T = (k: string, v?: Record<string, string | number>) => string;
  const tEn = createTranslator({ locale: "en", messages: en, namespace }) as unknown as T;
  const tAr = createTranslator({ locale: "ar", messages: ar, namespace }) as unknown as T;
  return { en: tEn(key, varsFor(vars, "en")), ar: tAr(key, varsFor(vars, "ar")) };
}

/** One email carrying both languages: Arabic first when the school's default language is Arabic. */
export function bilingualEmail(subjectKey: string, bodyKey: string, vars: Vars, first: "en" | "ar") {
  const s = bothLanguages("accessEmail", subjectKey, vars);
  const b = bothLanguages("accessEmail", bodyKey, vars);
  const order = first === "ar" ? [b.ar, b.en] : [b.en, b.ar];
  return { subject: first === "ar" ? `${s.ar} | ${s.en}` : `${s.en} | ${s.ar}`, subjectEn: s.en, subjectAr: s.ar, body: order.join("\n\n") };
}
