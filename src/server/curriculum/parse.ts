// Turning pasted text or a CSV file into a list of curriculum standards for a person to review.
// Pure and deterministic: this is also the fallback when no AI model is configured.
import Papa from "papaparse";

export type DraftStandard = {
  code: string;
  strandEn: string;
  strandAr: string;
  descEn: string;
  descAr: string;
};

const ARABIC = /[؀-ۿ]/;
const BULLET = /^\s*(?:[-*•·▪●–→>]|o\s)\s*/;
const NUMBERED = /^\s*(?:\(?(\d+(?:\.\d+)*)[.)]?|\(?([a-z])[.)])\s+/i;
const CODED = /^\s*([A-Z][A-Za-z]{0,6}[.\-_]?\d+[A-Za-z0-9.\-_]*)\s*[:.)\-–]?\s+/;

function clean(s: string) {
  return s.replace(/\s+/g, " ").replace(/^[\s:.\-–]+/, "").trim();
}

type Line = { kind: "item"; text: string; code?: string; number?: string } | { kind: "plain"; text: string };

function classify(raw: string): Line | null {
  const line = raw.replace(/\t/g, " ").trimEnd();
  if (!line.trim()) return null;
  const coded = line.match(CODED);
  if (coded && /\d/.test(coded[1])) return { kind: "item", code: coded[1].replace(/[.\-_]$/, ""), text: clean(line.slice(coded[0].length)) };
  const num = line.match(NUMBERED);
  if (num) return { kind: "item", number: num[1] ?? num[2], text: clean(line.slice(num[0].length)) };
  const bullet = line.match(BULLET);
  if (bullet) return { kind: "item", text: clean(line.slice(bullet[0].length)) };
  return { kind: "plain", text: clean(line) };
}

function toBilingual(text: string) {
  return ARABIC.test(text) ? { en: text, ar: text } : { en: text, ar: "" };
}

/**
 * Split a curriculum document into standards. Numbered, lettered, coded or bulleted lines become standards;
 * a short plain line followed by items becomes the strand heading; a plain line after an item continues it.
 * A document with no list markers at all is read one standard per sentence-length line.
 */
export function parseStandardsText(text: string, opts: { prefix?: string; defaultStrand?: { en: string; ar: string } } = {}): DraftStandard[] {
  const prefix = (opts.prefix ?? "STD").trim() || "STD";
  const fallbackStrand = opts.defaultStrand ?? { en: "General", ar: "عام" };
  const lines = text.split(/\r?\n/).map(classify).filter((l): l is Line => l !== null);
  const hasItems = lines.some((l) => l.kind === "item");

  const out: Array<DraftStandard & { explicit: boolean }> = [];
  let strand = { ...fallbackStrand };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.kind === "plain") {
      const next = lines.slice(i + 1).find(Boolean);
      const isHeading = hasItems ? next?.kind === "item" && l.text.length <= 80 && !/[.;]$/.test(l.text) : l.text.length < 40 && !/[.;]$/.test(l.text) && next?.kind === "plain" && next.text.length >= 40;
      if (isHeading) {
        const h = l.text.replace(/^(strand|domain|topic|unit|المجال|المحور)\s*[:\-]?\s*/i, "").replace(/:$/, "").trim();
        const b = toBilingual(h);
        strand = { en: b.en, ar: b.ar || b.en };
        continue;
      }
      const prev = out[out.length - 1];
      if (hasItems && prev) {
        if (ARABIC.test(l.text)) prev.descAr = clean(`${prev.descAr} ${l.text}`);
        else prev.descEn = clean(`${prev.descEn} ${l.text}`);
        continue;
      }
      if (!hasItems && l.text.length >= 15) {
        const b = toBilingual(l.text);
        out.push({ code: "", strandEn: strand.en, strandAr: strand.ar, descEn: b.en, descAr: b.ar, explicit: false });
      }
      continue;
    }
    if (l.text.length < 4) continue;
    const b = toBilingual(l.text);
    const code = l.code ?? (l.number && l.number.includes(".") ? `${prefix}.${l.number}` : "");
    out.push({ code, strandEn: strand.en, strandAr: strand.ar, descEn: b.en, descAr: b.ar, explicit: Boolean(code) });
  }
  return assignCodes(out, prefix);
}

