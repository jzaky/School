import type { Ctx } from "@/server/context";
import { pick, personName } from "@/lib/i18n-data";
import { listableCaseWhere, SENSITIVE } from "@/server/access/case-access";
import { visibleStudentIds } from "@/server/access/student-access";

export type CalKind = "appointment" | "task" | "event" | "deadline" | "followup";
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
    const events = await db.calendarEvent.findMany({ where: { orgId, startsAt: { lt: to }, endsAt: { gt: from }, audience: { hasSome: audience } } });
    for (const e of events) {
      const kind: CalKind = e.kind === "DEADLINE" ? "deadline" : "event";
      if (!kinds.includes(kind)) continue;
      items.push({ id: `e-${e.id}`, kind, title: pick(locale, e.titleEn, e.titleAr), subtitle: pick(locale, e.descEn, e.descAr) || undefined, start: e.startsAt.toISOString(), end: e.endsAt.toISOString(), allDay: e.allDay, color: e.kind === "HOLIDAY" ? "#10B981" : e.kind === "EXAM" ? "#EF4444" : undefined });
    }
  }
  if (kinds.includes("deadline") && (studentIds.length || ctx.isStudent)) {
    const ids = ctx.isStudent && ctx.membership.student ? [ctx.membership.student.id] : studentIds;
    const entries = await db.shortlistEntry.findMany({ where: { orgId, studentId: { in: ids }, deadline: { gte: from, lt: to } }, include: { university: true } });
    for (const e of entries) items.push({ id: `d-${e.id}`, kind: "deadline", title: pick(locale, e.university.nameEn, e.university.nameAr), subtitle: e.programEn, start: e.deadline!.toISOString(), end: e.deadline!.toISOString(), allDay: true, href: "/career" });
  }
  if (kinds.includes("followup") && ctx.isStaff && memberIds.length) {
    const cases = await db.case.findMany({ where: { AND: [listableCaseWhere(ctx, "dashboard"), { assigneeId: { in: memberIds }, nextFollowUpAt: { gte: from, lt: to } }] }, include: { student: true } });
    for (const c of cases) items.push({ id: `f-${c.id}`, kind: "followup", title: pick(locale, c.titleEn, c.titleAr), subtitle: personName(c.student, locale), start: c.nextFollowUpAt!.toISOString(), end: c.nextFollowUpAt!.toISOString(), allDay: true, href: `/cases/${c.id}` });
  }
  return items.sort((a, b) => a.start.localeCompare(b.start));
}
