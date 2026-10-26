# Service Level Agreement

> **Draft prepared without legal review. Have a UAE-qualified lawyer review before signing.**

**Schedule 3 to the Master Services Agreement** reference [agreement number] between Nexus AI Assurance FZCO (the **Supplier**) and Al Durrah International School LLC (the **Customer**).

This Service Level Agreement (**SLA**) sets out how the Supplier supports Horizon, how quickly it responds, the availability target and the service credits if the target is missed. Terms defined in the Master Services Agreement (the **MSA**) have the same meaning here.

---

## 1. Definitions

- **Business Hours:** 08:00 to 17:00 Gulf Standard Time (GST) on Business Days.
- **Business Day:** Sunday to Thursday, excluding UAE public holidays announced for the private sector. [Confirm the school's teaching days. If the school is open on days not covered here, agree whether support hours should be extended.]
- **School Hours:** the hours the Customer's school is open to students and staff, [for example Monday to Thursday 07:00 to 15:30 and Friday 07:00 to 11:30], as notified by the Customer each term.
- **Incident:** an unplanned interruption to the Platform or a reduction in its quality, or a security event.
- **Priority:** the classification of an Incident or request under section 4.
- **Response:** a reply from a member of the Supplier's support team (not an automatic acknowledgement) that confirms the ticket reference and the priority, and gives an initial assessment or the next step.
- **Restoration:** the Platform or the affected feature is working again, or a workaround is in place that lets users carry on with acceptable effort.
- **Permanent Fix:** the root cause is corrected.
- **Monthly Fee:** one twelfth of the annual subscription Fees for the Modules affected, or the equivalent for the invoicing period.
- **Availability** and **Downtime:** as defined in section 6.

## 2. Support channels

| Channel | Details | When |
|---|---|---|
| Support email | [support email] | Monitored during Business Hours |
| Support phone | [support phone] | Business Hours |
| Emergency line (Priority 1 only) | +971 52 377 7246 [confirm this is the emergency number] | [Emergency line hours, for example every day 07:00 to 22:00 GST, plus best effort at other times] |
| Named support contact | [name], [email], [phone] | Business Hours |

2.1 **Who may raise tickets.** Up to [5] people named by the Customer (for example the Head of IT, the school administrator, the registrar and the Designated Safeguarding Lead). Parents, students and other staff contact the school first; the school's named people pass on issues they cannot solve.

2.2 **What to include.** The affected feature, what happened, when, how many users are affected, the browser and device, and steps to reproduce. Use the request or case reference number shown in Horizon.

2.3 **Protecting data in tickets.** Do not put student personal data, medical details or any safeguarding information in a support email or phone message beyond the reference number needed to find the record. For safeguarding issues, say "safeguarding" and give the case reference only; the Supplier will call the Designated Safeguarding Lead back.

2.4 **Language.** Support is provided in English [and Arabic].

## 3. Customer first-line support

3.1 The Customer provides first-line support to its own users: answering how-to questions, resetting access through invitations, checking roles with the Access check screen, and confirming that an issue is real before raising a ticket. The Training Plan prepares the school's administrators and champions for this.

3.2 The Customer's Head of IT, or another named person, is available during Business Hours to help the Supplier diagnose Priority 1 and Priority 2 Incidents.

## 4. Priorities

| Priority | Meaning | Examples |
|---|---|---|
| **P1 Critical** | The Platform is down or unusable for all or most users, a security incident or personal data breach is suspected or confirmed, or child protection work is blocked | Nobody can sign in; pages fail for everyone; suspected unauthorised access to records; staff cannot submit a safeguarding concern or the Designated Safeguarding Lead cannot open safeguarding records; data appears lost or corrupted |
| **P2 High** | A major feature is unavailable or seriously degraded for many users, with no reasonable workaround | Notifications or emails not being sent; letters cannot be generated; one sign-in method (for example Microsoft) fails for all users; approvals cannot be completed; the scheduled sync from the school's system fails on a day it is needed; the course selection window cannot be used during its open period |
| **P3 Normal** | A feature does not work as described, but a workaround exists or only a few users are affected | A filter shows wrong results; one form field misbehaves; a PDF layout issue; a single user cannot see a page they should |
| **P4 Low** | Questions, configuration help, cosmetic issues, translation corrections and feature requests | How to change a workflow; a spelling fix in an Arabic label; a request for a new report |

4.1 The Customer proposes the priority when raising a ticket. The Supplier may change it with reasons. If the parties disagree, the Customer may escalate under section 9, and the higher priority applies until the escalation is resolved.

4.2 Any suspected personal data breach is P1 and is also handled under clause 8 of the Data Processing Agreement.

## 5. Response and resolution targets

| Priority | Response | Progress updates | Restoration target | Permanent Fix target |
|---|---|---|---|---|
| P1 | Within 1 hour, at any time the emergency line is covered | Every [2] hours until Restoration | Within [4] hours | Within [5] Business Days, or a written plan by then |
| P2 | Within 4 Business Hours | Daily | Within [2] Business Days | Within [10] Business Days, or a written plan by then |
| P3 | Within 1 Business Day | Weekly, or when status changes | Within [10] Business Days | Next scheduled release, target [20] Business Days |
| P4 | Within 3 Business Days | When status changes | Not applicable | As agreed; feature requests go on the product roadmap with no commitment unless agreed in writing |

5.1 Times run from when the Supplier receives the ticket through a channel in section 2 (for P1, the emergency line call or the support email, whichever is first).

5.2 Response, update and resolution times are targets the Supplier will use all reasonable efforts to meet. Service credits apply to the availability target in section 6. [Optional: if the P1 Response target is missed more than twice in a calendar month, a credit of [5] percent of the Monthly Fee applies, within the cap in section 7.]

5.3 After every P1 Incident, the Supplier sends a written incident report within [5] Business Days: what happened, the impact, the timeline, the root cause, and what will prevent it happening again.

## 6. Availability

6.1 **Target.** The Supplier will make the production Platform available at least **99.5 percent** of each calendar month, excluding the exclusions in section 6.5.

6.2 **What counts as available.** The production web application at [production URL] is reachable, Authorised Users can sign in and core pages load. A failure of background processing alone (for example delayed emails) is handled as a P2 Incident, not as Downtime.

6.3 **Measurement.** Availability is measured by the Platform's status checks, which test the web application, the database, the background queue and the worker every 5 minutes and are shown on the status page (section 8). A 5-minute period counts as Downtime when the web application or database check fails, or when no check result was recorded for that period. The Customer may also report Downtime it experienced, and the parties will reconcile the two records in good faith. [The Supplier will add an independent external monitor by [date], and from then that monitor's records will also be used.]

