// Evidence validation for extracted requirement lines.
// Ported from collegedata-fyi tools/extraction_worker/tier4_llm_fallback.py (validate_response,
// _evidence_present, _value_in_evidence, _sanity_check), MIT License, (c) 2026 Anthony S. and
// Bolewood Group, LLC. See docs/third-party.md. Every line, whether from the model or from the
// rule-based extractor, goes through the same checks:
//   1. the evidence quote is a verbatim substring of the page text (exact, then whitespace-collapsed)
//   2. the value appears in its evidence (numbers, grades, subjects, test names)
//   3. codes are inside the vocabulary (CanonicalSubject keys, known tests, levels, policies)
//   4. numbers pass range checks (IELTS 0-9, TOEFL 0-120, IB 24-45, percent 0-100, GPA 0-5, SAT 400-1600, ACT 1-36)
import {
  ADDITIONAL_KINDS,
  ADMISSION_TESTS,
  CURRICULA,
  LANGUAGE_TESTS,
  LEVELS,
  SUBJECT_TYPES,
  TEST_POLICIES,
  emptyGroup,
  type AdditionalLine,
  type Curriculum,
  type DraftGroup,
  type LanguageLine,
  type OverallLine,
  type RejectedLine,
  type SubjectLine,
  type TestLine,
} from "./types";
import { subjectInText, type VocabEntry } from "./vocab";

export const RANGES: Record<string, [number, number]> = {
  IELTS: [0, 9],
  IELTS_COMPONENT: [0, 9],
  TOEFL: [0, 120],
  TOEFL_COMPONENT: [0, 30],
  PTE: [10, 90],
  PTE_COMPONENT: [10, 90],
  DUOLINGO: [10, 160],
  DUOLINGO_COMPONENT: [10, 160],
  CAMBRIDGE: [80, 230],
  CAMBRIDGE_COMPONENT: [80, 230],
  SAT: [400, 1600],
  ACT: [1, 36],
  AP: [1, 5],
  IB_POINTS: [24, 45],
  PERCENT: [0, 100],
  GPA: [0, 5],
};

export const MAX_EVIDENCE = 600;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Exact substring first, then whitespace-collapsed (port of _evidence_present). */
export function evidencePresent(evidence: string, text: string) {
  if (!evidence || !evidence.trim()) return false;
  if (text.includes(evidence)) return true;
  return collapse(text).includes(collapse(evidence));
}

/** A number appears in the evidence in any common form (port of _value_in_evidence). */
export function numberInEvidence(value: number, evidence: string) {
  const ev = evidence.replace(/[,\s]/g, "");
  const candidates = new Set([String(value), Number.isInteger(value) ? String(value) : String(value), value.toFixed(0), value.toFixed(1), value.toFixed(2)]);
  if (Number.isInteger(value)) candidates.delete(value.toFixed(2));
  for (const c of candidates) {
    if (!Number.isInteger(value) && c === value.toFixed(0)) continue;
    const re = new RegExp(`(^|[^0-9.])${c.replace(".", "\\.")}(?![0-9])`);
    if (re.test(ev) || re.test(evidence)) return true;
  }
  return false;
}

/** A grade or grade profile appears verbatim in the evidence (A* counted as a unit). */
export function gradeInEvidence(grade: string, evidence: string) {
  const g = grade.trim();
  if (!g) return false;
  const re = new RegExp(`(^|[^A-Za-z*])${g.replace(/[*.+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z*])`);
  return re.test(evidence);
}

const inRange = (n: unknown, key: string): n is number => {
  if (typeof n !== "number" || !Number.isFinite(n)) return false;
  const r = RANGES[key];
  return !r || (n >= r[0] && n <= r[1]);
};

const isStr = (v: unknown): v is string => typeof v === "string";
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const numOrNull = (v: unknown): number | null | undefined => (v === null || v === undefined || v === "" ? null : typeof v === "number" ? v : typeof v === "string" && Number.isFinite(Number(v)) ? Number(v) : undefined);

