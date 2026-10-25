// Subject levels across a student's targets, the university impact of elective choices and the
// worldwide summary. Pure and deterministic: every count comes from evaluate() on the catalog rows.
import { applicableRows, evaluate } from "./evaluate";
import { apCourseSubject, apExamRule, HIGH_CLASSES, type LevelClass } from "./level-guide";
import { plannedCourse } from "./whatif";
import type { CatalogCourse, EvalResult, LineResult, LineStatus, MatchStatus, ProgramForEval, StudentProfile } from "./types";

const COUNTED = new Set(["REQUIRED", "ONE_OF", "TWO_OF"]);
/** A programme a student can still aim for: the engine says eligible or on track. */
export const OPEN_STATUSES: MatchStatus[] = ["ELIGIBLE", "ON_TRACK"];

// ---------------------------------------------------------------------------------------------
// Subject levels across the targets ("AP planner")

export type LevelEntry = {
  programId: string;
  /** The line's own subject keys, for example ["precalculus"] in the mathematics family. */
  keys: string[];
  cls: LevelClass;
  /** Recommended or preferred, not required. */
  advisory: boolean;
  type: string;
  apCourses: string[];
  onlyCodes?: string[];
  fromGrade?: number;
  quote: string | null;
  sourceUrl: string | null;
  status: LineStatus;
  /** Courses on the record or plan that meet it. */
  satisfiedBy: Array<{ nameEn: string; nameAr: string }>;
  /** line: a subject requirement. exam_rule: an AP exam rule on the row that names this course. */
  via: "line" | "exam_rule";
};

export type LevelRow = {
  /** The subject family (mathematics, physics, sciences...) or the sorted keys joined with "+". */
  key: string;
  /** Every subject key in the row. */
  keys: string[];
  entries: LevelEntry[];
  /** Programmes that require the advanced course (AP, A Level, IB HL). */
  high: string[];
  /** Programmes that require the subject and accept a regular course. */
  regular: string[];
  /** Programmes that only recommend it. */
  advice: string[];
  /** Some regular entries need a senior-level (Grade 11 or 12) course. */
  senior: boolean;
  /** The AP course to name, for example AP_CALC_BC. */
  course: string | null;
  /** Of the high programmes, those that accept only AP Calculus BC. */
  bcOnly: string[];
};

export type ExamRuleEntry = { programId: string; cls: LevelClass; included: string[]; quote: string; sourceUrl: string | null };
export type LevelPlan = { curriculum: string; targetIds: string[]; rows: LevelRow[]; examRules: ExamRuleEntry[] };

const rank = (e: LevelEntry) => (e.advisory ? 0 : HIGH_CLASSES.has(e.cls) ? 3 : e.cls === "SENIOR" ? 2 : 1);

/** Subject families, so Calculus, Pre-calculus and Mathematics lines read as one Mathematics row. */
const FAMILY: Record<string, string> = {
  mathematics: "mathematics",
  calculus: "mathematics",
  precalculus: "mathematics",
  statistics: "mathematics",
  further_mathematics: "mathematics",
  algebra: "mathematics",
  geometry: "mathematics",
  physics: "physics",
  chemistry: "chemistry",
  biology: "biology",
  science: "sciences",
  combined_science: "sciences",
  environmental_science: "sciences",
  english_language: "english",
  english_literature: "english",
};
const SCIENCE_FAMILIES = new Set(["physics", "chemistry", "biology", "sciences"]);

/** The family a line's subjects belong to: one family, "sciences" for a choice of sciences, else the keys. */
export function familyOf(keys: string[]): string {
  const fams = [...new Set(keys.map((k) => FAMILY[k] ?? k))].sort();
  if (fams.length === 1) return fams[0];
  if (fams.length > 1 && fams.every((f) => SCIENCE_FAMILIES.has(f))) return "sciences";
  return fams.join("+");
}

