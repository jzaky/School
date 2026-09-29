// Deterministic requirement evaluation. Pure: no database access, safe on client and server.
//
// Rules (see docs/decisions.md, "Pathway engine evaluation rules"):
// - Applicable rows: the general row (curriculum null) plus the row for the student's curriculum.
//   If the programme has curriculum rows but none for the student's curriculum, it is not covered.
// - Subject lines are ANDed. Several keys on one line (or ONE_OF) means any one of them. TWO_OF needs
//   two DIFFERENT keys filled by two DIFFERENT courses (a course is counted once per group).
// - Only REQUIRED, ONE_OF and TWO_OF can make a student miss. RECOMMENDED, PREFERRED and OPTIONAL are advice.
// - Each line is met, not met or unknown. Unknown covers a grade that is not available yet, a
//   mapping that still needs review, a grade on a different scale, an unverified requirement row,
//   a test not taken yet and free-text notes a person has to read.
// - Programme status: UNKNOWN_DATA (no rows) > MISSING_REQUIREMENTS (a required line not met) >
//   NEEDS_MANUAL_REVIEW (curriculum not covered, or a note to read) > POSSIBLY_ELIGIBLE (unknowns) >
//   ON_TRACK (met, but some of it rests on predictions, plans or tests still to take) > ELIGIBLE.
import { gradeRank, meetsGrade, parseGradeProfile } from "./grade-scales";
import {
  LEVEL_RANK,
  type Basis,
  type ClassToTake,
  type Confidence,
  type CourseMapping,
  type EvalResult,
  type LineResult,
  type LineStatus,
  type MatchStatus,
  type ProgramForEval,
  type RequirementRow,
  type ScoreGap,
  type StudentCourseInput,
  type StudentProfile,
  type SubjectLevel,
  type SubjectLine,
  type TestLine,
  type UnknownReason,
} from "./types";

/** Tests that are accepted as alternatives to each other when listed in one row with the same policy. */
export const TEST_ALTERNATIVES: string[][] = [["SAT", "ACT"]];
/** Additional requirement kinds that are application steps, shown as a checklist and never evaluated. */
export const APPLICATION_STEPS = new Set(["PERSONAL_STATEMENT", "ESSAYS", "INTERVIEW", "REFERENCE", "PORTFOLIO", "AUDITION", "SUPPLEMENTAL", "ADMISSIONS_TEST", "WORK_EXPERIENCE", "HEALTH_CHECK"]);
/** The university does not accept this curriculum for direct entry (for example a foundation year is needed first). */
export const BLOCKING_KINDS = new Set(["NOT_ACCEPTED", "FOUNDATION_REQUIRED"]);
const COUNTED_SUBJECT_TYPES = new Set(["REQUIRED", "ONE_OF", "TWO_OF"]);
const UNVERIFIED: Confidence[] = ["EXTRACTED", "UNKNOWN"];
/** Mappings below this confidence are treated as needing review. */
export const MIN_MAPPING_CONFIDENCE = 0.6;

// ---------------------------------------------------------------------------------------------
// Rows

/** The rows that apply to a student: the general row and the row for their curriculum (next intake first). */
export function applicableRows(program: ProgramForEval, curriculum: string): { rows: RequirementRow[]; covered: boolean } {
  const pickOne = (rows: RequirementRow[]) => [...rows].sort((a, b) => a.intakeYear - b.intakeYear || b.version - a.version)[0];
  const general = program.requirements.filter((r) => r.curriculum === null);
  const specific = program.requirements.filter((r) => r.curriculum !== null);
  const own = specific.filter((r) => r.curriculum === curriculum);
  const rows: RequirementRow[] = [];
  if (general.length) rows.push(pickOne(general));
  if (own.length) rows.push(pickOne(own));
  return { rows, covered: own.length > 0 || specific.length === 0 };
}

// ---------------------------------------------------------------------------------------------
// Subject candidates

type Candidate = {
  course: StudentCourseInput;
  mapping: CourseMapping;
  subjectKey: string;
  status: LineStatus;
  basis: Basis;
  reason?: UnknownReason;
  grade: string | null;
  levelOk: boolean;
};

