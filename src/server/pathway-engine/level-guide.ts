// Subject level guidance per requirement line. Pure and deterministic: no database, safe on client
// and server.
//
// A stored minimumLevel of ADVANCED is a coarse tag ("school-leaving level"). For the American
// curriculum it does not always mean an AP course, so the line is read from its verbatim quote:
// - AP_REQUIRED: the university asks for AP (Advanced Placement) courses or exam scores.
// - AP_OR_REGULAR: AP is one accepted route and a regular course is another.
// - SENIOR: a Grade 12 (or upper-level) course is needed and AP is not mentioned.
// - ANY_LEVEL: a regular course is fine; the quote states no level.
// "AP required" is only ever given when the quote itself says AP, Advanced Placement or names an AP
// course (Calculus AB or BC, Physics C). A small reviewed list (LEVEL_OVERRIDES) corrects lines the
// rules read wrongly; every override says why.
//
// Other curricula use the stored level in their own words: British A Level, AS or GCSE, IB Higher or
// Standard Level, and the existing level words elsewhere. Lines without a quote keep the stored level.
import type { SubjectLevel } from "./types";

export const LEVEL_CLASSES = ["AP_REQUIRED", "AP_OR_REGULAR", "SENIOR", "ANY_LEVEL", "A_LEVEL", "AS_LEVEL", "GCSE", "IB_HL", "IB_SL", "LEVEL"] as const;
export type LevelClass = (typeof LEVEL_CLASSES)[number];
/** The four American classes, in display order. */
export const AMERICAN_CLASSES: LevelClass[] = ["AP_REQUIRED", "AP_OR_REGULAR", "SENIOR", "ANY_LEVEL"];
/** Classes that ask for the curriculum's advanced course (AP, A Level, IB Higher Level). */
export const HIGH_CLASSES = new Set<LevelClass>(["AP_REQUIRED", "A_LEVEL", "IB_HL"]);

export type LevelGuide = {
  cls: LevelClass;
  /** The curriculum the guidance is written for: the row's, or the student's for a general row. */
  curriculum: string | null;
  /** quote: read from the verbatim quote. override: a reviewed decision. level: from the stored level. */
  basis: "quote" | "override" | "level";
  /** AP course codes the quote names for this line's subjects, for example ["AP_CALC_BC"]. */
  apCourses: string[];
  /** Only these AP courses meet the line (for example AP Calculus BC when AB is not accepted). */
  onlyCodes?: string[];
  /** SENIOR: a regular course from this grade on (or any AP course) meets the line. */
  fromGrade?: number;
  /** The level the engine checks against. */
  effectiveLevel: SubjectLevel | null;
  /** The stored level, for display when basis is "level". */
  storedLevel: SubjectLevel | null;
};

export type GuideInput = { type: string; keys: string[]; minimumLevel?: SubjectLevel | null; evidenceQuote?: string | null };

// ---------------------------------------------------------------------------------------------
// Patterns

/** AP is mentioned: the abbreviation (case-sensitive), the full name, or an AP-only course name. */
const AP_RE = /\bAPs?\b|Advanced Placement|\bCalculus\s+(?:AB|BC)\b|\bPhysics\s+C\b/;
/** The same quote also offers a regular high school route. */
const REGULAR_ROUTE_RE = /\bHS\s+\d|high school (?:grade|average|mark|course)|\bCalculus\s+12\b|\bHonou?rs\b|dual enrol/i;
/** Senior-level wording, with the grade it implies. */
const SENIOR_RULES: Array<{ re: RegExp; fromGrade: number }> = [
  { re: /\bgrades?\s*11\b|\b11th\b|\bupper[- ]level\b|\bsenior[- ]level\b/i, fromGrade: 11 },
  { re: /\b(?:grade|year)\s*12\b|\b12th\b|final year/i, fromGrade: 12 },
  { re: /\bsenior high school\b|final (?:two|three) years|upper secondary/i, fromGrade: 10 },
];

