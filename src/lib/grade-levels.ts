// Grade levels are stored as integers: KG1 = -1, KG2 = 0, Grades 1 to 12 = 1 to 12.
// Labels come from the "gradeLevel" messages, for example t("gradeLevel.label", gradeLevelValues(level)),
// or gradeLabel(tg, level, section) with tg = useTranslations("gradeLevel") / getTranslations("gradeLevel").
// The API and exports keep the integer (gradeLevel: -1 for KG1, 0 for KG2).
export const KG1 = -1;
export const KG2 = 0;
export const MIN_GRADE_LEVEL = KG1;
export const MAX_GRADE_LEVEL = 12;
export const ALL_GRADE_LEVELS: readonly number[] = Array.from({ length: MAX_GRADE_LEVEL - MIN_GRADE_LEVEL + 1 }, (_, i) => MIN_GRADE_LEVEL + i);

/** Pathways, university planning and transcripts start at Grade 9. */
export const PATHWAY_MIN_GRADE = 9;

export function gradeLevelValues(level: number): { level: "kg1" | "kg2" | "n"; grade: number } {
  return { level: level === KG1 ? "kg1" : level === KG2 ? "kg2" : "n", grade: level };
}

export function gradeRange(from: number, to: number): number[] {
  return ALL_GRADE_LEVELS.filter((g) => g >= from && g <= to);
}

export const isGradeLevel = (g: unknown): g is number => typeof g === "number" && Number.isInteger(g) && g >= MIN_GRADE_LEVEL && g <= MAX_GRADE_LEVEL;

/** A translator for the "gradeLevel" message namespace. */
export type GradeTranslator = (key: "label" | "short" | "withSection" | "shortWithSection", values: Record<string, string | number>) => string;

/**
 * "KG1", "Grade 9", "Grade 9A", "KG2 B" (and the Arabic forms). `short` gives "KG1", "9", "9A", "KG2 B" for tight
 * spaces such as table cells and pickers.
 */
export function gradeLabel(tg: GradeTranslator, level: number, section?: string | null, opts: { short?: boolean } = {}): string {
  const v = gradeLevelValues(level);
  if (section) return tg(opts.short ? "shortWithSection" : "withSection", { ...v, section });
  return tg(opts.short ? "short" : "label", v);
}

/** The short code used in exports and accepted again by imports: "KG1", "KG2", "1" to "12". */
export function gradeCode(level: number): string {
  return level === KG1 ? "KG1" : level === KG2 ? "KG2" : String(level);
}

// ---------------------------------------------------------------------------
// Parsing grades typed by people (CSV imports, forms, API filters)
// ---------------------------------------------------------------------------

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const toWesternDigits = (s: string) => s.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));
/** Lower case, Western digits, Arabic letter variants folded (alef forms, ta marbuta, alef maqsura), no spaces or punctuation. */
function fold(raw: string) {
  return toWesternDigits(raw)
    .toLowerCase()
    .replace(/[ـً-ْ]/g, "")
    .replace(/[آأإ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\s._\-/()]+/g, "");
}

// Kindergarten spellings. In UAE American-curriculum schools Pre-K is KG1 and Kindergarten ("K", "KG") is KG2.
const KG_WORDS: Record<string, number> = {
  kg1: KG1, k1: KG1, kindergarten1: KG1, pk: KG1, prek: KG1, prekg: KG1, prekindergarten: KG1, fs2: KG1,
  kg2: KG2, k2: KG2, kindergarten2: KG2, kg: KG2, k: KG2, kindergarten: KG2,
  // Arabic: "الروضة الأولى", "روضة أولى", "روضة 1", "الروضة الثانية", "روضة 2", "روضة"
  "الروضهالاولي": KG1,
  "روضهاولي": KG1,
  "روضهالاولي": KG1,
  "روضه1": KG1,
  "الروضه1": KG1,
  "الروضهالثانيه": KG2,
  "روضهثانيه": KG2,
  "روضهالثانيه": KG2,
  "روضه2": KG2,
  "الروضه2": KG2,
  "روضه": KG2,
  "الروضه": KG2,
};
// Arabic ordinals after "الصف": الأول ... الثاني عشر (folded: no spaces, alef forms as plain alef).
const AR_ORDINALS = ["الاول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحاديعشر", "الثانيعشر"];
const GRADE_PREFIX = /^(grade|grd|gr|g|الصف|صف)/;

/**
 * A grade typed by a person: "9", "Grade 9", "G9", "KG1", "KG 2", "PK", "Pre-K", "KG", "K", "-1", "0",
 * "الصف 9", "الصف التاسع", "الروضة الأولى", "روضة 2", with Western or Arabic-Indic digits.
 * Returns the stored integer (KG1 = -1, KG2 = 0) or null. Callers check the range they accept.
 */
export function parseGradeLevel(raw: string | null | undefined): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const signed = /^\s*(-?\d{1,2})\s*$/.exec(toWesternDigits(text));
  if (signed) return Number(signed[1]) === 0 ? 0 : Number(signed[1]);
  const v = fold(text);
  if (v in KG_WORDS) return KG_WORDS[v];
  const rest = v.replace(GRADE_PREFIX, "");
  if (/^\d{1,2}$/.test(rest)) return Number(rest);
  const ord = AR_ORDINALS.indexOf(rest);
  if (ord >= 0) return ord + 1;
  const ordNoAl = AR_ORDINALS.findIndex((o) => o.slice(2) === rest);
  if (ordNoAl >= 0 && rest.length > 2) return ordNoAl + 1;
  return null;
}
