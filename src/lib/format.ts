// Date and number formatting shared by server and client. Always Asia/Dubai.
export type FormatPrefs = { locale: "en" | "ar"; numerals?: "WESTERN" | "ARABIC_INDIC"; hijri?: boolean };

const TZ = "Asia/Dubai";

export function localeTag(p: FormatPrefs, calendar?: "gregory" | "islamic-umalqura") {
  const nu = p.numerals === "ARABIC_INDIC" ? "arab" : "latn";
  const base = p.locale === "ar" ? "ar-AE" : "en-GB";
  const ca = calendar ? `-ca-${calendar}` : "";
  return `${base}-u-nu-${nu}${ca}`;
}

type D = Date | string | number | null | undefined;
const toDate = (d: D) => (d === null || d === undefined ? null : d instanceof Date ? d : new Date(d));

export function fmtDate(p: FormatPrefs, d: D, style: "short" | "medium" | "long" = "medium") {
  const date = toDate(d);
  if (!date) return "";
  const opts: Intl.DateTimeFormatOptions =
    style === "short"
      ? { day: "numeric", month: "short" }
      : style === "long"
        ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
        : { day: "numeric", month: "short", year: "numeric" };
  return new Intl.DateTimeFormat(localeTag(p), { ...opts, timeZone: TZ }).format(date);
}

export function fmtHijri(p: FormatPrefs, d: D) {
  const date = toDate(d);
  if (!date) return "";
  return new Intl.DateTimeFormat(localeTag(p, "islamic-umalqura"), { day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(date);
}

export function fmtTime(p: FormatPrefs, d: D) {
  const date = toDate(d);
  if (!date) return "";
  return new Intl.DateTimeFormat(localeTag(p), { hour: "numeric", minute: "2-digit", timeZone: TZ }).format(date);
}

export function fmtDateTime(p: FormatPrefs, d: D) {
  const date = toDate(d);
  if (!date) return "";
  return new Intl.DateTimeFormat(localeTag(p), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: TZ }).format(date);
}

export function fmtWeekday(p: FormatPrefs, d: D, style: "short" | "long" = "short") {
  const date = toDate(d);
  if (!date) return "";
  return new Intl.DateTimeFormat(localeTag(p), { weekday: style, timeZone: TZ }).format(date);
}

export function fmtNumber(p: FormatPrefs, n: number, opts?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(localeTag(p), opts).format(n);
}

export function fmtRelative(p: FormatPrefs, d: D, now: Date = new Date()) {
  const date = toDate(d);
  if (!date) return "";
  const diff = (date.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(localeTag(p), { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}

/** Calendar day key (YYYY-MM-DD) in Dubai. */
export function dubaiDayKey(d: D) {
  const date = toDate(d);
  if (!date) return "";
  return new Date(date.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
}

export function isSameDubaiDay(a: D, b: D) {
  return dubaiDayKey(a) === dubaiDayKey(b);
}
