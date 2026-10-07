# Onboarding a school: the playbook

How to take a school from "yes, let's pilot" to families using Horizon, with as little of your time as possible.
Two ways to do it: the school does it itself (self-serve), or you run a 90-minute setup call with them (guided).
Both use the same screens, so you can mix them.

## 0. One-time setup on your side (Railway)

Do these once, before the first real school:

| Variable (web service unless noted) | Why |
|---|---|
| `RESEND_API_KEY`, `EMAIL_FROM` (web and worker) | Real emails: invitations, email confirmation, notifications. Without them emails only go to the server log. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | "Continue with Google" (steps in section 7). |
| `AUTH_MICROSOFT_ENTRA_ID_ID`, `_SECRET`, `_ISSUER` | "Continue with Microsoft" for schools on Microsoft 365. |
| `ANTHROPIC_API_KEY` (web and worker) | Real AI drafts (briefs, plans, requirement extraction). Without it the offline fallback is used. |
| `COLLEGE_SCORECARD_API_KEY` (web and worker) | US university data import. |
| `PLATFORM_ADMIN_EMAILS` | Your own email: lets you publish reviewed requirement data to the shared university catalog. |
| `SIGNUP_ENABLED` | `true` (default) shows "Start free pilot". Set `false` to invite-only. |

Also: turn on Postgres backups in Railway, and add a custom domain when you have one (then update `AUTH_URL`, `APP_URL` and the Google/Microsoft redirect URLs).

## 1. Before the setup call: send the school a data request

Send this list about a week before. Every template is downloadable from **School admin > Import center** (English and Arabic headers, two example rows each).

1. **School details**: official name in English and Arabic, short name, emirate, regulator (KHDA, ADEK, SPEA or MoE), curricula taught, school days, time zone.
2. **Logo**: PNG or SVG, transparent background, at least 512 pixels wide. **Brand colors**: two hex codes (main and accent).
3. **Staff list** (staff template): name in English (Arabic optional), work email, roles (teacher, counselor, registrar, principal, and so on; several allowed), department, job title, subjects taught, grades taught (for example 9-12).
4. **Students and guardians** (student template): student number, names in English and Arabic, grade, section, date of birth, and for each guardian: name, email, phone, relationship.
5. **Classes and enrollments** (classes template): class code, name, subject, grade, section, teacher email, room, capacity, homeroom yes or no; and which students are in each class (enrollments template: class code plus student number, or a student numbers column in the classes file).
   Optional: **subject choices** (one column per option subject) for schools that run option blocks.
6. **Calendar**: first and last day of each term, holidays, exam weeks. (UAE public holidays are pre-filled; Islamic dates are estimates to confirm.)
7. **Bell schedule**: period start and end times (a standard UAE schedule is pre-filled).
8. **Letters**: wording and signatory for the official letters they issue (enrollment, good conduct, fee, transfer). The defaults can be used as they are.
9. **Safeguarding**: who is the Designated Safeguarding Lead and deputy.
10. **Launch services**: the five procedures to go live with first (suggested: school documents, absence requests, parent meetings, teacher referrals, safeguarding concerns).

Most schools export items 3 to 5 from their current student information system as CSV or Excel. Horizon reads either, and can keep reading them on a schedule (section 8).

## 2. Path A: the school sets itself up (self-serve)

1. The school's administrator goes to **/signup** ("Start free pilot" on the home page) and enters the school name in English and Arabic, emirate, curricula, their name, work email and a password (or continues with Google or Microsoft).
2. Horizon creates a complete, working school straight away: all roles, the service catalog with its forms and approval routes, bilingual letter templates, message templates, grade bands, the bell schedule, the current academic year with terms and UAE holidays, departments, subjects and the course catalog for their curricula. Nothing is empty.
3. They confirm their email (a link is sent). Until then, invitations and the family join code stay locked, so nobody can invite people into a school that has not proven its email.
4. The **setup wizard** (/setup) opens. It has seven steps, each can be skipped and finished later:
   - **Profile**: names, logo upload, brand colors (the whole app changes color live), language, school days, time zone, regulator, Hijri dates.
   - **Year**: term dates, holidays, bell schedule.
   - **Curricula**: which tracks the school teaches; the course catalog is filled from the global catalog.
   - **Modules**: switch modules on or off (core ones such as requests, safeguarding and documents always stay on).
   - **People**: the Import center, in order: staff, then students with guardians, then classes and enrollments.
   - **Invite**: invite staff, print the family join poster, choose how people sign in.
   - **Done**: a summary checklist.
5. Until setup is finished, the administrator's home page shows a "Finish setting up" card with progress.

## 3. Path B: you run a guided setup call (90 minutes)

