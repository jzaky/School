// Shared shapes for the import center: kinds, row issues, previews and results.
// Row issues carry a row number, a column key and a code (plus positions inside a list cell), never the
// cell's value, so an error report can be stored and shown without repeating personal data.
import { MIN_GRADE_LEVEL, parseGradeLevel } from "@/lib/grade-levels";

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

/**
 * Grade list such as "9-12", "9, 10, 11", "Grade 9; Grade 10", "KG1-5", "KG1, KG2" or "الصف 1 إلى الصف 6".
 * Kindergarten is KG1 = -1 and KG2 = 0 (see parseGradeLevel). Returns null when a part is not a grade.
 */
export function parseGradeList(value: string | null | undefined, min = MIN_GRADE_LEVEL, max = 13): number[] | null {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const out = new Set<number>();
  const inRange = (g: number | null): g is number => g !== null && g >= min && g <= max;
  const one = (s: string) => parseGradeLevel(s.replace(/\byears?\s*/gi, "").replace(/\by(?=\d)/gi, "").trim());
  for (const partRaw of text.split(/[;,|\u060C\u061B]+/)) {
    const part = partRaw.replace(/\bgrades\b|\u0627\u0644\u0635\u0641\u0648\u0641/gi, " ").replace(/\s+/g, " ").trim();
    if (!part) continue;
    const single = one(part);
    if (single !== null) {
      if (!inRange(single)) return null;
      out.add(single);
      continue;
    }
    // A range: try each separator ("-", en dash, "to", "إلى") until both ends are grades.
    let done = false;
    for (const m of part.matchAll(/\s*(?:-|\u2013|\u2014|\bto\b|\u0627\u0644\u0649|\u0625\u0644\u0649)\s*/gi)) {
      const a = one(part.slice(0, m.index));
      const b = one(part.slice((m.index ?? 0) + m[0].length));
      if (a === null || b === null) continue;
      if (a > b || !inRange(a) || !inRange(b)) return null;
      for (let g = a; g <= b; g++) out.add(g);
      done = true;
      break;
    }
    if (done) continue;
    for (const token of part.split(" ")) {
      const g = one(token);
      if (!inRange(g)) return null;
      out.add(g);
    }
  }
  return [...out].sort((x, y) => x - y);
}