const basisOf = (c: StudentCourseInput): { basis: Basis; grade: string | null } => {
  if (c.status === "COMPLETED") {
    if (c.finalGrade) return { basis: "final", grade: c.finalGrade };
    return { basis: "predicted", grade: c.predictedGrade ?? null };
  }
  if (c.status === "IN_PROGRESS") return { basis: "predicted", grade: c.predictedGrade ?? null };
  return { basis: "planned", grade: c.predictedGrade ?? null };
};

function bestMapping(course: StudentCourseInput, keys: string[]): CourseMapping | null {
  let best: CourseMapping | null = null;
  for (const m of course.mappings) {
    if (!keys.includes(m.subjectKey)) continue;
    if (!best || LEVEL_RANK[m.level] > LEVEL_RANK[best.level] || (m.level === best.level && m.rigor > best.rigor)) best = m;
  }
  return best;
}

function candidateFor(course: StudentCourseInput, keys: string[], minLevel: SubjectLevel | null | undefined, minGrade: string | null | undefined): Candidate | null {
  const mapping = bestMapping(course, keys);
  if (!mapping) return null;
  const { basis, grade } = basisOf(course);
  const levelOk = !minLevel || LEVEL_RANK[mapping.level] >= LEVEL_RANK[minLevel];
  const base = { course, mapping, subjectKey: mapping.subjectKey, basis, grade, levelOk };
  if (!levelOk) return { ...base, status: "not_met" };
  const review = course.mappingStatus === "NEEDS_REVIEW" || mapping.confidence < MIN_MAPPING_CONFIDENCE;
  let status: LineStatus = "met";
  let reason: UnknownReason | undefined;
  if (minGrade) {
    if (!grade) {
      status = "unknown";
      reason = course.status === "COMPLETED" ? "grade_missing" : "grade_pending";
    } else {
      const ok = meetsGrade(course.gradeScale, grade, minGrade);
      if (ok === null) {
        status = "unknown";
        reason = "scale_mismatch";
      } else status = ok ? "met" : "not_met";
    }
  }
  if (review && status !== "not_met") {
    status = "unknown";
    reason = "mapping_review";
  }
  return { ...base, status, reason };
}

const BASIS_Q: Record<Basis, number> = { final: 3, predicted: 2, planned: 1 };
/** Quality of a candidate: met beats unknown beats not met; final beats predicted beats planned. */
function quality(c: Candidate | null): number {
  if (!c) return 0;
  if (c.status === "met") return 10 + BASIS_Q[c.basis];
  if (c.status === "unknown") return 5 + (c.reason === "grade_pending" ? 1 : 0);
  return c.levelOk ? 2 : 1;
}
function better(a: Candidate, b: Candidate): number {
  const q = quality(b) - quality(a);
  if (q !== 0) return q;
  const ra = a.grade ? gradeRank(a.course.gradeScale, a.grade) : null;
  const rb = b.grade ? gradeRank(b.course.gradeScale, b.grade) : null;
  if (ra !== null && rb !== null && a.course.gradeScale === b.course.gradeScale && ra !== rb) return rb - ra;
  if (a.mapping.rigor !== b.mapping.rigor) return b.mapping.rigor - a.mapping.rigor;
  return a.course.id < b.course.id ? -1 : a.course.id > b.course.id ? 1 : 0;
}

const worstBasis = (xs: Basis[]): Basis => (xs.includes("planned") ? "planned" : xs.includes("predicted") ? "predicted" : "final");

