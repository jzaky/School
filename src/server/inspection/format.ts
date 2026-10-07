// Bilingual labels and value text for the evidence pack downloads (PDF and CSV). The page itself uses
// next-intl; downloads carry both languages, so they read the same message files directly.
import en from "../../../messages/en.json";
import ar from "../../../messages/ar.json";
import type { EvidencePack, Metric } from "./evidence";

type Loc = "en" | "ar";
const M = { en: en.inspection, ar: ar.inspection };
type Dict = Record<string, string>;

export const L = (loc: Loc) => M[loc];

export function headingLabel(key: string, loc: Loc) {
  return (M[loc].headings as Dict)[key] ?? key;
}
export function metricLabel(key: string, loc: Loc) {
  return (M[loc].metrics as Dict)[key] ?? key;
}
export function breakdownLabel(key: string, loc: Loc) {
  return (M[loc].breakdown as Dict)[key] ?? key;
}
export function frameworkLabel(key: string, loc: Loc) {
  return (M[loc].mapping.frameworks as Dict)[key] ?? key;
}

const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
const num = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
const day = (iso: string, loc: Loc) => new Intl.DateTimeFormat(loc === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(iso));

/** The value of a metric as text in one language (numbers stay Western digits for print consistency). */
export function metricValue(m: Metric, loc: Loc): string {
  const u = M[loc].units;
  if (m.value === null) return m.note ? (M[loc].notes as Dict)[m.note] : "-";
  if (m.unit === "date") return day(String(m.value), loc);
  const v = Number(m.value);
  switch (m.unit) {
    case "hours":
      return fill(u.hours, { n: num(v) });
    case "days":
      return fill(u.days, { n: num(v) });
    case "percent":
      return fill(u.percent, { n: num(v) });
    case "ratio":
      return fill(u.ratio, { value: num(v), of: num(m.of ?? 0) });
    default:
      return num(v);
  }
}

/** Breakdown as "Open 2, Closed 1". */
export function breakdownText(m: Metric, loc: Loc): string {
  if (!m.breakdown?.length) return "";
  const sep = loc === "ar" ? "، " : ", ";
  return m.breakdown.map((b) => `${breakdownLabel(b.key, loc)} ${num(b.value)}`).join(sep);
}

export function periodText(pack: Pick<EvidencePack, "from" | "to">, loc: Loc) {
  // `to` is exclusive (the start of the day after the last day).
  const last = new Date(new Date(pack.to).getTime() - 1).toISOString();
  // Arabic reads "from ... to ..." so the two dates never get reordered by the bidi algorithm.
  return loc === "ar" ? `من ${day(pack.from, loc)} إلى ${day(last, loc)}` : `${day(pack.from, loc)} - ${day(last, loc)}`;
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** CSV with both languages per row. Aggregates only: case references are never exported. */
export function evidenceCsv(pack: EvidencePack): string {
  const lines = [["heading_en", "heading_ar", "metric_key", "metric_en", "metric_ar", "value", "of", "unit", "value_en", "value_ar", "breakdown_en", "breakdown_ar", "period_from", "period_to"].join(",")];
  const last = new Date(new Date(pack.to).getTime() - 1).toISOString().slice(0, 10);
  for (const s of pack.sections) {
    for (const m of s.metrics) {
      lines.push(
        [headingLabel(s.key, "en"), headingLabel(s.key, "ar"), m.key, metricLabel(m.key, "en"), metricLabel(m.key, "ar"), m.value ?? "", m.of ?? "", m.unit, metricValue(m, "en"), metricValue(m, "ar"), breakdownText(m, "en"), breakdownText(m, "ar"), pack.from.slice(0, 10), last]
          .map(cell)
          .join(","),
      );
    }
  }
  lines.push("");
  lines.push(["heading_en", "framework", "area_en", "area_ar", "note_en"].map(cell).join(","));
  for (const s of pack.sections) for (const r of s.mapping) lines.push([headingLabel(s.key, "en"), r.framework, r.areaEn, r.areaAr, r.noteEn ?? ""].map(cell).join(","));
  return "﻿" + lines.join("\n");
}
