import type { Ctx } from "@/server/context";
import { pick, personName } from "@/lib/i18n-data";
import { listableCaseWhere, SENSITIVE } from "@/server/access/case-access";
import { visibleStudentIds } from "@/server/access/student-access";
import { timetableCalendarItems } from "@/server/timetable/calendar";
import { applicationCalendarItems } from "@/server/applications/calendar";

export type CalKind = "appointment" | "task" | "event" | "deadline" | "followup" | "cover" | "lesson";
export type CalItem = { id: string; kind: CalKind; title: string; subtitle?: string; start: string; end: string; allDay: boolean; href?: string; color?: string };
export type CalScope = { kind: "me" } | { kind: "staff"; membershipId: string } | { kind: "department"; departmentId: string } | { kind: "student"; studentId: string };

/** Everything that belongs on a calendar in a date range, respecting what the member may see. */
export async function calendarItems(ctx: Ctx, from: Date, to: Date, scope: CalScope, kinds: CalKind[]): Promise<CalItem[]> {
  const { db, orgId, locale } = ctx;
  const items: CalItem[] = [];
  let memberIds: string[] = [ctx.membershipId];
  let studentIds: string[] = [];
  if (scope.kind === "staff" && ctx.isStaff) memberIds = [scope.membershipId];
  if (scope.kind === "department" && ctx.isStaff) {
    const staff = await db.staffProfile.findMany({ where: { orgId, departmentId: scope.departmentId }, select: { membershipId: true } });
    memberIds = staff.map((s) => s.membershipId);
  }
  if (scope.kind === "student") {
    const allowed = await visibleStudentIds(ctx);
    if (allowed === null || allowed.includes(scope.studentId)) studentIds = [scope.studentId];
    memberIds = [];
  }
  if (ctx.isParent && scope.kind === "me") studentIds = ctx.membership.guardian?.links.map((l) => l.studentId) ?? [];

  if (kinds.includes("appointment")) {
    const appts = await db.appointment.findMany({
      where: {
        orgId,
        status: { in: ["CONFIRMED", "SCHEDULED", "COMPLETED"] },
        startsAt: { lt: to },
        endsAt: { gt: from },
        OR: [
          ...(memberIds.length ? [{ hostId: { in: memberIds } }, { attendees: { some: { membershipId: { in: memberIds } } } }] : []),
          ...(studentIds.length ? [{ studentId: { in: studentIds } }] : []),
        ],
      },
      include: { type: true, attendees: { select: { membershipId: true } } },
    });
    // Meetings on sensitive cases only show for people who can see the case, or who were invited to the meeting.
    const caseIds = [...new Set(appts.map((a) => a.caseId).filter(Boolean))] as string[];
    const sensitiveCases = caseIds.length ? await db.case.findMany({ where: { id: { in: caseIds }, sensitivity: { in: SENSITIVE } }, select: { id: true } }) : [];
    const visibleCases = sensitiveCases.length ? await db.case.findMany({ where: { AND: [listableCaseWhere(ctx, "dashboard"), { id: { in: sensitiveCases.map((c) => c.id) } }] }, select: { id: true } }) : [];
    const students = await db.student.findMany({ where: { id: { in: appts.map((a) => a.studentId).filter(Boolean) as string[] } } });
    for (const a of appts) {
      const invited = a.hostId === ctx.membershipId || a.attendees.some((x) => x.membershipId === ctx.membershipId);
      if (a.caseId && sensitiveCases.some((c) => c.id === a.caseId) && !visibleCases.some((c) => c.id === a.caseId) && !invited) continue;
      const s = students.find((x) => x.id === a.studentId);
      items.push({ id: `a-${a.id}`, kind: "appointment", title: pick(locale, a.type.nameEn, a.type.nameAr), subtitle: s ? personName(s, locale) : undefined, start: a.startsAt.toISOString(), end: a.endsAt.toISOString(), allDay: false, href: `/meetings/${a.id}`, color: a.type.color });
    }
  }
  if (kinds.includes("task") && memberIds.length) {
    const tasks = await db.task.findMany({ where: { orgId, assigneeId: { in: memberIds }, status: { in: ["TODO", "IN_PROGRESS"] }, dueAt: { gte: from, lt: to }, ...(memberIds[0] !== ctx.membershipId ? { sensitivity: { in: ["STANDARD", "CONFIDENTIAL"] } } : {}) } });
    for (const t of tasks) items.push({ id: `t-${t.id}`, kind: "task", title: pick(locale, t.titleEn, t.titleAr), start: t.dueAt!.toISOString(), end: t.dueAt!.toISOString(), allDay: true, href: t.href ?? "/tasks" });
  }
  if (kinds.includes("event") || kinds.includes("deadline")) {
    const audience = ctx.isStudent ? ["all", "student"] : ctx.isParent ? ["all", "parent"] : ["all", "staff", "student", "parent"];
    // Students and families only see events for their grade (or whole-school events), and never drafts.
    const gradeIds = ctx.isStudent && ctx.membership.student ? [ctx.membership.student.id] : studentIds;
    const grades = gradeIds.length ? [...new Set((await db.student.findMany({ where: { id: { in: gradeIds } }, select: { gradeLevel: true } })).map((s) => s.gradeLevel))] : [];
    const gradeWhere = !ctx.isStaff || scope.kind === "student" ? { OR: [{ gradeLevels: { isEmpty: true } }, { gradeLevels: { hasSome: grades } }] } : {};
    let events = await db.calendarEvent.findMany({ where: { orgId, published: true, startsAt: { lt: to }, endsAt: { gt: from }, audience: { hasSome: audience }, ...gradeWhere } });
    // A trip shows only for its participants (it may be for a few classes, not a whole grade).
    const trips = await db.trip.findMany({ where: { orgId, calendarEventId: { in: events.map((e) => e.id) } }, select: { id: true, calendarEventId: true, participants: { where: { studentId: { in: gradeIds } }, select: { id: true } } } });
    if (!ctx.isStaff || scope.kind === "student") {
      const hidden = new Set(trips.filter((tr) => tr.participants.length === 0).map((tr) => tr.calendarEventId));
      events = events.filter((e) => !hidden.has(e.id));
    }
    const tripHref = new Map(trips.map((tr) => [tr.calendarEventId, `/trips/${tr.id}`]));
    for (const e of events) {
      const kind: CalKind = e.kind === "DEADLINE" ? "deadline" : "event";
      if (!kinds.includes(kind)) continue;
      items.push({ id: `e-${e.id}`, kind, title: pick(locale, e.titleEn, e.titleAr), subtitle: pick(locale, e.descEn, e.descAr) || undefined, start: e.startsAt.toISOString(), end: e.endsAt.toISOString(), allDay: e.allDay, href: tripHref.get(e.id) ?? (e.kind === "EXAM" && e.gradeLevels.length ? "/exams" : undefined), color: e.kind === "HOLIDAY" ? "#10B981" : e.kind === "EXAM" ? "#EF4444" : undefined });
    }
  }
  if (kinds.includes("event") && ctx.isStaff && memberIds.length) {
    const duties = await db.examSitting.findMany({ where: { orgId, status: "PUBLISHED", invigilatorIds: { hasSome: memberIds }, startsAt: { lt: to }, endsAt: { gt: from } } });
    for (const x of duties) items.push({ id: `x-${x.id}`, kind: "event", title: pick(locale, `Invigilation: Grade ${x.gradeLevel} ${x.titleEn}`, `مراقبة امتحان: الصف ${x.gradeLevel} ${x.titleAr}`), subtitle: x.room ?? undefined, start: x.startsAt.toISOString(), end: x.endsAt.toISOString(), allDay: false, href: "/exams", color: "#EF4444" });
  }
  if (kinds.includes("deadline") && (studentIds.length || ctx.isStudent)) {
    const ids = ctx.isStudent && ctx.membership.student ? [ctx.membership.student.id] : studentIds;
    const entries = await db.shortlistEntry.findMany({ where: { orgId, studentId: { in: ids }, deadline: { gte: from, lt: to } }, include: { university: true } });
    for (const e of entries) items.push({ id: `d-${e.id}`, kind: "deadline", title: pick(locale, e.university.nameEn, e.university.nameAr), subtitle: e.programEn, start: e.deadline!.toISOString(), end: e.deadline!.toISOString(), allDay: true, href: "/career" });
  }
  if (kinds.includes("deadline")) items.push(...(await applicationCalendarItems(ctx, from, to, { studentIds: ctx.isStudent && ctx.membership.student ? [ctx.membership.student.id] : studentIds, counselorIds: ctx.isStaff ? memberIds : [] })));
  if (kinds.includes("followup") && ctx.isStaff && memberIds.length) {
    const cases = await db.case.findMany({ where: { AND: [listableCaseWhere(ctx, "dashboard"), { assigneeId: { in: memberIds }, nextFollowUpAt: { gte: from, lt: to } }] }, include: { student: true } });
    for (const c of cases) items.push({ id: `f-${c.id}`, kind: "followup", title: pick(locale, c.titleEn, c.titleAr), subtitle: personName(c.student, locale), start: c.nextFollowUpAt!.toISOString(), end: c.nextFollowUpAt!.toISOString(), allDay: true, href: `/cases/${c.id}` });
  }
  if (kinds.includes("cover") || kinds.includes("lesson")) {
    const own = ctx.isStudent && ctx.membership.student ? [ctx.membership.student.id] : studentIds;
    items.push(...(await timetableCalendarItems(ctx, from, to, { memberIds: ctx.isStaff ? memberIds : [], studentIds: own, cover: kinds.includes("cover"), lessons: kinds.includes("lesson") })));
  }
  return items.sort((a, b) => a.start.localeCompare(b.start));
}
