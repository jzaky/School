// Hooks other modules register with fees (kept apart from ledger.ts so there are no import cycles).
// Admissions registers a handler that moves an application to "Seat booking paid" when its seat booking invoice is
// paid in full (src/server/fees/admissions-link.ts wires it to markSeatPaid).
import type { ExecCtx } from "@/server/db";

export type SeatPaidHandler = (ec: ExecCtx, input: { applicationId: string; reference: string }) => Promise<unknown>;

const g = globalThis as unknown as { __feesSeatPaidHandler?: SeatPaidHandler | null };

export function registerSeatPaidHandler(handler: SeatPaidHandler | null) {
  g.__feesSeatPaidHandler = handler;
}

export function seatPaidHandler(): SeatPaidHandler | null {
  return g.__feesSeatPaidHandler ?? null;
}

/** Seat booking invoices carry sourceRef "seat:<application id>". */
export const SEAT_REF_PREFIX = "seat:";