function subjectLine(line: SubjectLine, row: RequirementRow, courses: StudentCourseInput[]): { result: LineResult; classes: ClassToTake | null } {
  const keys = [...new Set([...line.keys, ...(line.alternatives ?? [])])];
  const advisory = !COUNTED_SUBJECT_TYPES.has(line.type);
  const needed = line.type === "TWO_OF" ? 2 : 1;
  const common = {
    id: line.id,
    rowId: row.id,
    kind: "subject" as const,
    type: line.type,
    advisory,
    keys,
    minimumLevel: line.minimumLevel ?? null,
    required: line.minimumGrade ?? null,
    confidence: row.confidence,
    evidenceQuote: line.evidenceQuote ?? null,
    sourceUrl: line.sourceUrl ?? null,
    noteEn: line.noteEn ?? null,
    noteAr: line.noteAr ?? null,
    needed,
  };

  // Candidates per key, best first.
  const byKey = new Map<string, Candidate[]>();
  for (const k of keys) {
    const list = courses.map((c) => candidateFor(c, [k], line.minimumLevel, line.minimumGrade)).filter((c): c is Candidate => c !== null);
    list.sort(better);
    byKey.set(k, list);
  }

  let chosen: Candidate[] = [];
  if (needed === 1) {
    const all = [...byKey.values()].flat().sort(better);
    if (all.length) chosen = [all[0]];
  } else {
    // Count once: two different keys, two different courses. Pick the assignment whose worse slot is best,
    // then the better total, then the first in key order (deterministic).
    let best: { pair: Candidate[]; min: number; sum: number } | null = null;
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = byKey.get(keys[i])!;
        const b = byKey.get(keys[j])!;
        const opts: Array<Array<Candidate | null>> = [];
        for (const x of [...a, null]) for (const y of [...b, null]) if (!x || !y || x.course.id !== y.course.id) opts.push([x, y]);
        for (const pair of opts) {
          const qs = pair.map(quality);
          const min = Math.min(...qs);
          const sum = qs[0] + qs[1];
          if (!best || min > best.min || (min === best.min && sum > best.sum)) best = { pair: pair.filter((p): p is Candidate => !!p), min, sum };
        }
      }
    }
    if (best) chosen = best.pair;
  }

  const metSlots = chosen.filter((c) => c.status === "met");
  const unknownSlots = chosen.filter((c) => c.status === "unknown");
  let status: LineStatus;
  let reason: UnknownReason | undefined;
  if (metSlots.length >= needed) status = "met";
  else if (metSlots.length + unknownSlots.length >= needed) {
    status = "unknown";
    reason = unknownSlots[0]?.reason;
  } else status = "not_met";
  const used = status === "met" ? metSlots.slice(0, needed) : chosen.filter((c) => c.status !== "not_met" || c.levelOk);
  const result: LineResult = {
    ...common,
    status,
    reason,
    basis: status === "met" ? worstBasis(used.map((c) => c.basis)) : undefined,
    have: used.map((c) => c.grade).filter(Boolean).join(", ") || null,
    filled: metSlots.length,
    satisfiedBy: used.map((c) => ({ courseId: c.course.id, nameEn: c.course.nameEn, nameAr: c.course.nameAr, subjectKey: c.subjectKey, grade: c.grade, basis: c.basis })),
  };
  // A class to take when no course at the needed level fills the slot (a low grade is a different gap).
  const atLevel = chosen.filter((c) => c.levelOk).length;
  const classes = status === "not_met" && atLevel < needed ? { lineId: line.id, subjectKeys: keys, minimumLevel: line.minimumLevel ?? null, minimumGrade: line.minimumGrade ?? null, slots: needed - atLevel } : null;
  return { result, classes };
}

// ---------------------------------------------------------------------------------------------
// Overall figures, streams and grade profiles

function metricLine(row: RequirementRow, kind: "gpa" | "percent" | "points", min: number, profile: StudentProfile): LineResult {
  const m = profile.overall[kind] ?? null;
  const base = { id: `${row.id}:${kind}`, rowId: row.id, kind, type: "REQUIRED", advisory: false, required: min, confidence: row.confidence, evidenceQuote: row.evidenceLocator ?? null };
  if (!m) return { ...base, status: "unknown", reason: "no_overall", have: null };
  return { ...base, status: m.value >= min ? "met" : "not_met", basis: m.final ? "final" : "predicted", have: m.value };
}

