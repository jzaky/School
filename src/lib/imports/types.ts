// Shared shapes for the import center: kinds, row issues, previews and results.
// Row issues carry a row number, a column key and a code (plus positions inside a list cell), never the
// cell's value, so an error report can be stored and shown without repeating personal data.

export const IMPORT_KINDS = ["staff", "students", "classes", "enrollments", "registrations"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const isImportKind = (v: unknown): v is ImportKind => typeof v === "string" && (IMPORT_KINDS as readonly string[]).includes(v);

/** Largest file each import accepts, in data rows. */
export const MAX_ROWS: Record<ImportKind, number> = { staff: 1000, students: 2000, classes: 1000, enrollments: 20000, registrations: 2000 };

/** Largest upload, in bytes. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export type RowIssue = {
  row: number;
  field: string;
  code: string;
  /** 1-based positions inside a list cell (for example the 3rd student number), when the issue is about some of them. */
  items?: number[];
};

export type RowAction = "create" | "update" | "unchanged";

export type PreviewCell = { text?: string; sub?: string; ltr?: boolean; chips?: string[] };

export type PreviewRow = {
  row: number;
  /** What importing this row will do; null when the row has errors. */
  action: RowAction | null;
  cells: PreviewCell[];
  errors: RowIssue[];
  warnings: RowIssue[];
  /** For updates: which parts change (message keys under imports.changes). */
  changes?: string[];
};

export type ImportPreview = {
  kind: ImportKind;
  rows: PreviewRow[];
  total: number;
  valid: number;
  invalid: number;
  counts: Record<RowAction, number>;
  unknownHeaders: string[];
  /** File-level notes (message keys under imports.notes). */
  notes: string[];
};

export type ImportSummary = {
  importId: string;
  total: number;
  succeeded: number;
  failed: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: RowIssue[];
  /** Kind-specific counts (message keys under imports.extra). */
  extra: Record<string, number>;
};

export function countActions(rows: PreviewRow[]): Record<RowAction, number> {
  const counts: Record<RowAction, number> = { create: 0, update: 0, unchanged: 0 };
  for (const r of rows) if (r.action && r.errors.length === 0) counts[r.action]++;
  return counts;
}

export function finishPreview(kind: ImportKind, rows: PreviewRow[], unknownHeaders: string[] = [], notes: string[] = []): ImportPreview {
  const valid = rows.filter((r) => r.errors.length === 0).length;
  return { kind, rows, total: rows.length, valid, invalid: rows.length - valid, counts: countActions(rows), unknownHeaders, notes };
}

/** Grade list such as "9-12", "9, 10, 11" or "Grade 9; Grade 10". Returns null when a part is not a grade. */
export function parseGradeList(value: string | null | undefined, min = 0, max = 13): number[] | null {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const out = new Set<number>();
  const RANGE = /^(\d{1,2})\s*(?:-|\u2013|\u2014|to|الى|إلى)\s*(?:grade\s*|g\s*|الصف\s*)?(\d{1,2})$/i;
  for (const partRaw of text.split(/[;,|\u060C\u061B]+/)) {
    const part = partRaw.replace(/\b(grade|year)s?\b|الصفوف|الصف/gi, " ").replace(/\b[gy](?=\d)/gi, "").replace(/\s+/g, " ").trim();
    if (!part) continue;
    const range = RANGE.exec(part);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      if (a > b || a < min || b > max) return null;
      for (let g = a; g <= b; g++) out.add(g);
      continue;
    }
    for (const token of part.split(" ")) {
      if (!/^\d{1,2}$/.test(token)) return null;
      const g = Number(token);
      if (g < min || g > max) return null;
      out.add(g);
    }
  }
  return [...out].sort((x, y) => x - y);
}
