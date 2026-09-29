/** Localized weekday name for a day number (0 Sunday ... 6 Saturday). Safe on server and client. */
export function dayName(locale: string, day: number, style: "long" | "short" = "long") {
  // 2023-01-01 was a Sunday.
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-GB", { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + day)));
}
