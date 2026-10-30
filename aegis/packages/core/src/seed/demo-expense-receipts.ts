import { withTenant } from "@aegis/db";
import { makeContext } from "../lib/context.js";
import { registerTransactions, submitExpenseClaim } from "../payments/receipts.js";
import type { SeededTenant } from "./demo-tenant.js";

/**
 * Receipt validation demo (docs/RECEIPT_VALIDATION.md). The corporate card feed registers last week's card
 * transactions; the expense system submits six claims against them, each showing one outcome: a receipt that
 * matches its card charge, an inflated receipt, the same charge claimed twice, wrong VAT, a cash receipt with
 * nothing to check it against, and a refunded charge claimed anyway. Synthetic merchants, people and amounts.
 */
export async function seedDemoExpenseReceipts(t: SeededTenant): Promise<{ transactions: number; claims: Record<string, number> }> {
  const day = 86_400_000;
  const at = (daysAgo: number, hour = 12) => new Date(Math.floor(Date.now() / day) * day - daysAgo * day + hour * 3_600_000);
  const integrationId = t.integrations["core-banking-sim"]!;
  const feed = makeContext(t.orgId, { type: "integration", id: integrationId, label: "Corporate card feed (synthetic)" });
  const expenses = makeContext(t.orgId, { type: "integration", id: integrationId, label: "Expense system (synthetic)" });
  return withTenant(t.orgId, async (db) => {
    const { created } = await registerTransactions(db, feed, {
      transactions: [
        { ref: "CARD-77810", cardRef: "4411", merchantName: "Al Nakheel Restaurant LLC", amount: "287.50", currency: "AED", postedAt: at(6, 21) },
        { ref: "CARD-77815", cardRef: "4411", merchantName: "Careem Rides", amount: "64.00", currency: "AED", postedAt: at(5, 9) },
        { ref: "CARD-77821", cardRef: "5520", merchantName: "Jumeirah Business Centre", amount: "1050.00", currency: "AED", postedAt: at(4, 11) },
        { ref: "CARD-77830", cardRef: "5520", merchantName: "Creek View Hotel", amount: "520.00", currency: "AED", postedAt: at(3, 15) },
        { ref: "CARD-77836", kind: "refund", cardRef: "5520", merchantName: "Creek View Hotel", amount: "520.00", currency: "AED", postedAt: at(2, 10), originalRef: "CARD-77830" },
      ],
    });
    const claims = [
      // Matches its card charge: merchant, date, amount, VAT and tax number all check out.
      { ref: "EXP-2026-1041", claimantRef: "EMP-1207", cardRef: "4411", merchantName: "Al Nakheel Restaurant", receiptDate: at(6, 20), currency: "AED", subtotal: "273.81", vat: "13.69", total: "287.50", trn: "100234567800003" },
      // The receipt says 164.00; the card was charged 64.00.
      { ref: "EXP-2026-1042", claimantRef: "EMP-1207", cardRef: "4411", merchantName: "Careem", receiptDate: at(5, 9), currency: "AED", total: "164.00" },
      // A second person claims the dinner already claimed above.
      { ref: "EXP-2026-1043", claimantRef: "EMP-1388", cardRef: "4411", merchantName: "Al Nakheel Restaurant", receiptDate: at(6, 20), currency: "AED", subtotal: "273.81", vat: "13.69", total: "287.50", trn: "100234567800003" },
      // Adds up, but the VAT is 6% of the net amount where the UAE rate is 5%.
      { ref: "EXP-2026-1044", claimantRef: "EMP-1452", cardRef: "5520", merchantName: "Jumeirah Business Centre", receiptDate: at(4, 11), currency: "AED", subtotal: "990.57", vat: "59.43", total: "1050.00", trn: "100345678900003" },
      // Cash, no card: there is no system-of-record transaction to compare with.
      { ref: "EXP-2026-1045", claimantRef: "EMP-1452", cardRef: null, merchantName: "Souk Taxi Service", receiptDate: at(4, 18), currency: "AED", total: "45.00" },
      // The hotel charge was refunded two days later.
      { ref: "EXP-2026-1046", claimantRef: "EMP-1452", cardRef: "5520", merchantName: "Creek View Hotel", receiptDate: at(3, 15), currency: "AED", subtotal: "495.24", vat: "24.76", total: "520.00", trn: "100456789000003" },
    ];
    const tally: Record<string, number> = {};
    for (const c of claims) {
      const r = await submitExpenseClaim(db, expenses, c);
      tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
    }
    return { transactions: created, claims: tally };
  });
}