6.4 **Calculation.**

> Availability (%) = (minutes in the month minus excluded minutes minus Downtime minutes) divided by (minutes in the month minus excluded minutes), multiplied by 100

For a 30-day month, 99.5 percent allows about 216 minutes (3 hours 36 minutes) of Downtime.

6.5 **Exclusions.** These periods do not count as Downtime:
- (a) **Planned maintenance** announced to the Customer's named contacts at least 48 hours in advance and carried out outside School Hours, up to [4] hours per month in total. Planned maintenance is normally scheduled [after 18:00 GST on a weekday, or on a Saturday].
- (b) **Emergency maintenance** to fix an urgent security vulnerability, announced as early as possible, up to [2] hours per month. Emergency maintenance beyond that counts as Downtime.
- (c) Problems caused by the Customer's own network, devices, browsers, or by use contrary to the MSA.
- (d) Outages of Third-Party Services the Customer chose, for example its own student information system, Google, Microsoft or ClassLink sign-in, or its WhatsApp Business account.
- (e) General internet failures outside the control of the Supplier and its hosting provider.
- (f) Suspension under clause 17 of the MSA, or a Force Majeure Event under clause 20 of the MSA.
- (g) The public demonstration school.

6.6 Outages of the Supplier's own hosting provider and sub-processors are not excluded and count as Downtime.

6.7 **Change freezes.** The Customer may notify up to [6] critical periods per academic year (for example examination weeks, report card publication, the course selection window and the first week of a term), each up to [10] Business Days. The Supplier will not carry out planned maintenance or non-urgent changes during these periods.

6.8 **Releases.** Routine updates are designed to be deployed without planned downtime. Any update that needs downtime is treated as planned maintenance under section 6.5(a).

## 7. Service credits

7.1 If Availability in a calendar month is below the target, the Customer is entitled to a credit against the Monthly Fee for that month:

| Monthly Availability | Service credit |
|---|---|
| 99.5 percent or more | None |
| 99.0 percent to below 99.5 percent | 5 percent of the Monthly Fee |
| 98.0 percent to below 99.0 percent | 10 percent of the Monthly Fee |
| 95.0 percent to below 98.0 percent | 20 percent of the Monthly Fee |
| Below 95.0 percent | 30 percent of the Monthly Fee |

