# Horizon pilot proposal: one term

**Prepared for:** [School name]  
**Prepared by:** Nexus AI Assurance FZCO, +971 52 377 7246, [email]  
**Date:** [date]

## 1. What we propose

A one-term pilot of Horizon, the School Operations and Student Services OS, with five launch services, real staff and real families, and success measures agreed before we start. If the agreed measures are not met at the end-of-term review, the school pays no pilot fee.

## 2. Scope

### Five launch services

These are live in every new Horizon school from day one, with bilingual forms, approval routes and service targets the school can change.

| Service | Who uses it | Default target |
|---|---|---|
| Request a school document (enrollment, good conduct, fee and other letters) | Parents, students | 72 hours |
| Report or request an absence | Parents, students | 24 hours |
| Book a parent meeting | Parents, staff | 48 hours |
| Refer a student: academic concern | Staff (teachers) | 48 hours |
| Report a safeguarding concern | All staff | 4 hours |

The school may swap any of these for another service from the catalog (29 services are installed), for example counselor meetings or subject changes.

### Modules included

- **Services and requests:** service catalog, bilingual forms, request tracking with a progress view, approvals inbox with signatures.
- **Workflows:** approval routes the school can edit in a visual builder, with validation and a dry run before publishing.
- **Documents and letters:** bilingual PDF letters (English and Arabic) with the school's logo and seal, family document sharing, signed download links.
- **Meetings:** booking against real availability, reminders and calendar files.
- **Cases and safeguarding:** referrals, case pages, restricted safeguarding queue for the Designated Safeguarding Lead, recorded decisions on informing families.
- **Notifications:** in-app and email, in English and Arabic. Parents and students can also install Horizon on their phone home screen and turn on app alerts; WhatsApp messages can be switched on per notification type once the school's WhatsApp sender is approved, and each parent opts in with their own number.
- **Analytics:** requests, time to close, share closed within target, meetings held, and a Pilot measures panel for the principal (staff active, parent adoption, median days to issue a letter, requests closed on time, meetings booked) for any chosen period, with CSV download. Wellbeing and safeguarding records are always excluded.
- **Administration:** setup wizard, Import center, roles and access, invitations and family join code, compliance settings (including personal data export and erasure), audit log.

Other modules (grades, timetable, career guidance, university planning and more) can be switched on during the pilot if the school wants them, but they are not part of the success measures unless agreed in writing.

### Not in scope

- Connecting the school's student information system is optional. Data comes in through the Import center (CSV or XLSX exports); if the school's system can publish a scheduled export over HTTPS or call an API, Horizon can also read it on a schedule or receive it through the Horizon API. Setting this up with the school's system supplier is outside the pilot measures.
- SMS delivery (not built). Notifications are in-app, email, phone app alerts and, where the school enables it, WhatsApp.
- Fee collection or payments. Horizon can show families a link to the school's own fee payment page, but processes no payments.

## 3. Timeline

| When | What happens | Who |
|---|---|---|
| Before week 1 | School sends the data request (staff, students and guardians, classes, calendar, logo, letters, DSL names). Templates are in the Import center. | School pilot lead |
| Week 1: setup day | A 90-minute guided setup: school profile and brand, term dates, Import center, roles and access, the five launch services, letter preview with the school logo. | Horizon and school pilot lead |
| Weeks 2 to 3: staff | Staff are invited, trained in a 30-minute session, and use the services internally (teacher referrals, safeguarding concerns, approvals). Fixes to forms and routes are made. | School pilot lead, staff champions |
| Weeks 4 to 10: families | Families join (email invitation or the family join code poster). Parents use documents, absences and meetings. Mid-pilot check-in in week 6. | School, with Horizon support |
| End of term: review | Results against each success measure, read from the app. Decision: continue, change, or exit. | Both |

Review meeting date: [review date]

## 4. Roles

### School

| Role | Responsibility | Name |
|---|---|---|
| Pilot sponsor (Principal) | Owns the decision, chairs the review | [name] |
| Pilot lead (School administrator) | Runs setup, imports data, first contact for staff | [name] |
| Designated Safeguarding Lead and deputy | Confirm the safeguarding route and access | [name], [name] |
| Data protection or IT lead | Reviews the data protection pack, approves processors | [name] |
| Registrar | Approves letters and documents | [name] |
| Staff champions (one teacher, one counselor) | Use it first, collect feedback | [names] |

### Horizon (Nexus AI Assurance FZCO)

| Role | Responsibility | Name |
|---|---|---|
| Account lead | Pilot plan, weekly check-in, review meeting | [name] |
| Onboarding support | Setup day, import help, staff training | [name] |
| Technical contact | Availability, incidents, data requests | [name] |

Support hours and response times: [support hours and response times]

## 5. Success measures

Agreed before week 1. Baselines come from the school's current process (a short count or estimate in week 1).

| Measure | Baseline | Target | How Horizon measures it |
|---|---|---|---|
| Days to issue a school document | [baseline] | [target] | Analytics: Pilot measures, "Median days to issue a letter", plus each request's submitted and completed times on its request page. |
| Share of requests closed within target | [baseline] | [target] % | Analytics: Service levels, "Within target" (requests closed before their service target, last 7, 30 or 90 days). |
| Parent adoption | [baseline] | [target] % of families | Analytics: Pilot measures, "Parent adoption" (parent accounts linked, of guardians on record). Invitations and Join requests show the detail. |
| Staff active | [baseline] | [target] % of staff | Analytics: Pilot measures, "Staff active" for the chosen period (staff seen in the app or with a recorded action, of all active staff accounts). |
| Requests handled online | [baseline] | [target] per month | Analytics: Requests received and Requests by service. |
| Meetings held as booked | [baseline] | [target] % | Analytics: Service levels, "Meetings held". |

Wellbeing and safeguarding records are never counted in these figures, by design.

## 6. Pilot guarantee

If the agreed success measures are not met at the end-of-term review, the school pays no pilot fee.

- Pilot fee: [pilot fee] for [number of students] students, invoiced [when].
- Measures count as met when: [all measures met / an agreed number of measures met].
- The guarantee assumes the school completes setup day and sends invitations by the end of week 3: [confirm wording].

## 7. Data handling

### During the pilot

- The school is the data controller. Horizon processes data only to run the service for the school.
- The school's data sits in its own tenant, separated from every other school by database row level security.
- Only people the school invites can sign in. Horizon staff get access only if the school adds them as an administrator, and are removed at the end of setup or the pilot.
- Hosting region: [hosting region].
- Details are in the Horizon data protection pack.

### At exit or at the end of the pilot

- **Export:** the school exports its own data at any time from Admin > Compliance > School data export: a CSV file per table and every stored document, prepared in the background, with a download link that works for 24 hours. Horizon can help on request.
- **Deletion:** after the export is confirmed, Horizon deletes the school's records from the live database and its stored files within [number] days, and confirms in writing. Backup copies expire within [backup retention period].

## 8. Easy exit

- Either side can end the pilot with [notice period] written notice.
- No long-term commitment is created by this pilot.
- If the school ends the pilot early, [fee treatment on early exit].

## 9. Signatures

| For [School name] | For Nexus AI Assurance FZCO |
|---|---|
| Name: | Name: |
| Title: | Title: |
| Signature: | Signature: |
| Date: | Date: |
