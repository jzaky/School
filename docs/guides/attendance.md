# Attendance and grade publishing: a guide for school staff

This guide explains how your school takes attendance in Horizon, how the attendance office follows up absences, what the reports show, and how grades and report cards reach families when your school uses a publisher.

## Who does what

| Person | What they can do | Permission |
| --- | --- | --- |
| Homeroom teacher | Take the morning register for their homeroom | attendance.take |
| Subject teacher | Take the register for each lesson they teach | attendance.take |
| Cover teacher | Take the register for a lesson they cover that day | attendance.take |
| Attendance office (registrar, school administrator) | Follow up absences, change closed registers, mark late after the cut-off, close and reopen registers, set codes and rules | attendance.manage |
| Principal, counselors, safeguarding lead | Read attendance reports for the whole school | attendance.view_all |
| Attendance team and school nurse | See why a student is away (illness, appointment) | attendance.reasons |
| Head of IT | Release grades and report cards, run integrations and sign-in settings | grades.publish, integrations.manage, signin.manage |

A school can change any of this on Roles and access.

## Taking a register

1. Open **Attendance** in the menu. "Today's registers" lists your homeroom's morning register and your lessons for the day, including lessons you cover. A lesson that someone else covers for you shows who is covering it.
2. Open a register. Tap **All present**, then change the few students who are not: **Late** (minutes are filled in from the time; adjust with the plus and minus buttons), **Absent**, **Excused** or **Activity** (a school trip or event). The **...** button holds the school's other codes.
3. There is no save button. Each mark saves on its own and the bar at the bottom says "All changes saved".

On a computer you can use the keyboard: the arrow keys move between students; P, L, A, E and S (or 1 to 5) mark the student and move to the next one.

If the connection drops, keep going. The marks wait on your device, the bar says how many are waiting, and they are sent as soon as the connection is back (or when you press **Send now**).

Hints on the register:
- "Suggested: E (absence report)" means the family reported the absence and it was approved. The register already shows the student as excused; the reason stays with the attendance office.
- "Suggested: A (morning register)" on a lesson means the student was absent at morning registration.
- "Reason private" means the office recorded a reason you do not need to see. You can still mark the student present if they arrive.

### Times and locks

- **Late cut-off.** Teachers can mark late until the cut-off (by default 30 minutes after the register starts). After that, only the attendance office marks late, and each such mark is recorded in the audit log with the old and the new value.
- **Closing.** Registers close at the end of the school day (15:30 by default), or earlier when the attendance office closes them. After closing, only the attendance office can change a mark, and each change is recorded in the audit log with the old and the new value.
- **Kindergarten.** Grades set as "morning register only" (KG1 and KG2 by default) take no lesson registers.

## Attendance codes

Horizon starts with a default list based on codes common in UAE private schools. Each code says how it counts:

| Code | Meaning | Counts as |
| --- | --- | --- |
| P | Present | Present |
| L | Late | Present, counted as a late arrival |
| LB | Late, school bus | Present, not counted as late |
| SA | School activity or educational visit | Present |
| RL | Remote learning | Present |
| A | Absent, reason not known yet | Absent, unauthorised until the office explains it |
| E | Excused absence | Absent, authorised |
| I, M, F, R, S | Illness, medical appointment, family emergency, religious observance, suspension | Absent, authorised; the reason is private |
| U | Unauthorised absence | Absent, unauthorised |
| N | Not required to attend | Left out of percentages |

Change the list on **Attendance > Settings**: labels in English and Arabic, how each code counts, its report category, whether its reason is private, and which one-tap button it backs. Codes are never deleted, only switched off, so earlier marks keep their meaning. Please check the list against your own attendance policy and the categories your regulator asks you to report.

## The attendance office

**Attendance > Attendance office** shows, for any school day:

