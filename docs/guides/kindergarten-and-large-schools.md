# Kindergarten grades and large schools: a guide for school staff

This guide explains how Horizon shows KG1 and KG2, how to import kindergarten children, and how to find people in a school with well over a thousand students. The technical measurements behind "tested at full size" are in docs/capacity.md.

## KG1 and KG2

Horizon stores a grade as a number and always shows its name:

| Stored | English | Arabic |
| --- | --- | --- |
| -1 | KG1 | الروضة الأولى |
| 0 | KG2 | الروضة الثانية |
| 1 to 12 | Grade 1 to Grade 12 | الصف 1 to الصف 12 |

With a section the names read "KG1 A" and "Grade 9B" (Arabic: "الروضة الأولى A", "الصف 9B"). Short badges on student cards, class lists and the timetable read "KG1 A", "KG2", "9B" (Arabic: "روضة 1 A", "روضة 2", "9B").

You see the name everywhere a grade appears: student cards and profiles, class lists and filters, the timetable, a parent's My children, report cards, letters and documents, exams, trips, the calendar, curriculum plans, search, exports and AI drafts. Spreadsheet exports write KG1 and KG2 (not -1 and 0) so they read correctly in Excel. The API (src/server/integrations) keeps the number and documents it: gradeLevel -1 is KG1 and 0 is KG2.

Grade filters (students list, people, classes, registration, exams) offer the grades your school actually has this year, so a KG to Grade 12 school sees KG1 to Grade 12 and a secondary school sees only its own grades. University pathways and the programme search are for Grade 9 and above; a parent with a KG child and a Grade 10 child sees only the older child there.

Letter templates written before this change that say "Grade {{student.grade}}" now print the grade name, so a KG1 child's letter says "KG1", not "Grade -1". New templates can use {{student.gradeName}}.

### A child who has not started yet

A child enrolled for a start date in the future appears on My children with "Starts on 14 November" instead of an attendance figure. A child with no attendance marks yet shows "No attendance marks yet". Attendance is only shown once there is something to count.

### Importing kindergarten children

The student import (Administration, People, Import, and the Import center) accepts any of these in the grade column:

- KG1, KG 1, PK, Pre-KG, FS2, روضة أولى, الروضة الأولى, روضة 1: all read as KG1
- KG2, KG 2, KG, K, Kindergarten, روضة ثانية, الروضة الثانية, روضة 2: all read as KG2
- 1 to 12, Grade 9, G9, Gr 9, الصف 9, الصف التاسع, and Arabic-Indic digits such as ٩
- -1 and 0 also work, for files exported from another system

Class imports name kindergarten homerooms "KG1 A" and "KG2 B" automatically. Where a list of grades is asked for (the grades a teacher teaches in the staff import), ranges such as "KG1-KG2" or "KG1-12" are accepted.

## Finding people in a large school

Lists of people are paged on the server. Nothing is cut off silently: the line above each list says "Showing 1 to 50 of 1,554", and Previous and Next move through the pages. This applies to the students list, Administration > People (staff, students and families), invitations, lesson plans and the university pathways list.

- **Search first.** The search box looks at first and last names in English and Arabic, the preferred name and the student number. Each extra word narrows the search, so "Adam Nasser" finds Adam Nasser and not every Adam.
- **Grade chips** filter by grade and keep your search.
- **Pickers** (choose a student or a guardian in a form, a join request, an invitation, a document or the access check) search as you type and show the first 20 matches. Type more of the name to narrow it down; the picker says so when there are more matches.

## What "tested at full size" means

Horizon was loaded with a synthetic school the size of a large Sharjah school (1,554 students from KG1 to Grade 12, 2,483 guardians, 180 staff, a full year of daily and lesson attendance, gradebooks, fees, admissions and messages) and every main page was timed for each role, then 1,000 parents, 120 teachers and 1,000 fee payers were simulated at once. The numbers, what was fixed as a result and the recommended server size are in docs/capacity.md. That data lives only in a test database; it is never part of the demo school.