function assignCodes(rows: Array<DraftStandard & { explicit?: boolean }>, prefix: string): DraftStandard[] {
  const used = new Set(rows.filter((r) => r.code).map((r) => r.code));
  let n = 0;
  return rows.map((r) => {
    let code = r.code;
    if (!code) {
      do code = `${prefix}.${++n}`;
      while (used.has(code));
      used.add(code);
    }
    return { code, strandEn: r.strandEn, strandAr: r.strandAr, descEn: r.descEn, descAr: r.descAr };
  });
}

const HEADERS: Record<keyof DraftStandard, string[]> = {
  code: ["code", "id", "ref", "reference", "standard code", "الرمز"],
  strandEn: ["strand", "strand en", "strand_en", "stranden", "domain", "topic", "area"],
  strandAr: ["strand ar", "strand_ar", "strandar", "المجال", "المحور"],
  descEn: ["description", "description en", "description_en", "descen", "desc", "outcome", "learning outcome", "standard", "text", "statement"],
  descAr: ["description ar", "description_ar", "descar", "desc_ar", "outcome ar", "outcome_ar", "الوصف", "النص"],
};

export type CsvResult = { rows: DraftStandard[]; errors: Array<{ line: number; code: "missing_description" }> };

/**
 * Read standards from CSV. Recognised headers: code, strand, strand_ar, description, description_ar (and common
 * synonyms). Without a recognised header the columns are read as code, strand, description, strand_ar, description_ar.
 */
export function parseStandardsCsv(csv: string, opts: { prefix?: string } = {}): CsvResult {
  const parsed = Papa.parse<string[]>(csv.replace(/^﻿/, "").trim(), { skipEmptyLines: true });
  const data = parsed.data.filter((r) => r.some((c) => c && c.trim()));
  if (!data.length) return { rows: [], errors: [] };
  const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");
  const header = data[0].map(norm);
  const col: Partial<Record<keyof DraftStandard, number>> = {};
  for (const key of Object.keys(HEADERS) as Array<keyof DraftStandard>) {
    const idx = header.findIndex((h) => HEADERS[key].includes(h));
    if (idx >= 0) col[key] = idx;
  }
  const hasHeader = col.descEn !== undefined || col.descAr !== undefined;
  const body = hasHeader ? data.slice(1) : data;
  const map = hasHeader ? col : { code: 0, strandEn: 1, descEn: 2, strandAr: 3, descAr: 4 };
  const get = (r: string[], k: keyof DraftStandard) => (map[k] !== undefined ? clean(r[map[k]!] ?? "") : "");
  const rows: Array<DraftStandard & { explicit?: boolean }> = [];
  const errors: CsvResult["errors"] = [];
  body.forEach((r, i) => {
    let descEn = get(r, "descEn");
    let descAr = get(r, "descAr");
    if (!descEn && descAr) descEn = descAr;
    if (descEn && !descAr && ARABIC.test(descEn)) descAr = descEn;
    if (!descEn) {
      errors.push({ line: i + (hasHeader ? 2 : 1), code: "missing_description" });
      return;
    }
    const strandEn = get(r, "strandEn") || get(r, "strandAr") || "General";
    const strandAr = get(r, "strandAr") || (ARABIC.test(strandEn) ? strandEn : strandEn === "General" ? "عام" : strandEn);
    rows.push({ code: get(r, "code"), strandEn, strandAr, descEn, descAr });
  });
  return { rows: assignCodes(rows, (opts.prefix ?? "STD").trim() || "STD"), errors };
}

/** A short code prefix for a framework, for example CS9 or MATH10. */
export function codePrefix(subjectCode: string | null | undefined, grade: number | null | undefined) {
  return `${(subjectCode ?? "STD").toUpperCase()}${grade ?? ""}`;
}

export function isDraftStandard(v: unknown): v is DraftStandard {
  const s = v as DraftStandard;
  return Boolean(s) && ["code", "strandEn", "strandAr", "descEn", "descAr"].every((k) => typeof (s as Record<string, unknown>)[k] === "string");
}
