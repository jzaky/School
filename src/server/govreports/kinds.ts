// Government returns: kinds, statuses and validation rules. Pure: safe for client and server.
//
// None of the UAE education authorities (SPEA, KHDA, ADEK, the Ministry of Education) publishes an API or a public
// file format for these returns (see docs/guides/government-reporting.md for what each one does publish). Every
// file Horizon produces is therefore a "Horizon standard" layout, labelled "Format to be confirmed with <authority>",
// that staff copy into the authority's own portal.

export const RETURN_KINDS = ["CENSUS", "REGISTRATION", "ATTENDANCE", "STAFF", "RESULTS"] as const;
export type ReturnKind = (typeof RETURN_KINDS)[number];
export const isReturnKind = (v: unknown): v is ReturnKind => typeof v === "string" && (RETURN_KINDS as readonly string[]).includes(v);

/** Due dates can also be for something that is not a Horizon return (for example a survey). */
export const DUE_KINDS = [...RETURN_KINDS, "OTHER"] as const;
export type DueKind = (typeof DUE_KINDS)[number];
export const isDueKind = (v: unknown): v is DueKind => typeof v === "string" && (DUE_KINDS as readonly string[]).includes(v);

export const RETURN_STATUSES = ["DRAFT", "SIGNED_OFF", "SUBMITTED"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const EXPORT_FORMATS = ["XLSX", "CSV", "PDF"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** A census and a staff return are for one date; the others cover a period ending on asOf. */
export const usesPeriod = (k: ReturnKind) => k !== "STAFF";
export const isSnapshotKind = (k: ReturnKind) => k === "CENSUS" || k === "STAFF";

/** Which returns list individual people (and so may carry identifiers); the rest are aggregates only. */
export const listsPeople = (k: ReturnKind) => k === "REGISTRATION" || k === "STAFF" || k === "ATTENDANCE";
/** Only the learner registration list can carry full Emirates ID numbers (with people.reveal_ids). */
export const canCarryIds = (k: ReturnKind) => k === "REGISTRATION";

export const PROBLEM_RULES = [
  "missing_eid",
  "missing_nationality",
  "missing_dob",
  "missing_gender",
  "age_grade",
  "no_reference",
  "duplicate_eid",
  "duplicate_name_dob",
  "staff_missing_title",
  "staff_missing_department",
  "staff_missing_employee_no",
  "unexplained_absences",
  "limit_off",
  "unpublished_results",
] as const;
export type ProblemRule = (typeof PROBLEM_RULES)[number];

/** Errors should be fixed before sending; warnings are worth a look; notes explain a gap in what Horizon holds. */
export type Severity = "error" | "warning" | "note";
export const RULE_SEVERITY: Record<ProblemRule, Severity> = {
  missing_eid: "error",
  missing_nationality: "error",
  missing_dob: "error",
  missing_gender: "error",
  age_grade: "warning",
  no_reference: "error",
  duplicate_eid: "error",
  duplicate_name_dob: "warning",
  staff_missing_title: "warning",
  staff_missing_department: "note",
  staff_missing_employee_no: "warning",
  unexplained_absences: "warning",
  limit_off: "note",
  unpublished_results: "note",
};

/** Problems that count towards the "exported with problems" warning (notes never do). */
export const countsAsProblem = (r: ProblemRule) => RULE_SEVERITY[r] !== "note";

export type Problem = {
  /** Stable key, for example "missing_nationality:<studentId>". */
  key: string;
  rule: ProblemRule;
  severity: Severity;
  /** The record to fix: a student, a member of staff, or a page. Never an identifier value. */
  studentId?: string;
  otherStudentId?: string;
  membershipId?: string;
  /** Message values (numbers, labels). Never an Emirates ID or passport number. */
  values?: Record<string, string | number>;
  /** How many records a school-wide problem covers (unexplained absences, unpublished assessments). */
  count?: number;
};

/** Today's calendar date in the UAE (UTC+4, no daylight saving) as YYYY-MM-DD. */
export const todayKey = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);

/** Staff fields a return needs that Horizon does not hold. Shown as "not recorded in Horizon", never invented. */
export const STAFF_GAPS = ["nationality", "gender", "qualification", "licence"] as const;
