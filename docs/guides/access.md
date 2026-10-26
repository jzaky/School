# Roles and access: a guide for the school IT team and leadership

Horizon lets your IT team and administrators run the school day to day without being able to quietly give themselves access to safeguarding, wellbeing, medical or other sensitive records. This page explains the rules in plain English.

## Who can do what

- Every person has one or more **roles** (School Administrator, Teacher, Designated Safeguarding Lead and so on). A role is a list of permissions. Open **Roles and access** to see each role and switch permissions on or off.
- Some permissions are marked **Sensitive**: safeguarding cases, wellbeing cases, medical records, reasons for absence, full identity numbers, the audit log, managing roles and managing integrations. Giving one to a role asks you to type the role's name to confirm.
- The School Administrator role does **not** include safeguarding, wellbeing or medical access. Running the school and reading child protection records are different jobs.

## Nobody can raise their own sensitive access

If you manage roles, you can change other people's access, but you cannot increase your **own** access to anything sensitive. Horizon refuses it whichever way you try:

- switching on a sensitive permission in a role you hold;
- adding yourself to a role that has sensitive permissions you do not already have;
- restoring a role you hold to its default when the default has more sensitive access;
- deleting a role you hold and moving its members (you) into a more powerful role;
- making a copy of a sensitive role and then joining it;
- importing a staff spreadsheet with your own row and a sensitive role;
- accepting a staff join link while you are already a member;
- keeping your own time-limited sensitive access for longer.

On screen these options are locked and say why. If someone tries anyway, the server refuses and the attempt is written to the audit log as "Self-grant refused".

Another person who manages roles (for example the Principal) has to make the change. You can always **lower** your own access, as long as the school keeps at least one person who can manage roles and you do not lock yourself out.

**Tip for a new school:** if you are the only person who manages roles, invite the Principal first. Then the Principal can give the safeguarding roles to the right people, including you if that is your job.

## The safeguarding lead is told about every change

Whenever a role or a person gains or loses any of these, everyone who manages safeguarding (normally the DSL and the Deputy DSL) gets a notification in Horizon and an email:

- see safeguarding cases, manage safeguarding cases, export safeguarding records, emergency access;
- wellbeing cases.

The message says who made the change and what changed. It never includes anything about a case. If the person who made the change is the only one who manages safeguarding, the Principal is told instead. These alerts cannot be switched off.

## Time-limited access

When you add someone to a role you can choose **Until** a date, for example cover for the DSL during their leave, or a contractor helping the IT team for a month.

- Access lasts until the end of that day (Dubai time). From the next morning it stops working on the person's very next click, even before the overnight tidy-up removes it.
- Every night Horizon removes ended assignments, records each one in the audit log and tells the safeguarding lead if safeguarding or wellbeing access ended.
- On a role's page you can **Change end** (extend it or end it sooner) or **End now**. Everyone keeps at least one role without an end date.
- You can end your own sensitive cover early, but not extend it yourself.

## Who can see what

**Roles and access > Who can see what** lists everyone who can see safeguarding, wellbeing, medical records, absence reasons, identity numbers or the audit log, or who can manage roles, sign-in or integrations. For each person it shows the role that gives the access, whether it ends on a date, and when they were last active. It shows people and roles only, never records.

The DSL can open this page too (under Administration), without being able to change roles. Use **Export CSV** for the inspection file; every export is recorded in the audit log.

## Checking the history

Open **Audit log** and choose **Access changes** to see every role and permission change, who was given which role and until when, access that ended, exports of the access report and refused self-grants. People who can see safeguarding records also see every use of emergency access to a restricted case there.