/** AP courses a quote can name, with the canonical subjects they count for. */
const AP_NAMES: Array<{ re: RegExp; code: string; keys: string[] }> = [
  { re: /\bCalculus\s+BC\b/, code: "AP_CALC_BC", keys: ["calculus", "mathematics"] },
  { re: /\bCalculus\s+AB\b/, code: "AP_CALC_AB", keys: ["calculus", "mathematics"] },
  { re: /\bAP\s+Statistics\b/, code: "AP_STATS", keys: ["statistics", "mathematics"] },
  { re: /\bPhysics\s+C\b/, code: "AP_PHYS_C_MECH", keys: ["physics", "science"] },
  { re: /\bPhysics\s+1\b/, code: "AP_PHYS_1", keys: ["physics", "science"] },
  { re: /\bPhysics\s+2\b/, code: "AP_PHYS_2", keys: ["physics", "science"] },
  { re: /\bAP\s+Chemistry\b/, code: "AP_CHEM", keys: ["chemistry", "science"] },
  { re: /\bAP\s+Biology\b/, code: "AP_BIO", keys: ["biology", "science"] },
  { re: /\bAP\s+Computer\s+Science(?:\s+A)?\b/, code: "AP_CSA", keys: ["computer_science"] },
];
/** Calculus AB is named only to say it is not accepted. */
const AB_REFUSED_RE = /(?:not|n't)\s+accept\w*\s+(?:AP\s+)?Calculus\s+AB|Calculus\s+AB\s+(?:is\s+|are\s+)?not\s+accepted/i;
const CALCULUS_KEYS = new Set(["calculus", "mathematics"]);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** AP course codes the quote names for these subjects. */
export function apCoursesIn(quote: string, keys: string[]): string[] {
  const q = norm(quote);
  if (!AP_RE.test(q)) return [];
  const out: string[] = [];
  for (const n of AP_NAMES) {
    if (!n.re.test(q) || !n.keys.some((k) => keys.includes(k))) continue;
    if (n.code === "AP_CALC_AB" && AB_REFUSED_RE.test(q)) continue;
    if (!out.includes(n.code)) out.push(n.code);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reviewed overrides. Matched on the line's subject keys and the start of its quote.

export type LevelOverride = { keys: string[]; quoteStarts: string; cls: LevelClass; fromGrade?: number; why: string };

export const LEVEL_OVERRIDES: LevelOverride[] = [
  {
    keys: ["mathematics"],
    quoteStarts: "USA High School Graduation Diploma with an overall GPA of 3.0 including grade B in Mathematics",
    cls: "ANY_LEVEL",
    why: "Manchester asks for grade B in a regular Mathematics course; the three APs at 5, 5, 5 in the same sentence are a separate overall rule, not this subject.",
  },
  {
    keys: ["biology", "chemistry", "physics"],
    quoteStarts: "A lab science exam is not required when both the AP Calculus AB and AP Calculus BC exams are presented",
    cls: "AP_REQUIRED",
    why: "Melbourne's lab science is an AP exam (AP Biology, AP Chemistry or an approved AP Physics combination).",
  },
  {
    keys: ["mathematics"],
    quoteStarts: "Applicants must complete Mathematics as a mandatory subject",
    cls: "SENIOR",
    fromGrade: 12,
    why: "Khalifa University's row quote says the 80% minimum is in the final grade (Grade 12) in these subjects.",
  },
  {
    keys: ["physics", "biology", "chemistry"],
    quoteStarts: "Applicants must complete Mathematics as a mandatory subject",
    cls: "SENIOR",
    fromGrade: 12,
    why: "Khalifa University's row quote says the 80% minimum is in the final grade (Grade 12) in these subjects.",
  },
  {
    keys: ["mathematics"],
    quoteStarts: "English | 4 | Mathematics | 3 |",
    cls: "SENIOR",
    fromGrade: 12,
    why: "The University of Washington table adds a senior year math-based quantitative course to the three mathematics credits.",
  },
];

function findOverride(line: GuideInput): LevelOverride | null {
  const q = norm(line.evidenceQuote ?? "");
  const keys = [...line.keys].sort().join(",");
  return LEVEL_OVERRIDES.find((o) => [...o.keys].sort().join(",") === keys && q.startsWith(norm(o.quoteStarts))) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Classifier

function americanClass(quote: string): { cls: LevelClass; fromGrade?: number } {
  if (AP_RE.test(quote)) return { cls: REGULAR_ROUTE_RE.test(quote) ? "AP_OR_REGULAR" : "AP_REQUIRED" };
  for (const r of SENIOR_RULES) if (r.re.test(quote)) return { cls: "SENIOR", fromGrade: r.fromGrade };
  return { cls: "ANY_LEVEL" };
}

function storedClass(curriculum: string | null, level: SubjectLevel | null, quote: string): LevelClass {
  if (curriculum === "BRITISH") {
    if (!level) return "ANY_LEVEL";
    if (level === "ADVANCED" || level === "HIGHER") return "A_LEVEL";
    if (level === "STANDARD" && /\bAS\b/.test(quote) && !/GCSE/.test(quote)) return "AS_LEVEL";
    return "GCSE";
  }
  if (curriculum === "IB") {
    if (!level) return "ANY_LEVEL";
    return level === "ADVANCED" || level === "HIGHER" ? "IB_HL" : "IB_SL";
  }
  if (curriculum === "AMERICAN" && !level) return "ANY_LEVEL";
  return "LEVEL";
}

/**
 * Level guidance for one subject line. curriculum is the row's curriculum, or the student's when the
 * line comes from a general row (curriculum null) evaluated for that student.
 */
export function levelGuide(line: GuideInput, curriculum: string | null): LevelGuide {
  const stored = line.minimumLevel ?? null;
  const quote = norm(line.evidenceQuote ?? "");
  const base = { curriculum, storedLevel: stored, apCourses: [] as string[] };
  if (curriculum === "AMERICAN" && quote) {
    const o = findOverride(line);
    const read = o ? { cls: o.cls, fromGrade: o.fromGrade } : americanClass(quote);
    const apCourses = apCoursesIn(quote, line.keys);
    const guide: LevelGuide = { ...base, cls: read.cls, basis: o ? "override" : "quote", apCourses, effectiveLevel: read.cls === "AP_REQUIRED" ? "ADVANCED" : null };
    if (read.cls === "SENIOR") guide.fromGrade = read.fromGrade ?? 12;
    // A calculus line that names AP Calculus BC only (or says AB is not accepted) needs BC. When AB is
    // accepted, BC (the longer course) is too. Other AP courses never meet a calculus line.
    if (read.cls === "AP_REQUIRED" && line.keys.length > 0 && line.keys.every((k) => CALCULUS_KEYS.has(k))) {
      if (apCourses.includes("AP_CALC_BC") && !apCourses.includes("AP_CALC_AB")) guide.onlyCodes = ["AP_CALC_BC"];
      else if (apCourses.includes("AP_CALC_AB") || line.keys.includes("calculus")) guide.onlyCodes = ["AP_CALC_AB", "AP_CALC_BC"];
    }
    return guide;
  }
  return { ...base, cls: storedClass(curriculum, stored, quote), basis: "level", effectiveLevel: stored };
}

/** Is a course code an AP course code (AP_...)? Legacy and local codes are not. */
export const isApCode = (code: string | null | undefined) => !!code && /^AP_/.test(code);

/**
 * Does a course mapping meet the line's level? mappingRank is the course's level rank for the subject.
 * Used by the evaluator, the unlock ranking and the elective impact.
 */
export function meetsGuide(guide: LevelGuide, course: { code?: string | null; gradeLevel: number }, mappingLevel: SubjectLevel, rank: Record<SubjectLevel, number>): boolean {
  if (guide.effectiveLevel && rank[mappingLevel] < rank[guide.effectiveLevel]) return false;
  if (guide.onlyCodes && isApCode(course.code) && !guide.onlyCodes.includes(course.code!)) return false;
  if (guide.fromGrade && rank[mappingLevel] < rank.ADVANCED && course.gradeLevel < guide.fromGrade) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// AP exam rules on American rows (free-text notes such as "5, 5, 5 to include Calculus BC")

const ALL_AP_KEYS = ["calculus", "mathematics", "statistics", "physics", "science", "chemistry", "biology", "computer_science"];

export type ApExamRule = {
  /** AP_REQUIRED, or AP_OR_REGULAR when the quote also offers a regular route. */
  cls: LevelClass;
  /** AP courses the rule says must be included, for example ["AP_CALC_BC"]. */
  included: string[];
};

/** A required note on an American row whose quote asks for AP exams. Null for anything else. */
export function apExamRule(a: { required: boolean; evidenceQuote?: string | null }, curriculum: string | null): ApExamRule | null {
  if (curriculum !== "AMERICAN" || !a.required) return null;
  const q = norm(a.evidenceQuote ?? "");
  if (!q || !AP_RE.test(q)) return null;
  const cls: LevelClass = REGULAR_ROUTE_RE.test(q) ? "AP_OR_REGULAR" : "AP_REQUIRED";
  return { cls, included: /\binclud/i.test(q) ? apCoursesIn(q, ALL_AP_KEYS) : [] };
}

/** The canonical subject an AP course code counts for first (AP_CALC_BC: calculus). */
export function apCourseSubject(code: string): string | null {
  return AP_NAMES.find((n) => n.code === code)?.keys[0] ?? null;
}
