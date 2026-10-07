// Group dashboard KPIs: operational figures only, per member school and in total.
//
// Each school is evaluated on its own through tenantDb(orgId) (Row-Level Security scoped to that school);
// nothing here queries across schools. What may be counted comes from the case access module
// (groupAggregatePolicy): no case figures at all, and only STANDARD requests and tasks, so wellbeing,
// safeguarding, confidential and medical work never reaches group level, not even as a count.
import type { ApplicationStage, Prisma } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";
import { groupAggregatePolicy } from "@/server/access/case-access";
import { setupProgress } from "@/lib/onboarding";

export const GROUP_WINDOW_DAYS = 30;
const DAY = 86_400_000;

export const OPEN_REQUEST_STATUSES = ["SUBMITTED", "IN_REVIEW", "PENDING_APPROVAL", "APPROVED", "IN_PROGRESS"] as const;
/** Appointment types that count as parent meetings. Wellbeing, counseling and learning support meetings never do. */
export const PARENT_MEETING_TYPES = ["parent_teacher_meeting"];
export const APPLICATION_STAGES: ApplicationStage[] = ["RESEARCHING", "SHORTLISTED", "PREPARING", "SUBMITTED", "INTERVIEW", "OFFER", "WAITLISTED", "ACCEPTED", "ENROLLED", "REJECTED"];

export type ServiceUsage = { key: string; nameEn: string; nameAr: string; count: number };

export type SchoolKpis = {
  orgId: string;
  students: number;
  openRequests: number;
  /** Requests completed in the window and the hours they took in total (for a weighted average). */
  closedRequests: number;
  turnaroundHoursTotal: number;
  overdueRequests: number;
  overdueTasks: number;
  parentMeetingsHeld: number;
  parentMeetingsUpcoming: number;
  requestsSubmitted: number;
  serviceUsage: ServiceUsage[];
  onboarding: { done: number; total: number; completed: boolean };
  activeUsers: number;
  accounts: number;
  plansApproved: number;
  plansProposed: number;
  applications: Partial<Record<ApplicationStage, number>>;
};

export type GroupTotals = {
  schools: number;
  students: number;
  openRequests: number;
  closedRequests: number;
  avgTurnaroundHours: number | null;
  overdue: number;
  overdueRequests: number;
  overdueTasks: number;
  parentMeetingsHeld: number;
  parentMeetingsUpcoming: number;
  requestsSubmitted: number;
  serviceUsage: ServiceUsage[];
  onboardingCompleted: number;
  activeUsers: number;
  accounts: number;
  plansApproved: number;
  plansProposed: number;
  applications: Record<ApplicationStage, number>;
  applicationsTotal: number;
};

/** Average turnaround in hours for one school, or null when nothing was completed in the window. */
export function avgTurnaround(k: Pick<SchoolKpis, "closedRequests" | "turnaroundHoursTotal">): number | null {
  return k.closedRequests ? Math.round((k.turnaroundHoursTotal / k.closedRequests) * 10) / 10 : null;
}

/** Totals across schools. The turnaround is weighted by the number of completed requests, not averaged per school. */
export function aggregateGroupKpis(rows: SchoolKpis[], opts: { topServices?: number } = {}): GroupTotals {
  const sum = (f: (k: SchoolKpis) => number) => rows.reduce((a, k) => a + f(k), 0);
  const services = new Map<string, ServiceUsage>();
  for (const k of rows) {
    for (const s of k.serviceUsage) {
      const cur = services.get(s.key);
      if (cur) cur.count += s.count;
      else services.set(s.key, { ...s });
    }
  }
  const applications = Object.fromEntries(APPLICATION_STAGES.map((st) => [st, sum((k) => k.applications[st] ?? 0)])) as Record<ApplicationStage, number>;
  const closedRequests = sum((k) => k.closedRequests);
  const overdueRequests = sum((k) => k.overdueRequests);
  const overdueTasks = sum((k) => k.overdueTasks);
  return {
    schools: rows.length,
    students: sum((k) => k.students),
    openRequests: sum((k) => k.openRequests),
    closedRequests,
    avgTurnaroundHours: avgTurnaround({ closedRequests, turnaroundHoursTotal: sum((k) => k.turnaroundHoursTotal) }),
    overdue: overdueRequests + overdueTasks,
    overdueRequests,
    overdueTasks,
    parentMeetingsHeld: sum((k) => k.parentMeetingsHeld),
    parentMeetingsUpcoming: sum((k) => k.parentMeetingsUpcoming),
    requestsSubmitted: sum((k) => k.requestsSubmitted),
    serviceUsage: [...services.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, opts.topServices ?? 8),
    onboardingCompleted: rows.filter((k) => k.onboarding.completed).length,
    activeUsers: sum((k) => k.activeUsers),
    accounts: sum((k) => k.accounts),
    plansApproved: sum((k) => k.plansApproved),
    plansProposed: sum((k) => k.plansProposed),
    applications,
    applicationsTotal: Object.values(applications).reduce((a, b) => a + b, 0),
  };
}

