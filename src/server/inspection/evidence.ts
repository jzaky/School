// Inspection evidence pack: aggregates for a date range, grouped under the headings an inspection usually
// asks about. Sensitive cases (WELLBEING, SAFEGUARDING) only ever appear as counts and timings here; case
// references are listed only for cases src/server/access/case-access.ts lets the viewer open, and only when
// the viewer asks for them (each listed sensitive case is audited by the caller).
// Never includes names, summaries or notes.
import type { Prisma, Sensitivity } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { inspectionAggregatesAllowed, inspectionReferenceWhere } from "@/server/access/case-access";
import { EVIDENCE_HEADINGS, mappingForHeading, resolveMapping, type EvidenceHeading, type MappingRow } from "./mapping";

export type MetricUnit = "count" | "hours" | "days" | "percent" | "date" | "ratio";
export type Metric = {
  key: string;
  value: number | string | null;
  unit: MetricUnit;
  /** For ratio: the denominator (value of total). */
  of?: number;
  breakdown?: Array<{ key: string; value: number }>;
  /** Message key under inspection.notes when there is nothing to count. */
  note?: "notRecorded" | "snapshot" | "noneInRange";
};
export type CaseReference = { number: string; status: string; openedAt: string; firstResponseHours: number | null; closedAt: string | null };
export type EvidenceSection = { key: EvidenceHeading; metrics: Metric[]; references?: CaseReference[]; referencesAllowed?: boolean; mapping: MappingRow[] };
export type EvidencePack = { from: string; to: string; generatedAt: string; regulator: string; sections: EvidenceSection[] };

export type EvidenceCtx = Pick<Ctx, "db" | "orgId" | "isStaff" | "membershipId" | "can"> & { org: { regulator: string } };

const HOUR = 3_600_000;
const DAY = 86_400_000;
const CLOSED = ["RESOLVED", "CLOSED"] as const;

export class EvidenceError extends Error {
  constructor(public code: "FORBIDDEN" | "INVALID_RANGE") {
    super(code);
  }
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : null);

function countBy<T>(rows: T[], key: (r: T) => string, order: readonly string[]): Array<{ key: string; value: number }> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return order.filter((k) => m.has(k)).map((k) => ({ key: k, value: m.get(k)! }));
}

