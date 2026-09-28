# Compliance notes (UAE)

This describes how the platform supports a UAE private school's obligations. It is a technical summary for school leaders and IT, not legal advice.

## Frameworks in scope

- Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data (PDPL).
- Federal Law No. 3 of 2016 on Child Rights (Wadeema's Law): duty to report and protect.
- Emirate regulators: KHDA (Dubai), ADEK (Abu Dhabi), SPEA (Sharjah), Ministry of Education. The regulator is set per school in School setup.
- Where the school hosts in a free zone with its own regime (for example DIFC or ADGM), the same controls apply; check local registration duties.

## Controls built into the product

| Area | Control | Where |
| --- | --- | --- |
| Tenant isolation | Postgres row-level security on every tenant table; the app connects as a non-owner role | `prisma/rls.sql`, `src/lib/tenant-db.ts`, tests in `tests/integration/tenant-isolation.test.ts` |
| Least privilege | Role-based permissions (15 system roles) checked on every page and action | `src/server/identity/permissions.ts` |
| Sensitive cases | Wellbeing and safeguarding cases pass through one access module; excluded from search, dashboards and analytics | `src/server/access/case-access.ts` |
| Safeguarding | Referrers see status only; DSL and deputy see everything; break-glass access is time-limited, reasoned and alerts the DSL | Cases and Safeguarding pages |
| Family notification | Never automatic for wellbeing or safeguarding; a staff decision with a reason is recorded | `ParentNotificationDecision` |
| Identity documents | Emirates ID and passport numbers encrypted with AES-256-GCM; only the last four digits stored in clear; every reveal audited | `src/lib/crypto.ts` |
| Audit | Append-only audit log (the app role cannot update or delete); every view of a sensitive record is logged; CSV export | Admin > Audit log |
| AI | One provider module; sensitive and medical data is never sent unless the school enables it with a recorded reason; outputs are drafts that need approval | `src/server/ai/provider.ts`, Admin > Compliance |
| Retention | Per record type policies (review, anonymize, delete) run nightly by the worker; safeguarding records are review-only | Admin > Compliance, `src/worker` |
| Data subject rights | Access, correction and deletion requests tracked with due dates and recorded resolutions | Admin > Compliance |
| Incidents | Breach log with severity, dates and reporting status | Admin > Compliance |
| Consent | Processing purposes with lawful basis; consent records per student and guardian | Admin > Compliance |
| Transfers | Cross-border transfers off by default; providers listed with safeguards and explicit approval | Admin > Compliance |
| Logging | Application logs never contain student personal data (ids and counts only) | CLAUDE.md rule 11 |
| Files | Private storage; downloads through signed links valid for five minutes, after an access check | `src/server/documents/storage.ts` |

## Data residency

The data region is recorded per school (default `me-central-1`). For production, host the database and file storage in a UAE region (for example a UAE cloud region, or Cloudflare R2 with a jurisdiction restriction where available) and keep `crossBorderAllowed` off unless each provider is approved.

## Retention defaults (demo school)

| Record | Period | Action |
| --- | --- | --- |
| Student academic record | 50 years | Review |
| Safeguarding cases | 25 years | Review only |
| Wellbeing cases | 7 years | Review |
| Academic and behavior cases | 6 years | Review |
| Medical records | 7 years | Review |
| Service requests | 3 years | Anonymize |
| Audit log | 7 years | Delete (needs the owner role) |
| AI drafts | 1 year | Delete |
| In-app notifications | 180 days | Delete |

Schools should confirm these periods with their regulator and legal advisers.

## Operational checklist before going live

1. Set `FIELD_ENCRYPTION_KEY` and keep it in a secrets manager; losing it makes encrypted IDs unreadable.
2. Use separate database roles: owner for migrations, `app_user` for the app.
3. Confirm the hosting region and list every processor under Compliance.
4. Appoint the DSL and deputy DSL in People and check the safeguarding workflow routes to them.
5. Decide whether AI drafting is enabled and whether sensitive data may be used (default: no).
6. Review retention periods and consent purposes with the school's data protection lead.
