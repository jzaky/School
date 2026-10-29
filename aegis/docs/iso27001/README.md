# ISO/IEC 27001 readiness pack

Drafts that let Nexus AI Assurance reach ISO/IEC 27001 certification for AEGIS with only the
certification audit left to pay for. Everything here is a draft until the founder approves it and the
company starts keeping the records it describes. Nothing here is a certificate or a claim of
compliance.

| File | What it is |
|---|---|
| `ISMS_SCOPE.md` | What the management system covers, who is responsible, interested parties |
| `INFORMATION_SECURITY_POLICY.md` | The top-level policy for management to sign |
| `RISK_METHOD_AND_REGISTER.md` | How risks are scored and the first risk register |
| `STATEMENT_OF_APPLICABILITY.md` | All 93 Annex A controls: applicable, status, evidence or next step |
| `TOPIC_POLICIES.md` | Short topic policies: access, acceptable use, suppliers, incidents, continuity, remote work, people |
| `RECORDS_CHECKLIST.md` | The records an auditor will ask for, and when to start keeping each |

## Where the company stands

The product side is strong: most technological controls are in place, with evidence in the
repository and in CI. The gaps are company processes that need a person and time: signed policies,
access reviews, supplier records, staff onboarding, an incident exercise, an internal audit and a
management review. See the summary in `STATEMENT_OF_APPLICABILITY.md`.

## Path to certification

1. **Approve.** Founder reviews and signs the policy, scope and risk register. (Week 1)
2. **Operate.** Keep the records in `RECORDS_CHECKLIST.md` for at least two to three months, so the
   auditor can see the system working, not only written down.
3. **Close the "To do" items** in the Statement of Applicability. Most are short company actions.
4. **Independent test.** Commission the penetration test (`../PENTEST_RFQ.md`) and fix findings.
5. **Internal audit and management review.** One of each, recorded, before booking the audit.
6. **Certification audit.** An accredited certification body runs Stage 1 (documents) and Stage 2
   (operation). Choose a body accredited for ISO/IEC 27001 that is recognised by the customers you
   sell to.

Steps 1 to 3 cost nothing but time. Steps 4 and 6 are the paid items; they can wait for the first
paid pilot, but step 2 cannot, because the auditor needs to see records over time.

## Keeping this pack honest

- Status values in the Statement of Applicability must match reality. When a control moves to
  "In place", add the evidence reference in the same change.
- Do not describe AEGIS or the company as ISO 27001 certified or compliant until a certificate is
  issued. "Aligned with" or "preparing for" is the accurate wording until then.
