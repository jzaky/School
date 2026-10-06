# Horizon data protection pack

For the school's IT lead, data protection lead and board. A practical summary of how Horizon handles personal data, set against the main duties of the UAE Personal Data Protection Law (Federal Decree-Law No. 45 of 2021). It describes the product as built today; anything not yet built is marked **planned**. It is not legal advice.

**Vendor:** Nexus AI Assurance FZCO, +971 52 377 7246, [email]  
**Hosting region:** [hosting region]

## 1. Roles

The school is the controller. Nexus AI Assurance FZCO is the processor and acts only on the school's instructions, set out in the [data processing agreement].

## 2. What data is processed

| Category | Examples | Notes |
|---|---|---|
| Identity and contact | Names in English and Arabic, student number, grade, date of birth, guardian email and phone | From the school's import or entered by staff |
| Identity documents | Emirates ID and passport numbers | Optional per school (off, optional or required). Encrypted at field level. |
| School operations | Requests, forms, approvals, letters, meetings, documents | Created by use of the services |
| Academic | Classes, grades, report cards, course plans | Only if the school switches those modules on |
| Wellbeing and safeguarding | Cases, notes, referrals, chronology | Special handling, see section 6 |
| Account and security | Sign-in email, hashed password, audit events | Passwords stored as bcrypt hashes |

## 3. Purposes and lawful basis

Each school has a list of processing purposes with a lawful basis, under Admin > Compliance (for example: delivering education, student wellbeing, child protection under Wadeema's Law, health care, photos and media, AI-assisted drafting, trips). Purposes that need consent record consent per student or guardian. Editing the purpose list from the screen is **planned**; today the defaults are installed and can be changed by Horizon on request.

## 4. Security controls

| Control | How it works |
|---|---|
| Tenant isolation | Every school table carries the school's id and is protected by Postgres row level security. The application connects as a separate non-owner database role, so it cannot bypass these rules. An automated isolation test suite checks that one school can never read another's rows. |
| Encryption at field level | Emirates ID and passport numbers are encrypted with AES-256-GCM. Only the last four digits are kept in clear for display. Each reveal of a full number is permission-checked and recorded in the audit log. |
| Encryption in transit | The application is served over HTTPS. Files are downloaded through signed HTTPS links that expire after five minutes. |
| Encryption at rest | Provided by the database host and the file storage provider: [confirm at-rest encryption for each provider]. |
| Files | Stored privately in a folder per school. Never public. Every download passes an access check first. |
| Sign-in | Email and password, or the school's existing work accounts (single sign-on) when the school enables it. Sessions expire after 12 hours. Sign-in attempts are rate limited. |
| Logging | Application logs never contain student personal data (ids and counts only). |

## 5. Access control and roles

- 14 built-in roles (administrator, principal, registrar, head of department, teacher, counselor, career advisor, wellbeing lead, Designated Safeguarding Lead and deputy, nurse, IT support, student and parent). The school can copy, rename and create roles.
- Every page and action checks permissions on the server. Role changes apply on the person's next click.
- Granting a sensitive permission (safeguarding, wellbeing cases, medical, identity numbers, audit log, role management) requires typing the role name to confirm.
- "Access check" shows exactly what any person can see and which role grants it.
- Parents see only their own children. Wrong details when joining reveal nothing, and repeated wrong attempts are locked out.

## 6. Wellbeing and safeguarding cases

- All access goes through one access module. These records never appear in global search, dashboards, analytics or parent and student portals unless that module allows it.
- Staff who raise a safeguarding concern see only its status. The DSL and deputy see the full record.
- Emergency (break-glass) access is time-limited, needs a reason and alerts the DSL.
- Every view of a sensitive record writes an audit event.
- Families are never notified automatically about wellbeing or safeguarding cases. Informing a family is a recorded staff decision with a reason.

## 7. Audit log

Append-only: the application's database role cannot change or delete audit events. It records who did what and when, including every view of a sensitive record and every identity number reveal. Authorised staff can filter and export it as CSV; the export itself is logged.

## 8. Retention

Retention periods are set per record type under Admin > Compliance, and the nightly background job applies them (review, anonymise or delete). Safeguarding records are review-only and are never deleted automatically. Defaults, which the school should confirm with its regulator:

| Record | Default period | Action |
|---|---|---|
| Student academic record | 50 years | Review |
| Safeguarding cases | 25 years | Review only |
| Wellbeing and medical | 7 years | Review |
| Academic and behaviour cases | 6 years | Review |
| Service requests | 3 years | Anonymise |
| Audit log | 7 years | Delete |
| AI drafts | 1 year | Delete |
| In-app notifications | 180 days | Delete |

## 9. Processors and switches

Each processor is listed under Admin > Compliance as "not approved" in a new school, so the school reviews it. Cross-border transfers are off by default.

| Processor role | What it receives | Switch |
|---|---|---|
| Cloud hosting (application, database, background jobs) | All school data | Required. Region: [hosting region] |
| File storage | Uploaded and generated documents | Required. [storage location] |
| Email delivery | Recipient email, notification subject and text | Without it, emails are not sent (in-app only) |
| AI model provider | Only the facts a drafting task needs (see section 10) | AI can be switched off for the school entirely |

Named providers, locations and contract terms: [processor list with locations, supplied with the data processing agreement].

## 10. AI rules

- All AI calls go through one provider module. Every call is recorded.
- Wellbeing, safeguarding and medical data is never sent unless the school turns on sensitive AI processing, which requires a recorded reason and is audited. Default: off. Blocked calls are recorded as blocked.
- AI output is always a draft. A person reviews it and accepts or discards it before anything is shared.
- AI can be switched off for the whole school. Without an AI provider key, a built-in drafter works offline from the same facts.
- Eligibility for university programmes is decided by rules, never by AI.

## 11. Backups

[Backup schedule, retention period and restore test frequency to confirm.] Backups are kept in [hosting region].

## 12. Incidents

- The compliance area has a breach log with severity, dates, number affected and reporting status (regulator and data subjects).
- Horizon will notify the school of a personal data breach affecting its data within [hours] of becoming aware, with what is known, and support the school's own notification duties.
- Incident contact: [name], +971 52 377 7246, [email].

## 13. Data subject requests

- Access, correction and deletion requests are logged in Admin > Compliance with a due date, status and recorded resolution.
- **Correction:** staff correct records directly in the app (people, students, guardians); re-importing a corrected file updates rather than duplicates.
- **Access:** documents can be downloaded, and the DSL can export a case chronology. A one-click export of everything held about one person is **planned**; until then Horizon prepares it on request within [days].
- **Deletion:** handled through the retention rules or on request by Horizon within [days]. A self-serve deletion button is **planned**.

## 14. Leaving Horizon

On exit the school receives an export of its records (CSV) and documents (files) within [days]. Horizon then deletes the school's records and files and confirms in writing. Backup copies expire within [backup retention period].
