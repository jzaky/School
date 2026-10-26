# Implementation plan: Horizon at Al Durrah International School

> **Draft prepared without legal review. Have a UAE-qualified lawyer review before signing.**
> Once agreed, this plan becomes Schedule 4 to the Master Services Agreement, and its acceptance criteria are contractual.

**Customer:** Al Durrah International School LLC, Sharjah. American curriculum, KG1 to Grade 12, regulated by the Sharjah Private Education Authority (SPEA).
**Supplier:** Nexus AI Assurance FZCO, +971 52 377 7246, [supplier email]
**Version:** [1.0], [date]

## 1. Summary

Horizon is introduced in three phases, so the school gets value early and never has to switch everything at once.

| Phase | What goes live | Length | Current system |
|---|---|---|---|
| 0. Preparation | Contract, decisions, data request, production set-up | 1 to 2 weeks | Unchanged |
| 1. Course selection and university guidance | Electives and next year's course selection with AP guidance, university planning, career guidance, application tracker | 3 to 4 weeks | Remains the main system. Horizon runs alongside it and reads student data from it |
| 2. Services and communication | School services and approvals, messages with families, private sick leave handling, safeguarding | The next 4 weeks | Remains the main system for attendance, admissions, fees and reporting |
| 3. Main school information system | Attendance, admissions, fees and government reporting move to Horizon at a term boundary | One term of parallel running, then switch | Runs in parallel for one term, then becomes a read-only archive |

### Indicative calendar (to confirm against the school calendar)

| Milestone | Indicative date |
|---|---|
| Contract and data processing agreement signed | [date] |
| Kickoff | [date, for example early November 2026] |
| Phase 1 go-live | [date, for example early December 2026] |
| Phase 2 go-live | [date, for example late January 2027, allowing for the winter break] |
| Phase 3 modules delivered and accepted | [date, at least 4 weeks before parallel running] |
| Phase 3 parallel running | [the whole of a term, for example Term 3, April to June 2027] |
| Horizon becomes the main system | [the start of the following term, for example academic year 2027-28] |

Avoid go-live dates in examination weeks, report card weeks, the first week of a term and Ramadan (expected around February to March 2027). Confirm the course selection window for next year early, because Phase 1 should be live before it opens.

## 2. What exists today and what must be built

This plan is honest about the product. Phases 1 and 2 use features that exist today. Phase 3 depends on features that must still be built. Phase 3 starts only after those features pass acceptance (Master Services Agreement clause 3.3).

