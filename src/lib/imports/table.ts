// Turning a spreadsheet (rows of cells from a CSV or the first sheet of an XLSX file) into records keyed by
// column. Row numbers are the real spreadsheet row numbers (the header is usually row 1), so error reports
// point at the right line even when the file has blank rows. Pure: shared by the browser and the server.
import { headerIndex, resolveHeader, type ColumnSpec } from "./headers";

/** One data row: its spreadsheet row number and its cells keyed by column key (or by raw header). */
export type SheetRecord = { row: number; values: Record<string, string> };

export type Sheet = {
  /** Spreadsheet row number of the header row. */
  headerRow: number;
  records: SheetRecord[];
  /** Header cells that do not match a known column (shown as a note; never personal data). */
  unknownHeaders: string[];
  /** Required column keys the file does not have. */
  missing: string[];
};

const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/\u0000/g, "").trim());
const isBlank = (row: unknown[]) => row.every((c) => cell(c) === "");

/** Maps a table to records with known columns. The first non-blank row is the header. */
export function tableToSheet(table: unknown[][], columns: ColumnSpec[]): Sheet {
  const index = headerIndex(columns);
  const headerAt = table.findIndex((r) => Array.isArray(r) && !isBlank(r));
  if (headerAt < 0) return { headerRow: 1, records: [], unknownHeaders: [], missing: columns.filter((c) => c.required).map((c) => c.key) };
  const header = table[headerAt].map(cell);
  const keys = header.map((h) => (h ? resolveHeader(h, index) : null));
  const unknownHeaders = header.filter((h, i) => h && !keys[i]);
  const present = new Set(keys.filter(Boolean) as string[]);
  const missing = columns.filter((c) => c.required && !present.has(c.key)).map((c) => c.key);
  const records: SheetRecord[] = [];
  for (let i = headerAt + 1; i < table.length; i++) {
    const r = table[i];
    if (!Array.isArray(r) || isBlank(r)) continue;
    const values: Record<string, string> = {};
    keys.forEach((k, j) => {
      if (!k) return;
      const v = cell(r[j]);
      // Two columns for the same field (for example "Email" and "البريد"): the first filled one wins.
      if (v && !values[k]) values[k] = v;
      else if (!(k in values)) values[k] = v;
    });
    records.push({ row: i + 1, values });
  }
  return { headerRow: headerAt + 1, records, unknownHeaders, missing };
}

/** Records keyed by the raw header text (for imports whose columns are dynamic, like subject choices). */
export function tableToRawRecords(table: unknown[][]): { headers: string[]; records: SheetRecord[] } {
  const headerAt = table.findIndex((r) => Array.isArray(r) && !isBlank(r));
  if (headerAt < 0) return { headers: [], records: [] };
  const headers = table[headerAt].map(cell);
  const records: SheetRecord[] = [];
  for (let i = headerAt + 1; i < table.length; i++) {
    const r = table[i];
    if (!Array.isArray(r) || isBlank(r)) continue;
    const values: Record<string, string> = {};
    headers.forEach((h, j) => {
      if (h && !(h in values)) values[h] = cell(r[j]);
    });
    records.push({ row: i + 1, values });
  }
  return { headers: headers.filter(Boolean), records };
}

/** Excel stores dates as a day count from 30 December 1899. Returns YYYY-MM-DD, or null when out of range. */
export function excelSerialToIso(value: string): string | null {
  if (!/^\d{4,5}(\.\d+)?$/.test(value.trim())) return null;
  const serial = Math.floor(Number(value));
  if (serial < 1 || serial > 80000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
  return d.toISOString().slice(0, 10);
}
