// PLACEHOLDER on the fees branch only. The real module is on the main branch (admissions). When merging, keep the
// main branch's version of this file (git checkout --theirs or --ours, whichever side is main): it has the same
// exports, and src/server/fees/admissions-link.ts is written against them.
import type { ExecCtx } from "@/server/db";

export type SeatChargeRequest = {
  orgId: string;
  applicationId: string;
  applicationNumber: string;
  amountFils: number;
  currency: "AED";
  payerEmail: string | null;
  description: { en: string; ar: string };
  idempotencyKey: string;
};

export type SeatChargeResult = { reference: string; payUrl: string | null };

export interface SeatBookingProvider {
  createCharge(ec: ExecCtx, req: SeatChargeRequest): Promise<SeatChargeResult>;
}

const g = globalThis as unknown as { __seatProvider?: SeatBookingProvider | null };

export function registerSeatBookingProvider(p: SeatBookingProvider | null) {
  g.__seatProvider = p;
}

export async function markSeatPaid(
  _ec: ExecCtx,
  _input: { applicationId: string; reference: string | null; actor: { membershipId: string | null; userId: string | null } | null; source: "staff" | "fees" },
): Promise<"paid" | "already"> {
  // Admissions is not on this branch, so there is no application to move on.
  throw new Error("NOT_FOUND");
}
