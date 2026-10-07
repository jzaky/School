# Meeting kit: the live school meeting

One checklist for a 45 to 60 minute meeting with a school leadership team. Production: https://myhorizon.up.railway.app

## 1. Before the meeting

### The day before

- [ ] Ask the school for an anonymised staff list or one class list (names may be made up; real emails not needed). Send them the Import center templates or the sample files in `samples/`.
- [ ] Fill the blanks in `pilot-proposal.md` that you already know (school name, date). Print one copy, plus `data-protection-pack.md` for the IT lead.
- [ ] Check the daily live check (it runs at 06:45 Dubai time for every role in English and Arabic) passed that morning, and that the public status page (/status) shows all checks up.

### 30 minutes before

- [ ] The production URL loads, and `/demo` shows the persona cards.
- [ ] Enter as any persona and press **Reset demo** in the yellow bar (under a minute). Every record is restored with dates relative to today.
- [ ] Two browser windows side by side: one normal, one private (each window holds one signed-in persona).
- [ ] Optional: switch the second window to Arabic to show right-to-left.
- [ ] Environment checks, only for what you plan to show:
    - Real emails: the email delivery key and sender address are set on the web and worker services. Without them, emails go to the server log only.
    - AI drafts: the AI provider key is set. Without it the built-in drafter still works; say "this is the offline drafter".
    - Single sign-on with the school's work accounts: the sign-in keys are set, so the login page shows those buttons. School admin > Invitations > How people sign in shows which methods are ready on the server. Demo personas need no password.
    - Phone app alerts: the push keys are set; otherwise the alert option is hidden in Settings.
    - WhatsApp: the demo uses the console provider (messages are logged, not sent). Say so if you show the parent opt-in.
- [ ] Sample files ready on the laptop: `samples/staff-sample.csv`, `samples/students-guardians-sample.csv`, `samples/classes-sample.csv`, `samples/enrollments-sample.csv`.
- [ ] Phone charged, with the demo open, to show the mobile view.

## 2. The live import moment (5 minutes)

The point: "your data is in Horizon in minutes, and nothing is saved until you have seen it".

