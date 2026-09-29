// Deadline resolver and urgency buckets for university applications. Pure functions.
// Reimplements the deadline logic of granitehq/college-tools src/task-planner.js (MIT, see docs/third-party.md):
// every deadline resolves to {date, source}; round and route defaults are labeled so nobody mistakes them for
// an official date; urgency uses the 14, 30 and 90 day buckets.
import type { AppRoute, DeadlineSource, Urgency } from "./types";

export const DAY_MS = 86_400_000;

/** Deadline kinds. Submission kinds drive the task plan; the rest are informational. */
export const SUBMISSION_KINDS = ["OXBRIDGE_MEDICINE", "UCAS_EQUAL", "ED", "EA", "UC", "RD", "OUAC_EQUAL", "UAE_WINDOW", "UNIFIED", "REGULAR"] as const;
export const OTHER_KINDS = ["SCHOLARSHIP", "FINANCIAL_AID", "INTERVIEW", "DECISION", "REPLY"] as const;
export type DeadlineKind = (typeof SUBMISSION_KINDS)[number] | (typeof OTHER_KINDS)[number];
export const isSubmissionKind = (k: string) => (SUBMISSION_KINDS as readonly string[]).includes(k);

export type DeadlineRowIn = {
  id?: string;
  orgId?: string | null;
  programId: string | null;
  universityId: string | null;
  intakeYear: number;
  kind: string;
  date: Date;
  noteEn?: string | null;
};

export type ResolvedDeadline = {
  kind: string;
  date: Date;
  source: DeadlineSource;
  /** True for route defaults: the date must be confirmed with the university. */
  confirm: boolean;
  noteEn?: string | null;
};

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));

/**
 * Typical dates for each application route and intake year. Shown as "confirm with the university".
 * UCAS: equal consideration in mid January, Oxford, Cambridge and medicine mid October of the year before.
 * US: early decision and early action 1 November, regular decision 1 January (UC: 30 November).
 * OUAC: mid January. UAE universities: spring window. Jordan unified admission: mid August after Tawjihi results.
 */
export function routeDefaults(route: AppRoute, intakeYear: number, opts: { oxbridgeOrMedicine?: boolean } = {}): ResolvedDeadline[] {
  const prev = intakeYear - 1;
  const d = (kind: DeadlineKind, date: Date): ResolvedDeadline => ({ kind, date, source: "ROUTE_DEFAULT", confirm: true });
  switch (route) {
    case "UCAS":
      return [opts.oxbridgeOrMedicine ? d("OXBRIDGE_MEDICINE", utc(prev, 10, 15)) : d("UCAS_EQUAL", utc(intakeYear, 1, 14))];
    case "COMMON_APP":
    case "MIT_APP":
      return [d("ED", utc(prev, 11, 1)), d("EA", utc(prev, 11, 1)), d("RD", utc(intakeYear, 1, 1))];
    case "UC_APP":
      return [d("UC", utc(prev, 11, 30))];
    case "OUAC":
      return [d("OUAC_EQUAL", utc(intakeYear, 1, 15))];
    case "UAE":
      return [d("UAE_WINDOW", utc(intakeYear, 4, 30))];
    case "JORDAN_UNIFIED":
      return [d("UNIFIED", utc(intakeYear, 8, 15))];
    case "STUDIELINK":
      return [d("REGULAR", utc(intakeYear, 5, 1))];
    case "CAO":
      return [d("REGULAR", utc(intakeYear, 2, 1))];
    case "UNI_ASSIST":
      return [d("REGULAR", utc(intakeYear, 7, 15))];
    default:
      return [];
  }
}

/**
 * Resolve every deadline for one application. Per kind, a programme row beats a university row, and a
 * school's own row beats a global catalog row at the same level. Route defaults fill in only when neither
 * the programme nor the university lists a submission deadline for the intake year.
 */
export function resolveDeadlines(input: {
  programId: string | null;
  universityId: string;
  intakeYear: number;
  route: AppRoute;
  oxbridgeOrMedicine?: boolean;
  rows: DeadlineRowIn[];
}): ResolvedDeadline[] {
  const rows = input.rows.filter((r) => r.intakeYear === input.intakeYear);
  const byKind = new Map<string, ResolvedDeadline & { rank: number }>();
  const consider = (r: DeadlineRowIn, source: DeadlineSource, rank: number) => {
    const cur = byKind.get(r.kind);
    if (cur && cur.rank <= rank) return;
    byKind.set(r.kind, { kind: r.kind, date: r.date, source, confirm: false, noteEn: r.noteEn ?? null, rank });
  };
  for (const r of rows) {
    if (input.programId && r.programId === input.programId) consider(r, "PROGRAM", r.orgId ? 0 : 1);
    else if (!r.programId && r.universityId === input.universityId) consider(r, "UNIVERSITY", r.orgId ? 2 : 3);
  }
  const out: ResolvedDeadline[] = [...byKind.values()].map(({ rank: _rank, ...d }) => d);
  if (!out.some((d) => isSubmissionKind(d.kind))) out.push(...routeDefaults(input.route, input.intakeYear, { oxbridgeOrMedicine: input.oxbridgeOrMedicine }));
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * The submission deadline that drives the plan: the chosen decision plan when it has a date, otherwise the
 * earliest submission deadline still ahead, otherwise the latest one (already passed).
 */
export function primaryDeadline(deadlines: ResolvedDeadline[], decisionPlan: string | null | undefined, today: Date): ResolvedDeadline | null {
  const subs = deadlines.filter((d) => isSubmissionKind(d.kind));
  if (!subs.length) return null;
  if (decisionPlan) {
    const chosen = subs.find((d) => d.kind === decisionPlan);
    if (chosen) return chosen;
  }
  const start = startOfDay(today).getTime();
  const ahead = subs.filter((d) => d.date.getTime() >= start).sort((a, b) => a.date.getTime() - b.date.getTime());
  return ahead[0] ?? subs.sort((a, b) => b.date.getTime() - a.date.getTime())[0];
}

export function startOfDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function daysUntil(due: Date, today: Date) {
  return Math.ceil((startOfDay(due).getTime() - startOfDay(today).getTime()) / DAY_MS);
}

export type TaskPriority = "URGENT" | "HIGH" | "MEDIUM" | "LOW";

/** Urgency buckets: overdue, within 14 days, within 30, within 90, later. */
export function urgencyFor(due: Date | null | undefined, today: Date): { bucket: Urgency; days: number | null; priority: TaskPriority } {
  if (!due) return { bucket: "none", days: null, priority: "MEDIUM" };
  const days = daysUntil(due, today);
  if (days < 0) return { bucket: "overdue", days, priority: "URGENT" };
  if (days <= 14) return { bucket: "urgent", days, priority: "URGENT" };
  if (days <= 30) return { bucket: "soon", days, priority: "HIGH" };
  if (days <= 90) return { bucket: "upcoming", days, priority: "MEDIUM" };
  return { bucket: "later", days, priority: "LOW" };
}
