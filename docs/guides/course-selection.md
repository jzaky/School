# Course selection: windows, late changes, class sessions and help with choosing

This guide is for school staff. It explains how students choose their courses in Horizon, when they can,
and how teachers, counselors, parents and the school office can help.

## The idea in one paragraph

Students choose their courses (one in each option block) during a **selection window**: a period with an
opening and a closing date and time, set per school year and per grade. Before the window opens, students
see "Opens on ...". While it is open, they see a countdown to closing. After it closes, their choices are
locked and the screen tells them who to ask. The school office can still change choices after closing;
those changes are labelled "Changed after closing" and kept in the audit log. All times are Dubai time.

## For the school office (staff with "Run subject registration")

Open **Administration, Subject registration, Selection windows** (`/admin/registration/windows`).

### Set a window
1. Press **New window**.
2. Pick the school year: this year, or next year's course selection.
3. Pick the grades. These are the grades students are in **now**: for next year, a Grade 9 student
   chooses Grade 10 courses, so pick Grade 9.
4. Set the opening and closing date and time (Dubai time). Choosing is open from the opening time until
   the closing time.
5. Optionally name the round in English and Arabic (for example "Round 1" or "Round 2 for students whose
   first choices were full").
6. Save. The closing deadline appears on the school calendar for those grades.

You can run several rounds for the same year, one after another. Two windows for the same grade cannot
overlap. **Edit** changes dates or grades; **Close now** ends a window straight away.

### Rules for your school
On the same page, under **Rules for this school**:
- **Parents can make course choices**: *Always* (whenever choosing is open), *Only when allowed* (the
  student, a teacher or the office allows a named parent first) or *Never, sign-off only*.
- **A parent confirms the choices**: after choices are submitted, a parent signs them off.
- **A parent's own choices count as their sign-off**: when off, the other parent or the student confirms
  what a parent chose.

### Follow progress
Press **Progress** on a window. You see how many students have not started, are part way through, have
submitted or are signed off, by homeroom and by student. Filter by grade, homeroom or status.
- **Remind ... students not finished** sends a reminder to each student who has not finished, and their
  parents. Pressing it again on the same day does not send a second reminder.
- **Export CSV** downloads one row per student with the status and the options chosen (recorded in the
  audit log).
- The side panels list the late changes, assisted choosing and class sessions active right now, with who
  allowed them and until when.

### Automatic messages
Students and parents receive a message when a window opens, 3 days and 1 day before it closes (only those
who have not finished), and a summary of what was recorded when it closes. Each message is sent once.
People can turn these off under Settings, "Course selection: dates, reminders and help". You can edit the
wording under Message templates (keys starting with `course_selection_`).

## Late changes for one student

A student's homeroom teacher, subject teachers, counselor or career advisor (with the "Help students choose
courses" permission), or the school office, can open the student's course screen and press
**Allow changes**. Choose until when and write a reason (required, kept in the audit log). The student and
their parents are told. **End** stops it early.

## Class choosing session (homeroom teachers)

Use this during a homeroom period, even when the window is closed or not open yet.
1. Open **Help students choose, Class session** (`/subjects/session`).
2. Pick how long (15 minutes to 2 hours) and press **Start session**.
3. Show the QR code or the short link (for example `.../choose/K7Q2MX`). Students scan it on their phones
   and land on their own course screen.
4. Watch who has finished, who is still choosing and who is waiting for a parent to sign off. The list
   updates every few seconds. **Class screen** shows a large QR code and the count for a projector.
5. The session ends by itself at the set time, or press **End session**. Starting and ending are audited.

## Help a student choose (assisted choosing)

Some students have no phone, or want help. Two ways to turn it on:
- **The student** opens **My subjects** and presses **Let someone help me**, picks one of their own
  teachers, their counselor or advisor (or a parent, when your school allows parents only when allowed),
  and optionally an end date (the default is the window's closing time). They can stop it at any time.
- **A teacher or the office** opens the student's course screen and presses **Turn on assisted choosing**.
  The student and their parents are told who can help and until when.

The helper opens **Help students choose** (`/subjects/help`), finds the student under "Asked for your
help" or by searching their own students, and presses **Help choose**. They see the student's real course
screen, with a banner "Choosing on behalf of ...", the same AP guidance and university impact the student
sees. Helping covers course selection only: no cases, wellbeing or medical information.

The window rules still apply to helpers, unless a late change or a class session is active. Every choice
shows who made it, for example "Chosen by Daniel Carter for Adam on 26 Oct", and parent sign-off still
applies.

## Parents

- With *Always*, parents choose on their child's course screen while choosing is open.
- With *Only when allowed*, a parent chooses only after the student (or a teacher or the office) allowed
  them. Otherwise the screen says the student makes these choices.
- With sign-off on, parents see **Confirm these choices** once choices are submitted.

## A new school

Nothing is open until you add a window. Students see "Course selection is not scheduled for this grade
yet" and can look at the options. The default rule is that parents can choose whenever choosing is open,
without sign-off; change it under Rules for this school.