1. Enter as **Aisha Rahman** (School Administrator). Open **School admin > Import center**.
2. **Staff:** upload `staff-sample.csv` (or the school's anonymised list). Leave sending invitations off. Show the preview: one row per person with roles, department and subjects; every row says create. Confirm.
3. **Students and guardians:** upload `students-guardians-sample.csv`. Point out the Arabic names and that two siblings share one guardian. Confirm.
4. **Classes and enrollments:** upload `classes-sample.csv`, then `enrollments-sample.csv`. Confirm each.
5. Upload the staff file again: every row now says unchanged. "Re-importing never creates duplicates and never removes anyone's access."
6. Optional: change one email in a copy of the file to something invalid and upload it to show the row-level error.

Notes:

- The sample files use section **S** so they never merge with the demo school's own classes (lettered A, B and onwards). A school's own file that uses the same grade, subject and section as a demo class may update that class; press **Reset demo** afterwards in any case.
- The importer reads CSV or XLSX, English or Arabic headers, and files saved by older Arabic spreadsheet software.
- Never upload real personal data into the demo school.

What the sample files contain (all fictional): 8 staff (teachers, a head of science, a counselor, a registrar, a nurse), 12 students in grades 9 and 10 with 11 guardians, 4 classes (one homeroom) and 19 enrollments.

## 3. The five-minute demo path

Switch personas with the yellow bar. Show the parent in Arabic if the audience is Arabic-speaking.

| Time | Persona | What to show | Line to say |
|---|---|---|---|
| 0:00 | **Rania Nasser** (Parent) | Services > Request a school document: Adam, enrollment letter, bilingual, purpose embassy. Submit; show the progress view. | "No phone call, no visit, and she can see where it is." |
| 0:45 | **Registrar** | Approvals > approve with a signature. | "One inbox for every approval." |
| 1:15 | **Rania Nasser** | Notification, then Documents > open the PDF: English and Arabic side by side, the school's logo. | "Arabic is shaped correctly, not reversed." |
| 1:45 | **Daniel Carter** (Teacher) | Safeguarding > raise a concern. After submitting he sees only "Received and being handled". | "The teacher cannot read the case. That is the point." |
| 2:30 | **Khalid Yousef** (DSL) | Restricted queue, chronology, the recorded decision about telling the family, the audit tab. | "Families are never told automatically. Every view is logged." |
| 3:30 | **Omar Al Mansoori** (Principal) | Home KPIs, then Analytics: time to close, share within target. | "Wellbeing and safeguarding are excluded from every figure." |
| 4:15 | **Aisha Rahman** (Admin) | Workflows (visual route, validate, simulate) or Compliance (AI safeguards, retention, data requests). | "Your team changes forms and routes; you do not wait for us." |

If there is more time, by audience:

- **Counselors:** Sarah Ahmed: a referral in her caseload, versioned notes, book a meeting with the parent.
- **Career and university staff:** Adam Nasser: career assessment and matches; then Layla Hassan: AI brief (draft, review before use), action plan, approve and share. University planning: requirements per programme with the official source.
- **IT lead:** Roles and access > Access check on a teacher; Audit log with CSV export; Compliance > processors and AI switches; Integrations (API keys with scopes, the scheduled sync and its run history, the API guide); Compliance > Person data tools (one-person export and erasure preview).
- **Principal or inspection lead:** Omar Al Mansoori: Inspection evidence pack for this term (PDF and CSV), then Analytics > Pilot measures.
- **Group leaders:** Noura Al Suwaidi (Group Director, on /demo): Group dashboard comparing three schools, then Shared templates.
- **Parents on a phone:** Rania Nasser: install Horizon to the home screen, turn on app alerts in Settings, download Adam's career report (PDF). Show University fairs and visits and register Adam for one.

## 4. Objections and answers

**"Do you connect to our SIS?"**  
Yes, three ways, all with the same validation and no duplicates:

1. **Import center:** staff, students with guardians, classes and enrollments, as CSV or XLSX with English or Arabic headers, previewed before anything is saved.
2. **Scheduled sync:** if your system can publish an export to an HTTPS address, Horizon reads it hourly or daily with the column mapping you set, keeps a run history and alerts administrators after repeated failures.
3. **Horizon API:** your system or IT team pushes and reads students, staff, classes, enrollments and attendance with a school API key (scoped per area, revocable, rate limited). The API guide and OpenAPI file are in School admin > Integrations.

A ready-made connector for a specific SIS product is not built; the school's supplier points its export or API calls at Horizon.

**"Where is data hosted?"**  
[hosting region]. Each school's data is separated by database row level security, the app runs as a non-owner database role, identity numbers are encrypted at field level, and every file download is a signed link that expires in five minutes. The data protection pack has the detail and the processor list.

**"What about our existing career guidance provider?"**  
Keep them. Horizon does not replace partners; it can link partner providers. Under Career > Partner resources, the career team lists partner links for students and parents and sees how often they are opened (no personal tracking). Staff record a referral to an outside provider on the student's case (provider, reference number, contact), the school can add a service in the catalog that routes a request to the partner's process, and documents from the partner can be shared with the family. If you prefer, switch the career module off and use Horizon only for operations. Direct data exchange with a partner's own platform: [to discuss].

**"Our safeguarding records cannot leak."**  
One access module controls every wellbeing and safeguarding record. They are excluded from search, dashboards, analytics and family portals; referrers see status only; emergency access is time-limited, reasoned and alerts the DSL; every view is in the audit log.

**"How do we prepare for inspection?"**  
The Inspection evidence pack gathers, for a chosen period, the figures inspectors commonly ask about (safeguarding, wellbeing and counseling, parent communication, careers guidance, attendance and academics, policies and compliance records), with the related framework areas noted for the school to check against its current framework. It downloads as a bilingual PDF on the school letterhead or CSV, with no case details.

**"What about AI and student data?"**  
AI is optional and can be switched off. Wellbeing, safeguarding and medical data is never sent unless the school turns it on with a recorded reason. Every AI output is a draft a person approves.

**"We do not have time to set this up."**  
A new school starts complete: services, forms, approval routes, letters, roles, calendar with UAE holidays. Setup is one 90-minute session, and the import takes minutes, as you just saw.

**"Will parents use it?"**  
Parents join by email invitation or a family join code on a printed poster with a QR code. It works in the phone browser in Arabic or English, and parents can install it on the home screen like an app (no app store download) and turn on alerts. Where the school enables it, they can also choose WhatsApp messages. Parent adoption is one of the pilot success measures, and the Pilot measures panel shows it at any time.

**"What does it cost?"**  
[price per student] per year. The public /pricing page has a time-saved estimator with every assumption shown and editable; it shows "Request an offer" until prices are published. The pilot fee is [pilot fee], and if the agreed success measures are not met at the end-of-term review, the school pays no pilot fee.

**"What if we stop?"**  
Exit with [notice period] notice. Your administrator can export all school data at any time (CSV per table and every document) from Compliance > School data export. We then delete your data and confirm in writing.

## 5. Next steps (agree before leaving)

- [ ] Pilot sponsor and pilot lead named.
- [ ] Five launch services chosen (default: documents, absences, parent meetings, teacher referrals, safeguarding concerns).
- [ ] Success measures and targets agreed (see the pilot proposal).
- [ ] Data protection pack sent to the IT or data protection lead; questions by [date].
- [ ] Data request sent: staff, students and guardians, classes and enrollments, calendar, logo and colours, letter wording, DSL and deputy.
- [ ] Setup day booked: [date].
- [ ] Pilot proposal signed by [date].
- [ ] After the meeting: press **Reset demo**, send a thank-you email with the proposal and the data protection pack.
