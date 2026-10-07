# Horizon data protection pack

For the school's IT lead, data protection lead and board. A practical summary of how Horizon handles personal data, set against the main duties of the UAE Personal Data Protection Law (Federal Decree-Law No. 45 of 2021). It describes the product as built today; where something is not built, it says so. It is not legal advice.

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
| Account and security | Sign-in email, hashed password, last active time, audit events | Passwords stored as bcrypt hashes. Last active time is updated at most every 15 minutes and is used for the school's own usage figures. |

## 3. Purposes and lawful basis

Each school has a list of processing purposes with a lawful basis, under Admin > Compliance (for example: delivering education, student wellbeing, child protection under Wadeema's Law, health care, photos and media, AI-assisted drafting, trips). Purposes that need consent record consent per student or guardian. The school's compliance lead can add and edit purposes on screen (name in English and Arabic, description, lawful basis, data categories, whether consent is needed, and the linked retention policy). Every change is recorded in the audit log. Purposes cannot be deleted from the screen, because consent records refer to them.

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
| School API keys | Created by a school administrator with per-area scopes (read or write), shown once and stored only as a hash. A key acts with its creator's current permissions, is rate limited (120 requests a minute) and can be revoked at any time. Usage is recorded in the audit log. |
| Scheduled sync | Reads the school's export over HTTPS only, with the source credentials stored encrypted. Private and internal network addresses are refused. |
| Phone alerts | App alerts and WhatsApp messages about wellbeing, safeguarding, medical or confidential matters never carry the content: they say "New message from" the school, with a link that needs sign-in. |

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
| WhatsApp messaging | The parent's own number and an approved message template (sensitive matters as a generic line only) | Off unless the school enables it per notification type; each parent opts in with their own number and an explicit consent, which they can withdraw |
| Phone app alerts (web push) | A short alert title and link, sent to devices the person subscribed | Each person opts in per device in Settings |
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
- Requests can be logged for students, guardians and staff, with a 30-day due date by default (the school can change it).
- **Access:** under Admin > Compliance > Person data tools, the compliance lead finds the person and downloads one ZIP file: a summary in English and Arabic, the data as JSON and CSV per area, their uploaded files, and a list of what was withheld. The export is recorded in the audit log. Safeguarding content is never released through a personal data export. Wellbeing and medical content is included only for a logged access request and an exporter with access to it. Withheld sensitive records are counted under one general "Restricted records" line, so the export does not reveal that a safeguarding case exists. Identity numbers show the last four digits only.
- **Deletion (erasure):** the compliance lead previews exactly what will happen, confirms by typing the person's reference, and Horizon then deletes what can be deleted, with their stored files. Records the retention settings require the school to keep (academic record, cases, medical, consent and approval evidence, the audit log) are kept and anonymised. Safeguarding records are never deleted. The erasure is recorded in the audit log.

## 14. Leaving Horizon

- **School data export (self-serve):** under Admin > Compliance > School data export, an administrator with both compliance and school management permissions types the school code and starts a full export. It is built in the background: a CSV file per table, grouped by area, plus the stored documents. The download link works for 24 hours and every download is recorded in the audit log. Wellbeing and safeguarding records are included only when the person exporting can view safeguarding records; otherwise they are left out and counted in the export's README.
- **Deletion:** after the school confirms it has its export, Horizon deletes the school: every record, every stored file and the sign-in accounts used only at that school, after a dry run listing what will be removed. Horizon confirms in writing. Backup copies expire within [backup retention period].
