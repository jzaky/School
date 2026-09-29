// Deterministic, rule-based requirement extractor. Used when no AI model is configured (and by the
// worker), so the pipeline works offline. It finds common patterns only: IELTS and TOEFL scores,
// A-Level grade profiles (A*AA), IB points, subject grades, required and recommended subject lists,
// SAT/ACT policy, admissions tests, interviews and personal statements. Its output goes through the
// same evidence validation as model output (validate.ts).
import type { Curriculum } from "./types";
import { findSubjects, resolveSubjectKey, type VocabEntry } from "./vocab";

type RawLine = Record<string, unknown>;
type RawGroup = { curriculum: Curriculum | null; overall: RawLine[]; subjects: RawLine[]; languages: RawLine[]; tests: RawLine[]; additional: RawLine[] };

const BRITISH = /\bA[- ]?levels?\b|\bGCE\b|\bIGCSE\b|\bGCSE\b/i;
const IB = /\bIB\b|International Baccalaureate|\bHL\b|Higher Level/i;
const AMERICAN = /\bSAT\b|\bACT\b|\bAP\b|Advanced Placement|\bGPA\b|high school diploma|US High School/i;

function curriculumOf(s: string): Curriculum | null {
  if (BRITISH.test(s)) return "BRITISH";
  if (IB.test(s)) return "IB";
  if (AMERICAN.test(s)) return "AMERICAN";
  return null;
}

/** Split into sentences that are exact substrings of the text. Long sentences are windowed. */
function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    for (const piece of line.split(/(?<=[.;!?])\s+(?=[A-Z0-9(])/)) {
      const s = piece.trim();
      if (!s) continue;
      if (s.length <= 400) out.push(s);
      else for (let i = 0; i < s.length; i += 300) out.push(s.slice(i, i + 400).trim());
    }
  }
  return out;
}

const num = (s: string | undefined) => (s === undefined ? null : Number(s));

function languageLine(s: string): RawLine | null {
  const ielts = /IELTS/i.exec(s);
  if (ielts) {
    const after = s.slice(ielts.index);
    const overall = /(?:^|[^\d.])([4-9](?:\.[05])?)(?![\d])/.exec(after.slice(5));
    if (!overall) return null;
    const comp =
      /([4-9](?:\.[05])?)\s*(?:or above\s*)?(?:in|for)\s*(?:each|all|every|any)(?:\s+of the)?(?:\s+four)?\s*(?:component|element|band|section|subtest|skill|sub-?score|module)s?/i.exec(after) ??
      /(?:each|every|all|no)\s+(?:component|element|band|section|subtest|skill|sub-?score|module)s?[^\d]{0,30}?([4-9](?:\.[05])?)/i.exec(after) ??
      /(?:minimum|at least)\s+(?:of\s+)?([4-9](?:\.[05])?)\s+in\s+(?:each|all|every)/i.exec(after);
    return { test: "IELTS", minOverall: num(overall[1]), minComponent: comp ? num(comp[1]) : null, evidenceQuote: s };
  }
  const toefl = /TOEFL/i.exec(s);
  if (toefl) {
    const after = s.slice(toefl.index);
    const overall = /(?:^|[^\d])([4-9]\d|1[01]\d|120)(?![\d])/.exec(after);
    if (!overall) return null;
    const comp =
      /(?:minimum|at least|no less than)?\s*(?:of\s+)?([12]\d|30)\s*(?:in|for)\s*(?:each|all|every|any)\s*(?:section|component|skill|band|sub-?score)s?/i.exec(after) ??
      /(?:each|every|all)\s+(?:section|component|skill|sub-?score)s?[^\d]{0,30}?([12]\d|30)(?![\d])/i.exec(after);
    return { test: "TOEFL", minOverall: num(overall[1]), minComponent: comp ? num(comp[1]) : null, evidenceQuote: s };
  }
  return null;
}

function subjectKeys(clause: string, vocab: VocabEntry[]) {
  return findSubjects(clause)
    .map((m) => resolveSubjectKey(m.aliasId, vocab))
    .filter((k): k is string => !!k);
}

