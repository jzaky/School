import type { Prisma } from "@prisma/client";

/** A transaction client already scoped to one organization (from tenantTx) or the owner client in seeds. */
export type Tx = Prisma.TransactionClient;

/** Side effects that must run after the transaction commits (queue jobs, outbound messages). */
export type Effect =
  | { kind: "job"; queue: string; name: string; data: Record<string, unknown>; jobId: string; delayMs?: number };

export type ExecCtx = {
  tx: Tx;
  orgId: string;
  now: Date;
  effects: Effect[];
  actorId?: string | null;
  /** Seeds run without delivering email or queue jobs. */
  quiet?: boolean;
};

export function execCtx(tx: Tx, orgId: string, opts: Partial<Omit<ExecCtx, "tx" | "orgId">> = {}): ExecCtx {
  return { tx, orgId, now: opts.now ?? new Date(), effects: opts.effects ?? [], actorId: opts.actorId ?? null, quiet: opts.quiet };
}