/** One row per subject family, with each target programme counted once (its most demanding line). */
export function buildLevelPlan(profile: StudentProfile, targets: ProgramForEval[], results?: EvalResult[]): LevelPlan {
  const evals = results ?? targets.map((p) => evaluate(profile, p));
  const groups = new Map<string, { keys: Set<string>; byProgram: Map<string, LevelEntry> }>();
  const put = (keys: string[], e: LevelEntry) => {
    const key = familyOf(keys);
    const g = groups.get(key) ?? { keys: new Set<string>(), byProgram: new Map<string, LevelEntry>() };
    for (const k of keys) g.keys.add(k);
    const cur = g.byProgram.get(e.programId);
    if (!cur || rank(e) > rank(cur)) g.byProgram.set(e.programId, e);
    groups.set(key, g);
  };
  const examRules: ExamRuleEntry[] = [];
  targets.forEach((p, i) => {
    const res = evals[i];
    for (const l of res.lines) {
      if (l.kind !== "subject" || !l.guide) continue;
      put(l.keys ?? [], lineEntry(p.id, l));
    }
    // AP exam rules (notes) on the rows that apply.
    const { rows } = applicableRows(p, profile.curriculum);
    for (const row of rows) {
      for (const a of row.additional) {
        const rule = apExamRule(a, row.curriculum ?? profile.curriculum);
        if (!rule) continue;
        examRules.push({ programId: p.id, cls: rule.cls, included: rule.included, quote: a.evidenceQuote ?? "", sourceUrl: a.sourceUrl ?? row.sourceUrl ?? null });
        for (const code of rule.included) {
          const subject = apCourseSubject(code);
          if (!subject) continue;
          const has = profile.courses.filter((c) => c.code === code);
          put([subject], { programId: p.id, keys: [subject], cls: rule.cls, advisory: false, type: "REQUIRED", apCourses: [code], onlyCodes: code === "AP_CALC_BC" ? ["AP_CALC_BC"] : undefined, quote: a.evidenceQuote ?? null, sourceUrl: a.sourceUrl ?? row.sourceUrl ?? null, status: has.length ? "met" : "not_met", satisfiedBy: has.map((c) => ({ nameEn: c.nameEn, nameAr: c.nameAr })), via: "exam_rule" });
        }
      }
    }
  });
  const rows: LevelRow[] = [...groups.entries()].map(([key, g]) => {
    const entries = [...g.byProgram.values()];
    const high = entries.filter((e) => !e.advisory && HIGH_CLASSES.has(e.cls)).map((e) => e.programId);
    const regular = entries.filter((e) => !e.advisory && !HIGH_CLASSES.has(e.cls)).map((e) => e.programId);
    const advice = entries.filter((e) => e.advisory).map((e) => e.programId);
    const named = new Map<string, number>();
    for (const e of entries) if (!e.advisory && HIGH_CLASSES.has(e.cls)) for (const c of e.apCourses) named.set(c, (named.get(c) ?? 0) + 1);
    const bcOnly = entries.filter((e) => !e.advisory && HIGH_CLASSES.has(e.cls) && e.onlyCodes?.length === 1 && e.onlyCodes[0] === "AP_CALC_BC").map((e) => e.programId);
    // Name the course: BC when any programme insists on it, else the most named one.
    const course = bcOnly.length ? "AP_CALC_BC" : ([...named.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null);
    return { key, keys: [...g.keys].sort(), entries, high, regular, advice, senior: entries.some((e) => !e.advisory && e.cls === "SENIOR"), course, bcOnly };
  });
  rows.sort((a, b) => b.high.length - a.high.length || b.high.length + b.regular.length - (a.high.length + a.regular.length) || b.advice.length - a.advice.length || (a.key < b.key ? -1 : 1));
  return { curriculum: profile.curriculum, targetIds: targets.map((t) => t.id), rows, examRules };
}

function lineEntry(programId: string, l: LineResult): LevelEntry {
  const g = l.guide!;
  return { programId, keys: l.keys ?? [], cls: g.cls, advisory: l.advisory || !COUNTED.has(l.type), type: l.type, apCourses: g.apCourses, onlyCodes: g.onlyCodes, fromGrade: g.fromGrade, quote: l.evidenceQuote ?? null, sourceUrl: l.sourceUrl ?? null, status: l.status, satisfiedBy: l.status === "not_met" ? [] : (l.satisfiedBy ?? []).map((c) => ({ nameEn: c.nameEn, nameAr: c.nameAr })), via: "line" };
}

// ---------------------------------------------------------------------------------------------
// Elective impact: compare eligibility with and without each option

export type ImpactOption = {
  /** The option's key in the picker (the offering's subject id). */
  key: string;
  block: string;
  /** The curriculum course it counts as, with its mappings. Null: no university link. */
  course: CatalogCourse | null;
  gradeLevel: number;
};

export type OptionImpact = {
  key: string;
  /** Target programmes where this option meets a subject requirement nothing else meets yet. */
  targets: string[];
  /** Programmes in the whole catalog where it does so. */
  programs: string[];
  /** For the targets: the requirement lines it meets, with their level class. */
  lines: Array<{ programId: string; cls: LevelClass; keys: string[] }>;
};

/** Counted subject lines the change moves forward: from not met to met or unknown, or one more slot filled. */
function linesGained(before: EvalResult, after: EvalResult): LineResult[] {
  const b = new Map(before.lines.map((l) => [l.id, l]));
  return after.lines.filter((l) => {
    if (l.kind !== "subject" || l.advisory) return false;
    const prev = b.get(l.id);
    if (!prev || prev.status !== "not_met") return false;
    return l.status !== "not_met" || (l.filled ?? 0) > (prev.filled ?? 0);
  });
}

/**
 * For every option: the programmes where choosing it meets a subject requirement that the student's
 * record and their choices in the other blocks do not meet. chosen maps a block to the chosen key.
 */
export function electiveImpact(profile: StudentProfile, programs: ProgramForEval[], targetIds: Set<string>, options: ImpactOption[], chosen: Record<string, string | undefined>): Record<string, OptionImpact> {
  const out: Record<string, OptionImpact> = {};
  const blocks = [...new Set(options.map((o) => o.block))];
  for (const block of blocks) {
    const others = options.filter((o) => o.block !== block && chosen[o.block] === o.key && o.course);
    const base: StudentProfile = { ...profile, courses: [...profile.courses, ...others.filter((o) => !profile.courses.some((c) => c.courseId === o.course!.courseId)).map((o) => plannedCourse(o.course!, o.gradeLevel))] };
    let baseline: EvalResult[] | null = null;
    for (const o of options.filter((x) => x.block === block)) {
      const res: OptionImpact = { key: o.key, targets: [], programs: [], lines: [] };
      out[o.key] = res;
      if (!o.course || base.courses.some((c) => c.courseId === o.course!.courseId)) continue;
      baseline ??= programs.map((p) => evaluate(base, p));
      const next: StudentProfile = { ...base, courses: [...base.courses, plannedCourse(o.course, o.gradeLevel)] };
      programs.forEach((p, i) => {
        const gained = linesGained(baseline![i], evaluate(next, p));
        if (!gained.length) return;
        res.programs.push(p.id);
        if (targetIds.has(p.id)) {
          res.targets.push(p.id);
          for (const l of gained) if (l.guide) res.lines.push({ programId: p.id, cls: l.guide.cls, keys: l.keys ?? [] });
        }
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Worldwide summary

export type WorldInput = { programId: string; universityId: string; countryCode: string; status: MatchStatus; covered: boolean };
export type WorldSummary = {
  programs: number;
  universities: number;
  countries: number;
  /** Eligible or on track. */
  open: number;
  openUniversities: number;
  openCountries: number;
  counts: Record<MatchStatus, number>;
  /** Per country, most programmes first. */
  byCountry: Array<{ country: string; programs: number; open: number }>;
};

export function worldSummary(items: WorldInput[]): WorldSummary {
  const counts = { ELIGIBLE: 0, ON_TRACK: 0, POSSIBLY_ELIGIBLE: 0, MISSING_REQUIREMENTS: 0, NEEDS_MANUAL_REVIEW: 0, UNKNOWN_DATA: 0 } as Record<MatchStatus, number>;
  const byCountry = new Map<string, { country: string; programs: number; open: number }>();
  const open = items.filter((i) => OPEN_STATUSES.includes(i.status));
  for (const i of items) {
    counts[i.status]++;
    const c = byCountry.get(i.countryCode) ?? { country: i.countryCode, programs: 0, open: 0 };
    c.programs++;
    if (OPEN_STATUSES.includes(i.status)) c.open++;
    byCountry.set(i.countryCode, c);
  }
  return {
    programs: items.length,
    universities: new Set(items.map((i) => i.universityId)).size,
    countries: byCountry.size,
    open: open.length,
    openUniversities: new Set(open.map((i) => i.universityId)).size,
    openCountries: new Set(open.map((i) => i.countryCode)).size,
    counts,
    byCountry: [...byCountry.values()].sort((a, b) => b.open - a.open || b.programs - a.programs || (a.country < b.country ? -1 : 1)),
  };
}
