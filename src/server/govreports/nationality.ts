// Nationality as returns need it: one key per country (ISO 3166 alpha-2 where it can be recognised), whether the
// student is Emirati, and a label in English and Arabic. Student records hold free text (for example "Jordanian"
// from an import, or "Jordan" from an admissions enrollment), so both demonyms and country names are recognised.
// Pure: safe for client and server.

type Row = [code: string, demonymEn: string, demonymAr: string, ...aliases: string[]];

// Demonyms for the nationalities most common in UAE schools. Other countries fall back to the country name.
const DEMONYMS: Row[] = [
  ["AE", "Emirati", "إماراتي", "uae", "u.a.e.", "emirates", "إماراتية", "الإمارات"],
  ["SA", "Saudi", "سعودي", "saudi arabian", "سعودية"],
  ["EG", "Egyptian", "مصري", "مصرية"],
  ["JO", "Jordanian", "أردني", "اردني", "أردنية"],
  ["LB", "Lebanese", "لبناني", "لبنانية"],
  ["SY", "Syrian", "سوري", "سورية"],
  ["PS", "Palestinian", "فلسطيني", "palestine", "palestinian territories", "فلسطينية", "الأراضي الفلسطينية"],
  ["IQ", "Iraqi", "عراقي", "عراقية"],
  ["SD", "Sudanese", "سوداني", "سودانية"],
  ["MA", "Moroccan", "مغربي", "مغربية"],
  ["TN", "Tunisian", "تونسي", "تونسية"],
  ["DZ", "Algerian", "جزائري", "جزائرية"],
  ["LY", "Libyan", "ليبي", "ليبية"],
  ["YE", "Yemeni", "يمني", "يمنية"],
  ["OM", "Omani", "عماني", "عمانية", "عمان"],
  ["KW", "Kuwaiti", "كويتي", "كويتية"],
  ["QA", "Qatari", "قطري", "قطرية"],
  ["BH", "Bahraini", "بحريني", "بحرينية"],
  ["SO", "Somali", "صومالي", "صومالية"],
  ["IN", "Indian", "هندي", "هندية"],
  ["PK", "Pakistani", "باكستاني", "باكستانية"],
  ["BD", "Bangladeshi", "بنغلاديشي", "بنغلاديشية"],
  ["LK", "Sri Lankan", "سريلانكي", "سريلانكية"],
  ["NP", "Nepali", "نيبالي", "nepalese", "نيبالية"],
  ["PH", "Filipino", "فلبيني", "filipina", "philippine", "فلبينية"],
  ["IR", "Iranian", "إيراني", "إيرانية"],
  ["AF", "Afghan", "أفغاني", "afghani", "أفغانية"],
  ["TR", "Turkish", "تركي", "turkey", "türkiye", "تركية"],
  ["GB", "British", "بريطاني", "uk", "english", "scottish", "welsh", "بريطانية"],
  ["IE", "Irish", "إيرلندي", "أيرلندي", "إيرلندية"],
  ["US", "American", "أمريكي", "usa", "u.s.", "united states of america", "أمريكية"],
  ["CA", "Canadian", "كندي", "كندية"],
  ["AU", "Australian", "أسترالي", "أسترالية"],
  ["NZ", "New Zealander", "نيوزيلندي", "نيوزيلندية"],
  ["ZA", "South African", "جنوب أفريقي", "جنوب إفريقي", "جنوب أفريقية"],
  ["NG", "Nigerian", "نيجيري", "نيجيرية"],
  ["KE", "Kenyan", "كيني", "كينية"],
  ["ET", "Ethiopian", "إثيوبي", "إثيوبية"],
  ["FR", "French", "فرنسي", "فرنسية"],
  ["DE", "German", "ألماني", "ألمانية"],
  ["IT", "Italian", "إيطالي", "إيطالية"],
  ["ES", "Spanish", "إسباني", "إسبانية"],
  ["NL", "Dutch", "هولندي", "هولندية"],
  ["RU", "Russian", "روسي", "روسية"],
  ["UA", "Ukrainian", "أوكراني", "أوكرانية"],
  ["CN", "Chinese", "صيني", "صينية"],
  ["KR", "Korean", "كوري", "south korean", "كورية"],
  ["JP", "Japanese", "ياباني", "يابانية"],
  ["MY", "Malaysian", "ماليزي", "ماليزية"],
  ["ID", "Indonesian", "إندونيسي", "إندونيسية"],
  ["BR", "Brazilian", "برازيلي", "برازيلية"],
];

const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

let lookup: Map<string, string> | null = null;

/** Every ISO region code Intl knows, by its English and Arabic name, plus the demonyms above. */
function buildLookup() {
  const m = new Map<string, string>();
  const en = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  const ar = new Intl.DisplayNames(["ar"], { type: "region", fallback: "none" });
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const ne = en.of(code);
      if (!ne || ne === code) continue;
      // First code wins: a few retired codes share a name with the current one (FX and FR are both "France").
      if (!m.has(norm(ne))) m.set(norm(ne), code);
      const na = ar.of(code);
      if (na && !m.has(norm(na))) m.set(norm(na), code);
    }
  }
  for (const [code, dEn, dAr, ...aliases] of DEMONYMS) {
    for (const k of [dEn, dAr, ...aliases]) m.set(norm(k), code);
  }
  return m;
}

/** ISO code for a nationality written as a demonym, a country name or a code, or null when not recognised. */
export function nationalityCode(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  lookup ??= buildLookup();
  return lookup.get(norm(t)) ?? null;
}

export type Nationality = { key: string; code: string | null; en: string; ar: string; emirati: boolean } | null;

/** Nationality of a record (English and Arabic text as stored). Null when nothing is recorded. */
export function nationalityOf(en: string | null | undefined, ar: string | null | undefined): Nationality {
  const te = (en ?? "").trim();
  const ta = (ar ?? "").trim();
  if (!te && !ta) return null;
  const code = nationalityCode(te) ?? nationalityCode(ta);
  if (!code) {
    const key = `text:${norm(te || ta)}`;
    return { key, code: null, en: te || ta, ar: ta || te, emirati: false };
  }
  const row = DEMONYMS.find((r) => r[0] === code);
  const label = (loc: "en" | "ar") => {
    if (row) return loc === "en" ? row[1] : row[2];
    try {
      return new Intl.DisplayNames([loc], { type: "region" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  return { key: code, code, en: label("en"), ar: label("ar"), emirati: code === "AE" };
}

/** Nationality picker options: the common nationalities above, Emirati first, then by English name. */
export function nationalityOptions(): Array<{ code: string; en: string; ar: string }> {
  const rows = DEMONYMS.map(([code, en, ar]) => ({ code, en, ar }));
  return [rows[0], ...rows.slice(1).sort((a, b) => a.en.localeCompare(b.en))];
}
