# Expense receipt validation

An expense claim is checked against what the person claiming cannot edit: the card or bank transaction in
the system of record, earlier claims, and the arithmetic and tax rules of the receipt itself. Every check is
deterministic and money is compared in minor units (fils, cents).

- Code: `packages/core/src/payments/receipts.ts`, enforced in `gateway/gateway.ts` for reimbursement tools
- API: `POST /v1/expenses/transactions` (bank or card feed), `POST /v1/expenses/claims` (expense system),
  `GET /v1/expenses/claims`, `POST /v1/expenses/tools/:toolId/claim-rule`
- Tests: `packages/core/tests/receipts.test.ts` (real PNG and JPEG images), `apps/api/tests/expenses-api.test.ts`

## Verdicts

| Verdict | Meaning | At the gateway |
|---|---|---|
| verified_match | The receipt agrees with itself, the tax rules and a real charge, and is not a duplicate | Paid, once |
| requires_review | An indicator needs a person (AI-generated label, reused image, wrong VAT, no charge found on a covered card) | Held for a person |
| confirmed_mismatch | A fact contradicts the claim | Refused, with the reason |
| insufficient_evidence | No card or bank record covers that card and date | Held for a person |

## Checks

| Check | Finding codes |
|---|---|
| Subtotal plus VAT equals the total; claim not above the receipt; receipt not dated after the claim | totals_do_not_add_up, claim_exceeds_receipt, receipt_dated_in_future |
| VAT at the jurisdiction's standard rate (AE 5%, SA 15%, BH 10%, OM 5%), half-up rounding, 1 minor unit tolerance; zero-rated supplies can be marked | vat_rate_wrong |
| Tax registration number present and in the right format (format only, not registration) | trn_missing, trn_invalid_format |
| A charge at the same merchant for the same amount within the receipt date minus 1 day to plus 4 days | transaction_matches, amount_differs_from_charge, no_matching_charge |
| Split payments: two or three charges adding up to the total | split_transaction_matches |
| Refunds and reversals linked to the charge | transaction_reversed, transaction_partly_refunded |
| The same file (SHA-256) or the same charge claimed before | duplicate_receipt_file, transaction_already_claimed |
| The same picture resized, re-compressed or cropped (64-bit difference hash, up to 6 bits apart) | reused_receipt_image |
| C2PA or IPTC "trained algorithmic media" labels, image-generator names in metadata | ai_generated_label, ai_generator_named |

## What it does not do

- It does not decide whether an image is AI-generated. Provenance labels are indicators for a person and
  never make a claim a mismatch on their own; their absence proves nothing, because labels are easy to strip.
- It does not check a tax registration number against the tax authority, only its format.
- VAT rates are standard rates for illustration; zero-rated and exempt supplies and rule changes must be
  confirmed by the customer's tax adviser.
- `extractReceiptText` reads typed and e-receipts with simple patterns. For scanned receipts, send fields
  from the expense system's own extraction (or a document-extraction service such as Docling, under evaluation).

Agents cannot register transactions or submit claims, so an agent cannot create the record it is paid against.
