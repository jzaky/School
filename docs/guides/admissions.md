# Admissions and enrollment: a guide for school staff

This guide is for the admissions office, the registrar and school leaders. It covers the whole journey of a new student: the family applies online, the school reviews, assesses and makes an offer, the family pays the seat booking, and one click turns the application into a student record with the family invited to the parent portal. It also covers re-enrollment for next year, leavers with transfer certificates, and registration with the education authority.

Everything works in English and Arabic, on a computer or a phone.

## Who can do what

| Permission | What it allows | Given by default to |
|---|---|---|
| See admissions | The board, applications (without health details), waiting list, places and reports | School administrator, principal, registrar, admissions officer |
| Run admissions | Move applications, book assessments, message families, make offers, record payments, run re-enrollment, change admissions settings | School administrator, registrar, admissions officer |
| Enroll and withdraw students | Create the student from a paid application, complete withdrawals, record government registration | School administrator, registrar, admissions officer |

The built-in role **Admissions Officer** (مسؤول القبول والتسجيل) has all three, plus booking assessments, managing documents and seeing full ID numbers. You can change any role on Settings, Roles.

**Health information stays private.** Admissions staff see only that a child has a medical note or support needs. The details (allergies, conditions, medication, learning support) open only for staff with medical access (the school nurse) or sensitive document access, and every opening is recorded in the audit log. The nurse has a short list at Admissions health review in the menu. Vaccination records are filed as medical documents.

## 1. Set up (once a year)

Open **Admissions, Settings**.

1. **Applications open**: switch on to publish the school's application page. Copy the link (for example `/apply/your-school`) to your website and social media. Choose which years families may apply for (by default the current year and the next).
2. **Age cut-off date**: children are placed by their age on this date. The default is 31 December, following the UAE Ministry of Education's announcement of 17 December 2025 for new admissions from 2026-27 (KG1 age 4, KG2 age 5, Grade 1 age 6 by 31 December). Schools whose year starts in April use 31 March. Please confirm the date with your regulator (SPEA in Sharjah). Children outside the age range are flagged for you, never blocked.
3. **Admission numbers**: a pattern such as `{YYYY}-{SEQ:4}` (2027-0001). You can use `{YY}` for the two-digit year, `{SHORT}` for the school's short name and `{SEQ:3}` to `{SEQ:6}` for the running number. The preview shows the next number.
4. **Offer deadline**: how many days families have to accept an offer (14 by default).
5. **Stages**: rename any stage, hide the optional ones (Documents pending, Assessment booked, Assessed, Seat booking paid, Waitlisted) and add your own review stages, such as "Principal interview".
6. **Documents**: the list of documents families upload, with which are required, from which grade, and which nationalities are exempt (for example no residence visa for UAE nationals). Each type also says where the file goes in the student's record after enrollment.
7. **Registration authority**: SPEA (DALEEL) for Sharjah, MoE (Al Manhal) for Ministry curriculum schools, KHDA for Dubai, ADEK for Abu Dhabi, or your own name. It is chosen from your regulator automatically and can be changed.

Then open **Admissions, Places** and set, for each grade, the number of sections and seats per section, and the seat booking amount in AED. A grade with no sections is not offered on the application page.

## 2. The family applies

The family opens your application page on any phone, in English or Arabic, with your logo and colours. No login is needed to start: they enter an email address and a password and confirm the email with a six-digit code. They can save and come back at any time; the page lists all their applications (one per child).

The wizard asks for:

- the child's details (names in English and Arabic, date of birth, nationality, Emirates ID, passport, home language) and the grade and year of entry, with the age check shown right away;
- previous schooling;
- parents or guardians (relationship, contact details, who the child lives with);
- brothers and sisters at the school, and whether a parent works at the school;
- health and learning support (stored encrypted, see above) and consent;
- documents: PDF, JPG, PNG, WEBP or HEIC photos, up to 10 MB each. Program files, archives and anything else are refused, and every file is checked by its content, not only its name.

When the family submits, the application reaches the board as **New**, the family gets a confirmation email, and the admissions team gets a notice.

**Duplicates**: if another application or a current or former student has the same Emirates ID, or the same name and date of birth, the application shows a "Possible duplicate" warning with a link. Nothing is merged automatically.

