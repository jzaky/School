# Fees and invoicing: guide for school staff

This guide is for the finance office, school leaders and administrators. It explains how fees, invoices, payments and finance reports work in Horizon. Amounts are in UAE dirhams (AED) with fils (two decimals).

## Who can do what

| Role | What they can do |
|---|---|
| Finance Officer | Everything in Finance except approving refunds and awards: set up fees, bill families, record payments, issue credit notes, ask for refunds, run reports and exports. |
| Principal | See Finance, run reports (read only) and approve refunds, scholarships and bursaries. |
| School Administrator | See Finance (read only). |
| Parents | See their own family's invoices, receipts, balance and due dates under Fees. |
| Students | Never see fees. |

The permissions behind these roles are: `fees.view`, `fees.manage`, `fees.collect`, `fees.refund.approve` and `fees.reports`. A school can give them to other roles on Administration, Roles. Approving refunds and awards always needs a second person: nobody can approve a request they made themselves.

Every change to money (an invoice, a payment, a credit note, a refund, an award, a setting) is recorded in the audit log with who did it and when.

## 1. First setup

Open **Finance, Fee setup**.

1. **School details.** Enter the school's legal name in English and Arabic, the address and the 15-digit Tax Registration Number (TRN). These appear on every tax invoice. Add bank details for transfers if you want them printed on invoices. Until the legal name, address and TRN are filled in, Horizon will not issue tax invoices.
2. **Fee schedule.** Add the approved tuition for each grade from KG1 to Grade 12 (one tuition fee per grade), the school bus fee for each zone, and one-off items such as registration, re-enrollment, uniforms, books, trips and exam fees. To start next year, use **Copy from another year** and enter the approved percentage change.
3. **Instalment plans.** Add at least one plan. Horizon suggests a termly plan (40%, 30%, 30%) from the academic year's terms, and can also suggest a monthly plan (ten instalments, September to June) or an annual plan. Mark one plan as the default. Each instalment has a billing period and a due date.
4. **Discounts.** Sibling and early payment discounts are automatic and set in **Billing rules**. Staff child discounts, scholarships, bursaries and other discounts are added here and then given to a child from the family account. Scholarships and bursaries always need approval by a second person.
5. **Billing rules.** Sibling percentages, how several discounts combine, the early payment discount, the pro rata rule, reminders and the finance hold.

### VAT

Each fee item has a VAT treatment. The defaults are:

- Zero rated: tuition, registration, re-enrollment, seat deposit, books.
- Standard rated at 5%: transport, uniforms, trips, exam fees, other items.

These are defaults only. **The school's accountant must confirm the VAT treatment of every item** before the first invoice, and change any item that is treated differently. VAT is worked out on each invoice line, on the amount after discounts, and rounded to the fils.

## 2. Family accounts

A family account groups the children who are billed together and says who pays: a guardian, or a company sponsor (with its legal name, TRN and billing address). On **Finance, Families**, use **Create family accounts** to put every active student on their primary guardian's account in one step. You can run it again at any time: it only adds students who have no account yet.

On a family account you can:

- change who pays, choose an instalment plan for the family, add a billing email and address;
- set a child's school bus zone, or move one child to a sponsor's account;
- give a child a discount (staff child, scholarship, bursary);
- pause automatic reminders for the family, with a reason (for example while a payment arrangement is agreed);
- see the statement: every invoice, payment, credit note, refund and returned cheque with a running balance.

## 3. Billing a term

Open **Finance, Billing** and choose **Bill an instalment**. Pick the instalment (for example Term 2), the issue date and the due date. Horizon then invoices every family on that plan in the background, a batch of families at a time, and shows the progress. You can leave the page; the work continues. If the server restarts, the run continues from where it stopped, and no family is ever billed twice in the same run.

Each family gets one tax invoice with:

