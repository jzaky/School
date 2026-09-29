// Shared types and rules for the university application tracker. Pure: safe for client and server code.
import type { ApplicationItemStatus, ApplicationStage } from "@prisma/client";

export const STAGES = ["RESEARCHING", "SHORTLISTED", "PREPARING", "SUBMITTED", "INTERVIEW", "OFFER", "REJECTED", "WAITLISTED", "ACCEPTED", "ENROLLED"] as const satisfies readonly ApplicationStage[];
export type Stage = (typeof STAGES)[number];

/** Board columns, in pipeline order. Decisions share the last columns. */
export const BOARD_STAGES: Stage[] = ["SHORTLISTED", "PREPARING", "SUBMITTED", "INTERVIEW", "OFFER", "WAITLISTED", "ACCEPTED", "REJECTED"];

/** Stages that record a university decision (decidedAt is set when an application enters one). */
export const DECISION_STAGES: Stage[] = ["OFFER", "REJECTED", "WAITLISTED"];
/** Stages where the application is closed for task generation. */
export const CLOSED_STAGES: Stage[] = ["REJECTED", "ACCEPTED", "ENROLLED"];

/** Allowed transitions. Anything not listed is refused. Staff may also step back one stage to correct a mistake. */
export const TRANSITIONS: Record<Stage, Stage[]> = {
  RESEARCHING: ["SHORTLISTED", "PREPARING"],
  SHORTLISTED: ["RESEARCHING", "PREPARING"],
  PREPARING: ["SHORTLISTED", "SUBMITTED"],
  SUBMITTED: ["PREPARING", "INTERVIEW", "OFFER", "REJECTED", "WAITLISTED"],
  INTERVIEW: ["SUBMITTED", "OFFER", "REJECTED", "WAITLISTED"],
  OFFER: ["ACCEPTED", "REJECTED"],
  WAITLISTED: ["OFFER", "REJECTED"],
  REJECTED: [],
  ACCEPTED: ["ENROLLED", "OFFER"],
  ENROLLED: [],
};

/** Stages a student may move their own application into. Decisions are recorded by staff. */
export const STUDENT_STAGES: Stage[] = ["RESEARCHING", "SHORTLISTED", "PREPARING", "SUBMITTED"];

export function canTransition(from: Stage, to: Stage, actor: "student" | "staff"): boolean {
  if (from === to) return false;
  if (!TRANSITIONS[from].includes(to)) return false;
  // Once submitted, only staff change the stage (including undoing a submission recorded by mistake).
  if (actor === "student") return from !== "SUBMITTED" && STUDENT_STAGES.includes(from) && STUDENT_STAGES.includes(to);
  return true;
}

export function nextStages(from: Stage, actor: "student" | "staff"): Stage[] {
  return TRANSITIONS[from].filter((to) => canTransition(from, to, actor));
}

/** Application routes. APPLY_ROUTES from pathways plus UAE (direct entry to a UAE university). */
export const APP_ROUTES = ["UCAS", "COMMON_APP", "UC_APP", "MIT_APP", "OUAC", "UAE", "JORDAN_UNIFIED", "STUDIELINK", "CAO", "UNI_ASSIST", "DIRECT"] as const;
export type AppRoute = (typeof APP_ROUTES)[number];

export function routeFor(via: string | null | undefined, countryCode: string): AppRoute {
  const v = (via ?? "").toUpperCase();
  if (v && v !== "DIRECT" && (APP_ROUTES as readonly string[]).includes(v)) return v as AppRoute;
  if (countryCode === "AE") return "UAE";
  if (!v) {
    if (countryCode === "GB") return "UCAS";
    if (countryCode === "US") return "COMMON_APP";
    if (countryCode === "JO") return "JORDAN_UNIFIED";
  }
  return "DIRECT";
}

export const ITEM_KINDS = [
  "FORM",
  "PERSONAL_STATEMENT",
  "ESSAY",
  "RECOMMENDATION",
  "TEST",
  "LANGUAGE_TEST",
  "PORTFOLIO",
  "INTERVIEW",
  "TRANSCRIPT",
  "PREDICTED_GRADES",
  "PASSPORT",
  "FINANCIAL",
  "OTHER",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_STATUSES = ["TODO", "IN_PROGRESS", "DONE", "WAIVED"] as const satisfies readonly ApplicationItemStatus[];
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const itemComplete = (s: string) => s === "DONE" || s === "WAIVED";

/** Where a deadline date came from. Route defaults are labeled "confirm with the university". */
export type DeadlineSource = "PROGRAM" | "UNIVERSITY" | "ROUTE_DEFAULT";

export type Urgency = "overdue" | "urgent" | "soon" | "upcoming" | "later" | "none";

/** Intake year for a student in a grade on a date: Grade 12 applies in the autumn for the next September. */
export function intakeYearFor(gradeLevel: number, now: Date) {
  const base = now.getUTCFullYear() + (now.getUTCMonth() >= 6 ? 1 : 0);
  return base + Math.max(0, 12 - gradeLevel);
}