**Siblings**: when a brother or sister is found at the school (by the parent's email or the sibling details), the application is linked to them and gets sibling priority.

## 3. Review, assess and decide

Open **Admissions**. The board shows every application by stage. Drag a card to another column or use its menu. Filters at the top narrow by year, grade, a flag (possible duplicates, brothers and sisters at the school, staff children, support needs, expired offers) or a name. Each column shows the first cards and a **Show more** button, so large intakes stay quick. The **List** view shows the same applications as a table and works best on a phone.

On an application you can:

- **Check documents**: accept or reject each file (a rejected file asks the family for a new one), and see what is still missing.
- **Documents pending**: move the application there and send the family a shared message about what is missing. The family's page always shows how many required documents are still missing.
- **Book an assessment**: pick a time from the admissions team's calendar. The family gets the date by email and sees it on their page.
- **Record the outcome**: recommended, recommended with conditions, or not recommended, with notes.
- **Conversation**: messages marked **Shared** reach the family by email and on their page; **Staff only** notes never do.
- **Make an offer**: choose the section and the deadline; the bilingual offer letter (PDF) is created from the school's letter template and the family can accept or decline on their page. If no seat is free in the grade, Horizon says so and suggests the waiting list; you can still make the offer by giving a reason, which is recorded.
- **Waiting list**: puts the application on the list for the grade. **Admissions, Waiting list** orders it by priority (brothers and sisters at the school, verified children of staff, and any extra priority you give) and then by the date the child joined the list. When a seat frees up, offer it to the first child.
- **Decline** or **Withdraw**: always with a reason. Families are told politely, never with internal notes.

Every step is recorded in the application's history.

## 4. Seat booking

When the family accepts the offer, the seat booking amount for the grade is shown on their page.

- **Today**: the family pays the school as usual (bank transfer, card at the finance office, or the school's payment portal if you have set its link in school settings). Finance or admissions then presses **Mark paid** on the application and enters the receipt number. The application moves to Seat booking paid.
- **With the fees module**: when the school's fees module is switched on for seat booking, accepting an offer creates the charge automatically (once per application), the family sees a payment link, and the application moves to Seat booking paid as soon as the payment clears. No one needs to press Mark paid.

## 5. Enroll in one click

On a paid application, press **Enroll**. Choose the homeroom (or leave it for later) and whether to email the family their portal invitations. Horizon then:

- creates the student record with the admission number from your pattern, the grade, section and homeroom;
- finds the parents already at the school (same email, or same phone and first name as a sibling's parent) and links them instead of creating copies; new parents get a record of their own;
- links brothers and sisters to the same family;
- copies every accepted document into the student's record, in the right category;
- sends each parent an invitation to the parent portal, and shows the invitation links once so you can copy one and send it another way;
- opens the government registration step (below) and records everything in the audit log.

A child admitted for next year is created as "starting next year" and becomes active automatically on the first day of that year.

If the duplicate check found a former student, you can re-admit that record instead of creating a new one.

## 6. Government registration (SPEA DALEEL, MoE Al Manhal, KHDA, ADEK)

In Sharjah every learner in a private school must be registered in SPEA's DALEEL system, and may not attend until SPEA approves them (SPEA policy SPEA-8.1-01.0). Transfers, withdrawals and re-enrollment also go through DALEEL. Other emirates have similar systems. None of them offers a public connection for other software, so the school enters the student in the authority's system and records each step in Horizon:

1. Open **Admissions, Registration**. New students and leavers waiting for the authority are listed with their status: not submitted, submitted, approved or rejected.
2. Open the **registration sheet** (printable, English and Arabic) or download the CSV, and type the details into the authority's system.
3. Press **Update** and record "Submitted" with the date, then "Approved" with the authority's reference number and approval date (or "Rejected" with the reason, fix it and submit again).

Until approval the student shows "Awaiting SPEA approval" (or your authority's name) on the admissions board, the class list and the student's page, so teachers know the place is not final.

## 7. Re-enrollment for next year

Open **Admissions, Re-enrollment** and open a window for next year: the dates, a message to families, and the days before closing when reminders go out (for example 7 and 2 days before).

- Parents see **Next year's places** in their menu while the window is open and confirm, for each child, "returning" or "leaving" (with a reason). They can change their answer until the window closes.
- The dashboard shows, per grade, how many are returning, leaving and not answered yet, with the list of families to follow up.
- Reminders go only to parents who have not answered, automatically on the reminder days, or when you press **Send reminders**. Each parent gets each reminder once, however often the button is pressed.
- A "leaving" answer creates a planned withdrawal on the Leavers page, and frees the seat in next year's places so you can offer it to a new family.

## 8. Leavers and transfer certificates

Open **Admissions, Leavers**. Record a withdrawal (leaving date, reason, destination school) or complete one that came from re-enrollment. Completing it:

- issues a bilingual **transfer certificate** (PDF from your letter template, with its own number), filed in the student's documents and visible to the family;
- marks the student as withdrawn from the leaving date;
- opens the authority's withdrawal registration step.

## 9. Reports

**Admissions, Reports** shows, for the year you choose:

- the funnel: how many applications reached each stage, by grade;
- conversion from application to offer and from offer to enrollment;
- places against enrolled and offered, per grade;
- nationalities and age groups of applicants (totals only, never individual children).

Download any report as CSV or Excel.

## A new school

A school that signs up gets the admissions setup ready: the stages, document types, email templates, offer letter and transfer certificate templates and the assessment appointment type. The board, places and reports are empty with a short explanation of the first step. Set up places, switch applications on, and share the link.