| Area | Status today | Needed for | Plan |
|---|---|---|---|
| Course selection with AP badges and university impact, subject registration, class allocation | Available | Phase 1 | Configure for Al Durrah |
| University planning with requirements from official university pages | Available. The shared catalogue covers universities in many countries, including the US, the UK, Canada, the UAE and Saudi Arabia; programmes whose official pages could not be read show no requirements rather than guesses | Phase 1 | Counselors list the programmes Al Durrah students target; the Supplier adds missing programmes and checks their official requirements |
| Career assessment, application tracker, transcripts import, fairs and visits | Available | Phase 1 | Configure |
| Services, approvals, letters, meetings, request messages, private absence reasons, safeguarding | Available | Phase 2 | Configure |
| Sign-in with Google or Microsoft | Available once the sign-in keys are set on the server | Phase 1 | Supplier sets the keys; Head of IT confirms the accounts |
| Sign-in with ClassLink | Not built | Phase 1 or 2, if chosen | See section 6 |
| "Forgot password" self-service reset | Not built. Today a person who forgets their Horizon password cannot reset it; people who sign in with Google or Microsoft are not affected | Phase 2 (parents) | Build before whole-school parent rollout: target [date] |
| KG1 and KG2 as grade levels | Not built. Imports accept numbered grades only | Phase 2 (families with KG children) | Build before whole-school import: target [date] |
| Meeting types and staff availability screen | No self-service screen. The Supplier configures them | Phase 2 | Supplier configures from the school's list; screen on the roadmap [date] |
| Email delivery | Supported. The sending address is set per server, so it is [the Supplier's verified domain with the school's name in each email, on a shared environment / the school's own domain, on a dedicated environment] | Phase 1 | Supplier configures and verifies the domain; if the school's domain is used, the Head of IT adds the DNS records |
| WhatsApp messages | Built. Needs a WhatsApp Business sender approved by Meta, set per server: [the Supplier's sender, with the school's name in each message / the school's own sender, on a dedicated environment] | Optional, Phase 2 or later | The holder of the WhatsApp Business account applies to Meta; Supplier configures |
| Daily register taking by teachers | Not built. Today the register is a read-only view fed from the current system, plus excused days from absence reports | Phase 3 | Build: target [date] |
| Admissions (enquiry to enrolment) | Not built | Phase 3 | Build: target [date] |
| Fees beyond a payment link | Not built. Today families see a link to the school's own payment portal | Phase 3 | Build: target [date]; scope to agree, including whether payments stay in the current finance system |
| Government reporting exports for SPEA and the Ministry of Education | Not built | Phase 3 | School provides the list of reports, formats and deadlines; build: target [date] |

## 3. Who does what

### Named people

| Role | Al Durrah | Supplier |
|---|---|---|
| Sponsor | [Principal name] | [account lead name] |
| Project lead | [school administrator name] | [implementation lead name] |
| Head of IT | [name] | [technical lead name] |
| Designated Safeguarding Lead and deputy | [names] | - |
| Head of counseling and university counselor | [name] | - |
| Career advisor | [name] | - |
| Registrar and attendance office | [names] | - |
| School nurse | [name] | - |
| Finance officer | [name] | - |
| Admissions officer | [name] | - |
| Data protection lead | [name] | [Supplier data protection contact] |
| Champions (KG, elementary, middle, high) | [names] | - |
| Support contact | - | [name, email, phone] |

### Responsibilities

| Activity | Al Durrah | Supplier |
|---|---|---|
| Sign the agreement and data processing agreement; approve sub-processors | Leads | Supports |
| Decisions: sign-in method, AI settings, WhatsApp, identity documents, launch services | Decides | Advises |
| Production set-up: hosting, email, file storage, backups, sign-in keys | Provides DNS and account details | Leads |
| Data extraction from the current system | Leads (Head of IT, registrar) | Provides templates and mapping |
| Data loading, validation and reconciliation | Checks and signs off | Loads and fixes technical issues |
| School configuration: profile, calendar, roles, forms, workflows, letters | Leads (school administrator) with training | Guides, configures meeting types and availability |
| Requirement checks for target programmes | Counselors confirm with Mark verified | Adds missing programmes and official sources |
| Safeguarding route and access | DSL confirms in writing | Configures and tests |
| Training | Releases staff, books rooms, runs champion sessions | Delivers sessions, cards and videos (Training Plan) |
| Communication to staff, students and parents | Leads (letters, posters, assemblies) | Drafts texts in English and Arabic |
| First-line support to users | Leads (champions, administrator) | Second-line support under the Service Level Agreement |
| Phase 3 development (attendance, admissions, fees, reporting, KG, ClassLink if chosen) | Provides requirements and test data, tests | Builds and delivers |
| Acceptance testing | Tests and signs off | Prepares and fixes |
| Parallel running and reconciliation | Runs both systems, reviews differences | Produces reconciliation reports, fixes differences |

## 4. Phase 0: Preparation (1 to 2 weeks)

| Task | Owner |
|---|---|
| Sign the Master Services Agreement and the Data Processing Agreement | Both |
| Kickoff meeting (Training Plan session 1) | Both |
| Decide where Al Durrah's data is hosted: [a dedicated production environment for customer schools / the shared production environment with the public demonstration school], and the hosting region | Supplier proposes, school approves |
| Production readiness: real email sending with a verified domain, private file storage, database backups switched on and a restore tested, Google or Microsoft sign-in keys | Supplier |
| Create Al Durrah's school in Horizon; the school administrator confirms their email | Both |
| Send the data request (section 7) | Supplier sends, school returns |
| Agree the champions and the training dates | School |
| Publish the privacy notice to families and staff | School |

## 5. The Head of IT

The Head of IT is the school's technical owner of Horizon. Their responsibilities:

1. **Security review.** Read the Security Overview and the Data Processing Agreement, raise questions, and recommend approval of the sub-processors to the data protection lead.
2. **Sign-in.** Choose the sign-in method with the Supplier (section 6), confirm the staff email domain, and test sign-in for each role.
3. **Accounts.** Own the joiners and leavers process: new staff are added through the Import center or invitations, leavers are suspended on their last day. Review the roles holding sensitive permissions each term with the Access check screen.
4. **Data.** Extract the data from the current system for each phase, check the import previews with the registrar, and sign off the reconciliation.
5. **Integration.** Decide whether the current system sends data through a scheduled export over HTTPS or through the Horizon API, create the school API key with the minimum scopes, and monitor the sync run history.
6. **Email and messaging.** If the school's own domain is used for sending email, add the DNS records for it; if WhatsApp is used with the school's own WhatsApp Business account, manage that account with Meta.
7. **Devices and network.** Confirm supported browsers on school devices, allow the Horizon address on the school network and filters, and help install the app on shared devices if needed.
8. **Audit.** Review the audit log [monthly], especially emergency access to safeguarding records and identity number reveals, with the DSL and the data protection lead.
9. **Incidents.** Be the first contact for P1 and P2 Incidents, raise tickets, and receive breach notifications with the Principal.
10. **Change.** Approve the timing of Supplier maintenance and notify the Supplier of critical periods (examinations, report cards, course selection window).

## 6. Sign-in

| Who | Options | Recommendation |
|---|---|---|
| Staff | Google or Microsoft school accounts (available), ClassLink (not built), or email and password | Use the system the school already uses for staff email. Google and Microsoft sign-in work for people the school has invited or imported |
| Students from Grade [x] | Google or Microsoft school accounts, ClassLink, or email and password | Same as staff if students have school accounts |
| Younger students | No student accounts | Parents act for younger children |
| Parents | Email and password, or a personal Google or Microsoft account | Email and password with the invitation or the family join code |

**ClassLink.** Horizon does not support "Sign in with ClassLink" today. Options:
- (a) The Supplier builds ClassLink single sign-on, using the standard sign-in protocol the school's ClassLink tenant supports [confirm with ClassLink: OpenID Connect or SAML], by [date], with acceptance in Phase 1 or 2; or
- (b) if ClassLink at Al Durrah federates Google or Microsoft accounts, staff and students use Google or Microsoft sign-in in Horizon, and the school adds Horizon as an app tile in ClassLink LaunchPad that opens the Horizon sign-in page.

Decision: [a / b], by [date].

**Points to note:**
- Horizon links a Google or Microsoft sign-in to the person by email address. The Head of IT should confirm that only the school's own domain is used for staff and student accounts.
- Multi-factor authentication is not built into Horizon. Staff with sensitive permissions should sign in through Google or Microsoft with the school's multi-factor authentication switched on.
- Sessions last up to 12 hours. Suspending a person ends their access at their next page load.

## 7. Data migration

### Principles

- The current system remains the source of truth until Phase 3 cutover.
- Every import is previewed row by row before anything is saved, and re-importing a file updates records instead of creating duplicates. Re-importing never removes anyone's access.
- Files with personal data are transferred only through [a secure channel agreed with the Head of IT, for example a shared folder with named access], never by ordinary email, and local copies are deleted after loading.
- Real data is never loaded into the demonstration school. Import rehearsals use [a separate test school created for this purpose and deleted afterwards].

### Steps for each phase

1. **Inventory.** List what is needed, where it is in the current system, and who owns it.
2. **Mapping.** Match the current system's columns to the Horizon templates (Import center, English and Arabic headers). For a scheduled sync, map the columns once with Read headers.
3. **Extract.** The Head of IT exports the files (CSV or Excel).
4. **Rehearse.** Load into the test school, review the errors (unknown teacher emails, missing student numbers, invalid dates), fix them at the source and repeat.
5. **Load.** Load into Al Durrah's school in this order: staff, students with guardians, classes and enrolments, subject choices.
6. **Reconcile.** Compare counts by grade, section and class with the current system; spot-check [20] random students and [10] families with the registrar.
7. **Sign off.** The registrar and the Head of IT sign the reconciliation.
8. **Keep in step.** Until cutover, changes flow from the current system by scheduled sync or by repeating the import [daily / weekly].

### Data by phase

| Phase | Data | Method |
|---|---|---|
| 1 | Staff (high school teachers, counselors, career advisor, registrar, leadership) | Import center |
| 1 | Students in Grades [8 or 9] to 12 with guardians | Import center, then scheduled sync |
| 1 | High school classes and enrolments | Import center |
| 1 | This year's and next year's course offerings, with AP flags and the courses they count as for universities | Configured in Subject registration |
| 1 | Grades 9 to 12 transcripts or grade history | Transcript import (CSV, Excel or text-based PDF) with mapping review |
| 1 | Students' current university lists and application stages, if kept elsewhere | Entered by counselors, or imported [if a file exists] |
| 2 | All staff and all students (KG1 to Grade 12) with guardians | Import center, then scheduled sync (KG requires the KG feature) |
| 2 | All classes and homerooms | Import center |
| 2 | Letter wording, logo, seal and signatories | School setup and Document templates |
| 2 | Students' medical alerts | [Decide after the legal review of health data hosting, see the Data Processing Agreement clause 11.6] |
| 2 | Open wellbeing and safeguarding matters | Not bulk-migrated. The DSL decides case by case whether to open a case in Horizon with a short summary; historical records stay in the current secure system |
| 3 | Attendance history for the current year | Horizon API (attendance endpoint) or file |
| 3 | Open admissions applications | [Method, once the admissions module is built] |
| 3 | Fee schedules and balances | [Method, once the fees module is built] |

## 8. Phase 1: Course selection and university guidance (3 to 4 weeks)

**Goal:** counselors, students and parents use Horizon for next year's course selection, AP decisions, university planning and Grade 12 applications, while the current system continues as before.

| Week | Activities |
|---|---|
| 1 | Admin setup session; Head of IT session; staff and Grades [8 or 9] to 12 imported; sign-in tested; offerings for next year configured |
| 2 | Counselors and career advisor trained; target programmes listed and checked; transcripts imported; train the trainer |
| 3 | Teachers, students and parents' orientation; families invited; course selection window opened or scheduled |
| 4 | Support and adjustments; acceptance testing; Phase 1 review |

**Phase 1 acceptance criteria**
1. Staff in scope sign in with the agreed method; at least one person per role tested.
2. Students in scope and their guardians are imported; counts match the current system by grade and section, with no unresolved row errors.
3. Next year's offerings are set up with AP flags; a test student and a test parent can make and change choices; staff can register on behalf; demand statistics show.
4. For the [50 to 100] programmes Al Durrah students target most, each requirement line shows its official source, or the programme shows that requirements are unknown; counselors have marked [number] as verified.
5. University planning, AP guidance and the impact lines work for [10] sample students with imported transcripts, checked by a counselor.
6. The application tracker holds every Grade 12 student's applications that counselors manage, with deadlines.
7. Student and parent views checked in English and Arabic, on a computer and a phone.
8. Emails arrive from the agreed verified sending address and are not marked as spam by the main email providers used by families.
9. No double entry: the current system remains the record for attendance, admissions and fees.

## 9. Phase 2: Services, messages, sick leave privacy and safeguarding (4 weeks)

**Goal:** families and staff use Horizon for everyday requests and messages; sick leave reasons stay private; safeguarding concerns go through the restricted route.

| Week | Activities |
|---|---|
| 1 | All staff and all students imported (KG ready); DSL and registrar sessions; launch services configured with Al Durrah's forms, routes and letters; meeting types and availability configured |
| 2 | Teacher sessions by section (champions); safeguarding route tested with the DSL; staff use services internally |
| 3 | Parents' orientation; family invitations or join code poster; WhatsApp if approved |
| 4 | Support and adjustments; acceptance testing; Phase 2 review |

**Launch services** (default, adjust at kickoff): request a school document, report an absence, book a parent meeting, refer a student for an academic concern, report a safeguarding concern.

**Phase 2 acceptance criteria**
1. The five launch services are live with Al Durrah's wording, approval routes and letters (logo, seal, signatory), in English and Arabic.
2. **Safeguarding:** with a fictional test student, a teacher raises a concern and then sees only that it is being handled; the DSL and deputy see the full record and chronology; an external referral and a decision about informing the family are recorded with a reason; emergency access by the Principal alerts the DSL; every view appears in the audit tab. The DSL confirms the route in writing. The test record is then removed.
3. **Sick leave privacy:** a parent reports an illness absence with a doctor's note; the attendance office approves it; the homeroom teacher sees "Excused absence, reported by parent" without the reason; the registrar, attendance office and nurse see the reason.
4. **Messages:** on a request, a family message, a staff-only note and a private note behave as labelled; notifications do not contain message text; phone alerts about sensitive matters show only a generic line.
5. All staff and all students from KG1 to Grade 12, with guardians, are imported and reconciled.
6. Parents and staff who forget their Horizon password can reset it themselves (feature delivered and tested before the whole-school parent rollout).
7. Parent adoption: [target] percent of families joined within 4 weeks of invitations; staff active: [target] percent.
8. If ClassLink was chosen under option (a), ClassLink sign-in works for staff and students.

## 10. Phase 3: Horizon as the main school information system

**Goal:** at a term boundary, Horizon becomes the main system for attendance, admissions, fees and government reporting, after one full term of parallel running.

### Before parallel running

1. The Supplier delivers the attendance, admissions, fees and government reporting features, each passing acceptance under the Master Services Agreement.
2. The school provides: the list of SPEA and Ministry of Education reports with their formats and deadlines, the fee structure and how payments are recorded today, and the admissions process from enquiry to enrolment.
3. Rehearsal: teachers take the register in Horizon for [2] weeks in a test period; attendance, admissions and fees data are loaded into the test school and compared with the current system.
4. Training sessions 14, 15 and 16 (Training Plan).

### During parallel running (one term)

- Teachers take the daily register in Horizon. [The current system is updated by: the attendance office from Horizon's daily export / a daily file in the current system's import format / manual entry]. Choose the method that avoids teachers entering everything twice.
- New admissions are handled in Horizon and also recorded in the current system.
- Fees: [Horizon shows fee information from the finance system / Horizon issues invoices and the finance system records payments], as agreed in the fees scope.
- Government reports are produced from both systems and compared before submission from the current system.
- Each week the Supplier produces a reconciliation report (attendance totals by class and day, enrolment counts, fee totals) and the registrar reviews the differences.

### Cutover

- At the end of the parallel term, the Principal, the Head of IT and the registrar decide go or no-go.
- Final changes are loaded, the current system is set to read-only and kept as an archive for [period].
- From the first day of the next term, Horizon is the main system.

**Phase 3 acceptance criteria**
1. Attendance: for the last [4] weeks of parallel running, daily attendance in Horizon matches the current system for at least [99.5] percent of student-days, and every difference is explained.
2. Admissions: [number] real applications have gone from enquiry to enrolment in Horizon, creating the student and guardian records correctly.
3. Fees: invoices or fee statements for a sample of [number] families match the finance system.
4. Government reporting: each required report produced by Horizon has been checked by the registrar against the official format and against the current system's output [and accepted by the regulator's portal in a test upload, where one is available].
5. Every user group has been trained, and the quick reference cards cover the new tasks.
6. The Exit Export from Horizon has been tested once, so the school knows it can get its data out.

## 11. Risks and mitigations

| Risk | Impact | Mitigation | Owner |
|---|---|---|---|
| Staff do not adopt the new tools | Low use, double work | Train just before go-live; champions per section; leadership uses Horizon visibly; monthly adoption figures | Principal, champions |
| Parents do not join | Requests stay on the phone | Invitations plus the join code poster and QR code; orientation in Arabic and English; installable app; adoption target reviewed weekly | School administrator |
| Data quality problems in the current system's exports | Failed or wrong imports | Rehearse in the test school; fix at the source; row-level previews; reconciliation sign-off | Head of IT, registrar |
| Phase 3 features not ready in time | Phase 3 delayed | Phase 3 starts only after acceptance; long-stop dates in the Order Form; Phase 3 moves to the next term boundary at no extra charge | Supplier |
| Government report formats unclear or changed by the regulator | Reports cannot be produced | School provides official formats early; validate with the registrar; keep the current system for reporting until accepted | Registrar, Supplier |
| ClassLink sign-in not available | Students and staff cannot use their usual sign-in | Decide option (a) or (b) at kickoff; Google or Microsoft sign-in as a fallback | Head of IT, Supplier |
| KG grades and password reset not ready before Phase 2 | KG families cannot join; parents locked out | Both are on the critical path for Phase 2 with target dates; Phase 2 can start with Grades 1 to 12 if needed | Supplier |
| Hosting outside the UAE | Legal questions on transfers and health data | Legal review of the Data Processing Agreement; decide on clinic records; option to move hosting to a UAE region [decision] | Data protection lead, Supplier |
| Email not delivered or marked as spam | Families miss invitations | Verify the sending domain; test with major email providers; re-send from Invitations | Head of IT, Supplier |
| WhatsApp approval by Meta takes time | No WhatsApp at Phase 2 | In-app, email and phone alerts work without it; add WhatsApp when approved | School administrator |
| Workload of parallel running | Staff fatigue, errors | Avoid double entry by teachers; limit parallel running to one term; weekly reconciliation by the Supplier | Registrar, Supplier |
| Small supplier, key person dependency | Delays if a key person is unavailable | Named deputies; written runbooks; the school can export all its data at any time; business continuity clause in the agreement | Supplier |
| Security incident | Harm to families, loss of trust | Security measures in the Data Processing Agreement; P1 handling and 72-hour notification; independent penetration test before Phase 3 [date] | Supplier, Head of IT |
| Calendar clashes (exams, Ramadan, holidays) | Low attendance at training, rushed go-live | Change freezes notified in advance; go-lives outside critical periods | Project leads |
| Scope creep | Delays | Changes through the weekly check-in and written change requests | Project leads |

## 12. Governance

- **Weekly check-in** (30 minutes): project leads and the Head of IT. Progress, issues, decisions, next week.
- **Phase review** at the end of each phase with the sponsor: acceptance, adoption figures, go or no-go for the next phase.
- **Issue log and decision log** kept by the Supplier and shared with the school.
- **Change requests** in writing, with the effect on dates and fees, approved by both project leads.

## 13. Communication plan

| When | Audience | Message | Channel |
|---|---|---|---|
| Phase 0 | All staff | What is coming, why, and when | Staff meeting, email |
| Phase 0 | Families | Privacy notice | Website, email |
| Phase 1, week 3 | Grades 9 to 12 families | How to join, course selection and university planning | Letter in English and Arabic, orientation, video |
| Phase 1, week 3 | Grades 9 to 12 students | Course selection and university planning | Assembly or class, video |
| Phase 2, week 2 | All staff | Services, messages and safeguarding concerns | Training by champions |
| Phase 2, week 3 | All families | How to join and use services | Letter, join code poster, orientation, video |
| Before Phase 3 | Staff and families | Attendance, admissions and fees move to Horizon | Letter, staff meeting |

## 14. Sign-off

| Phase | Accepted by (Al Durrah) | Date | Confirmed by (Supplier) | Date |
|---|---|---|---|---|
| Phase 0 | | | | |
| Phase 1 | | | | |
| Phase 2 | | | | |
| Phase 3 modules | | | | |
| Phase 3 cutover | | | | |