/** Operational KPIs for one school, read only through that school's tenant client. */
export async function collectSchoolKpis(db: TenantDb, orgId: string, now = new Date()): Promise<SchoolKpis> {
  const policy = groupAggregatePolicy();
  const since = new Date(now.getTime() - GROUP_WINDOW_DAYS * DAY);
  const ahead = new Date(now.getTime() + GROUP_WINDOW_DAYS * DAY);
  // Both the request and its service must be of an allowed sensitivity.
  const req: Prisma.RequestWhereInput = { orgId, sensitivity: { in: policy.requestSensitivities }, service: { sensitivity: { in: policy.requestSensitivities } } };
  const open: Prisma.RequestWhereInput = { ...req, status: { in: [...OPEN_REQUEST_STATUSES] } };
  const [org, students, openRequests, closed, overdueRequests, overdueTasks, meetings, submitted, accounts, activeUsers, plans, apps] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { onboardingSteps: true, onboardingCompletedAt: true } }),
    db.student.count({ where: { orgId, status: "ACTIVE" } }),
    db.request.count({ where: open }),
    db.request.findMany({ where: { ...req, status: "COMPLETED", completedAt: { gte: since, lte: now } }, select: { submittedAt: true, completedAt: true } }),
    db.request.count({ where: { ...open, slaDueAt: { lt: now } } }),
    db.task.count({ where: { orgId, caseId: null, sensitivity: { in: policy.taskSensitivities }, status: { in: ["TODO", "IN_PROGRESS"] }, dueAt: { lt: now } } }),
    db.appointment.findMany({
      where: { orgId, caseId: null, type: { key: { in: PARENT_MEETING_TYPES } }, startsAt: { gte: since, lt: ahead } },
      select: { status: true, startsAt: true },
    }),
    db.request.groupBy({ by: ["serviceId"], where: { ...req, submittedAt: { gte: since, lte: now } }, _count: { _all: true } }),
    db.membership.count({ where: { orgId, status: "ACTIVE" } }),
    db.membership.count({ where: { orgId, status: "ACTIVE", lastSeenAt: { gte: since } } }),
    db.studentCoursePlan.groupBy({ by: ["status"], where: { orgId }, _count: { _all: true } }),
    db.application.groupBy({ by: ["stage"], where: { orgId }, _count: { _all: true } }),
  ]);
  const serviceRows = submitted.length
    ? await db.serviceDefinition.findMany({ where: { orgId, id: { in: submitted.map((s) => s.serviceId) } }, select: { id: true, key: true, nameEn: true, nameAr: true } })
    : [];
  const serviceUsage: ServiceUsage[] = submitted
    .map((s) => {
      const svc = serviceRows.find((x) => x.id === s.serviceId);
      return svc ? { key: svc.key, nameEn: svc.nameEn, nameAr: svc.nameAr, count: s._count._all } : null;
    })
    .filter((s): s is ServiceUsage => s !== null)
    .sort((a, b) => b.count - a.count);
  const progress = setupProgress(org?.onboardingSteps ?? []);
  const completed = Boolean(org?.onboardingCompletedAt);
  return {
    orgId,
    students,
    openRequests,
    closedRequests: closed.length,
    turnaroundHoursTotal: closed.reduce((a, r) => a + (r.completedAt ? (r.completedAt.getTime() - r.submittedAt.getTime()) / 3_600_000 : 0), 0),
    overdueRequests,
    overdueTasks,
    parentMeetingsHeld: meetings.filter((m) => m.startsAt < now && m.status === "COMPLETED").length,
    parentMeetingsUpcoming: meetings.filter((m) => m.startsAt >= now && (m.status === "SCHEDULED" || m.status === "CONFIRMED")).length,
    requestsSubmitted: submitted.reduce((a, s) => a + s._count._all, 0),
    serviceUsage,
    onboarding: { done: completed ? progress.total : progress.done, total: progress.total, completed },
    activeUsers,
    accounts,
    plansApproved: plans.find((p) => p.status === "APPROVED")?._count._all ?? 0,
    plansProposed: plans.find((p) => p.status === "PROPOSED")?._count._all ?? 0,
    applications: Object.fromEntries(apps.map((a) => [a.stage, a._count._all])),
  };
}
