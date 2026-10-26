# Government reporting: a guide for school staff

Horizon prepares the returns your education authority asks for from the data already in Horizon: who is on roll, who joined and left, attendance, staff and results. You check each return for problems before you send it, download it as Excel, CSV or a signed PDF summary, and keep a record of what was sent and the reference the authority gave you.

Open it from **Government reporting** in the Administration section of the menu (`/admin/government`).

## Who does what

| Person | What they can do | Permission |
| --- | --- | --- |
| Registrar, school administrator | Create returns, fix the problems they find, export Excel, CSV and PDF, record submissions, keep the due date calendar | Prepare government returns (government.reports) |
| Principal | See every return, the submission log and due dates, download the summary PDF, sign off a return | View and sign off government returns (government.view) |
| Staff who can reveal identity numbers | Download the learner registration list with full Emirates ID numbers | Reveal identity numbers (people.reveal_ids) |
| Staff who manage people | Fill in a missing date of birth, gender, nationality or Emirates ID from a return's check list | Manage people (people.manage) |
| Staff who enroll students | Record a registration reference from a return's check list | Enroll and withdraw students (admissions.enroll) |

A school can change any of this on Roles and access.

## Your authority

The authority comes from **Admissions settings, registration authority**: SPEA (DALEEL) for Sharjah, the Ministry of Education (Al Manhal) for northern emirates and Ministry curriculum schools, KHDA for Dubai, ADEK for Abu Dhabi, or your own name. A school whose regulator is SPEA starts with SPEA (DALEEL). Each return remembers the authority it was made for.

None of these authorities publishes a file format or an API that Horizon could send to (see "What each authority publishes" below). Every file Horizon produces is therefore a **Horizon standard** layout, marked "format to be confirmed with <authority>". You copy the figures or rows into the authority's own portal. If your authority gives you a template, compare it with the Horizon layout before you send.

## The returns

Every return is for a **census date** or a **period**. Grades read KG1, KG2, Grade 1 to Grade 12 everywhere.

| Return | Date | What it holds |
| --- | --- | --- |
| Enrollment census | Census date (admissions and leavers from the start of the school year, or a date you choose) | Students on roll by grade and section, gender, nationality (Emirati and others, and every nationality), people of determination, new admissions and leavers in the period, age against grade |
| Learner registration list | A period | Every new admission, transfer in (from a UAE school or from abroad), re-enrollment of a former student and withdrawal, with the details the authority's registration needs and each learner's registration status and reference from Admissions |
| Attendance return | A period (usually a term) | Attendance rate by grade, authorised and unauthorised absence (absences not yet explained count as unauthorised), and students at or over the regulator absence limit set in attendance settings |
| Staff return | As at a date | Teachers and staff by role, and a staff list (name, employee number, job title, department, roles) |
| Results summary | A period | Each student's weighted average per subject from published gradebook assessments, by grade and subject, with grade band counts; AP entries from AP results recorded on student records |

Who is on roll on a census date: active students who had joined by that date, plus students who left after it. Students admitted for a later date are not counted. For a census date in an earlier school year, grades are taken back one grade per school year.

### What Horizon does not hold

The staff return says plainly what is missing instead of guessing: **staff nationality, staff gender, qualifications, and teaching licence or permit to practise numbers** are not recorded in Horizon. They show as "Not recorded in Horizon" in the file. Complete them from your HR records before you send.

The exams timetable lists exam sittings, not entries per student, so AP entries come only from AP results recorded on student records.

## Checks before sending

Each return shows a check list. Problems link to the record so you can fix them, and most can be fixed on the spot:

