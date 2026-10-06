// Turning REST API request bodies into the same records the Import center reads from a spreadsheet, so
// the API runs the exact same validation and import services. The JSON field names are the Import center
// column keys (student_no, first_name_en, email, class_code, ...). Lists may be sent as arrays.
// Row numbers are the 1-based position in the request array; errors are reported back as a 0-based index.
// Pure, unit-tested.
import { STUDENT_COLUMNS } from "@/lib/people-csv";
import { STAFF_COLUMNS } from "@/lib/imports/staff";
import { CLASS_COLUMNS, ENROLLMENT_COLUMNS } from "@/lib/imports/classes";
import type { ColumnSpec } from "@/lib/imports/headers";
import type { SheetRecord } from "@/lib/imports/table";
import type { RowIssue } from "@/lib/imports/types";

export const UPSERT_KINDS = ["students", "staff", "classes", "enrollments"] as const;
export type UpsertKind = (typeof UPSERT_KINDS)[number];

export const COLUMNS_BY_KIND: Record<UpsertKind, ColumnSpec[]> = { students: STUDENT_COLUMNS, staff: STAFF_COLUMNS, classes: CLASS_COLUMNS, enrollments: ENROLLMENT_COLUMNS };

/** Largest batch one request may send. */
export const MAX_BATCH: Record<UpsertKind | "attendance", number> = { students: 500, staff: 500, classes: 500, enrollments: 5000, attendance: 5000 };

export const GUARDIAN_FIELDS = ["first_name_en", "last_name_en", "first_name_ar", "last_name_ar", "email", "phone", "relationship"] as const;
export const MAX_GUARDIANS = 4;

const MAX_CELL = 4000;

export class PayloadError extends Error {
  constructor(public code: "INVALID_BODY" | "EMPTY" | "TOO_MANY_ITEMS") {
    super(`payload:${code}`);
  }
}

/** A JSON value as a spreadsheet cell: lists are joined with "; ", booleans become yes or no. */
export function toCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (Array.isArray(v)) return v.map(toCell).filter(Boolean).join("; ").slice(0, MAX_CELL);
  if (typeof v === "string") return v.replace(/\u0000/g, "").trim().slice(0, MAX_CELL);
  return "";
}

/** The array of items in a body such as {"students": [...]} or {"items": [...]}, or a bare array. */
export function itemsOf(body: unknown, kind: string, max: number): Array<Record<string, unknown>> {
  const list = Array.isArray(body) ? body : body && typeof body === "object" ? ((body as Record<string, unknown>)[kind] ?? (body as Record<string, unknown>).items) : undefined;
  if (!Array.isArray(list)) throw new PayloadError("INVALID_BODY");
  if (list.length === 0) throw new PayloadError("EMPTY");
  if (list.length > max) throw new PayloadError("TOO_MANY_ITEMS");
  if (!list.every((x) => x && typeof x === "object" && !Array.isArray(x))) throw new PayloadError("INVALID_BODY");
  return list as Array<Record<string, unknown>>;
}

/** Field names in the items that are not columns of this kind (reported back, never fatal). */
export function unknownFields(items: Array<Record<string, unknown>>, kind: UpsertKind): string[] {
  const known = new Set(COLUMNS_BY_KIND[kind].map((c) => c.key));
  if (kind === "students") known.add("guardians");
  const out = new Set<string>();
  for (const it of items) for (const k of Object.keys(it)) if (!known.has(k)) out.add(k.slice(0, 60));
  return [...out].slice(0, 30);
}

/** Staff, classes and enrollments: one record per item, keyed by column key. */
export function toRecords(kind: Exclude<UpsertKind, "students">, items: Array<Record<string, unknown>>): SheetRecord[] {
  const columns = COLUMNS_BY_KIND[kind];
  return items.map((it, i) => {
    const values: Record<string, string> = {};
    for (const c of columns) values[c.key] = toCell(it[c.key]);
    return { row: i + 1, values };
  });
}

/**
 * Students with guardians. The student import takes one guardian per row and rejects a student number twice
 * in one file, so a student with several guardians is imported in passes: pass 0 carries every student with
 * their first guardian (or none), pass 1 the students that have a second guardian, and so on.
 */
export function studentPasses(items: Array<Record<string, unknown>>): SheetRecord[][] {
  const base = STUDENT_COLUMNS.filter((c) => !c.key.startsWith("guardian_") && c.key !== "relationship");
  const guardiansOf = (it: Record<string, unknown>): Array<Record<string, unknown>> => {
    const g = it.guardians;
    if (Array.isArray(g)) return g.filter((x) => x && typeof x === "object" && !Array.isArray(x)).slice(0, MAX_GUARDIANS) as Array<Record<string, unknown>>;
    // Flat guardian_* fields, exactly as in the spreadsheet template.
    const flat: Record<string, unknown> = {};
    for (const f of GUARDIAN_FIELDS) {
      const key = f === "relationship" ? "relationship" : `guardian_${f}`;
      if (it[key] !== undefined) flat[f] = it[key];
    }
    return Object.keys(flat).length ? [flat] : [];
  };
  const passes: SheetRecord[][] = [];
  items.forEach((it, i) => {
    const guardians = guardiansOf(it);
    const count = Math.max(1, guardians.length);
    for (let p = 0; p < count; p++) {
      const values: Record<string, string> = {};
      for (const c of base) values[c.key] = toCell(it[c.key]);
      const g = guardians[p];
      for (const f of GUARDIAN_FIELDS) values[f === "relationship" ? "relationship" : `guardian_${f}`] = g ? toCell(g[f]) : "";
      (passes[p] ??= []).push({ row: i + 1, values });
    }
  });
  return passes;
}

export type ApiIssue = { index: number; field: string; code: string };

/** Row issues as API errors: 0-based index, and guardian fields named inside the guardians list. */
export function toApiIssues(errors: RowIssue[], pass = 0): ApiIssue[] {
  return errors.map((e) => {
    let field = e.field;
    if (field === "relationship" || field.startsWith("guardian_")) field = `guardians[${pass}].${field === "relationship" ? "relationship" : field.slice("guardian_".length)}`;
    return { index: e.row - 1, field, code: e.code };
  });
}
