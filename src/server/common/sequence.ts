import type { Tx } from "@/server/db";

/** Next value of a per-organization counter. Atomic inside the transaction. */
export async function nextSequence(tx: Tx, orgId: string, key: string): Promise<number> {
  const row = await tx.sequence.upsert({
    where: { orgId_key: { orgId, key } },
    create: { orgId, key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}

/** Human-friendly number like DOC-2026-0142. */
export async function nextNumber(tx: Tx, orgId: string, prefix: string, year: number): Promise<string> {
  const n = await nextSequence(tx, orgId, `${prefix}-${year}`);
  return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
}