/** Validate a date range: from before to, at most 400 days. */
export function checkRange(from: Date, to: Date) {
  if (!(from instanceof Date) || !(to instanceof Date) || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new EvidenceError("INVALID_RANGE");
  if (to <= from || to.getTime() - from.getTime() > 400 * DAY) throw new EvidenceError("INVALID_RANGE");
}

type CaseRow = { id: string; number: string; status: string; openedAt: Date; referrerId: string | null; concernLevel: string | null; resolvedAt: Date | null; closedAt: Date | null; assigneeId: string | null };

/** Hours from opening to the first non-system note by someone other than the referrer, per case. */
async function firstResponses(db: Ctx["db"], cases: CaseRow[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!cases.length) return out;
  const notes = await db.caseNote.findMany({ where: { caseId: { in: cases.map((c) => c.id) }, kind: { not: "SYSTEM" } }, select: { caseId: true, authorId: true, occurredAt: true }, orderBy: { occurredAt: "asc" } });
  for (const c of cases) {
    const first = notes.find((n) => n.caseId === c.id && n.occurredAt >= c.openedAt && n.authorId !== c.referrerId);
    if (first) out.set(c.id, (first.occurredAt.getTime() - c.openedAt.getTime()) / HOUR);
  }
  return out;
}

const CASE_SELECT = { id: true, number: true, status: true, openedAt: true, referrerId: true, concernLevel: true, resolvedAt: true, closedAt: true, assigneeId: true } as const;

async function caseMetrics(ctx: EvidenceCtx, sensitivity: Sensitivity, from: Date, to: Date) {
  const where: Prisma.CaseWhereInput = { orgId: ctx.orgId, sensitivity, openedAt: { gte: from, lt: to } };
  const [opened, closedInRange, openNow] = await Promise.all([
    ctx.db.case.findMany({ where, select: CASE_SELECT, orderBy: { openedAt: "asc" } }),
    ctx.db.case.count({ where: { orgId: ctx.orgId, sensitivity, OR: [{ resolvedAt: { gte: from, lt: to } }, { closedAt: { gte: from, lt: to } }] } }),
    ctx.db.case.count({ where: { orgId: ctx.orgId, sensitivity, status: { notIn: [...CLOSED] } } }),
  ]);
  const responses = await firstResponses(ctx.db, opened);
  const hours = [...responses.values()];
  return {
    opened,
    responses,
    metrics: {
      opened: { key: "opened", value: opened.length, unit: "count", breakdown: countBy(opened, (c) => c.status, ["NEW", "OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"]) } as Metric,
      closed: { key: "closedInRange", value: closedInRange, unit: "count" } as Metric,
      openNow: { key: "openNow", value: openNow, unit: "count", note: "snapshot" } as Metric,
      median: { key: "medianFirstResponse", value: round1(median(hours)), unit: "hours", note: hours.length ? undefined : "noneInRange" } as Metric,
      within24: { key: "respondedWithin24h", value: hours.filter((h) => h <= 24).length, unit: "ratio", of: opened.length } as Metric,
      awaiting: { key: "awaitingFirstResponse", value: opened.length - hours.length, unit: "count" } as Metric,
    },
  };
}

async function references(ctx: EvidenceCtx, sensitivity: "WELLBEING" | "SAFEGUARDING", from: Date, to: Date): Promise<CaseReference[]> {
  const rows = await ctx.db.case.findMany({ where: { AND: [inspectionReferenceWhere(ctx, sensitivity), { openedAt: { gte: from, lt: to } }] }, select: CASE_SELECT, orderBy: { openedAt: "asc" }, take: 200 });
  const responses = await firstResponses(ctx.db, rows);
  return rows.map((c) => ({ number: c.number, status: c.status, openedAt: c.openedAt.toISOString(), firstResponseHours: round1(responses.get(c.id) ?? null), closedAt: (c.closedAt ?? c.resolvedAt)?.toISOString() ?? null }));
}

/** Members holding any of these roles. */
async function holders(ctx: EvidenceCtx, roleKeys: string[]) {
  return ctx.db.membership.findMany({ where: { status: "ACTIVE", roles: { some: { role: { key: { in: roleKeys } } } } }, select: { id: true, roles: { select: { role: { select: { key: true } } } } } });
}

export type BuildOptions = { from: Date; to: Date; now?: Date; withReferences?: boolean };

/** Build the evidence pack. The caller checks the permission; this re-checks it so no caller can skip it. */
export async function buildEvidencePack(ctx: EvidenceCtx, opts: BuildOptions): Promise<EvidencePack> {
  if (!inspectionAggregatesAllowed(ctx)) throw new EvidenceError("FORBIDDEN");
  const { from, to } = opts;
  checkRange(from, to);
  const now = opts.now ?? new Date();
  const db = ctx.db;
  const orgId = ctx.orgId;
  const inRange = { gte: from, lt: to };

  const stored = await db.inspectionMapping.findMany({ where: { orgId } });
  const mapping = resolveMapping(stored);
  const mapFor = (h: EvidenceHeading) => mappingForHeading(mapping, h, ctx.org.regulator);

  // --- Safeguarding ---------------------------------------------------------------------------------
  const sg = await caseMetrics(ctx, "SAFEGUARDING", from, to);
  const leads = await holders(ctx, ["dsl", "deputy_dsl"]);
  const leadIds = new Set(leads.map((l) => l.id));
  const dslCount = leads.filter((l) => l.roles.some((r) => r.role.key === "dsl")).length;
  const deputyCount = leads.filter((l) => l.roles.some((r) => r.role.key === "deputy_dsl")).length;
  const [sgReferrals, notifyDecisions] = await Promise.all([
    db.externalReferral.count({ where: { orgId, referredAt: inRange, case: { sensitivity: "SAFEGUARDING" } } }),
    db.parentNotificationDecision.count({ where: { orgId, createdAt: inRange, case: { sensitivity: { in: ["WELLBEING", "SAFEGUARDING"] } } } }),
  ]);
  const safeguarding: Metric[] = [
    sg.metrics.opened,
    { key: "highConcern", value: sg.opened.filter((c) => c.concernLevel === "HIGH" || c.concernLevel === "IMMEDIATE_DANGER").length, unit: "count" },
    sg.metrics.median,
    sg.metrics.within24,
    sg.metrics.awaiting,
    sg.metrics.closed,
    sg.metrics.openNow,
    { key: "ledByDsl", value: sg.opened.filter((c) => c.assigneeId && leadIds.has(c.assigneeId)).length, unit: "ratio", of: sg.opened.length },
    { key: "dslCount", value: dslCount, unit: "count", note: "snapshot" },
    { key: "deputyCount", value: deputyCount, unit: "count", note: "snapshot" },
    { key: "externalReferrals", value: sgReferrals, unit: "count" },
    { key: "familyDecisions", value: notifyDecisions, unit: "count" },
    { key: "training", value: null, unit: "count", note: "notRecorded" },
  ];

  // --- Wellbeing and counseling -----------------------------------------------------------------------
  const wb = await caseMetrics(ctx, "WELLBEING", from, to);
  const counselingTypes = await db.appointmentType.findMany({ where: { orgId, key: { in: ["counselor_meeting", "wellbeing_checkin"] } }, select: { id: true } });
  const counseling = await db.appointment.groupBy({ by: ["status"], where: { orgId, typeId: { in: counselingTypes.map((t) => t.id) }, startsAt: inRange }, _count: { _all: true } });
  const sessions = (s: string) => counseling.find((c) => c.status === s)?._count._all ?? 0;
  const wellbeing: Metric[] = [
    wb.metrics.opened,
    wb.metrics.median,
    wb.metrics.within24,
    wb.metrics.closed,
    wb.metrics.openNow,
    { key: "counselingHeld", value: sessions("COMPLETED"), unit: "count" },
    { key: "counselingBooked", value: sessions("CONFIRMED") + sessions("SCHEDULED"), unit: "count" },
  ];

  // --- Parent communication and engagement --------------------------------------------------------------
  const parents = await db.membership.findMany({ where: { guardian: { isNot: null } }, select: { id: true } });
  const parentIds = parents.map((p) => p.id);
  const ptmType = await db.appointmentType.findMany({ where: { orgId, key: "parent_teacher_meeting" }, select: { id: true } });
  const [outbound, inApp, announcements, meetings, parentRequests] = await Promise.all([
    db.outboundMessage.groupBy({ by: ["channel"], where: { orgId, createdAt: inRange, status: { in: ["SENT", "DELIVERED"] } }, _count: { _all: true } }),
    db.notification.count({ where: { orgId, createdAt: inRange, recipientId: { in: parentIds } } }),
    db.announcement.count({ where: { orgId, publishedAt: inRange, OR: [{ audience: { has: "parent" } }, { audience: { has: "all" } }, { audience: { isEmpty: true } }] } }),
    db.appointment.findMany({ where: { orgId, startsAt: inRange, OR: [{ typeId: { in: ptmType.map((t) => t.id) } }, { guardianId: { not: null } }] }, select: { status: true } }),
    db.request.findMany({ where: { orgId, submittedAt: inRange, requesterId: { in: parentIds } }, select: { submittedAt: true, completedAt: true, slaDueAt: true } }),
  ]);
  const done = parentRequests.filter((r) => r.completedAt);
  const withSla = done.filter((r) => r.slaDueAt);
  const parentsSection: Metric[] = [
    { key: "messagesDelivered", value: outbound.reduce((a, o) => a + o._count._all, 0), unit: "count", breakdown: outbound.map((o) => ({ key: o.channel, value: o._count._all })) },
    { key: "inAppToParents", value: inApp, unit: "count" },
    { key: "announcements", value: announcements, unit: "count" },
    { key: "parentMeetings", value: meetings.length, unit: "count", breakdown: countBy(meetings, (m) => m.status, ["COMPLETED", "CONFIRMED", "SCHEDULED", "NO_SHOW", "CANCELLED"]) },
    { key: "parentRequests", value: parentRequests.length, unit: "count" },
    { key: "requestTurnaround", value: round1(median(done.map((r) => (r.completedAt!.getTime() - r.submittedAt.getTime()) / DAY))), unit: "days", note: done.length ? undefined : "noneInRange" },
    { key: "requestsOnTime", value: withSla.filter((r) => r.completedAt! <= r.slaDueAt!).length, unit: "ratio", of: withSla.length },
  ];

  // --- Student support and careers guidance ----------------------------------------------------------------
  const careerType = await db.appointmentType.findMany({ where: { orgId, key: "career_guidance_session" }, select: { id: true } });
  const [assessments, plans, guidance, apps, submitted, events, regs] = await Promise.all([
    db.aptitudeAssessment.count({ where: { orgId, completedAt: inRange } }),
    db.studentCoursePlan.count({ where: { orgId, approvedAt: inRange } }),
    db.appointment.count({ where: { orgId, typeId: { in: careerType.map((t) => t.id) }, startsAt: inRange, status: "COMPLETED" } }),
    db.application.groupBy({ by: ["stage"], where: { orgId, createdAt: { lt: to } }, _count: { _all: true } }),
    db.application.count({ where: { orgId, submittedAt: inRange } }),
    db.careerEvent.count({ where: { orgId, status: "PUBLISHED", startsAt: inRange } }),
    db.careerEventRegistration.findMany({ where: { orgId, status: "REGISTERED", event: { status: "PUBLISHED", startsAt: inRange } }, select: { attended: true } }),
  ]);
  const STAGES = ["RESEARCHING", "SHORTLISTED", "PREPARING", "SUBMITTED", "INTERVIEW", "OFFER", "WAITLISTED", "ACCEPTED", "ENROLLED", "REJECTED"];
  const careers: Metric[] = [
    { key: "assessmentsCompleted", value: assessments, unit: "count" },
    { key: "plansApproved", value: plans, unit: "count" },
    { key: "guidanceSessions", value: guidance, unit: "count" },
    { key: "applicationsByStage", value: apps.reduce((a, x) => a + x._count._all, 0), unit: "count", note: "snapshot", breakdown: STAGES.map((s) => ({ key: s, value: apps.find((a) => a.stage === s)?._count._all ?? 0 })).filter((b) => b.value > 0) },
    { key: "applicationsSubmitted", value: submitted, unit: "count" },
    { key: "careerEvents", value: events, unit: "count" },
    { key: "careerEventAttendance", value: regs.filter((r) => r.attended).length, unit: "ratio", of: regs.length },
  ];

  // --- Attendance and academics (where the data exists) ------------------------------------------------------
  const [attendance, published, gradesEntered] = await Promise.all([
    db.attendanceRecord.groupBy({ by: ["status"], where: { orgId, date: inRange }, _count: { _all: true } }),
    db.assessment.count({ where: { orgId, publishedAt: inRange } }),
    db.grade.count({ where: { orgId, score: { not: null }, assessment: { publishedAt: inRange } } }),
  ]);
  const att = (s: string) => attendance.find((a) => a.status === s)?._count._all ?? 0;
  const attTotal = attendance.reduce((a, x) => a + x._count._all, 0);
  const attendanceSection: Metric[] = attTotal
    ? [
        { key: "attendanceRate", value: pct(att("PRESENT") + att("LATE"), attTotal), unit: "percent" },
        { key: "attendanceRecords", value: attTotal, unit: "count", breakdown: ["PRESENT", "LATE", "EXCUSED", "ABSENT"].map((s) => ({ key: s, value: att(s) })).filter((b) => b.value > 0) },
        { key: "unexcusedAbsences", value: att("ABSENT"), unit: "count" },
      ]
    : [{ key: "attendanceRate", value: null, unit: "percent", note: "notRecorded" }];
  attendanceSection.push({ key: "assessmentsPublished", value: published, unit: "count" }, { key: "gradesRecorded", value: gradesEntered, unit: "count" });

  // --- Policies and compliance ------------------------------------------------------------------------------
  const [purposes, consents, retention, transfers, dsrs, breaches, auditCount, sensitiveViews, exports] = await Promise.all([
    db.processingPurpose.count({ where: { orgId } }),
    db.consentRecord.groupBy({ by: ["status"], where: { orgId }, _count: { _all: true } }),
    db.retentionPolicy.findMany({ where: { orgId }, select: { lastRunAt: true } }),
    db.crossBorderTransfer.findMany({ where: { orgId }, select: { approved: true } }),
    db.dataSubjectRequest.findMany({ where: { orgId, receivedAt: inRange }, select: { status: true, completedAt: true, dueAt: true } }),
    db.breachLog.count({ where: { orgId, detectedAt: inRange } }),
    db.auditEvent.count({ where: { orgId, createdAt: inRange } }),
    db.auditEvent.count({ where: { orgId, createdAt: inRange, sensitivity: { in: ["WELLBEING", "SAFEGUARDING"] } } }),
    db.auditEvent.count({ where: { orgId, createdAt: inRange, action: "inspection.export" } }),
  ]);
  const lastRun = retention.map((r) => r.lastRunAt).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const dsrDone = dsrs.filter((d) => d.completedAt);
  const compliance: Metric[] = [
    { key: "processingPurposes", value: purposes, unit: "count", note: "snapshot" },
    { key: "consentRecords", value: consents.reduce((a, c) => a + c._count._all, 0), unit: "count", note: "snapshot", breakdown: consents.map((c) => ({ key: c.status, value: c._count._all })) },
    { key: "retentionPolicies", value: retention.length, unit: "count", note: "snapshot" },
    { key: "retentionLastRun", value: lastRun ? lastRun.toISOString() : null, unit: "date", note: lastRun ? undefined : "notRecorded" },
    { key: "transfersApproved", value: transfers.filter((t) => t.approved).length, unit: "ratio", of: transfers.length },
    { key: "dataRequests", value: dsrs.length, unit: "count" },
    { key: "dataRequestsOnTime", value: dsrDone.filter((d) => d.completedAt! <= d.dueAt).length, unit: "ratio", of: dsrDone.length },
    { key: "incidents", value: breaches, unit: "count" },
    { key: "auditEvents", value: auditCount, unit: "count" },
    { key: "sensitiveViewsAudited", value: sensitiveViews, unit: "count" },
    { key: "packExports", value: exports, unit: "count" },
  ];

  const sections: Record<EvidenceHeading, Metric[]> = { safeguarding, wellbeing, parents: parentsSection, careers, attendance: attendanceSection, compliance };
  const out: EvidenceSection[] = EVIDENCE_HEADINGS.map((key) => ({ key, metrics: sections[key], mapping: mapFor(key) }));

  // Case references: only on request, only for cases the viewer could open in full.
  const sgAllowed = ctx.can("safeguarding.view") || (await db.case.count({ where: inspectionReferenceWhere(ctx, "SAFEGUARDING") })) > 0;
  const wbAllowed = ctx.can("cases.wellbeing") || (await db.case.count({ where: inspectionReferenceWhere(ctx, "WELLBEING") })) > 0;
  const sgSection = out.find((s) => s.key === "safeguarding")!;
  const wbSection = out.find((s) => s.key === "wellbeing")!;
  sgSection.referencesAllowed = sgAllowed;
  wbSection.referencesAllowed = wbAllowed;
  if (opts.withReferences) {
    if (sgAllowed) sgSection.references = await references(ctx, "SAFEGUARDING", from, to);
    if (wbAllowed) wbSection.references = await references(ctx, "WELLBEING", from, to);
  }

  return { from: from.toISOString(), to: to.toISOString(), generatedAt: now.toISOString(), regulator: ctx.org.regulator, sections: out };
}

/** Case ids behind the references in a pack, for the audit trail (the caller writes one event per case). */
export async function referencedCaseIds(ctx: EvidenceCtx, from: Date, to: Date): Promise<Array<{ id: string; sensitivity: Sensitivity }>> {
  const rows = await ctx.db.case.findMany({
    where: { OR: [inspectionReferenceWhere(ctx, "SAFEGUARDING"), inspectionReferenceWhere(ctx, "WELLBEING")], openedAt: { gte: from, lt: to } },
    select: { id: true, sensitivity: true },
    take: 400,
  });
  return rows;
}
