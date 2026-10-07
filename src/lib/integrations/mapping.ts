// Column mapping for scheduled sync: a school's own export (for example from its student information
// system) often has other header names than the Import center templates. The mapping says which header
// holds which template column. Headers the mapping does not mention fall back to the Import center header
// resolution (English, Arabic, bilingual and common variants), so a template file needs no mapping at all.
// Pure: shared by the browser (mapping editor) and the worker.
import { headerIndex, normHeader, resolveHeader, type ColumnSpec } from "@/lib/imports/headers";

/** Normalized source header -> column key, or "" to ignore that column. */
export type ColumnMapping = Record<string, string>;

export const MAX_MAPPED_HEADERS = 120;

/** Each header with the column the Import center would read it as (null when it does not know it). */
export function suggestMapping(headers: string[], columns: ColumnSpec[]): Array<{ header: string; key: string | null }> {
  const index = headerIndex(columns);
  return headers.map((header) => ({ header, key: header.trim() ? resolveHeader(header, index) : null }));
}

/** Keeps only entries for real headers that point at a known column (or "" to ignore). */
export function cleanMapping(input: unknown, columns: ColumnSpec[]): ColumnMapping {
  const keys = new Set(columns.map((c) => c.key));
  const out: ColumnMapping = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [rawHeader, rawKey] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_MAPPED_HEADERS) break;
    const header = normHeader(rawHeader).slice(0, 120);
    if (!header || typeof rawKey !== "string") continue;
    if (rawKey === "" || keys.has(rawKey)) out[header] = rawKey;
  }
  return out;
}

const isBlankRow = (row: unknown[]) => row.every((c) => String(c ?? "").trim() === "");

/**
 * The table with its header row rewritten through the mapping: a mapped header becomes its column key, an
 * ignored one becomes blank (so it is skipped), and any other header is left for the normal resolution.
 */
export function applyMapping(table: unknown[][], mapping: ColumnMapping): unknown[][] {
  if (!Object.keys(mapping).length) return table;
  const at = table.findIndex((r) => Array.isArray(r) && !isBlankRow(r));
  if (at < 0) return table;
  const header = table[at].map((cell) => {
    const n = normHeader(cell);
    if (n && Object.prototype.hasOwnProperty.call(mapping, n)) return mapping[n];
    return cell;
  });
  return [...table.slice(0, at), header, ...table.slice(at + 1)];
}

/** Required columns that the headers, read through the mapping, still do not provide. */
export function missingAfterMapping(headers: string[], mapping: ColumnMapping, columns: ColumnSpec[]): string[] {
  const index = headerIndex(columns);
  const present = new Set<string>();
  for (const h of headers) {
    const n = normHeader(h);
    if (!n) continue;
    const key = Object.prototype.hasOwnProperty.call(mapping, n) ? mapping[n] : resolveHeader(h, index);
    if (key) present.add(key);
  }
  return columns.filter((c) => c.required && !present.has(c.key)).map((c) => c.key);
}
