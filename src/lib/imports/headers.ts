// Column headers for spreadsheet imports. Every import accepts the column key (email), the English label
// (Email), the Arabic label (البريد الإلكتروني), the bilingual template header (Email / البريد الإلكتروني)
// and a few common variants. Matching ignores case, spacing, punctuation, Arabic diacritics and the
// usual spelling variants of alef, yaa and taa marbuta. Pure: shared by the browser and the server.

export type ColumnSpec = {
  /** Stable key used in code and in error reports. */
  key: string;
  en: string;
  ar: string;
  required?: boolean;
  aliases?: string[];
};

const AR_MARKS = /[ً-ٰٟـ]/g;

/** Normalizes a header (or a name to match) for comparison. Keeps "/" and "|" so bilingual headers can be split. */
export function normHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/^﻿/, "")
    .normalize("NFKC")
    .replace(AR_MARKS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/[_\-.:*()[\]#,،؛;"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The header written in templates: "Email / البريد الإلكتروني". */
export function bilingualHeader(c: ColumnSpec): string {
  return `${c.en} / ${c.ar}`;
}

export type HeaderIndex = Map<string, string>;

/** Lookup from every accepted spelling to the column key. Throws when two columns share a spelling. */
export function headerIndex(columns: ColumnSpec[]): HeaderIndex {
  const map: HeaderIndex = new Map();
  for (const c of columns) {
    for (const spelling of [c.key, c.en, c.ar, bilingualHeader(c), ...(c.aliases ?? [])]) {
      const n = normHeader(spelling);
      if (!n) continue;
      const taken = map.get(n);
      if (taken && taken !== c.key) throw new Error(`Header "${spelling}" is used by ${taken} and ${c.key}`);
      map.set(n, c.key);
    }
  }
  return map;
}

/** Column key for a header cell, or null when the column is not one we know. */
export function resolveHeader(raw: unknown, index: HeaderIndex): string | null {
  const n = normHeader(raw);
  if (!n) return null;
  const whole = index.get(n) ?? index.get(n.replace(/\s*([/|])\s*/g, " $1 "));
  if (whole) return whole;
  for (const part of n.split(/\s*[/|]\s*/)) {
    const key = index.get(part.trim());
    if (key) return key;
  }
  return null;
}

/** Splits a cell holding several values: "teacher; counselor", "MATH, PHYS", "A|B" or Arabic commas. */
export function splitList(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/[;,|\n،؛]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Like splitList, but also splits on spaces (for lists of codes such as student numbers). */
export function splitCodes(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/[;,|\s،؛]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const YES = new Set(["yes", "y", "true", "1", "x", "نعم", "صح"]);
const NO = new Set(["no", "n", "false", "0", "لا", "خطا"]);

/** Reads yes/no cells in English or Arabic. Empty is null; anything else is undefined (invalid). */
export function parseYesNo(value: string | null | undefined): boolean | null | undefined {
  const v = normHeader(value);
  if (!v) return null;
  if (YES.has(v)) return true;
  if (NO.has(v)) return false;
  return undefined;
}

/** CSV line with quoting where needed. */
export function csvLine(values: string[]): string {
  return values.map((v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",");
}

/** A template: the bilingual header row and example rows (keyed by column key). */
export function templateCsv(columns: ColumnSpec[], examples: Array<Record<string, string>>): string {
  const lines = [csvLine(columns.map(bilingualHeader)), ...examples.map((ex) => csvLine(columns.map((c) => ex[c.key] ?? "")))];
  return `${lines.join("\n")}\n`;
}
