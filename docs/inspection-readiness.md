# Inspection readiness: the evidence pack and its framework mapping

## What the evidence pack is

School administrators and principals (permission `inspection.view`) open **Administration > Inspection evidence** (`/admin/inspection`), choose a period (last 30 days, last 90 days, this academic year or custom dates) and see the records Horizon already holds, grouped under the headings an inspection usually asks about. Each heading is labelled "Evidence commonly requested in inspections".

The pack collects records. It does not state, score or certify compliance with any framework, and the page, the PDF and the CSV all say so.

| Heading | What is counted |
|---|---|
| Safeguarding | Concerns opened (by status), high or immediate concern level, median time to first response, share responded to within 24 hours, awaiting a first response, resolved or closed, open now, led by the DSL or deputy, number of DSLs and deputies, external referrals, recorded family notification decisions. Training records are shown as "Not recorded in Horizon" (Horizon has no training register yet). |
| Wellbeing and counseling | Wellbeing cases opened (by status), median time to first response, within 24 hours, resolved or closed, open now, counseling sessions held and booked. |
| Parent communication and engagement | Messages delivered by channel, in-app notifications to parents, announcements to families, parent meetings by outcome, requests from parents, median turnaround, share completed within the service time. |
| Student support and careers guidance | Career assessments completed, university plans approved, career guidance sessions held, university applications by stage (as of today), applications submitted, university fairs and visits held, registered students who attended. |
| Attendance and academics | Attendance rate and records by status, unexcused absences (or "Not recorded"), assessments published and grades recorded. |
| Policies and compliance records | Processing purposes, consent records, retention policies and when they were last applied, approved cross-border transfers, data subject requests (received, on time), data incidents, audit log entries, audited views of sensitive records, evidence pack downloads. |

**First response** is the first note on a case, other than a system note or a note by the person who raised it, written after the case was opened.

## Sensitive cases

Safeguarding and wellbeing cases appear only as counts and timings. Names, summaries and notes are never part of the pack. A viewer whom `src/server/access/case-access.ts` allows to open a case in full (for example the DSL for safeguarding, or a role with `cases.wellbeing` for wellbeing) can choose **Show case references**, which lists case numbers, status and dates only. Each listed case writes an AuditEvent (`inspection.case_reference_view`). References are never included in the PDF or CSV.

Every download (PDF or CSV) writes an AuditEvent (`inspection.export`) with the format and dates.

## The framework mapping

Each heading shows which area of each UAE regulator's framework it is likely to relate to: KHDA (Dubai), ADEK (Abu Dhabi), SPEA (Sharjah) and the Ministry of Education. The school's own regulator (Organization.regulator) is listed first and printed on the PDF.

The mapping is **data, not code**: one `InspectionMapping` row per school, heading and framework (`headingKey`, `framework`, `areaEn`, `areaAr`, `noteEn`, `noteAr`, `customized`). Defaults come from `defaultMapping()` in `src/server/inspection/mapping.ts` and are installed for every school by the starter template (`ensureInspectionMapping`, which never overwrites a row the school already has). A school's row always wins over the default; a missing row falls back to the default.

Defaults are a suggested starting point:

- KHDA, ADEK and MoE rows name the performance standards of the UAE School Inspection Framework: standard 5 (protection, care, guidance and support of students) for safeguarding and careers guidance; standards 5 and 2 for wellbeing; standard 6 (leadership and management) for parent engagement and for policies and compliance records; standards 1 and 2 for attendance and academics.
- SPEA rows carry the same text with a note that SPEA uses its own school evaluation framework and the school must match the heading to the right SPEA area.
- Every row carries the note "Suggested starting point. Check your regulator's current framework and edit this mapping if it differs."

**The school must check its regulator's current framework.** Frameworks are revised; Horizon does not track those changes. There is no editing screen yet; until there is, a platform administrator can update a school's rows (set `customized = true`), and the page shows an "Edited by the school" label on them.

## Files

- `src/server/inspection/evidence.ts`: the aggregates and case references.
- `src/server/inspection/mapping.ts`, `seed.ts`: defaults, resolution and seeding.
- `src/server/inspection/pdf.ts`, `format.ts`: bilingual PDF on the school letterhead and the CSV.
- `src/app/api/inspection/export/route.ts`: downloads (audited).
- Tests: `tests/unit/inspection.test.ts`, `tests/integration/inspection-events.test.ts`.
