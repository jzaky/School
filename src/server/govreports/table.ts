// The shape every return is built into: titled tables of cells, with headers in English and Arabic. Downloads
// (Excel, CSV, PDF) and the page all render from this, and the data checksum is taken over it. Pure.
import { createHash } from "node:crypto";
import type { Bi, Loc } from "./labels";
import type { Problem, ReturnKind } from "./kinds";

/**
 * A cell: text, a number, both languages, empty, or an Emirates ID placeholder. The placeholder never holds the
 * number: it says whether one is on file, and an export with people.reveal_ids swaps in the real value.
 */
export type Cell = string | number | null | Bi | { eid: string; present: boolean };
export type Column = { key: string; label: Bi; num?: boolean };
export type Table = { key: string; title: Bi; columns: Column[]; rows: Cell[][]; note?: Bi; totalRow?: boolean };

export type ReturnData = {
  kind: ReturnKind;
  tables: Table[];
  /** Headline figures (aggregates only) kept with each file generated, for the submission record. */
  summary: Record<string, number | string | null>;
  problems: Problem[];
  /** Fields the authority may ask for that Horizon does not hold. */
  gaps: string[];
  /** Number of data rows in the main table. */
  rowCount: number;
};

export const isBi = (c: Cell): c is Bi => typeof c === "object" && c !== null && "en" in c;
export const isEid = (c: Cell): c is { eid: string; present: boolean } => typeof c === "object" && c !== null && "eid" in c;

/** A cell as text or a number in one language. Emirates IDs show as present or missing unless `eids` has them. */
export function cellValue(c: Cell, loc: Loc, eids?: Map<string, string>, presence?: { present: string; missing: string }): string | number {
  if (c === null || c === undefined) return "";
  if (typeof c === "number" || typeof c === "string") return c;
  if (isEid(c)) {
    const v = eids?.get(c.eid);
    if (v) return v;
    return c.present ? (presence?.present ?? "present") : (presence?.missing ?? "missing");
  }
  return loc === "ar" ? c.ar || c.en : c.en || c.ar;
}

/** Bilingual header text, for a single header row: "Grade / الصف". */
export const bilingualHeader = (c: Column) => `${c.label.en} / ${c.label.ar}`;

/** SHA-256 of the return's data (both languages, identifiers as present or missing only), stable across runs. */
export function dataHash(meta: Record<string, string | number | null>, tables: Table[]): string {
  const canon = (c: Cell) => (isEid(c) ? (c.present ? "#eid" : "") : c);
  const body = JSON.stringify({ meta, tables: tables.map((t) => ({ key: t.key, columns: t.columns.map((c) => c.key), rows: t.rows.map((r) => r.map(canon)) })) });
  return createHash("sha256").update(body).digest("hex");
}

export const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");
