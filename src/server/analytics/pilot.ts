// Pilot measures: the adoption and service figures a school tracks during a pilot.
// Wellbeing and safeguarding requests, and meetings linked to such cases, are never counted (rule 6).
import type { TenantDb } from "@/lib/tenant-db";

const SENSITIVE = ["WELLBEING", "SAFEGUARDING"] as const;
const DAY = 86_400_000;

export type PilotPeriod = { from: Date; to: Date };
export type PilotMeasures = {
  period: PilotPeriod;
  staffActive: number;
  staffTotal: number;
  guardiansOnRecord: number;
  parentAccountsLinked: number;
  /** Linked parent accounts as a share of guardians on record, 0 to 100, or null without guardians. */
  adoptionPct: number | null;
  lettersIssued: number;
  /** Median days from request to issued letter, one decimal, or null without letters. */
  letterMedianDays: number | null;
  requestsClosed: number;
  requestsClosedOnTime: number;
  onTimePct: number | null;
  meetingsBooked: number;
};

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

/** Parse a period from yyyy-mm-dd strings (Dubai days, inclusive). Defaults to the last 7 days. */
export function parsePeriod(from: string | undefined, to: string | undefined, now = new Date()): PilotPeriod {
  const day = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00+04:00`) : null);
  const end = day(to);
  const start = day(from);
  const toD = end && !Number.isNaN(end.getTime()) ? new Date(end.getTime() + DAY - 1) : now;
  let fromD = start && !Number.isNaN(start.getTime()) ? start : new Date(toD.getTime() - 7 * DAY + 1);
  if (fromD > toD) fromD = new Date(toD.getTime() - 7 * DAY + 1);
  // At most two years, so one request cannot scan the whole history.
  if (toD.getTime() - fromD.getTime() > 731 * DAY) fromD = new Date(toD.getTime() - 731 * DAY);
  return { from: fromD, to: toD };
}

export async function pilotMeasures(db: TenantDb, orgId: string, period: PilotPeriod): Promise<PilotMeasures> {
  const inPeriod = { gte: period.from, lte: period.to };
  const staffWhere = { orgId, status: "ACTIVE" as const, student: { is: null }, guardian: { is: null } };
  const sensitiveCaseIds = (await db.case.findMany({ where: { orgId, sensitivity: { in: [...SENSITIVE] } }, select: { id: true } })).map((c) => c.id);
  const [staff, actors, guardiansOnRecord, parentAccountsLinked, letters, closed, meetingsBooked] = await Promise.all([
    db.membership.findMany({ where: staffWhere, select: { id: true, lastSeenAt: true } }),
    db.auditEvent.findMany({ where: { orgId, createdAt: inPeriod, actorId: { not: null } }, select: { actorId: true }, distinct: ["actorId"] }),
    db.guardian.count({ where: { orgId, anonymisedAt: null } }),
    db.guardian.count({ where: { orgId, anonymisedAt: null, membership: { is: { status: "ACTIVE" } } } }),
    db.document.findMany({ where: { orgId, source: "GENERATED", requestId: { not: null }, createdAt: inPeriod, sensitivity: { notIn: [...SENSITIVE] } }, select: { createdAt: true, requestId: true } }),
    db.request.findMany({
      where: { orgId, sensitivity: { notIn: [...SENSITIVE] }, status: { in: ["COMPLETED", "REJECTED"] }, completedAt: inPeriod },
      select: { submittedAt: true, completedAt: true, slaDueAt: true, service: { select: { slaHours: true } } },
    }),
    db.appointment.count({ where: { orgId, createdAt: inPeriod, status: { not: "CANCELLED" }, OR: [{ caseId: null }, { caseId: { notIn: sensitiveCaseIds } }] } }),
  ]);

  const acted = new Set(actors.map((a) => a.actorId as string));
  const staffActive = staff.filter((m) => acted.has(m.id) || (m.lastSeenAt && m.lastSeenAt >= period.from && m.lastSeenAt <= period.to)).length;

  const requestIds = [...new Set(letters.map((l) => l.requestId as string))];
  const requests = requestIds.length ? await db.request.findMany({ where: { orgId, id: { in: requestIds }, sensitivity: { notIn: [...SENSITIVE] } }, select: { id: true, submittedAt: true } }) : [];
  const submitted = new Map(requests.map((r) => [r.id, r.submittedAt]));
  const letterDays = letters.filter((l) => submitted.has(l.requestId as string)).map((l) => Math.max(0, (l.createdAt.getTime() - submitted.get(l.requestId as string)!.getTime()) / DAY));

  const onTime = closed.filter((r) => {
    const target = r.slaDueAt ?? new Date(r.submittedAt.getTime() + r.service.slaHours * 3600_000);
    return r.completedAt! <= target;
  }).length;

  return {
    period,
    staffActive,
    staffTotal: staff.length,
    guardiansOnRecord,
    parentAccountsLinked,
    adoptionPct: pct(parentAccountsLinked, guardiansOnRecord),
    lettersIssued: letterDays.length,
    letterMedianDays: round1(median(letterDays)),
    requestsClosed: closed.length,
    requestsClosedOnTime: onTime,
    onTimePct: pct(onTime, closed.length),
    meetingsBooked,
  };
}

/** CSV rows for the measures (metric key, value, detail). */
export function pilotCsvRows(m: PilotMeasures) {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(d);
  return [
    { metric: "period_from", value: day(m.period.from), detail: "" },
    { metric: "period_to", value: day(m.period.to), detail: "" },
    { metric: "staff_active", value: m.staffActive, detail: `of ${m.staffTotal} staff accounts` },
    { metric: "parent_accounts_linked", value: m.parentAccountsLinked, detail: `of ${m.guardiansOnRecord} guardians on record` },
    { metric: "parent_adoption_pct", value: m.adoptionPct ?? "", detail: "" },
    { metric: "letters_issued", value: m.lettersIssued, detail: "" },
    { metric: "letter_median_days", value: m.letterMedianDays ?? "", detail: "request submitted to letter issued" },
    { metric: "requests_closed", value: m.requestsClosed, detail: "" },
    { metric: "requests_closed_on_time", value: m.requestsClosedOnTime, detail: "within the service target time" },
    { metric: "requests_on_time_pct", value: m.onTimePct ?? "", detail: "" },
    { metric: "meetings_booked", value: m.meetingsBooked, detail: "booked in the period, not cancelled" },
  ];
}
