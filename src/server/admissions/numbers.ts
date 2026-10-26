// Application numbers (ADM-2027-0042) and admission numbers from the school's pattern.
//
// Pattern tokens: {YYYY} and {YY} are the year of entry (the year the academic year starts), {SHORT} the school's
// short name in capitals, and {SEQ:n} a running number padded to n digits (3 to 6), counted per year of entry.
// Anything else in the pattern is copied as is (letters, digits, dash, slash, underscore, dot).
import type { Tx } from "@/server/db";
import { nextSequence } from "@/server/common/sequence";

export const DEFAULT_PATTERN = "{YYYY}-{SEQ:4}";
const TOKEN_RE = /\{(YYYY|YY|SHORT|SEQ:[3-6])\}/g;

/** Null when the pattern is usable, otherwise why not. */
export function patternProblem(pattern: string): "EMPTY" | "NO_SEQ" | "CHARS" | "LENGTH" | null {
  const p = pattern.trim();
  if (!p) return "EMPTY";
  if (p.length > 40) return "LENGTH";
  const seqs = p.match(/\{SEQ:[3-6]\}/g) ?? [];
  if (seqs.length !== 1) return "NO_SEQ";
  const rest = p.replace(TOKEN_RE, "");
  if (!/^[A-Za-z0-9\-/_.]*$/.test(rest)) return "CHARS";
  return null;
}

export function shortCode(short: string | null | undefined): string {
  return (short ?? "").normalize("NFD").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6) || "SCH";
}

/** Fill a pattern. */
export function formatAdmissionNo(pattern: string, v: { year: number; seq: number; short: string }): string {
  return pattern.trim().replace(TOKEN_RE, (_, tok: string) => {
    if (tok === "YYYY") return String(v.year);
    if (tok === "YY") return String(v.year % 100).padStart(2, "0");
    if (tok === "SHORT") return shortCode(v.short);
    const n = Number(tok.split(":")[1]);
    return String(v.seq).padStart(n, "0");
  });
}

/** The counter a pattern uses: one per pattern shape and year, so changing the pattern starts a fresh count. */
export function sequenceKey(pattern: string, year: number) {
  return `admno:${pattern.trim().replace(/\{SEQ:[3-6]\}/, "#")}:${year}`;
}

/**
 * The next admission number that no student in the school has yet. Atomic inside the transaction; numbers taken
 * by imported students are skipped.
 */
export async function nextAdmissionNo(tx: Tx, orgId: string, pattern: string, v: { year: number; short: string }): Promise<string> {
  const p = patternProblem(pattern) ? DEFAULT_PATTERN : pattern;
  for (let i = 0; i < 500; i++) {
    const seq = await nextSequence(tx, orgId, sequenceKey(p, v.year));
    const no = formatAdmissionNo(p, { year: v.year, seq, short: v.short });
    const taken = await tx.student.findFirst({ where: { orgId, studentNo: no }, select: { id: true } });
    if (!taken) return no;
  }
  throw new Error("admission_number_exhausted");
}

/** Application reference shown to families and staff, for example ADM-2027-0042. */
export async function nextApplicationNo(tx: Tx, orgId: string, entryYear: number): Promise<string> {
  const n = await nextSequence(tx, orgId, `ADM-${entryYear}`);
  return `ADM-${entryYear}-${String(n).padStart(4, "0")}`;
}