const GRADE_RE = /^(A\*|[A-EU]|[1-9]|\d{1,3}%?|[A-D][+-]?)$/;
const PROFILE_RE = /^(A\*|[A-E]){2,5}$/;

export type ValidateOptions = {
  /** Human edits may change a value away from the quote; evidence must still be verbatim. */
  allowEditedValues?: boolean;
};

export type ValidationResult = { groups: DraftGroup[]; rejected: RejectedLine[]; accepted: number };

function check(section: string, summary: string, evidence: unknown, text: string, rejected: RejectedLine[]): evidence is string {
  if (!isStr(evidence) || !evidence.trim()) {
    rejected.push({ section, summary, reason: "missing_evidence" });
    return false;
  }
  if (evidence.length > MAX_EVIDENCE) {
    rejected.push({ section, summary, reason: "evidence_too_long", evidenceQuote: evidence.slice(0, 200) });
    return false;
  }
  if (!evidencePresent(evidence, text)) {
    rejected.push({ section, summary, reason: "evidence_not_in_text", evidenceQuote: evidence });
    return false;
  }
  return true;
}

/**
 * Validate a raw draft (model JSON or rule output) against the page text and vocabulary.
 * Returns only accepted lines; every rejected line carries a reason code.
 */
export function validateDraft(raw: unknown, text: string, vocab: VocabEntry[], opts: ValidateOptions = {}): ValidationResult {
  const rejected: RejectedLine[] = [];
  const vocabKeys = new Set(vocab.map((v) => v.key));
  const groupsIn = Array.isArray(obj(raw)?.groups) ? (obj(raw)!.groups as unknown[]) : [];
  const byCurriculum = new Map<string, DraftGroup>();
  let accepted = 0;
  const strictValue = !opts.allowEditedValues;

  for (const gRaw of groupsIn) {
    const g = obj(gRaw);
    if (!g) {
      rejected.push({ section: "group", summary: "", reason: "malformed" });
      continue;
    }
    const cur = g.curriculum === null || g.curriculum === undefined || g.curriculum === "" ? null : g.curriculum;
    if (cur !== null && !(CURRICULA as readonly unknown[]).includes(cur)) {
      rejected.push({ section: "group", summary: String(cur), reason: "invalid_curriculum" });
      continue;
    }
    const mapKey = cur === null ? "GENERAL" : String(cur);
    const out = byCurriculum.get(mapKey) ?? emptyGroup(cur as Curriculum | null);
    byCurriculum.set(mapKey, out);
    const seen = new Set<string>([...out.overall.map((l) => `o:${l.field}`), ...out.subjects.map((l) => `s:${[...l.keys].sort().join("|")}`), ...out.languages.map((l) => `l:${l.test}`), ...out.tests.map((l) => `t:${l.test}`), ...out.additional.map((l) => `a:${l.kind}`)]);
    const dup = (section: string, summary: string, id: string) => {
      if (seen.has(id)) {
        rejected.push({ section, summary, reason: "duplicate" });
        return true;
      }
      seen.add(id);
      return false;
    };

    for (const lRaw of Array.isArray(g.overall) ? g.overall : []) {
      const l = obj(lRaw);
      const field = l?.field;
      const summary = `${String(field)} ${String(l?.value ?? "")}`.trim();
      if (!l || !["gradeProfile", "minimumPoints", "minimumGPA", "minimumPercent"].includes(String(field))) {
        rejected.push({ section: "overall", summary, reason: "malformed" });
        continue;
      }
      if (!check("overall", summary, l.evidenceQuote, text, rejected)) continue;
      const ev = l.evidenceQuote as string;
      let value: string | number;
      if (field === "gradeProfile") {
        const v = isStr(l.value) ? l.value.replace(/\s+/g, "") : "";
        if (!PROFILE_RE.test(v)) {
          rejected.push({ section: "overall", summary, reason: "out_of_range", evidenceQuote: ev });
          continue;
        }
        if (strictValue && !gradeInEvidence(v, ev)) {
          rejected.push({ section: "overall", summary, reason: "value_not_in_evidence", evidenceQuote: ev });
          continue;
        }
        value = v;
      } else {
        const n = numOrNull(l.value);
        const rangeKey = field === "minimumPoints" ? "IB_POINTS" : field === "minimumGPA" ? "GPA" : "PERCENT";
        if (!inRange(n, rangeKey)) {
          rejected.push({ section: "overall", summary, reason: "out_of_range", evidenceQuote: ev });
          continue;
        }
        if (strictValue && !numberInEvidence(n, ev)) {
          rejected.push({ section: "overall", summary, reason: "value_not_in_evidence", evidenceQuote: ev });
          continue;
        }
        value = n;
      }
      if (dup("overall", summary, `o:${String(field)}`)) continue;
      out.overall.push({ field: field as OverallLine["field"], value, evidenceQuote: ev });
      accepted++;
    }

    for (const lRaw of Array.isArray(g.subjects) ? g.subjects : []) {
      const l = obj(lRaw);
      const keys = Array.isArray(l?.keys) ? (l!.keys as unknown[]).filter(isStr) : [];
      const summary = `${String(l?.type ?? "")} ${keys.join(" / ")} ${String(l?.minimumGrade ?? "")}`.trim();
      if (!l || !keys.length) {
        rejected.push({ section: "subject", summary, reason: "malformed" });
        continue;
      }
      if (!check("subject", summary, l.evidenceQuote, text, rejected)) continue;
      const ev = l.evidenceQuote as string;
      if (!(SUBJECT_TYPES as readonly unknown[]).includes(l.type) || ((l.type === "ONE_OF" || l.type === "TWO_OF") && keys.length < 2)) {
        rejected.push({ section: "subject", summary, reason: "invalid_type", evidenceQuote: ev });
        continue;
      }
      const unknown = keys.filter((k) => !vocabKeys.has(k));
      if (unknown.length) {
        rejected.push({ section: "subject", summary, reason: "unknown_subject_code", evidenceQuote: ev });
        continue;
      }
      if (strictValue && !keys.every((k) => subjectInText(k, ev, vocab))) {
        rejected.push({ section: "subject", summary, reason: "value_not_in_evidence", evidenceQuote: ev });
        continue;
      }
      const level = l.minimumLevel === undefined || l.minimumLevel === null || l.minimumLevel === "" ? null : l.minimumLevel;
      if (level !== null && !(LEVELS as readonly unknown[]).includes(level)) {
        rejected.push({ section: "subject", summary, reason: "invalid_level", evidenceQuote: ev });
        continue;
      }
      const grade = isStr(l.minimumGrade) && l.minimumGrade.trim() ? l.minimumGrade.trim() : null;
      if (grade !== null && !GRADE_RE.test(grade)) {
        rejected.push({ section: "subject", summary, reason: "out_of_range", evidenceQuote: ev });
        continue;
      }
      if (grade !== null && strictValue && !gradeInEvidence(grade, ev)) {
        rejected.push({ section: "subject", summary, reason: "value_not_in_evidence", evidenceQuote: ev });
        continue;
      }
      if (dup("subject", summary, `s:${[...keys].sort().join("|")}`)) continue;
      out.subjects.push({ type: l.type as SubjectLine["type"], keys: [...new Set(keys)], minimumLevel: level as SubjectLine["minimumLevel"], minimumGrade: grade, evidenceQuote: ev });
      accepted++;
    }

    for (const lRaw of Array.isArray(g.languages) ? g.languages : []) {
      const l = obj(lRaw);
      const test = isStr(l?.test) ? l!.test.toUpperCase() : "";
      const summary = `${test} ${String(l?.minOverall ?? "")}`.trim();
      if (!l) {
        rejected.push({ section: "language", summary, reason: "malformed" });
        continue;
      }
      if (!check("language", summary, l.evidenceQuote, text, rejected)) continue;
      const ev = l.evidenceQuote as string;
      if (!(LANGUAGE_TESTS as readonly string[]).includes(test)) {
        rejected.push({ section: "language", summary, reason: "unknown_test_code", evidenceQuote: ev });
        continue;
      }
      const overall = numOrNull(l.minOverall);
      const comp = numOrNull(l.minComponent);
      if (!inRange(overall, test) || comp === undefined || (comp !== null && !inRange(comp, `${test}_COMPONENT`)) || (comp !== null && comp > overall)) {
        rejected.push({ section: "language", summary, reason: "out_of_range", evidenceQuote: ev });
        continue;
      }
      if (strictValue && (!ev.toUpperCase().includes(test) || !numberInEvidence(overall, ev) || (comp !== null && !numberInEvidence(comp, ev)))) {
        rejected.push({ section: "language", summary, reason: "value_not_in_evidence", evidenceQuote: ev });
        continue;
      }
      if (dup("language", summary, `l:${test}`)) continue;
      out.languages.push({ test, minOverall: overall, minComponent: comp, evidenceQuote: ev } satisfies LanguageLine);
      accepted++;
    }

    for (const lRaw of Array.isArray(g.tests) ? g.tests : []) {
      const l = obj(lRaw);
      const test = isStr(l?.test) ? l!.test.toUpperCase() : "";
      const summary = `${test} ${String(l?.policy ?? "")}`.trim();
      if (!l) {
        rejected.push({ section: "test", summary, reason: "malformed" });
        continue;
      }
      if (!check("test", summary, l.evidenceQuote, text, rejected)) continue;
      const ev = l.evidenceQuote as string;
      if (!(ADMISSION_TESTS as readonly string[]).includes(test)) {
        rejected.push({ section: "test", summary, reason: "unknown_test_code", evidenceQuote: ev });
        continue;
      }
      if (!(TEST_POLICIES as readonly unknown[]).includes(l.policy)) {
        rejected.push({ section: "test", summary, reason: "invalid_policy", evidenceQuote: ev });
        continue;
      }
      const min = numOrNull(l.minScore);
      if (min === undefined || (min !== null && !inRange(min, test))) {
        rejected.push({ section: "test", summary, reason: "out_of_range", evidenceQuote: ev });
        continue;
      }
      if (strictValue && (!new RegExp(`\\b${test}\\b`, "i").test(ev) || (min !== null && !numberInEvidence(min, ev)))) {
        rejected.push({ section: "test", summary, reason: "value_not_in_evidence", evidenceQuote: ev });
        continue;
      }
      if (dup("test", summary, `t:${test}`)) continue;
      out.tests.push({ test, policy: l.policy as string, minScore: min, evidenceQuote: ev } satisfies TestLine);
      accepted++;
    }

    for (const lRaw of Array.isArray(g.additional) ? g.additional : []) {
      const l = obj(lRaw);
      const kind = isStr(l?.kind) ? l!.kind.toUpperCase() : "";
      const summary = kind;
      if (!l || typeof l.required !== "boolean") {
        rejected.push({ section: "additional", summary, reason: "malformed" });
        continue;
      }
      if (!check("additional", summary, l.evidenceQuote, text, rejected)) continue;
      const ev = l.evidenceQuote as string;
      if (!(ADDITIONAL_KINDS as readonly string[]).includes(kind)) {
        rejected.push({ section: "additional", summary, reason: "unknown_kind", evidenceQuote: ev });
        continue;
      }
      if (dup("additional", summary, `a:${kind}`)) continue;
      out.additional.push({ kind, required: l.required, noteEn: isStr(l.noteEn) ? l.noteEn.slice(0, 300) : null, evidenceQuote: ev } satisfies AdditionalLine);
      accepted++;
    }
  }
  const groups = [...byCurriculum.values()].filter((g) => g.overall.length + g.subjects.length + g.languages.length + g.tests.length + g.additional.length > 0);
  return { groups, rejected, accepted };
}
