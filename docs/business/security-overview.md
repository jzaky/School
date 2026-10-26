# Horizon security overview

**For:** the Head of IT and IT team at Al Durrah International School
**From:** Nexus AI Assurance FZCO, +971 52 377 7246, [supplier email]
**Version:** [1.0], [date]

This document describes how Horizon protects school data, based on what the code does today. Where something is not built or not yet confirmed, it says so, and section 14 lists the known gaps and the plan for each. It is information, not a contractual commitment; the contractual security measures are in Annex 2 of the Data Processing Agreement.

Horizon holds no security certification (for example ISO 27001 or SOC 2) at present, and no independent penetration test has been carried out yet.

---

## 1. Summary

**Strong today**
- Each school's data is separated inside the database by PostgreSQL row-level security, enforced against a database role the application cannot get around, and checked by an automated test suite against a real database.
- Child protection and wellbeing records go through one access module, never appear in search, dashboards or analytics, and every view is logged.
- Identity numbers and medical details are encrypted at field level.
- The audit log is append-only for the application.
- AI never receives wellbeing, safeguarding or medical data unless the school switches it on with a recorded reason.
- Files are private, and downloads use signed links that expire after five minutes.

**Not yet in place** (details in section 14)
- An independent penetration test.
- Confirmed hosting region (to be confirmed), backup schedule and a documented restore test.
- Multi-factor authentication inside Horizon (it is available through Google or Microsoft sign-in).
- Self-service password reset.
- Security headers such as a content security policy, malware scanning of uploads, and automated dependency scanning.

## 2. Architecture

```
 Browser or installed phone app (HTTPS)
        |
        v
 Web service (Next.js, Node.js)  ----- enqueues jobs ----->  Redis (job queue, rate limits)
        |                                                         |
        | database role app_user (row-level security)            v
        v                                                   Worker service (background jobs:
 PostgreSQL  <------------------- app_user ---------------  notifications, reminders, workflows,
                                                            retention, data exports, sync)
        |
 Outside services, each behind one module in the code:
   - File storage: Cloudflare R2 (S3 API), private bucket, signed links
   - Email: Resend
   - Optional: AI provider (Anthropic), WhatsApp Business Cloud API (Meta), browser push services
```