| Check | How to fix |
| --- | --- |
| Emirates ID missing | **Fix**: type the 15-digit number (stored encrypted) |
| Nationality, date of birth or gender missing | **Fix**: fill in the field |
| Age outside the grade's range | Open the record: check the date of birth or the grade. Uses the age cut-off in Admissions settings (KG1 is 4, KG2 5, Grade 1 6 on that date) |
| No registration reference | **Record reference**: the reference the authority gave, as submitted or approved. It is saved on the student's registration in Admissions |
| Same Emirates ID, or same name and date of birth, on two records | Open both records and correct or merge them |
| Staff job title or employee number missing | Open the person in People |
| Absences still unexplained, assessments not published, absence limit off | Notes: what the return will and will not include |

The check list never shows an Emirates ID, only that it is missing. You can still export a return with open problems: Horizon asks you first, the file carries a warning, and the export is recorded in the audit log as "exported with problems".

## Exporting

- **Excel**: every table on its own sheet, each with an English and an Arabic header row, plus an "About" sheet (school, authority, period, version, data checksum, who generated it and when, and any warning). In Arabic the sheets read right to left.
- **CSV**: the main table only (census: grade and section; registration: the learner list; attendance: by grade; staff: the staff list; results: by grade and subject), with headers in both languages ("Grade / الصف").
- **Summary PDF** in English or Arabic, on the school letterhead: the headline tables (never names or identity numbers), the principal's sign-off, the version and the data checksum.

Every file is logged under **Files and submissions** with its version, language, who generated it, when, and the file's checksum. The version goes up only when the data changes, so downloading the same data twice keeps the same version.

### Emirates ID numbers

Only the learner registration list can carry full Emirates ID numbers, and only for staff who may reveal identity numbers, who tick "Include full Emirates ID numbers". That download is recorded in the audit log as confidential, and the file says it contains identity numbers. Without that, the column shows "On file" or "Missing". No other return ever contains an identity number.

### Privacy

- Health details never appear in any return.
- People of determination are counts only. Neighbouring grades are merged so that no group shown has fewer than 5 students, and a smaller total shows as "Fewer than 5". Results groups with fewer than 5 students show no average, and grade band counts below 5 show as "<5".

## Sign-off and submission

1. The principal opens the return, checks the figures and the check list, and clicks **Sign off**. Their name, title and the date go on the summary PDF. If the data changes afterwards, the return shows that the sign-off is out of date until the principal signs again.
2. You send the file through the authority's portal.
3. Back in Horizon, click **Record submission**: choose the file you sent (by version), the date, and the reference the authority gave you. The return becomes "Submitted", its due date is marked done, and the submission appears in the **Submission log**.

If the data changes after a return was sent, the return says so: a new file would be a new version.

## Due dates and reminders

Under **Due dates**, add the dates your authority sets (for example the census date). Everyone who can prepare government returns gets a reminder 14 days before and again 3 days before (in Horizon and by email, following their notification settings). Each reminder is sent once; if you move the date, reminders follow the new date. Start a return straight from its due date, and mark a due date done if you sent it outside Horizon.

## What each authority publishes

We looked for what each authority publicly says private schools must submit. None publishes an API, a data dictionary or a file layout for these returns, so no Horizon file claims to be an official format.

### SPEA (Sharjah Private Education Authority): DALEEL

