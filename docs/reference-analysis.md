# Reference Analysis

The five repositories listed in docs/master-spec.md were shallow-cloned into /tmp for inspection only. None of them is part of this repo.

## 1. frappe/education
- License: GNU GPL v3 (`license.txt`). Pattern reference only. No code copied.
- What it is: Frappe/ERPNext education app (Python doctypes plus a Vue frontend).
- Patterns we take:
  - The academic structure vocabulary: Academic Year, Academic Term, Program, Course, Student Group, Instructor, Guardian, Guardian-Student link with relationship. Our `AcademicYear`, `Term`, `Department`, `Subject`, `SchoolClass`, `Enrollment`, `Guardian`, `GuardianLink` follow this shape.
  - Guardian links as a separate join with a relation type, so one guardian can hold several children and one child several guardians.
  - Assessment plans and grading scales as data rather than code (informs our aptitude question bank design).
- Code copied: none.

## 2. academix-platform/academix
- License: no license file. The README says "intended for educational and demonstration purposes". Without an explicit license, all rights are reserved, so we treat it as pattern reference only. No code copied.
- What it is: Next.js App Router + Prisma + Clerk school management system with role portals and next-intl (`messages/en.json`, `messages/ar.json`).
- Patterns we take:
  - Role-based portals with a route-permission map checked in middleware. We check permissions server side with `can()` instead of middleware only.
  - next-intl setup with `routing.ts`, `request.ts` and `navigation.ts` in `src/i18n`. This is the standard next-intl layout, which we also use.
  - Role home redirects after login (admin, teacher, student, parent each land on their own dashboard).
- Code copied: none.

## 3. calcom/cal.diy
- License: the cloned repo's `LICENSE` file reads MIT. Our CLAUDE.md lists cal.diy with the AGPL/GPL group and says not to paste its source, and CLAUDE.md wins on conflicts, so we reimplement from its patterns and copy nothing (logged in docs/decisions.md).
- Patterns we take (from `packages/features/schedules/lib/slots.ts` and `date-ranges.ts`):
  - Convert weekly availability plus date overrides into concrete date ranges in the host time zone, then subtract busy ranges.
  - Generate slots by stepping through each range at the event frequency, rounding the first slot to the interval.
  - Apply minimum booking notice as a cut-off from "now".
  - Buffers before and after are applied by expanding busy ranges, not by shrinking the slot.
  - Round-robin hosts: union of every host's slots, then assign the least-booked available host at booking time.
- Code copied: none.

## 4. heyform/heyform
- License: GNU AGPL v3. Pattern reference only. No code copied.
- What it is: conversational form builder.
- Patterns we take:
  - A field-kind enum as the single source of truth for the builder palette and the renderer (short text, long text, number, email, phone, date, time, yes/no, multiple choice, picture choice, rating, opinion scale, file upload, signature, statement, legal terms, group, hidden fields).
  - Logic rules stored as data on the form (condition on a field value, action show/hide/jump).
  - Form versions published as immutable snapshots; submissions reference the version they were made against.
- Code copied: none.

## 5. christex-foundation/career-guidance-platform
- License: `package.json` says ISC, but the repo has no LICENSE file. We treat it as pattern reference only and write our own code and data.
- What it is: Next.js + Prisma career guidance app with an aptitude quiz, career catalog, recommendations, mentors and progress tracking.
- Patterns we take:
  - Quiz questions with options that carry weighted scores, and student responses stored per question.
  - Careers linked to skills, recommendations stored per student with a match score.
  - A goals and progress model, which maps to our action plans and tasks.
- Our differences: deterministic scoring across 9 aptitude dimensions (no AI needed to score), recommendations stay DRAFT until a counselor approves them, and the catalog is bilingual and UAE focused.
- Code copied: none.

## Summary
No source code from any reference repository is copied into this project. docs/third-party.md lists the open source libraries we depend on and any permissively licensed snippets we adapt.
