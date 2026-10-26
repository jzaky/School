// Admissions configuration a school can change: document types, reasons for leaving, and the defaults.
// Pure: safe for client and server.
import { KG1, KG2 } from "@/lib/grade-levels";

export type DocCategory = "identity" | "medical" | "reports" | "official_letters";

export type DocType = {
  key: string;
  labelEn: string;
  labelAr: string;
  required: boolean;
  /** Only asked from this grade up (for example a school report from KG2). */
  minGrade: number | null;
  /** Not needed for these nationalities (for example a residence visa for UAE nationals). */
  exemptNationalities: string[];
  /** Where the file goes in the student's record after enrollment. */
  category: DocCategory;
};

/**
 * Defaults for a UAE private school. Sharjah registration typically asks for the Emirates ID, passport, residence
 * visa, birth certificate, vaccination record, previous school report and transfer certificate, plus a photo.
 * Schools adjust the list on Admissions settings.
 */
export const DEFAULT_DOC_TYPES: DocType[] = [
  { key: "emirates_id", labelEn: "Emirates ID (child)", labelAr: "الهوية الإماراتية (للطفل)", required: true, minGrade: null, exemptNationalities: [], category: "identity" },
  { key: "passport", labelEn: "Passport (child)", labelAr: "جواز السفر (للطفل)", required: true, minGrade: null, exemptNationalities: [], category: "identity" },
  { key: "residence_visa", labelEn: "Residence visa (child)", labelAr: "تأشيرة الإقامة (للطفل)", required: true, minGrade: null, exemptNationalities: ["AE"], category: "identity" },
  { key: "birth_certificate", labelEn: "Birth certificate", labelAr: "شهادة الميلاد", required: true, minGrade: null, exemptNationalities: [], category: "identity" },
  { key: "vaccination_record", labelEn: "Vaccination record", labelAr: "سجل التطعيمات", required: true, minGrade: null, exemptNationalities: [], category: "medical" },
  { key: "previous_report", labelEn: "Latest school report", labelAr: "آخر تقرير مدرسي", required: true, minGrade: KG2, exemptNationalities: [], category: "reports" },
  { key: "transfer_certificate", labelEn: "Transfer certificate from the previous school", labelAr: "شهادة النقل من المدرسة السابقة", required: false, minGrade: KG2, exemptNationalities: [], category: "reports" },
  { key: "photo", labelEn: "Passport-size photo", labelAr: "صورة شخصية", required: true, minGrade: KG1, exemptNationalities: [], category: "identity" },
];

export const DOC_CATEGORIES: DocCategory[] = ["identity", "medical", "reports", "official_letters"];
export const DOC_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
export const MAX_DOC_TYPES = 20;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** The school's document types, falling back to the defaults. Malformed rows are dropped. */
export function docTypes(raw: unknown): DocType[] {
  if (!Array.isArray(raw)) return DEFAULT_DOC_TYPES;
  const out: DocType[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    const key = str(r?.key, 40);
    const labelEn = str(r?.labelEn, 80);
    if (!DOC_KEY_RE.test(key) || !labelEn || out.some((d) => d.key === key)) continue;
    const category = DOC_CATEGORIES.includes(r.category as DocCategory) ? (r.category as DocCategory) : "identity";
    const minGrade = typeof r.minGrade === "number" && Number.isInteger(r.minGrade) ? r.minGrade : null;
    const exempt = Array.isArray(r.exemptNationalities) ? (r.exemptNationalities as unknown[]).filter((x): x is string => typeof x === "string" && /^[A-Z]{2}$/.test(x)).slice(0, 10) : [];
    out.push({ key, labelEn, labelAr: str(r.labelAr, 80) || labelEn, required: Boolean(r.required), minGrade, exemptNationalities: exempt, category });
    if (out.length >= MAX_DOC_TYPES) break;
  }
  return out.length ? out : DEFAULT_DOC_TYPES;
}

/** Document types that apply to this child (grade and nationality). */
export function docTypesFor(types: DocType[], gradeLevel: number, nationality: string | null | undefined): DocType[] {
  return types.filter((d) => (d.minGrade === null || gradeLevel >= d.minGrade) && !(nationality && d.exemptNationalities.includes(nationality)));
}

/** Required document types this child has not uploaded yet (rejected files do not count). */
export function missingDocs(types: DocType[], gradeLevel: number, nationality: string | null | undefined, uploaded: Array<{ typeKey: string; status: string }>): DocType[] {
  return docTypesFor(types, gradeLevel, nationality).filter((d) => d.required && !uploaded.some((u) => u.typeKey === d.key && u.status !== "REJECTED"));
}

/** Reasons a family gives for leaving (re-enrollment and withdrawals). Labels live in messages. */
export const LEAVING_REASONS = ["relocation_uae", "relocation_abroad", "another_school", "fees", "curriculum", "graduation", "other"] as const;
export type LeavingReason = (typeof LEAVING_REASONS)[number];

/** Why the school declines an application, or why a family withdraws. Labels live in messages. */
export const CLOSE_REASONS = ["no_seat", "assessment", "incomplete", "age", "family_choice", "other_school", "relocation", "no_response", "other"] as const;

export const ASSESSMENT_OUTCOMES = ["RECOMMENDED", "CONDITIONAL", "NOT_RECOMMENDED"] as const;

export const RELATIONSHIPS = ["MOTHER", "FATHER", "GUARDIAN", "GRANDPARENT", "OTHER"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

/** Upload limits for application documents. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_APPLICATION = 30;

/** Common home languages offered in the form (ISO 639 codes; Malayalam as "mal"). Names come from Intl.DisplayNames. */
export const LANGUAGES = ["ar", "en", "ur", "hi", "mal", "ta", "tl", "fr", "fa", "ru", "bn", "es", "de", "zh", "tr", "so", "am", "other"] as const;

/** Nationalities shown first in the picker (the rest follow alphabetically). */
export const COMMON_NATIONALITIES = ["AE", "SA", "EG", "JO", "SY", "LB", "PS", "IQ", "SD", "YE", "OM", "BH", "KW", "QA", "MA", "DZ", "TN", "LY", "IN", "PK", "BD", "PH", "LK", "NP", "IR", "GB", "US", "CA", "AU", "FR", "DE", "RU", "CN", "NG", "KE", "ZA"];

/** Every ISO 3166-1 alpha-2 code with a display name, for the nationality picker. */
export const ALL_COUNTRIES =
  "AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW".split(" ");

export function countryName(code: string | null | undefined, locale: string): string {
  if (!code) return "";
  try {
    return new Intl.DisplayNames([locale === "ar" ? "ar" : "en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function languageName(code: string | null | undefined, locale: string): string {
  if (!code || code === "other") return "";
  try {
    return new Intl.DisplayNames([locale === "ar" ? "ar" : "en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