- SPEA's service page "Student Registration in DALEEL" describes the service as "Enrollment of the Learner in the Private Foreign Education System in the Emirate of Sharjah", delivered through DALEEL (https://daleel.spea.shj.ae), free, in Arabic and English, with "Transcript and Transfer Certificate" as the required documents. It does not list the form's fields. Source: https://spea.shj.ae/en/services/dummy-individuals
- Since the move to "Daleel 2", schools tell parents that every student must be registered by their parent or guardian on DALEEL using their digital identity (UAE PASS). Source (a Sharjah school's newsletter): https://www.gemswestminsterschool-sharjah.com/-/media/project/gems/wss---gems-westminster-school---sharjah/_files-and-documents/newsletters/nl28-25424.pdf
- A Sharjah school's admissions policy says students cannot attend until DALEEL registration is finalised, and lists the documents it collects: the child's passport, visa and Emirates ID, birth certificate and vaccination card, both parents' passports, visas and Emirates IDs, and a transfer certificate (attested when from another emirate or abroad). Source: https://www.wesgreeninternationalschool-sharjah.com/en/-/media/project/gems/wgp_wesgreen_international_school_sharjah/_files-and-documents/policies/2024-2025/wgp-admission-policy.pdf
- SPEA's policy on learners' enrollment in private schools (November 2022) was listed on spea.shj.ae, but the PDF link now returns "not found", so we could not read it in full. Its first page gives the number as SPEA-6.1-01.0 in Arabic and SPEA-8.1-01.0 in English. The 10 consecutive or 15 total days absence preset in attendance settings comes from that policy as cited by the attendance module; please confirm it with SPEA.
- SPEA also runs a "permit to practise" service for staff of private schools (https://spea.shj.ae/en/services/renewal-permit-to-practice), which is why the staff return lists permit numbers as a field Horizon does not hold.
- No census or statistics return format was found on spea.shj.ae.

**Format to be confirmed with SPEA:** every return. DALEEL registration itself is done in DALEEL by parents and the school; Horizon records each learner's status and reference (Admissions, Government registration) and lists them on the learner registration list.

### KHDA (Dubai)

- Search results point to KHDA's "Register New Student" service page (https://web.khda.gov.ae/en/Services/Student-Related-Services/Requesting-Student-Registration) and to a Dubai Pulse dataset page (https://www.dubaipulse.gov.ae/data/khda-schools/khda_private_schools_in_dubai-open) that reportedly says schools upload or update student information during the census period. **Both sites returned "service unavailable" every time we tried to open them, so we could not confirm what they say.** We do not rely on them.

**Format to be confirmed with KHDA:** every return, including the census.

### ADEK (Abu Dhabi)

- ADEK's School Student Administrative Affairs Policy (version 1.1, September 2024; effective AY 2024/25, compliance from AY 2025/26) says schools "shall register all their students on the ADEK Enterprise Student Information System (eSIS)", shall update the student profile in eSIS with the new Emirates ID card, shall update registrations on eSIS for transfers within the emirate, and shall report attendance "to ADEK daily on eSIS". It also lists the registration documents (registration form with the child's contact information, birth certificate, passport, Emirates ID or diplomatic card, parents' passports and residency) and treats absence above 5% of calendar days (10% in KG) as a cause for concern. Source (a copy published by an Abu Dhabi school): https://reptonabudhabi.org/wp-content/uploads/sites/16/2024/10/ADEK_S_Student_Administrative_Affairs_Policy.pdf
- ADEK's eSIS user guide says eSIS serves charter and private schools and nurseries for school profiles, admitting, transferring and withdrawing students, next year's reservations and parent requests. It does not publish field lists. Source: https://guides.adek.gov.ae/Esis/tc
- A news report on ADEK's record-keeping policy lists what student records must hold (personal details such as name, date of birth, gender, nationality and parent details, attendance, progress, and more). Source: https://gulfnews.com/uae/education/abu-dhabi-schools-mandated-to-maintain-student-records-with-specific-data-points-1.500010843

**Format to be confirmed with ADEK:** every return. eSIS is a system schools work in directly (daily attendance, registrations); Horizon's returns help you check and reconcile what you enter there.

### Ministry of Education: Al Manhal

- A Ministry news item says schools must approve a student's file after the Ministry registers it "via Al Manhal portal", registering students by their ID cards. It concerns government schools; we found no current public page on how private schools use Al Manhal. Source: https://www.moe.gov.ae/En/MediaCenter/News/Pages/registration2020.aspx
- The UAE government portal says the Ministry manages registration of private schools except in Abu Dhabi (ADEK), Dubai (KHDA) and Sharjah (SPEA). Source: https://u.ae/en/information-and-services/education/licensing-private-educational-institutes

**Format to be confirmed with the Ministry of Education:** every return.
