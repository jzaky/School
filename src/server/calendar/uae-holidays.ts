// UAE public holidays for a date range. Pure: no database access.
// Fixed Gregorian holidays have known dates. Islamic holidays follow the Hijri calendar and are only
// confirmed after the moon sighting, so their dates here are estimates from the Umm al-Qura calendar
// and must be labelled as such and remain editable.

export type HolidayProposal = {
  key: string;
  titleEn: string;
  titleAr: string;
  /** Dubai calendar date of the first day, YYYY-MM-DD. */
  startKey: string;
  days: number;
  estimated: boolean;
};

type Def = { key: string; titleEn: string; titleAr: string; days: number } & ({ fixed: [number, number] } | { hijri: [number, number] });

const DEFS: Def[] = [
  { key: "new_year", titleEn: "New Year's Day", titleAr: "رأس السنة الميلادية", days: 1, fixed: [1, 1] },
  { key: "commemoration_day", titleEn: "Commemoration Day", titleAr: "يوم الشهيد", days: 1, fixed: [12, 1] },
  { key: "national_day", titleEn: "UAE National Day", titleAr: "اليوم الوطني لدولة الإمارات", days: 2, fixed: [12, 2] },
  { key: "eid_al_fitr", titleEn: "Eid al Fitr", titleAr: "عيد الفطر", days: 3, hijri: [10, 1] },
  { key: "arafat_day", titleEn: "Arafat Day", titleAr: "يوم عرفة", days: 1, hijri: [12, 9] },
  { key: "eid_al_adha", titleEn: "Eid al Adha", titleAr: "عيد الأضحى", days: 3, hijri: [12, 10] },
  { key: "islamic_new_year", titleEn: "Islamic New Year", titleAr: "رأس السنة الهجرية", days: 1, hijri: [1, 1] },
  { key: "prophets_birthday", titleEn: "Prophet's Birthday", titleAr: "المولد النبوي الشريف", days: 1, hijri: [3, 12] },
];

const HIJRI = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });

/** Hijri (Umm al-Qura) year, month and day for a Gregorian date key. */
export function hijriOf(key: string): { y: number; m: number; d: number } {
  const parts = HIJRI.formatToParts(new Date(`${key}T12:00:00Z`));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function addDays(key: string, n: number) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Every UAE public holiday whose first day falls between fromKey and toKey (inclusive), sorted by date. */
export function proposeUaeHolidays(fromKey: string, toKey: string): HolidayProposal[] {
  const out: HolidayProposal[] = [];
  for (let key = fromKey; key <= toKey; key = addDays(key, 1)) {
    const [, gm, gd] = key.split("-").map(Number);
    const h = hijriOf(key);
    for (const def of DEFS) {
      const hit = "fixed" in def ? def.fixed[0] === gm && def.fixed[1] === gd : def.hijri[0] === h.m && def.hijri[1] === h.d;
      if (!hit) continue;
      const year = "fixed" in def ? key.slice(0, 4) : String(h.y);
      out.push({ key: `${def.key}_${year}`, titleEn: def.titleEn, titleAr: def.titleAr, startKey: key, days: def.days, estimated: !("fixed" in def) });
    }
  }
  return out;
}
