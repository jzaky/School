# Payment document matching

Auditors ask: are receipts and invoices matched against payment records? When an AI agent pays,
AEGIS can require that the payment matches a document the organization's system of record
registered: an invoice, a receipt or a purchase order.

- Code: `packages/core/src/payments/matching.ts`, checked in `gateway/gateway.ts`
- Console: Action Gateway page, "Payment matching" panel (read-only)
- API: `POST /v1/payment-documents/register`, `GET /v1/payment-documents`, `POST /v1/payment-documents/:id/void`, `POST /v1/payment-documents/tools/:toolId/matching`
- Tests: `packages/core/tests/payment-matching.test.ts`, `apps/api/tests/payment-documents-api.test.ts`, `apps/web/tests/e2e/payment-matching.spec.ts`

## How it works

1. The system of record (ERP, accounts payable, core banking) registers documents with its
   integration key: reference, kind, vendor, amount, currency. A person with `integrations:write` can
   also register them. **Agents cannot**, so an agent cannot create the record it pays against.
2. A person with `policies:activate` turns matching on for a payment tool and says which parameter
   carries the document reference (for example `invoiceRef`), which kinds count, and an amount
   tolerance (zero by default).
3. For every payment request through that tool, AEGIS checks, before any policy runs:
   - the request references a document, and the document is registered;
   - it is of an accepted kind and not voided;
   - the payee and the currency are the document's;
   - the amount equals the document's amount, within the tolerance;
   - no other payment has claimed it: paying the same document twice is refused.
4. A mismatch is refused at the door with the exact reason, or, if the tool is set to, held for a
   person to check.
5. A payment that passes claims the document. The claim is conditional, so of two payments racing
   for one invoice only one wins. If the payment is refused, rejected, expires or fails, the claim is
   released automatically and the document can be paid again.

Matching decides whether there is a record to pay. The tool's policies still decide how much an agent
may pay alone and when a person must approve.

## What it does not do

AEGIS does not judge whether a receipt or invoice image is genuine. In 2025 and 2026 a growing share
of fake receipts were AI-generated; catching those is the job of the system of record, its document
checks and the people who approve what it registers. What AEGIS guarantees is narrower and checkable:
an agent pays only what the system of record registered, to the payee it names, for the amount it
states, once.

## Evidence

`payment_document.registered`, `payment_document.updated`, `payment_document.voided`,
`tool.document_matching_set`, and every refused payment's decision with the mismatch reason.
