// CSV writer for exports. Every cell is quoted and spreadsheet formulas are neutralised.
// A UTF-8 byte order mark is added so spreadsheet apps read Arabic text correctly.

export function csvCell(v: unknown): string {
  let s: string;
  if (v === null || v === undefined) s = "";
  else if (v instanceof Date) s = v.toISOString();
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Rows to CSV text. Columns are the union of keys in first-seen order unless given. */
export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [cols.map(csvCell).join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