Best for the pilot school. Share your screen, but let the school's administrator drive where possible so they learn it.

| Time | What | Where |
|---|---|---|
| 0 to 10 | The school's administrator signs up with their own work email (so they own the school and receive the confirmation), confirms the email. Add yourself as an administrator from **Roles and access** if you want to help later, and remove yourself at the end of the pilot. | /signup |
| 10 to 25 | Profile: logo, colors, names, days. Year: terms and holidays. | /setup |
| 25 to 50 | Import center: staff file, then students and guardians, then classes. Fix the rows the preview flags (unknown teacher emails, missing student numbers) and re-import; imports never create duplicates. | School admin > Import center |
| 50 to 65 | With the principal: **Roles and access**. Walk through each role in plain words, assign the DSL and deputy, the registrar, heads of department. Use **Access check** on one teacher to show what they can see. | School admin > Roles and access |
| 65 to 80 | Services: open the five launch services, adjust forms and approval routes, preview the letters with the school's logo. | School admin > Services, Forms, Workflows, Document templates |
| 80 to 90 | Invitations: send staff invitations (by email, or a join link for the staff room), turn on Google or Microsoft sign-in if they use it, print the family join poster with the QR code. | School admin > Invitations |

After the call: the school sends the staff invitations and the family letter or poster when they are ready to go live.

## 4. How people get in

- **Staff**: an email invitation (single, or bulk from the staff file), or a staff join link (with a role, a maximum number of uses and an expiry), or automatically by email domain (for example everyone @school.ae joins as a teacher, pending approval or auto-approved).
- **Parents**: either an email invitation linked to their children, or the **family join code** (for example HRZ-2026) on a printed poster or letter with a QR code. The parent enters the code, creates an account, then adds each child with the student number and date of birth. If the details match, the child is linked; if the school requires approval (the default), the request waits in **Join requests**. Wrong details never reveal anything, and repeated wrong attempts are locked out.
- **Students**: invited by email (student self-join is off by default).
- **Sign-in**: email and password always; Google and Microsoft when the school turns them on and the keys are set.

## 5. What makes it light to run

- New schools get a complete working configuration automatically; you do not build anything per school.
- The school's own administrators change everything: names, logo, colors, services, forms, approval routes, letters, notification texts, subjects, departments, roles, modules, calendar.
- Imports are idempotent: re-running a file updates rather than duplicates. A staff re-import adds roles and subjects but never removes them, so a file can never lock anyone out. Every import shows a preview with row-level errors before anything is saved, and is kept in the import history.
- Letters, report cards, exam timetables and the join poster carry the school's own logo, name, address and seal automatically.
- The university requirements catalog is shared by all schools and refreshes itself weekly from official pages; changes wait in a review queue.
- A GitHub job checks the live site every morning at 06:45 Dubai time for every role, in both languages, on desktop and phone.
- Deploys only happen when app code changes.

## 6. Go-live checklist

- [ ] Email confirmed, logo and colors set, year and holidays checked.
- [ ] Staff imported and invited; DSL and deputy assigned; registrar and heads of department assigned.
- [ ] Students and guardians imported; classes and enrollments imported.
- [ ] Five launch services reviewed; letter templates previewed with the logo.
- [ ] Sign-in method chosen (password, Google or Microsoft).
- [ ] Family join code poster printed or letter sent; join approval setting chosen.
- [ ] Success measures agreed (for example days to issue a letter, share of requests closed on time).

## 7. Connecting Google sign-in

1. Go to https://console.cloud.google.com and create a project (for example "Horizon").
2. Open **Google Auth Platform** (older screens: APIs and Services > OAuth consent screen) and press **Get started**: app name "Horizon School OS", your support email, audience **External**, your contact email. Create.
3. Under **Audience**, press **Publish app**. Horizon only asks for name and email, so Google does not need to review it.
4. Under **Clients**, **Create client**: type **Web application**, name "Horizon web".
   - Authorized JavaScript origins: `https://myhorizon.up.railway.app`
   - Authorized redirect URIs: `https://myhorizon.up.railway.app/api/auth/callback/google`
5. Copy the Client ID and Client secret into Railway (web service) as `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. Check `AUTH_URL` is `https://myhorizon.up.railway.app`. Railway redeploys.
6. The login, sign-up and join pages now show **Continue with Google**. A Google account only gets into a school if that email was invited or imported, or if it is signing up or joining with a link or code.

**Microsoft** (schools on Microsoft 365): in https://entra.microsoft.com go to App registrations > New registration, name "Horizon", supported accounts "Accounts in any organizational directory and personal Microsoft accounts", redirect URI (Web) `https://myhorizon.up.railway.app/api/auth/callback/microsoft-entra-id`. Then Certificates and secrets > New client secret. Set `AUTH_MICROSOFT_ENTRA_ID_ID` (Application (client) ID), `AUTH_MICROSOFT_ENTRA_ID_SECRET` (the secret value) and `AUTH_MICROSOFT_ENTRA_ID_ISSUER` (`https://login.microsoftonline.com/common/v2.0`).

