// Helpers for bilingual data stored as fooEn / fooAr columns.
export type Loc = "en" | "ar";

export function pick(locale: Loc | string, en: string | null | undefined, ar: string | null | undefined): string {
  if (locale === "ar") return ar || en || "";
  return en || ar || "";
}

/** pickField(row, "name", locale) reads row.nameEn / row.nameAr with fallback. */
export function pickField<T extends Record<string, unknown>>(row: T, base: string, locale: Loc | string): string {
  return pick(locale, row[`${base}En`] as string | undefined, row[`${base}Ar`] as string | undefined);
}

export function personName(
  p: { firstNameEn: string; lastNameEn: string; firstNameAr?: string | null; lastNameAr?: string | null; preferredName?: string | null },
  locale: Loc | string,
): string {
  if (locale === "ar" && p.firstNameAr) return `${p.firstNameAr} ${p.lastNameAr ?? ""}`.trim();
  return `${p.firstNameEn} ${p.lastNameEn}`.trim();
}

export function firstName(p: { firstNameEn: string; firstNameAr?: string | null }, locale: Loc | string) {
  return locale === "ar" && p.firstNameAr ? p.firstNameAr : p.firstNameEn;
}

export function userName(u: { nameEn: string; nameAr?: string | null } | null | undefined, locale: Loc | string) {
  if (!u) return "";
  return locale === "ar" && u.nameAr ? u.nameAr : u.nameEn;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
