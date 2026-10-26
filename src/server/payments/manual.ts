// The "manual" payment provider: money finance staff receive at the school and record by hand.
// Cash, card on the school's terminal, bank transfer (with the bank reference) and cheques (with number, bank and
// date; a cheque dated after today is a post-dated cheque, held until it clears).
import type { FeePaymentMethod } from "@prisma/client";
import type { Tx } from "@/server/db";
import { recordPayment, FeeError, type Actor, type RecordPaymentInput } from "@/server/fees/ledger";

export const MANUAL_METHODS: FeePaymentMethod[] = ["CASH", "CHEQUE", "BANK_TRANSFER", "CARD"];

export async function recordManualPayment(tx: Tx, orgId: string, input: Omit<RecordPaymentInput, "provider" | "externalId">, actor: Actor) {
  if (!MANUAL_METHODS.includes(input.method)) throw new FeeError("METHOD_INVALID");
  return recordPayment(tx, orgId, { ...input, provider: "manual", externalId: null }, actor);
}