/** "including A* in Mathematics and A in Physics or Chemistry" style clauses. */
function subjectItems(clause: string, vocab: VocabEntry[], level: string | null, gradeRe: RegExp): RawLine[] {
  const lines: RawLine[] = [];
  for (const item of clause.split(/,|;|\band\b/)) {
    const mentions = findSubjects(item);
    if (!mentions.length) continue;
    const keys = subjectKeys(item, vocab);
    if (!keys.length) {
      // Keep the unknown subject so validation can report it instead of silently dropping it.
      lines.push({ keys: mentions.map((m) => m.aliasId), grade: null });
      continue;
    }
    const g = gradeRe.exec(item);
    lines.push({ keys, grade: g ? g[1] : null, level });
  }
  return lines;
}

export function extractByRules(text: string, vocab: VocabEntry[]): { groups: RawGroup[] } {
  const groups = new Map<string, RawGroup>();
  const group = (c: Curriculum | null) => {
    const k = c ?? "GENERAL";
    let g = groups.get(k);
    if (!g) {
      g = { curriculum: c, overall: [], subjects: [], languages: [], tests: [], additional: [] };
      groups.set(k, g);
    }
    return g;
  };
  let heading: Curriculum | null = null;

  for (const s of sentences(text)) {
    const own = curriculumOf(s);
    // Short lines work as headings ("A levels", "International Baccalaureate") for the lines below.
    if (s.length <= 60 && own && !/\d/.test(s.replace(/\bA[- ]?levels?\b/i, ""))) heading = own;
    const cur = own ?? heading;

    const lang = languageLine(s);
    if (lang) {
      group(null).languages.push(lang);
      continue;
    }

    // SAT / ACT policy.
    const satAct = [...new Set([...s.matchAll(/\b(SAT|ACT)\b/g)].map((m) => m[1]))];
    if (satAct.length) {
      const policy = /test[- ]blind|not (?:be )?considered|will not (?:review|consider)/i.test(s)
        ? "NOT_CONSIDERED"
        : /test[- ]optional|optional|not required/i.test(s)
          ? "OPTIONAL"
          : /recommend/i.test(s)
            ? "RECOMMENDED"
            : /requir|must submit/i.test(s)
              ? "REQUIRED"
              : null;
      if (policy) {
        for (const test of satAct) {
          const min = test === "SAT" ? /minimum[^.]{0,20}?(1[0-5]\d{2}|[4-9]\d{2})\b/i.exec(s) : /minimum[^.]{0,20}?\b([1-3]\d)\b/i.exec(s);
          group("AMERICAN").tests.push({ test, policy, minScore: min ? Number(min[1]) : null, evidenceQuote: s });
        }
        continue;
      }
    }

    // Admissions tests.
    for (const m of s.matchAll(/\b(TMUA|MAT|STEP|ESAT|UCAT|LNAT)\b/g)) {
      const policy = /recommend|encourag/i.test(s) && !/requir|must/i.test(s) ? "RECOMMENDED" : /requir|must|sit|take/i.test(s) ? "REQUIRED" : null;
      if (policy) group(null).tests.push({ test: m[1], policy, minScore: null, evidenceQuote: s });
    }

    // Interviews and written parts of the application.
    for (const clause of s.split(/;\s*/)) {
      if (clause.length < 25 || !/\binterview/i.test(clause) || /\b(not|no)\b[^.;]{0,40}\binterview|\binterviews?\b[^.;]{0,20}\b(are|is) not\b/i.test(clause)) continue;
      const optional = /\bmay\b|optional|some applicants/i.test(clause);
      const required = !optional && /interview[^.;]*(required|compulsory|will be)|(all|every) (applicants|candidates)[^.;]*interview|must[^.;]*interview/i.test(clause);
      group(null).additional.push({ kind: "INTERVIEW", required, noteEn: null, evidenceQuote: s });
    }
    if (/personal statement/i.test(s)) group(null).additional.push({ kind: "PERSONAL_STATEMENT", required: !/optional/i.test(s), noteEn: null, evidenceQuote: s });
    if (/\bportfolio\b/i.test(s)) group(null).additional.push({ kind: "PORTFOLIO", required: /requir|must/i.test(s), noteEn: null, evidenceQuote: s });

    // A-Level grade profile and subject grades.
    if (cur === "BRITISH" || own === "BRITISH") {
      const profile = /(?<![A-Za-z*])((?:A\*|[A-E]){3,4})(?![A-Za-z*])/.exec(s);
      if (profile && /grade|level|offer|typical|including|requir/i.test(s + " " + (heading ?? ""))) {
        group("BRITISH").overall.push({ field: "gradeProfile", value: profile[1], evidenceQuote: s });
      }
      const incl = /\b(?:including|with)\s+([^.;]+)/i.exec(s);
      if (incl) {
        for (const item of subjectItems(incl[1], vocab, "ADVANCED", /(A\*|[A-E])\s+in\b/)) {
          group("BRITISH").subjects.push({ type: "REQUIRED", keys: item.keys, minimumLevel: "ADVANCED", minimumGrade: item.grade, evidenceQuote: s });
        }
      }
    }

    // IB points and Higher Level subjects.
    if (cur === "IB" || own === "IB") {
      const pts = /\b([2-4]\d)\s*(?:points|pts)\b/i.exec(s);
      if (pts) group("IB").overall.push({ field: "minimumPoints", value: Number(pts[1]), evidenceQuote: s });
      for (const m of s.matchAll(/\b([1-7])\s+in\s+(?:HL|Higher Level)\s+([A-Z][^,.;]*)/g)) {
        const keys = subjectKeys(m[2], vocab);
        if (keys.length) group("IB").subjects.push({ type: "REQUIRED", keys, minimumLevel: "HIGHER", minimumGrade: m[1], evidenceQuote: s });
      }
      for (const m of s.matchAll(/\b([1-7])\s+in\s+([A-Z][A-Za-z :]*?)\s+at\s+(?:HL|Higher Level)/g)) {
        const keys = subjectKeys(m[2], vocab);
        if (keys.length) group("IB").subjects.push({ type: "REQUIRED", keys, minimumLevel: "HIGHER", minimumGrade: m[1], evidenceQuote: s });
      }
    }

    // GPA.
    const gpa = /\bGPA\b[^.\d]{0,20}(\d\.\d{1,2})|(\d\.\d{1,2})\s*(?:\/\s*4\.0\s*)?(?:cumulative\s+)?GPA/i.exec(s);
    if (gpa) group("AMERICAN").overall.push({ field: "minimumGPA", value: Number(gpa[1] ?? gpa[2]), evidenceQuote: s });

    // Required and recommended subject lists.
    const req = /(?:required|essential|compulsory|prerequisite) subjects?\s*(?:are|is|:|-)?\s*([^.;]+)/i.exec(s) ?? /^([^.;]+?)\s+(?:is|are)\s+(?:required|essential|compulsory)\b/i.exec(s);
    if (req && !/including/i.test(s)) {
      for (const item of subjectItems(req[1], vocab, null, /(A\*|[A-E]|[1-7])\s+in\b/)) {
        group(cur).subjects.push({ type: "REQUIRED", keys: item.keys, minimumLevel: cur === "BRITISH" ? "ADVANCED" : null, minimumGrade: item.grade, evidenceQuote: s });
      }
    }
    const rec =
      /(recommended|desirable|preferred|useful|encouraged)\s*(?:subjects?)?\s*(?::|-|include|are)\s*([^.;]+)/i.exec(s) ??
      /^(?:we\s+(?:also\s+)?)?([^.;]+?)\s+(?:is|are|would be)\s+(?:also\s+)?(?:strongly\s+)?(recommended|desirable|preferred|useful|encouraged)\b/i.exec(s);
    if (rec) {
      const [clause, word] = /recommended|desirable|preferred|useful|encouraged/i.test(rec[1]) ? [rec[2], rec[1]] : [rec[1], rec[2]];
      const type = /preferred/i.test(word) ? "PREFERRED" : "RECOMMENDED";
      for (const item of subjectItems(clause, vocab, null, /(A\*|[A-E]|[1-7])\s+in\b/)) {
        group(cur).subjects.push({ type, keys: item.keys, minimumLevel: cur === "BRITISH" ? "ADVANCED" : cur === "IB" ? "HIGHER" : null, minimumGrade: null, evidenceQuote: s });
      }
    }
  }
  return { groups: [...groups.values()] };
}
