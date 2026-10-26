// Gapless document numbers (tax invoices, proformas, credit notes, receipts, refunds).
// The counter row is incremented with INSERT ... ON CONFLICT DO UPDATE inside the same transaction that writes
// the document. Postgres keeps the row locked until that transaction ends, so concurrent issuers queue up, and a
// rolled-back transaction rolls the counter back with it: numbers are never skipped and never repeated.
import { randomUUID } from "node:crypto";
import type { Tx } from "@/server/db";

export type DocType = "INV" | "PF" | "CN" | "RCT" | "RF" | "FAM";

/** Year of a date in Dubai (numbers restart each calendar year). */
export function dubaiYear(d: Date): number {
  return new Date(d.getTime() + 4 * 3_600_000).getUTCFullYear();
}

export async function nextGapless(tx: Tx, orgId: string, key: string): Promise<number> {
  const id = randomUUID().replace(/-/g, "").slice(0, 25);
  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "Sequence" ("id", "orgId", "key", "value") VALUES (${id}, ${orgId}, ${key}, 1)
    ON CONFLICT ("orgId", "key") DO UPDATE SET "value" = "Sequence"."value" + 1
    RETURNING "value"`;
  return Number(rows[0].value);
}

/** Reserve n consecutive numbers at once (bulk account creation). Returns the first one. */
export async function nextGaplessRange(tx: Tx, orgId: string, key: string, n: number): Promise<number> {
  if (!Number.isInteger(n) || n < 1) throw new Error("range size must be a positive integer");
  const id = randomUUID().replace(/-/g, "").slice(0, 25);
  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "Sequence" ("id", "orgId", "key", "value") VALUES (${id}, ${orgId}, ${key}, ${n})
    ON CONFLICT ("orgId", "key") DO UPDATE SET "value" = "Sequence"."value" + ${n}
    RETURNING "value"`;
  return Number(rows[0].value) - n + 1;
}

export function formatDocNumber(prefix: string, year: number | null, n: number, width = 5): string {
  return year === null ? `${prefix}-${String(n).padStart(width, "0")}` : `${prefix}-${year}-${String(n).padStart(width, "0")}`;
}

/** Next number for a document type, for example INV-2026-00042. Family account codes do not restart yearly. */
export async function nextDocNumber(tx: Tx, orgId: string, type: DocType, prefix: string, issuedAt: Date): Promise<string> {
  if (type === "FAM") return formatDocNumber(prefix, null, await nextGapless(tx, orgId, "fees:FAM"), 4);
  const year = dubaiYear(issuedAt);
  const n = await nextGapless(tx, orgId, `fees:${type}:${year}`);
  return formatDocNumber(prefix, year, n);
}