- **Hosting:** the web service, worker, PostgreSQL and Redis run on [Railway: confirm] in [hosting region, to be confirmed]. The Compliance page in Horizon shows the region the deployment is configured with, and only shows "Data stays in the UAE" when primary data really is stored in a UAE region.
- **One code base, two services:** the web service handles requests; the worker runs background jobs from the same code.
- **Environments:** [Al Durrah's school runs on: a dedicated production environment for customer schools / the same production environment as the public demonstration school]. In the second case, the demonstration school is an ordinary tenant separated by the same row-level security, and demonstration sign-in only ever works for the demonstration school.

## 3. Tenant isolation

| Control | How it works |
|---|---|
| Row-level security | Every table with a school identifier (`orgId`) has row-level security enabled, with a policy that only allows rows where `orgId` equals the school set for the current transaction. Policies are re-applied after every migration (`prisma/rls.sql`). |
| Non-owner database role | The application connects as `app_user`, which does not own the tables and is created without superuser or bypass-RLS rights, so the policies always apply to it. Migrations use a separate owner connection. |
| Scoped client | Request code gets its database access only through `tenantDb(orgId)` (`src/lib/tenant-db.ts`). Every query runs inside a transaction that first sets the school identifier, and every insert is stamped with it. An insert or upsert naming a different school is refused with a "cross-tenant write blocked" error. |
| Shared reference data | The shared university catalogue uses rows with no school identifier; every school can read them, but the application role can only add, change or remove its own school's rows. |
| Testing | An automated isolation suite runs against a real PostgreSQL database and checks that one school cannot read, insert into, update or delete another school's students, cases, requests, documents or appointments. |

**Documented exceptions.** A few operations happen before a school is known, or are platform-wide, and use the owner connection in narrow, reviewed functions: school sign-up, looking up an invitation or join code, looking up a school API key by its hash, school group administration, deleting a school at the end of a contract, and publishing to the shared university catalogue. The person account table (name, email, password hash) is global, because one person can belong to more than one school; it holds no school records and is reached only through these narrow paths and the sign-in code.

## 4. Sign-in and sessions

| Control | How it works |
|---|---|
| Methods | Email and password; Google; Microsoft Entra ID. Google and Microsoft appear only when configured on the server. |
| Who can sign in with Google or Microsoft | Only people the school has invited or imported, or someone completing a join link or join code. Anyone else is refused. |
| Account linking | A Google or Microsoft sign-in is linked to the existing Horizon account with the same email address. See section 14. |
| Passwords | Stored as bcrypt hashes. School sign-up requires at least 10 characters with a letter and a digit and blocks common passwords; joining by invitation or code requires at least 8 characters. |
| Brute force | Password attempts are limited per email address (10) and per network address (50) in 15 minutes; join code lookups, join submissions and invitation use are also limited. Limits are held in Redis, so they apply across servers. |
| No account enumeration | Sign-in, sign-up and joining show one generic error for every credential problem. |
| Sessions | Encrypted session tokens in a cookie, valid for 12 hours. |
| Suspension | Every request reloads the person's membership and permissions. A suspended person loses access at their next page load. |
| Pending people | Someone who has joined but is not yet approved has a session that grants nothing until a school administrator approves them. |
| Demonstration sign-in | One-click persona sign-in works only when the server runs in demonstration mode, and only into a school flagged as the demonstration school. |

## 5. Authorisation

| Control | How it works |
|---|---|
| Roles | 14 built-in roles: school administrator, principal, registrar, head of department, teacher, counselor, career advisor, wellbeing lead, Designated Safeguarding Lead, deputy DSL, nurse, IT support, student and parent. Schools can copy, rename and create roles. |
| Server-side checks | Every page, action and API call checks permissions on the server. Permissions are read from the database on each request, so changes take effect on the next click. |
| Sensitive permissions | Granting safeguarding, wellbeing cases, medical, identity number reveal, audit log or role management permissions requires typing the role name to confirm. |
| Guardrails | At least one active person must keep role management; nobody can remove it from themselves; the last school administrator cannot be suspended or demoted; only people with school management can grant administrator access. |
| Access check | A screen shows exactly what any person can see and which role grants it. |
| Families | Parents see only their linked children; students see only themselves. Family roles cannot be given staff permissions, and staff roles cannot be given family portal permissions. |
| Joining | Parents add a child with the student number and date of birth (or grade and full name). Wrong details reveal nothing; five wrong attempts in an hour lock claims for that school. By default, links wait for school approval. |
| Staff default visibility | Every staff role can look up the student directory and open standard (non-sensitive) documents. Medical details, identity numbers, wellbeing and safeguarding records and absence reasons need extra permissions. See section 14 for class-level scoping. |

## 6. Sensitive records

Horizon labels records as standard, confidential, medical, wellbeing or safeguarding.

| Rule | How it works |
|---|---|
| One access module | Every decision about cases goes through `src/server/access/case-access.ts`. |
| Safeguarding access | Full access: holders of the safeguarding view permission (the DSL and deputy by default), the assigned owner, and staff with an explicit, revocable, optionally time-limited access grant. A member of staff who raises a concern sees its status only. |
| Emergency access | Other staff with the emergency access permission (for example the principal) can open a safeguarding case only by giving a written reason. Access is time-limited and alerts the DSL. |
| Wellbeing access | The assignee, the case team, holders of the wellbeing permission (by default the wellbeing lead, counselors, the DSL and deputy, and the principal), and explicit grants. |
| Excluded surfaces | Search and analytics never include wellbeing or safeguarding cases. Dashboards and work lists show wellbeing cases only to people working on them, and never safeguarding cases. School group dashboards include no case figures at all. Family and student portals show only what staff choose to share. |
| Audit of every view | Opening a safeguarding, wellbeing or confidential case writes an audit event, with the reason when access came through a grant or emergency access. |
| Immutable history | The application role cannot delete case notes or change their earlier versions, and cannot change or delete emergency access records, family notification decisions or external referrals. |
| Families never told automatically | Informing a family about a wellbeing or safeguarding matter is a recorded staff decision with a reason. |
| Absence reasons | Reasons and doctor's notes for absences are visible to the family, holders of the attendance reasons permission (by default the school administrator, the registrar as attendance office, and the nurse) and holders of the medical permission. The principal sees that a student is excused, not why, unless the school grants the permission. Teachers see "Excused absence, reported by parent". |
| Documents | Safeguarding documents need the safeguarding view permission; wellbeing, medical and confidential documents need the matching permissions. |
| Exports | A personal data export never releases safeguarding content, and counts withheld sensitive records under a single "Restricted records" line. Only the DSL can export a safeguarding chronology. The school exit export includes safeguarding rows only when the person exporting can view them. |
| Inspection evidence | The inspection pack shows counts only. Case references are listed only to people with full case access and each listing is audited; references never go into downloads. |

## 7. Encryption

| Data | Protection |
|---|---|
| In transit | The service is served over HTTPS [confirm TLS versions and certificate management on the hosting provider]. Calls to outside services use HTTPS. |
| Identity numbers | Emirates ID and passport numbers are encrypted with AES-256-GCM (`src/lib/crypto.ts`), with a random nonce per value. Only the last four digits are stored in clear for display. Revealing a full number needs a permission and is audited. |
| Medical details | Allergies, conditions and medications are encrypted with the same method. |
| Integration secrets | Credentials the school stores for scheduled sync are encrypted the same way and never sent back to the browser. |
| Encryption key | One 32-byte key held in the server environment, not in the database or the code. |
| Hashes | Passwords (bcrypt), school API keys (SHA-256), invitation and email verification tokens, and group invitation codes are stored only as hashes. |
| At rest | Disk-level encryption is provided by the database host and the file storage provider: [confirm for each provider]. |
| Not field-encrypted | Case notes (including wellbeing and safeguarding notes), request messages and form answers are protected by row-level security, the access module and the provider's at-rest encryption, but are not encrypted at field level. See section 14. |

## 8. Files

| Control | How it works |
|---|---|
| Storage | Cloudflare R2 (S3 API), private bucket, one folder per school. Files are never public. |
| Downloads | Every download passes a permission check, then gets a signed link that expires after five minutes. Opening request attachments (for example a doctor's note) is audited, including refusals. |
| Uploads | Up to 10 MB, limited to PDF, PNG, JPEG, WebP, Word and CSV by the type the browser declares. |
| Fallback | Without R2, files are written to the web server's disk, which is not suitable for production. [Confirm R2 is configured for Al Durrah's environment.] |

## 9. Audit and logging

| Control | How it works |
|---|---|
| Audit log | Append-only: the application role cannot update or delete audit events. It records, among other things: every view of a sensitive case, identity number reveals, student record views, role and permission changes, invitations and joining, imports, document downloads, exports (audit log, person data, school data, inspection pack, career report), data subject request actions, AI and compliance setting changes, API key creation, use (hourly) and revocation, and emergency access. |
| Access to the log | Holders of the audit permission can filter it and export it as CSV; the export is itself logged. |
| Retention | 7 years by default. Deletion needs the database owner role, so the application cannot remove audit history. |
| Application logs | Contain identifiers and counts only, never student personal data. |
| Sign-in events | Successful and failed sign-ins are not written to the school's audit log today. See section 14. |

## 10. AI

| Control | How it works |
|---|---|
| One module | All AI calls go through `src/server/ai/provider.ts`. Every call is recorded (feature, who, when, whether it was sensitive, the provider, and whether it was blocked). |
| Sensitive data | If a task involves wellbeing, safeguarding or medical information and the school has not switched on sensitive AI processing, the call is blocked and the block is recorded. Switching it on requires a written reason and is audited. Default: off. |
| School switch | AI can be switched off entirely. Default: on for non-sensitive drafting. Without an AI provider key on the server, a built-in drafter produces drafts from the same facts with no network call. |
| Drafts only | AI output is always a draft that a person reviews, edits and accepts or discards. |
| No AI eligibility decisions | University programme eligibility is calculated by rules from official requirement data, never by AI. |
| What is sent | Only the facts the task needs. Some features send no names at all (for example the course plan summary); a pre-meeting brief on a standard academic case can include the student's name, grade and recent notes. |
| Provider terms | [Confirm the AI provider's data retention period and its commitment not to train on API data, and record them in Annex 3 of the Data Processing Agreement.] |

## 11. Notifications and messaging

- Request message notifications never include the message text.
- Phone alerts and WhatsApp messages about confidential, medical, wellbeing or safeguarding matters, and about case-related events, carry only "New message from [school]" and a link that needs sign-in.
- Web push payloads are encrypted end to end (RFC 8291), so the browser's push service cannot read them.
- WhatsApp is offered only when configured, only for message types the school enables, and only to parents who opt in with their own number and explicit consent, stored with time and version.
- Every outbound message has an idempotency key and is claimed before sending, so it is sent at most once. Addresses on reserved test domains are never sent.

## 12. Integrations

| Control | How it works |
|---|---|
| School API keys | Created by a school administrator with per-area scopes (none, read, or read and write for students and guardians, staff, classes and enrolments, attendance). Shown once, stored as a hash, revocable at once. A key acts with the current permissions of the administrator who created it, so it stops working if that person is suspended or loses the integrations permission. 120 requests a minute per key. |
| Errors | API errors give an item position, a field and a code, never the values sent, so they are safe to log. |
| Scheduled sync | Fetches the school's export over HTTPS only. Every resolved address is checked at connection time, and private, loopback, link-local and cloud metadata addresses are refused. Redirects are not followed; files are limited to 8 MB. Each run is keyed by source and time slot, so retries never import twice. Administrators are notified after three failures in a row. |
| Same rules as imports | API and sync use the same validation and matching as the Import center, and never remove a person's access. |

## 13. Operations

| Area | Current position |
|---|---|
| Backups | [Database backup frequency, retention and location: confirm on the hosting provider.] [File storage protection: versioning or a second copy, or none yet.] |
| Restore testing | [Date of the last restore test, or "not yet tested".] |
| Recovery targets | Recovery point objective [RPO]; recovery time objective [RTO]. |
| Availability monitoring | A public status page checks the web service, database, Redis and worker every 5 minutes and shows 90 days of history. A period with no recorded check counts as down. Every morning an automated job signs in as each demonstration persona and opens every page in English and Arabic on desktop and phone. |
| Background jobs | Idempotent, with an idempotency key on every side effect. The worker finishes active jobs before a restart. |
| Retention | A nightly job applies each school's retention policies and records a summary in the audit log. Automatic deletion only applies where a policy says delete; safeguarding records are review-only. |
| Secrets | Held in the hosting provider's environment settings, never committed to the code repository. |
| Secure development | TypeScript with type checking and lint; unit, integration and end-to-end tests, including the tenant isolation suite and safeguarding access tests; a check that every screen works in English and Arabic. Code borrowed from open-source projects is limited to permissive licences and logged. |
| Supplier access | Supplier staff have no access inside a school's Horizon unless the school invites them, and then act as a normal, audited user. The people who can reach the production database directly with the owner role are: [names]. Direct access is used only to operate the service, investigate incidents or act on a school's written request. |
| Incidents | Handled as Priority 1 under the Service Level Agreement; personal data breaches are notified to the school within 72 hours at most (Data Processing Agreement clause 8). Schools record breaches in the Compliance breach log. |
| School exit | Schools can export all their data at any time. At the end of a contract, the school's records, files and school-only accounts are deleted after a dry run, and a platform record keeps only identifiers and counts. |

## 14. Known gaps and roadmap

| # | Gap | Effect | Plan | Target |
|---|---|---|---|---|
| 1 | No independent penetration test has been done yet | Security relies on internal design and testing | Commission an independent test of the web application, API and tenant isolation; share the summary and remediation status with the school | [date, before Phase 2 go-live] |
| 2 | Hosting region to be confirmed | Data may be stored outside the UAE, which needs transfer safeguards and may affect health data | Confirm the region and record it in the Data Processing Agreement; [decide whether to move the database and files to a UAE region] | [date] |
| 3 | Backups, file storage protection and restore tests not yet documented | Unclear recovery capability | Confirm database backups are on, set retention, protect stored files, run and document a restore test every term | [date, before Phase 1 go-live] |
| 4 | No multi-factor authentication inside Horizon | Password accounts rely on the password alone | Require Google or Microsoft sign-in with the school's multi-factor authentication for staff with sensitive permissions; add one-time-code MFA in Horizon for password accounts | [date] |
| 5 | No self-service password reset | People who forget their password are stuck | Build an email reset with a single-use, time-limited link | [date, before Phase 2] |
| 6 | Google and Microsoft sign-in link accounts by email address; the Microsoft setting is the same for every school on a server | Relies on the identity provider verifying emails | Restrict Microsoft sign-in to verified school tenants, and check that each linked account belongs to the school's domain | [date] |
| 7 | No ClassLink sign-in | Students and staff on ClassLink need another method | See the Implementation Plan, section 6 | [date, if chosen] |
| 8 | Teachers can look up the whole-school student directory | Wider visibility than some schools want | Add an option to limit teachers to the students they teach | [date] |
| 9 | Case notes and messages are not encrypted at field level | A database-level compromise would expose them | Evaluate field-level encryption for safeguarding and wellbeing notes | [date] |
| 10 | One field encryption key with no rotation process | Key compromise affects all encrypted fields | Add key versioning and rotation (the stored format already carries a version marker) | [date] |
| 11 | Security headers (content security policy, strict transport security, frame restrictions) are not set by the application | Weaker browser-side defences | Add and test the headers | [date] |
| 12 | Uploads are checked by declared type only; no malware scanning | A harmful file could be stored and downloaded by staff | Check file content and scan uploads | [date] |
| 13 | No automated dependency vulnerability scanning, and tests do not run automatically on every change | Known vulnerabilities in libraries could be missed | Add dependency scanning and run the test suite on every change | [date] |
| 14 | Sign-in successes and failures are not in the school's audit log | Harder to investigate account misuse | Record sign-in events and repeated failures | [date] |
| 15 | No independent external uptime monitor with alerts; no central error monitoring | Outages and errors found later than they could be | Add an external monitor with alerts to the support team, and error monitoring that never records personal data | [date] |
| 16 | Direct database access by Supplier staff is not separately logged | The school relies on the Supplier's procedure | Named individuals only (section 13); add a logged access procedure | [date] |
| 17 | The public demonstration school [shares the production environment with customer schools] | Larger public surface on the same environment | [Move customer schools to a dedicated environment without demonstration mode] | [date] |
| 18 | The cross-border transfer switch on the Compliance page records the school's decision but does not by itself block a provider | The decision depends on the provider configuration matching it | Providers for each school are approved in writing (Data Processing Agreement Annex 4); link the switch to the optional providers | [date] |
| 19 | Rate limits fall back to memory on each server if Redis is unavailable | Limits are weaker during a Redis outage | Alert on Redis outages | [date] |
| 20 | A notification can be lost (never duplicated) if the worker stops at the exact moment of sending | Rare missed email | The sweeper resends queued messages; monitor failed deliveries | Ongoing |
| 21 | The source code repository is [public / private] | [If public: the code is visible to anyone; security does not rely on the code being secret] | [Decide whether to keep it public] | [date] |
| 22 | No security certification | The school relies on this document, questionnaires and tests | [Decide whether and when to pursue a certification] | [date] |

## 15. What the school controls

| Area | School's responsibility |
|---|---|
| People | Who is invited, their roles, removing leavers, reviewing sensitive permissions each term |
| Sign-in | Choosing Google, Microsoft or ClassLink and enforcing multi-factor authentication there |
| Settings | AI on or off, sensitive AI, WhatsApp, identity document policy, retention periods, processors approved |
| Data | Accuracy of imports, what form fields collect, what is uploaded |
| Devices | Supported, updated browsers; screen locks on shared devices |
| Incidents | Reporting suspected misuse quickly; deciding on notifications to the Data Office and families |

## 16. Contacts

- Security and incidents: [name], [email], +971 52 377 7246
- Data protection: [name], [email]