- **Absent without a reason**: students marked "absent, reason not known yet" with no absence report. For each one you see the guardians and their phone numbers, the call and message log, and buttons to **Log call**, **Message family** and **Mark explained** (choose the code for the day; the morning mark and the day's absent lesson marks change to it).
- **Morning registers not complete**, with a **Take** button for each homeroom.
- **Regulator absence limit** (when switched on) and **Persistent absence**: counts and percentages only, never reasons.

### The automatic message to families

From the follow-up time (09:30 by default) on a school day, the guardians of each student marked absent without an absence report receive one message in Horizon and by email: the student was marked absent today and the school has no report. It goes out once per student per day, follows each guardian's notification preferences, and appears in the log as "Automatic message to the family". **Send messages now** sends it before the set time.

No automatic message goes out when:
- **the student has an open wellbeing or safeguarding case or request.** The office sees "No automatic message: contact the family yourself" and is notified, without being told why. If you message the family yourself, you must write a reason, which is recorded;
- an absence report for the day is waiting for a decision;
- the school switched automatic messages off;
- the student has no guardian who receives updates.

## Alerts to staff

- **Persistent absence.** When a student's attendance this term falls below the threshold (90% by default, after at least 10 school days), the homeroom teacher and the head of year for the student's grade are told once per term. No reasons are included.
- **Regulator absence limit.** Off by default. When switched on, Horizon counts school days of unexcused absence in the academic year (weekends and holidays on the school calendar are not counted). The attendance office and the head of year are alerted at the warning level (70% of either limit by default) and again when a limit is reached. The Sharjah preset follows the SPEA policy on admission of learners to private schools (SPEA-8.1-01.0): a learner is de-registered after 10 consecutive or 15 separate school days of unexcused absence, based on the school's report. A run of days is broken by a day the student attended or was excused; a school day with no mark neither counts nor breaks it.

Set the heads of year, the threshold and the limit on **Attendance > Settings**.

## Reports

**Attendance > Reports** shows attendance for the whole school, a grade, a homeroom or one student, for a term or any date range:

- attendance percentage (days attended out of possible school days; not-counted days are left out; late arrivals, school activities and remote learning count as attended),
- unauthorised absence (absences still unexplained count here until the office explains them),
- late arrivals and minutes late,
- a daily chart against the school's threshold,
- **CSV** and **Excel** downloads (one row per student),
- for one student, a day-by-day view and an **attendance certificate** PDF in English or Arabic.

Teachers see the classes they teach. Reasons are never shown in reports, exports or certificates.

Families see their own child's attendance this term on the child's page, and can report the reason for an unexplained absence from there.

## Horizon and another register system

On **Attendance > Settings**, choose who keeps the register:

- **Horizon is our register** (default). Teachers take registers in Horizon. The API (`POST /api/v1/attendance`) can add days that have no mark (for example history from an old system), but never changes a mark taken in Horizon or an absence excused by an approved report; those come back with the error code `horizon_register`.
- **Our register is in another system.** Registers in Horizon become read only and the API is the register: it overwrites marks, except that an absence excused by an approved report stays excused if the other system says "absent".

`GET /api/v1/attendance` returns each day's status, the school's code (private codes are returned as the plain excused code) and where the mark came from. The scheduled sync for students, staff, classes and enrollments is not affected by this setting.

## Grade publishing

On **Publishing grades** (school administrators), choose who publishes grades:

- **Teachers publish their own** (default). Each teacher publishes an assessment from the gradebook and families are told at once. Report cards are visible to the family when they are made.
- **Teachers submit, a publisher releases.** Teachers choose **Mark ready for release** in an assessment's menu. People with the grades.publish permission (the Head of IT by default; the school can grant it to others) see the publishing queue, filter it by teacher or class, check how many students have a mark, and publish one, several or all. Publishing notifies students and families once, exactly as before. A publisher can unpublish; the assessment goes back to the ready list. Every publish and unpublish is recorded in the audit log.

Report cards follow the same rule: in publisher mode a report card made by staff stays hidden from the family until the publisher releases it from the **Report cards** tab, and families cannot make their own; they find released report cards in Documents.

## For IT: background jobs

The worker runs two attendance jobs: `attendance.followup` every 5 minutes (each school's automatic message from its own follow-up time) and `attendance.alerts` every hour (persistent absence and the regulator limit). Both are idempotent: one follow-up row per student and day, and one alert per student, period and kind.