[Proposed values. Adjust before sending.]

7.2 **Cap.** Total service credits in a month will not exceed 30 percent of the Monthly Fee.

7.3 **How to claim.** The Customer claims a credit in writing within 30 days after the end of the month. The Supplier confirms the Availability figure within 10 Business Days. Credits are deducted from the next invoice. If no further invoice is due, the Supplier pays the credit within 30 days.

7.4 **Sole financial remedy.** Service credits are the Customer's sole financial remedy for failure to meet the availability target, without affecting the right in section 7.5.

7.5 **Chronic failure.** The Customer may terminate the MSA, or the affected Modules, by 30 days written notice, and receive a refund of the Fees paid in advance for the period after termination, if Availability is:
- (a) below 99.0 percent in any 3 months within a rolling 6-month period; or
- (b) below 95.0 percent in any single month.

The Customer must give notice within 60 days of the month that gives rise to the right.

## 8. Status page and incident communication

8.1 **Status page:** [production URL]/status shows live checks of the web application, database, background queue and worker, and 90 days of availability history. It shows only up or down, never technical details.

8.2 **During a P1 or P2 Incident,** the Supplier informs the Customer's named contacts by email (and by phone for P1) when the Incident is confirmed, at the update intervals in section 5, and when service is restored.

8.3 **Planned maintenance** notices go by email to the named contacts at least 48 hours ahead, with the start time, expected duration and what users will notice.

8.4 **Monthly report.** By the 10th Business Day of each month the Supplier sends a short report: Availability for the month, Downtime periods and causes, tickets by priority with Response times achieved, open P1 and P2 items, and planned maintenance for the next month.

8.5 **Termly service review.** Once a term, the Supplier's account lead and the Customer's project lead and Head of IT meet for up to one hour to review the reports, open issues, adoption figures and upcoming changes.

## 9. Escalation

If a target is missed, or the Customer is not satisfied with the handling of a ticket, it may escalate as follows.

| Level | Supplier contact | When |
|---|---|---|
| 1 | Named support contact: [name], [email], [phone] | First point of contact for all tickets |
| 2 | Technical lead: [name], [email], [phone] | A P1 not restored within 2 hours; a P2 Response target missed; a disagreement about priority |
| 3 | Managing director: [name], [email], [phone] | A P1 not restored within 4 hours; repeated missed targets in a month; any suspected personal data breach |

| Level | Customer contact |
|---|---|
| 1 | Head of IT: [name], [email], [phone] |
| 2 | School administrator or project lead: [name], [email], [phone] |
| 3 | Principal: [name], [email], [phone] |
| Safeguarding-related Incidents | Designated Safeguarding Lead: [name], [phone]; deputy: [name], [phone] |

## 10. Security incidents and personal data breaches

10.1 A suspected or confirmed security incident or personal data breach is always P1.

10.2 The Supplier notifies the Customer under clause 8 of the Data Processing Agreement: without undue delay and in any case within 72 hours of becoming aware of a personal data breach, by phone and email to the breach contacts.

10.3 Where an incident involves safeguarding records, the Supplier also informs the Designated Safeguarding Lead directly.

## 11. Backups and recovery

| Item | Commitment |
|---|---|
| Database backups | [frequency, for example daily], kept for [backup retention period], stored in [backup location] |
| File storage | [describe protection for stored documents, for example versioning or a second copy, or state that none is in place yet] |
| Recovery point objective (maximum data loss) | [RPO, for example 24 hours] |
| Recovery time objective (time to restore service after a major failure) | [RTO, for example 8 hours] |
| Restore tests | [frequency, for example every term], with the result reported in the next monthly report |

11.1 If Customer Data is lost or corrupted because of the Supplier's failure, the Supplier restores it from the most recent backup at its own cost.

## 12. Out of scope

These are not covered by this SLA, but can be provided at the day rate in the Order Form if agreed in writing:
- custom development or new reports not in the Order Form;
- cleaning or correcting the Customer's source data;
- support for the Customer's Third-Party Services;
- on-site support beyond the Implementation Plan and the Training Plan;
- training for new staff beyond the materials and recorded videos in the Training Plan.

## 13. Changes to this SLA

13.1 This SLA can only be changed by written agreement signed by both parties. The Supplier may improve the service levels at any time without agreement.

---

| For Nexus AI Assurance FZCO | For Al Durrah International School LLC |
|---|---|
| Name: | Name: |
| Title: | Title: |
| Signature: | Signature: |
| Date: | Date: |