- tuition for each child for that instalment (the instalment's share of the yearly fee);
- the school bus for children with a zone;
- one-off items billed automatically on the first instalment, and charges waiting on the account (for example uniforms);
- discounts, shown per line.

To bill a single family (for example a child who joined after the run), open the family and use **Bill this family**.

### Sibling discount

On tuition only, for children on the same family account. The eldest child (highest grade, then date of birth) pays the full fee; the second child gets the second-child rate, and so on. The default is 5% for the second child and 10% for the third and later children; you can change these.

### How discounts combine

With "apply them one after another" (the default), discounts apply in this fixed order, each on what is left after the ones before:

1. staff child,
2. scholarship,
3. bursary,
4. other discounts,
5. sibling.

Percentages come before fixed amounts, and a line never goes below zero. A fixed yearly amount (for example a bursary of AED 6,000) is shared across the instalments like the fee itself. With "apply only the largest", a child gets the single largest discount.

### Joiners and leavers (pro rata)

Tuition and transport are pro rata for children who join or leave during an instalment period. The rule is set in Billing rules:

- **Whole months** (default): a child who joins on or before the cutoff day (default the 15th) pays for that month; after it, from the next month. A child who leaves after the cutoff day pays for the leaving month.
- **Days**: charged for the calendar days at school within the period.
- **Whole instalment**: any part of the period is charged in full.

For a leaver, open the family and use **Leaver credit** with the leaving date. Horizon issues credit notes for the unused part. Check your regulator's refund rules when you choose the rule.

## 4. Recording payments

On the family account choose **Record payment**:

- **Bank transfer**: enter the bank reference.
- **Cash** and **Card** (the school's terminal).
- **Cheque**: enter the number, bank and date. A cheque dated after today is a **post-dated cheque**: it is held, does not reduce what the family owes, and has no receipt yet. On the cheque's date, open **Payments, Post-dated cheques** and choose **Cheque cleared**: the receipt is issued and the money goes to the oldest invoices. If the bank returns a cheque, choose **Returned**: the invoices it paid become open again.

Money goes to the invoice you choose, or to the oldest due invoices first. More than is owed stays as credit on the family account; use **Apply credit** to put it against invoices later, or **Request refund** to return it. Recording the same payment twice (for example a double click) records it once.

Each payment gets a receipt (a bilingual PDF) with a receipt number.

### Early payment discount

If switched on, a family that pays an invoice in full a set number of days before the due date gets a percentage of the tuition back. Horizon shows the offer on the invoice and in the payment form; when the payment settles the invoice, the discount is given as a credit note.

## 5. Invoices, credit notes and corrections

An issued invoice is never edited. To correct one, open it and choose **Issue credit note**: credit some lines (for example two months of the school bus) or everything. VAT is credited at each line's own rate. If the invoice was already paid, the paid part becomes credit on the family account.

Tax invoices, proforma invoices, credit notes and receipts are each numbered in their own sequence without gaps, restarting each calendar year (for example INV-2026-00042). Every PDF is in English and Arabic and shows the school's legal name, address and TRN, the invoice number and date, the customer, each line with quantity, unit price, discount, taxable amount, VAT rate and VAT, and the totals in AED.

A **proforma invoice** is a request for payment, not a tax invoice (used for example for a seat booking). When it is paid, Horizon issues the tax invoice automatically. An unpaid proforma can be cancelled.

## 6. Refunds and approvals

A finance officer asks for a refund from a payment's credit, with a reason. The principal (or anyone with the approval permission) approves or rejects it on **Finance, Approvals**; they receive a notice. After approval the finance office pays the refund and records it with **Mark as paid out**, which gives it a refund number. Scholarships and bursaries go through the same approvals page.

## 7. Reminders

Every morning Horizon sends reminders for open invoices: a few days before the due date and on set days after it (default 7 days before; 7, 21 and 45 days after). Each stage is sent once per invoice, as an in-app notice and email, following each parent's notification settings. A missed day never sends several reminders at once. Reminders are not sent automatically to a family that has a child with an open wellbeing or safeguarding case: contacting such a family is a staff decision. You can always send a reminder by hand from the invoice.

## 8. Finance hold (off by default)

In Billing rules you can switch on a hold on report card downloads for families with an invoice overdue for more than a set number of days. Parents then see a message asking them to contact the accounts office; staff can still download. **This is off by default. Check your regulator's rules before switching it on.**

## 9. Reports and exports

**Finance, Reports** (read only) has:

- **Billed and collected** by month (after credit notes and refunds).
- **Aging**: open balances by days past due (not yet due, 0 to 30, 31 to 60, 61 to 90, over 90 days), in total and per family.
- **By grade**: what is outstanding per grade.
- **VAT**: taxable amounts and VAT by treatment for a period, with credit note adjustments. Use it when preparing the VAT return; your accountant confirms the figures and the return period.
- **Discounts** given, including early payment discounts.
- **Cash book**: money in and out by date with the opening balance.
- **Exports**: invoices, invoice lines, payments, credit notes, an accounting journal (double entry: receivables, income by fee type, VAT, cash and bank), and every report above, as CSV or Excel. Every export is recorded in the audit log.

## 10. What parents see

Parents open **Fees** in their menu. They see the balance to pay, the next due date, open invoices with a PDF download, post-dated cheques the school is holding, a statement per child (billed, discounts, still to pay) and their receipts and credit notes. When online payment is set up, open invoices have a **Pay now** button; otherwise the page says online payment is not set up and shows the school's bank details. Parents see only the accounts they pay or that bill their own children.

## 11. Online payment

Online payment needs a payment provider set up for the platform and switched on by the school (Fee setup, Online payment). The status there says whether it is ready. Payments are confirmed by the provider's signed message to Horizon, never by the browser, and a payment is recorded once even if the provider sends the message again. In the demo, a test checkout is used: no card details are asked for and no money moves.

## 12. Admissions: seat booking

When a family accepts an offer, Horizon creates a proforma invoice for the seat booking on an applicant family account (one per application, however often the offer is accepted). The family pays it by bank transfer, cash or cheque quoting the proforma number, and the finance office records the payment on the proforma (open it from Invoices, Proformas, and choose **Record payment**). A payment that covers the proforma, together with any earlier part payment, issues the tax invoice automatically, and the application moves to "Seat booking paid" once. A part payment stays as credit on the applicant account until the rest arrives.
