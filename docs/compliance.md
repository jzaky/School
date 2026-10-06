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
| Data subject rights | Access, correction and deletion requests tracked with due dates and recorded resolutions, linked to the student, guardian or staff member they concern | Admin > Compliance |
| Right of access | One-click export for one person: bilingual summary PDF, JSON and CSV of their records in every module, their uploaded files, and a list of anything withheld with the reason; audited | Admin > Compliance > Person data tools, `src/server/privacy/export.ts` |
| Right to erasure | Preview of what is deleted, anonymised or kept under the retention settings, two-step confirmation, stored files removed, audited | Admin > Compliance > Person data tools, `src/server/privacy/erase.ts` |
| Portability and exit | School-wide export (CSV per area plus files) built in the background, 24 hour download link; platform-level deletion of a school with a dry run and a record kept without personal data | Admin > Compliance > School data export, Platform > Schools |
| Incidents | Breach log with severity, dates and reporting status | Admin > Compliance |
| Consent | Processing purposes with lawful basis, data categories and a linked retention policy (addable and editable, audited); consent records per student and guardian | Admin > Compliance |
| Transfers | Cross-border transfers off by default; providers listed with safeguards and explicit approval | Admin > Compliance |
| Logging | Application logs never contain student personal data (ids and counts only) | CLAUDE.md rule 11 |
| Files | Private storage; downloads through signed links valid for five minutes, after an access check | `src/server/documents/storage.ts` |

## Data subject requests in practice

1. Log the request (Admin > Compliance > Log request): type, the person it concerns, who asked. It is due in 30 days by default.
2. Open the person (Person data tools). Check the requester's identity outside the system before releasing anything.
3. Access: download the export for the request. It contains:
   - `summary.pdf`: who the export is about, what the school holds per area and what was withheld, in English and Arabic.
   - `data.json` and `csv/`: every record that points at the person, one file per area.
   - `files/`: their uploaded documents, read through the storage layer.
   - `withheld.csv`: records not released and why. Safeguarding content is never released through this route (protection of the child; the Designated Safeguarding Lead decides on any disclosure). Wellbeing and medical content is released only for an access request and only when the person running the export may see it. Withheld sensitive records are counted together as "Restricted records" so the file does not reveal what kind they are.
   - Encrypted ID numbers, passwords and sign-in tokens are never included; ID numbers show the last four digits.
4. Deletion: Preview erasure shows, per area, what is deleted, anonymised or kept. Records the school must keep under its retention settings (academic record, cases, medical, consent evidence, the request register, the audit log) stay, linked to an anonymised record (name, birth date, ID numbers, contact details and photo removed). Everything else is deleted with the stored files. Confirm by typing the person's reference. If anything changed since the preview, the erasure is refused and must be previewed again. The sign-in account is anonymised unless the person uses it at another school.
5. Every export, preview and erasure writes an audit event with counts only.

## Leaving the platform

- School data export (Admin > Compliance > School data export, needs compliance and school management): type the school code to start; the worker builds a ZIP with one CSV per table grouped by area, the stored files and a README. Wellbeing and safeguarding rows are included in a separate `restricted/` folder only when the person who asked can also view safeguarding records. The download link works for 24 hours; the file is then deleted.
- Deleting a school is done by the platform operator (Platform > Schools): a dry run lists what would be removed (rows per table, files, sign-in accounts used only at that school); the operator types the school code; all rows, files and exclusive accounts are removed, and a platform record keeps only ids and counts.

## Pilot measures

Principal and School Administrator see Pilot measures on the Analytics page for any period, with a CSV download: staff active, parent accounts linked versus guardians on record, median days to issue a letter, share of requests closed within their target time, and meetings booked. Last active is recorded at most once per 15 minutes per member. Wellbeing and safeguarding requests and meetings are never counted.

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
