// Roster import options per connection: what to import, how grade codes become Horizon grade levels, which
// Horizon role new staff get, and the safety limit on removals. Pure, shared by the settings form, the preview
// and the worker. Grade levels are integers (src/lib/grade-levels.ts): KG1 = -1, KG2 = 0, Grades 1 to 12.
import { MAX_GRADE_LEVEL, MIN_GRADE_LEVEL } from "@/lib/grade-levels";

/** Grade codes as OneRoster sends them (CEDS). Clever's grade names are turned into these first. */
export const GRADE_CODES = ["IT", "PR", "PK", "TK", "KG", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "PS", "UG", "Other"] as const;

/** Default mapping: PK is KG1, KG is KG2, 01 to 12 are Grades 1 to 12. Anything else is reported, never guessed. */
export const DEFAULT_GRADE_MAP: Record<string, number> = {
  PK: -1,
  KG: 0,
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, "0"), i + 1])),
};

const CLEVER_GRADES: Record<string, string> = {
  infanttoddler: "IT",
  preschool: "PR",
  prekindergarten: "PK",
  transitionalkindergarten: "TK",
  kindergarten: "KG",
  postgraduate: "PS",
  ungraded: "UG",
  other: "Other",
};

/** A grade code from any feed, in CEDS form ("9" and "Grade 9" become "09", "Kindergarten" becomes "KG"). */
export function normalizeGradeCode(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const compact = v.toLowerCase().replace(/[\s_-]+/g, "");
  if (CLEVER_GRADES[compact]) return CLEVER_GRADES[compact];
  const num = /^(?:grade)?0?(\d{1,2})$/.exec(compact);
  if (num) return String(Number(num[1])).padStart(2, "0");
  const upper = v.toUpperCase();
  if (upper === "OTHER") return "Other";
  return upper.slice(0, 12);
}

/** The Horizon grade level for a code with the school's map, or null when the code is not mapped. */
export function gradeLevelFor(code: string | null, map: Record<string, number | null>): number | null {
  if (!code) return null;
  const level = map[code];
  return typeof level === "number" && Number.isInteger(level) && level >= MIN_GRADE_LEVEL && level <= MAX_GRADE_LEVEL ? level : null;
}

/** Feed staff roles a connection may map to a Horizon role. */
export const STAFF_FEED_ROLES = ["teacher", "aide", "administrator", "principal", "counselor", "proctor", "staff"] as const;
export type StaffFeedRole = (typeof STAFF_FEED_ROLES)[number];
export const FAMILY_FEED_ROLES = ["parent", "guardian", "relative"] as const;

/** Normalizes the many role spellings (OneRoster 1.1 and 1.2, Clever) to one list. */
export function normalizeFeedRole(raw: unknown): string | null {
  const r = String(raw ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!r) return null;
  if (r === "student") return "student";
  if (r === "teacher") return "teacher";
  if (r === "aide") return "aide";
  if (r === "proctor") return "proctor";
  if (r === "counselor") return "counselor";
  if (r === "principal") return "principal";
  if (r === "administrator" || r === "siteadministrator" || r === "districtadministrator" || r === "systemadministrator" || r === "districtadmin" || r === "schooladmin") return "administrator";
  if (r === "staff") return "staff";
  if (r === "parent") return "parent";
  if (r === "guardian") return "guardian";
  if (r === "relative" || r === "contact") return "relative";
  return null;
}

export type RosterOptions = {
  importStaff: boolean;
  importStudents: boolean;
  importGuardians: boolean;
  importClasses: boolean;
  /** Date of birth and sex from the demographics feed, only when the school says it may share them. */
  importDemographics: boolean;
  gradeMap: Record<string, number | null>;
  /** Horizon role key given to new staff of each feed role; null: that role is not imported. */
  roleMap: Record<StaffFeedRole, string | null>;
  /** Stop before removing more than this share (percent) of a kind's linked records in one run. */
  removalLimitPercent: number;
};

export const DEFAULT_ROLE_MAP: Record<StaffFeedRole, string | null> = { teacher: "teacher", aide: "teacher", administrator: null, principal: null, counselor: null, proctor: null, staff: null };

export const DEFAULT_OPTIONS: RosterOptions = {
  importStaff: true,
  importStudents: true,
  importGuardians: true,
  importClasses: true,
  importDemographics: false,
  gradeMap: { ...DEFAULT_GRADE_MAP },
  roleMap: { ...DEFAULT_ROLE_MAP },
  removalLimitPercent: 10,
};

/** Stored options merged over the defaults, with every value checked. */
export function readOptions(raw: unknown): RosterOptions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<RosterOptions>;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const gradeMap: Record<string, number | null> = {};
  const srcMap = o.gradeMap && typeof o.gradeMap === "object" ? o.gradeMap : DEFAULT_GRADE_MAP;
  for (const [code, level] of Object.entries(srcMap)) {
    const c = normalizeGradeCode(code);
    if (!c) continue;
    gradeMap[c] = typeof level === "number" && Number.isInteger(level) && level >= MIN_GRADE_LEVEL && level <= MAX_GRADE_LEVEL ? level : null;
  }
  const roleMap = { ...DEFAULT_ROLE_MAP };
  if (o.roleMap && typeof o.roleMap === "object") {
    for (const r of STAFF_FEED_ROLES) {
      const v = (o.roleMap as Record<string, unknown>)[r];
      if (v === null) roleMap[r] = null;
      else if (typeof v === "string" && /^[a-z0-9_]{2,40}$/.test(v)) roleMap[r] = v;
    }
  }
  const pct = Number(o.removalLimitPercent);
  return {
    importStaff: bool(o.importStaff, true),
    importStudents: bool(o.importStudents, true),
    importGuardians: bool(o.importGuardians, true),
    importClasses: bool(o.importClasses, true),
    importDemographics: bool(o.importDemographics, false),
    gradeMap,
    roleMap,
    removalLimitPercent: Number.isFinite(pct) && pct >= 1 && pct <= 100 ? Math.round(pct) : 10,
  };
}

/** Removals above the limit stop the run for review (at least this many before the percentage applies). */
export const REMOVAL_FLOOR = 5;

export function removalBlocked(remove: number, linked: number, percent: number): boolean {
  if (remove <= REMOVAL_FLOOR) return false;
  return linked > 0 && (remove / linked) * 100 > percent;
}