function streamLine(row: RequirementRow, profile: StudentProfile): LineResult {
  const accepted = (row.stream ?? "").split(/[|,]/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const base = { id: `${row.id}:stream`, rowId: row.id, kind: "stream" as const, type: "REQUIRED", advisory: false, required: accepted.join(" | "), confidence: row.confidence, alternatives: accepted };
  const have = profile.stream ? profile.stream.toUpperCase() : null;
  if (!have) return { ...base, status: "unknown", reason: "no_stream", have: null };
  return { ...base, status: accepted.includes(have) ? "met" : "not_met", basis: "final", have };
}

/** A-level profiles use A-level courses (ADVANCED); IB profiles use Higher Level courses. */
function gradeProfileLine(row: RequirementRow, profile: StudentProfile): LineResult | null {
  const scale = row.curriculum === "IB" ? "IB_7" : row.curriculum === "BRITISH" ? "A_LEVEL" : null;
  if (!scale || !row.gradeProfile) return null;
  const tokens = parseGradeProfile(scale, row.gradeProfile);
  if (!tokens) return null;
  const minLevel: SubjectLevel = scale === "IB_7" ? "HIGHER" : "ADVANCED";
  const base = { id: `${row.id}:profile`, rowId: row.id, kind: "gradeProfile" as const, type: "REQUIRED", advisory: false, required: row.gradeProfile, confidence: row.confidence, evidenceQuote: row.evidenceLocator ?? null };
  const eligible = profile.courses.filter((c) => c.gradeScale === scale && c.mappings.some((m) => LEVEL_RANK[m.level] >= LEVEL_RANK[minLevel]));
  const graded = eligible
    .map((c) => ({ c, ...basisOf(c) }))
    .filter((x) => x.grade && gradeRank(scale, x.grade) !== null)
    .sort((a, b) => gradeRank(scale, b.grade)! - gradeRank(scale, a.grade)! || (a.c.id < b.c.id ? -1 : 1));
  const ungraded = eligible.length - graded.length;
  const n = tokens.length;
  const sortedTokens = [...tokens].sort((a, b) => gradeRank(scale, b)! - gradeRank(scale, a)!);
  const top = graded.slice(0, n);
  const have = top.map((x) => x.grade).join("") || null;
  const satisfiedBy = top.map((x) => ({ courseId: x.c.id, nameEn: x.c.nameEn, nameAr: x.c.nameAr, subjectKey: x.c.mappings[0]?.subjectKey ?? "", grade: x.grade, basis: x.basis }));
  if (eligible.length < n) return { ...base, status: "not_met", have, satisfiedBy };
  if (top.length === n) {
    const ok = top.every((x, i) => gradeRank(scale, x.grade)! >= gradeRank(scale, sortedTokens[i])!);
    if (ok) return { ...base, status: "met", basis: worstBasis(top.map((x) => x.basis)), have, satisfiedBy };
    return ungraded > 0 ? { ...base, status: "unknown", reason: "grade_pending", have, satisfiedBy } : { ...base, status: "not_met", have, satisfiedBy };
  }
  // Some grades are still to come, so the profile cannot be decided yet.
  return { ...base, status: "unknown", reason: "grade_pending", have, satisfiedBy };
}

// ---------------------------------------------------------------------------------------------
// Tests and languages

const bestScore = (tests: StudentProfile["tests"], kind: string) => {
  let best: number | null = null;
  for (const t of tests) if (t.kind === kind && (best === null || t.score > best)) best = t.score;
  return best;
};

function groupTests(lines: TestLine[]): TestLine[][] {
  const groups: TestLine[][] = [];
  const used = new Set<string>();
  for (const l of lines) {
    if (used.has(l.id)) continue;
    const alt = TEST_ALTERNATIVES.find((g) => g.includes(l.test.toUpperCase()));
    const group = alt ? lines.filter((x) => !used.has(x.id) && x.policy === l.policy && alt.includes(x.test.toUpperCase())) : [l];
    for (const g of group) used.add(g.id);
    groups.push(group);
  }
  return groups;
}

function testLine(group: TestLine[], row: RequirementRow, profile: StudentProfile): LineResult | null {
  const policy = group[0].policy.toUpperCase();
  if (policy === "BLIND" || policy === "NOT_CONSIDERED") return null;
  const advisory = policy !== "REQUIRED";
  const scored = group.map((l) => ({ l, score: bestScore(profile.tests, l.test.toUpperCase()) }));
  const passing = scored.find((s) => s.score !== null && (s.l.minScore == null || s.score >= s.l.minScore));
  const tried = scored.find((s) => s.score !== null);
  const pick = passing ?? tried ?? scored[0];
  const base = {
    id: group.map((g) => g.id).join("+"),
    rowId: row.id,
    kind: "test" as const,
    type: policy,
    advisory,
    required: pick.l.minScore ?? null,
    have: pick.score,
    keys: [pick.l.test.toUpperCase()],
    alternatives: group.map((g) => g.test.toUpperCase()),
    confidence: row.confidence,
    evidenceQuote: group.map((g) => g.evidenceQuote).find(Boolean) ?? null,
    sourceUrl: group.map((g) => g.sourceUrl).find(Boolean) ?? null,
    noteEn: group.map((g) => g.noteEn).find(Boolean) ?? null,
  };
  if (passing) return { ...base, status: "met", basis: "final" };
  if (tried) return { ...base, status: "not_met" };
  return { ...base, status: "unknown", reason: "not_taken", basis: "planned" };
}

function languageLine(rows: RequirementRow[], profile: StudentProfile): LineResult | null {
  const all = rows.flatMap((r) => r.languages.map((l) => ({ l, row: r })));
  if (!all.length) return null;
  const scored = all.map((x) => ({ ...x, score: bestScore(profile.tests, x.l.test.toUpperCase()) }));
  const passing = scored.find((s) => s.score !== null && s.score >= s.l.minOverall);
  const tried = scored.find((s) => s.score !== null);
  const pick = passing ?? tried ?? scored[0];
  const base = {
    id: `lang:${all.map((x) => x.l.id).join("+")}`,
    rowId: pick.row.id,
    kind: "language" as const,
    type: "REQUIRED",
    advisory: false,
    required: pick.l.minOverall,
    have: pick.score,
    keys: [pick.l.test.toUpperCase()],
    alternatives: all.map((x) => x.l.test.toUpperCase()),
    confidence: pick.row.confidence,
    evidenceQuote: all.map((x) => x.l.evidenceQuote).find(Boolean) ?? null,
    sourceUrl: all.map((x) => x.l.sourceUrl).find(Boolean) ?? null,
    noteEn: all.map((x) => x.l.waiverNoteEn).find(Boolean) ?? null,
  };
  if (passing) return { ...base, status: "met", basis: "final" };
  if (tried) return { ...base, status: "not_met" };
  return { ...base, status: "unknown", reason: "not_taken", basis: "planned" };
}

// ---------------------------------------------------------------------------------------------
// Programme evaluation

export function statusFrom(lines: LineResult[], covered: boolean, hasRows: boolean): MatchStatus {
  if (!hasRows) return "UNKNOWN_DATA";
  const counted = lines.filter((l) => !l.advisory);
  if (counted.some((l) => l.status === "not_met")) return "MISSING_REQUIREMENTS";
  if (!covered || counted.some((l) => l.status === "unknown" && l.reason === "manual")) return "NEEDS_MANUAL_REVIEW";
  if (counted.some((l) => l.status === "unknown" && l.reason !== "not_taken")) return "POSSIBLY_ELIGIBLE";
  if (counted.some((l) => l.status === "unknown" || (l.basis && l.basis !== "final"))) return "ON_TRACK";
  return "ELIGIBLE";
}

export function evaluate(profile: StudentProfile, program: ProgramForEval): EvalResult {
  const { rows, covered } = applicableRows(program, profile.curriculum);
  const lines: LineResult[] = [];
  const classesToTake: ClassToTake[] = [];
  const suggestedClasses: ClassToTake[] = [];
  for (const row of rows) {
    const rowLines: LineResult[] = [];
    if (row.stream) rowLines.push(streamLine(row, profile));
    if (row.minimumGPA != null) rowLines.push(metricLine(row, "gpa", row.minimumGPA, profile));
    if (row.minimumPercent != null) rowLines.push(metricLine(row, "percent", row.minimumPercent, profile));
    if (row.minimumPoints != null) rowLines.push(metricLine(row, "points", row.minimumPoints, profile));
    const gp = gradeProfileLine(row, profile);
    if (gp) rowLines.push(gp);
    for (const s of row.subjects) {
      const { result, classes } = subjectLine(s, row, profile.courses);
      rowLines.push(result);
      if (classes) (result.advisory ? suggestedClasses : classesToTake).push(classes);
      else if (result.advisory && result.status !== "met") suggestedClasses.push({ lineId: s.id, subjectKeys: result.keys ?? [], minimumLevel: s.minimumLevel ?? null, minimumGrade: s.minimumGrade ?? null, slots: 1 });
    }
    for (const g of groupTests(row.tests)) {
      const t = testLine(g, row, profile);
      if (t) rowLines.push(t);
    }
    for (const a of row.additional) {
      if (BLOCKING_KINDS.has(a.kind.toUpperCase())) {
        rowLines.push({
          id: a.id,
          rowId: row.id,
          kind: "additional",
          type: a.kind.toUpperCase(),
          advisory: false,
          status: "not_met",
          reason: "not_accepted",
          confidence: row.confidence,
          evidenceQuote: a.evidenceQuote ?? null,
          sourceUrl: a.sourceUrl ?? null,
          noteEn: a.noteEn ?? null,
          noteAr: a.noteAr ?? null,
        });
        continue;
      }
      const step = APPLICATION_STEPS.has(a.kind.toUpperCase()) || !a.required;
      rowLines.push({
        id: a.id,
        rowId: row.id,
        kind: "additional",
        type: a.kind.toUpperCase(),
        advisory: step,
        status: "unknown",
        reason: step ? undefined : "manual",
        confidence: row.confidence,
        evidenceQuote: a.evidenceQuote ?? null,
        sourceUrl: a.sourceUrl ?? null,
        noteEn: a.noteEn ?? null,
        noteAr: a.noteAr ?? null,
      });
    }
    // Unverified rows are never shown as fact: their outcome becomes unknown.
    if (UNVERIFIED.includes(row.confidence)) {
      for (const l of rowLines) {
        if (l.advisory || l.status === "unknown") continue;
        l.underlying = l.status;
        l.status = "unknown";
        l.reason = "unverified";
        l.basis = undefined;
      }
    }
    lines.push(...rowLines);
  }
  const lang = languageLine(rows, profile);
  if (lang) {
    if (UNVERIFIED.includes(lang.confidence) && lang.status !== "unknown") {
      lang.underlying = lang.status;
      lang.status = "unknown";
      lang.reason = "unverified";
      lang.basis = undefined;
    }
    lines.push(lang);
  }

  const counted = lines.filter((l) => !l.advisory);
  const scoreGaps: ScoreGap[] = lines
    .filter((l) => l.status === "not_met" && !l.advisory && typeof l.required === "number" && typeof l.have === "number")
    .map((l) => ({ lineId: l.id, kind: l.kind === "test" || l.kind === "language" ? (l.keys?.[0] ?? l.kind) : l.kind.toUpperCase(), required: l.required as number, have: l.have as number }));
  // Unverified lines do not produce classes to take.
  const unverifiedLines = new Set(lines.filter((l) => l.reason === "unverified").map((l) => l.id));
  return {
    programId: program.id,
    status: statusFrom(lines, covered, rows.length > 0),
    covered,
    rowIds: rows.map((r) => r.id),
    lines,
    counts: {
      requiredSatisfied: counted.filter((l) => l.status === "met").length,
      requiredMissing: counted.filter((l) => l.status === "not_met").length,
      requiredUnknown: counted.filter((l) => l.status === "unknown").length,
      recommendedSatisfied: lines.filter((l) => l.advisory && l.kind === "subject" && l.status === "met").length,
    },
    classesToTake: classesToTake.filter((c) => !unverifiedLines.has(c.lineId)),
    suggestedClasses,
    scoreGaps,
  };
}

/** Evaluate many programmes. Order follows the input. */
export function evaluateAll(profile: StudentProfile, programs: ProgramForEval[]): EvalResult[] {
  return programs.map((p) => evaluate(profile, p));
}

/** Count results per status, every status present (zero when none). */
export function statusCounts(results: Array<{ status: MatchStatus }>): Record<MatchStatus, number> {
  const out = { ELIGIBLE: 0, ON_TRACK: 0, POSSIBLY_ELIGIBLE: 0, MISSING_REQUIREMENTS: 0, NEEDS_MANUAL_REVIEW: 0, UNKNOWN_DATA: 0 } as Record<MatchStatus, number>;
  for (const r of results) out[r.status]++;
  return out;
}