## 8. Integrations: connecting the school's student information system

The answer to "do you connect to our student information system?" is yes, in two ways, both under **Administration > Integrations** (school administrators; permission `integrations.manage`). Both run the very same checks and matching as the Import center, so a record sent by the system behaves exactly like a row in an uploaded file, and repeating a send never creates duplicates.

### API keys and the REST API
- **Create a key** on the API keys tab: give it a name and choose, per area, no access, read only, or read and write: students and guardians, staff, classes and enrollments, attendance. The key (`hzk_...`) is shown **once**; only a SHA-256 fingerprint is stored. Revoke it at any time; it stops working at once.
- A key acts with the access of the administrator who created it, limited to its areas. If that person is suspended or loses `integrations.manage`, their keys stop working; create a new one.
- Every key is limited to 120 requests a minute (HTTP 429 with `Retry-After` above that). Creation and revocation are in the audit log; use is audited once an hour per key with the number of requests, not once per request.
- Endpoints (base `https://<site>/api/v1`, header `Authorization: Bearer hzk_...`): `GET` and `POST` on `/students`, `/staff`, `/classes`, `/enrollments`, `/attendance`. `POST` takes a batch (`{"students": [...]}`), matching students on student number, staff and guardians on email, classes on class code, attendance on student number and date. Field names are the Import center column keys (for example `student_no`, `first_name_en`, `grade`, `email`, `roles`, `class_code`); a student's guardians go in a `guardians` array. `GET` returns one page and a `next_cursor`.
- Errors are JSON with an item position, a field and a code. They never repeat the values that were sent, so they are safe for the school's system to log.
- The OpenAPI 3 document is at `/api/v1/openapi.json`; the API guide tab shows the same with copyable examples. API batches appear in the Import center history (file name `API hzk_...`).

### Scheduled sync from an export file
- On the Scheduled sync tab, **Add sync source**: a name, what the file holds (staff, students and guardians, classes, enrollments), the HTTPS address of the export, and how to sign in to it (none, user name and password, or a token; stored encrypted with `FIELD_ENCRYPTION_KEY` and never shown again), then once a day at a chosen hour (school time) or every hour.
- Files in the Import center template format need no setup. For the system's own layout, press **Read headers**: each header shows the column Horizon would read it as, and you choose another column or "Ignore". The form says which required columns are still missing.
- The worker checks every 5 minutes and runs each source once per hourly or daily slot (the source and slot are the idempotency key, so restarts and retries never import twice). **Run now** runs it straight away. The run history shows rows added, updated and with errors, never the content of the file; row errors are in the Import center history.
- After 3 failed runs in a row, the school's integration administrators get a notification (in-app and email) and the page shows a warning.
- Only HTTPS addresses on the public internet are fetched (private and internal addresses are refused, redirects are not followed, files up to 8 MB). **SFTP and shared folders are not supported**: ask the school to publish the export to a secure web address (most systems and file-sharing services can).
- To try it: `https://<site>/api/v1/samples/sis-students.csv` is a sample export in a typical student information system layout (fictional students). The demo school has a source set up on it.

### Pointing a student information system export at Horizon (setup call checklist)
1. Ask the school which way its system works: calling a web API, or publishing scheduled CSV or Excel exports.
2. API: create a key with read and write on the areas the system owns, give the school's IT contact the base address and the API guide tab (or the OpenAPI document). Send staff first, then students with guardians, then classes and enrollments.
3. Export: have IT schedule the exports (staff, students with one guardian per row, classes, enrollments) to an HTTPS address with a user name and password or a token, add one sync source per file, read the headers and map the columns once, then press Run now and check the run history.
4. Agree that the system stays the source of truth for these records. A sync never removes people or access; that is done on the People and Roles pages.

### Sign-in readiness
The **How people sign in** tab (Invitations) now shows whether Google and Microsoft sign-in are set up on this server (which variable names are missing, never values), the exact redirect address to register with each, and the school's staff email domain rule.

## 9. Common questions

- **A parent says their child's details do not match.** Check the student number and date of birth in the student record; approve the request manually in Join requests.
- **Someone cannot see a page.** Use Roles and access > Access check on that person; it shows every permission and which role grants it.
- **An email never arrived.** Check `RESEND_API_KEY` and `EMAIL_FROM`; the invitation can be resent or its link copied from Invitations.
- **The school wants a feature switched off.** School admin > School setup > Modules.
