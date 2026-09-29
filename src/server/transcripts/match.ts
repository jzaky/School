// Match an imported course line to a catalog CurriculumCourse, with a confidence score. Pure.
// Order: exact course code, then normalized name, then fuzzy similarity. Qualification words (IGCSE,
// A-Level, AP, Honors, HL, SL, Class 12) and the grade level adjust the score; courses the school
// offers get a small bonus. A match is automatic only when it is confident and clearly ahead of the
// next candidate; everything else waits for a person.
import type { Curriculum } from "@/server/pathway-engine/types";
import type { MatchResult } from "./types";

export type CandidateCourse = {
  id: string;
  curriculum: Curriculum;
  code: string;
  nameEn: string;
  nameAr: string;
  qualification: string;
  gradeLevel: number | null;
};

export const AUTO_THRESHOLD = 0.8;
export const SUGGEST_THRESHOLD = 0.4;
const AUTO_MARGIN = 0.05;

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bmaths?\b/g, "mathematics"],
  [/\bcomp(?:uter)?\.? ?sci(?:ence)?\b/g, "computer science"],
  [/\bcs\b/g, "computer science"],
  [/\bict\b/g, "information technology"],
  [/\bit\b/g, "information technology"],
  [/\bbio\b/g, "biology"],
  [/\bchem\b/g, "chemistry"],
  [/\bphys?\b/g, "physics"],
  [/\becon\b/g, "economics"],
  [/\bgeog?\b/g, "geography"],
  [/\bhist\b/g, "history"],
  [/\bpsych\b/g, "psychology"],
  [/\bbus\b/g, "business"],
  [/\bbst\b/g, "business studies"],
  [/\bsst\b/g, "social science"],
  [/\bsci\b/g, "science"],
  [/\beng\b/g, "english"],
  [/\blng\b/g, "language"],
  [/\blang\b/g, "language"],
  [/\blit\b/g, "literature"],
  [/\badd\b/g, "additional"],
  [/\bhonours\b/g, "honors"],
  [/\bstd\b/g, "standard"],
  [/\bpe\b/g, "physical education"],
];

const STOP = new Set(["and", "of", "the", "in", "for", "to", "a", "course", "subject", "paper", "introduction", "intro", "و"]);

/** Lower case, Arabic letter variants folded, punctuation removed, common abbreviations expanded. */
export function normalizeName(raw: string): string {
  let s = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/&/g, " and ")
    .replace(/\ba[\s-]?levels?\b/g, " alevel ")
    .replace(/\bas[\s-]levels?\b/g, " aslevel ")
    .replace(/\(\s*\d{3}\s*\)/g, " ")
    .replace(/[^\p{L}\p{N}*+ ]+/gu, " ")
    .replace(/\s+/g, " ");
  for (const [re, to] of ABBREVIATIONS) s = s.replace(re, to);
  return s.replace(/\s+/g, " ").trim();
}

const QUAL_TOKENS: Record<string, string> = { igcse: "IGCSE", gcse: "GCSE", alevel: "A_LEVEL", aslevel: "AS_LEVEL", ap: "AP", honors: "HONORS", hl: "HL", sl: "SL" };
/** "AS" only names the qualification as the first word ("AS Physics"), not in "English as a Second Language". */
const qualAt = (t: string, i: number) => QUAL_TOKENS[t] ?? (t === "as" && i === 0 ? "AS_LEVEL" : undefined);
const DROP = /^(cbse|isc|ib|moe|level|core|course|dp|diploma)$/;
const MARKER = /^(class|grade|year)$/;
const ROMAN_NUM: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4" };

/** The words that name the subject, without curriculum, class or qualification markers. */
export function coreTokens(name: string): string[] {
  const toks = normalizeName(name).split(" ").filter(Boolean);
  const out: string[] = [];
  toks.forEach((t, i) => {
    const prev = toks[i - 1];
    if (STOP.has(t) || qualAt(t, i) || DROP.test(t) || MARKER.test(t)) return;
    // "Class 10", "Grade XI", "Year 11" describe when, not what.
    if (prev && MARKER.test(prev) && /^(\d{1,2}|x|xi|xii|ix)$/.test(t)) return;
    // "Mathematics Standard" is a CBSE course name; elsewhere "standard" is noise.
    if (t === "standard" && prev !== "mathematics") return;
    out.push(i > 0 && ROMAN_NUM[t] ? ROMAN_NUM[t] : t);
  });
  return out;
}

/** Qualification named in the course line (IGCSE, A_LEVEL, AP...), if any. */
export function qualificationOf(name: string): string | null {
  const toks = normalizeName(name).split(" ");
  for (let i = 0; i < toks.length; i++) {
    const q = qualAt(toks[i], i);
    if (q) return q;
  }
  return null;
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const x = s.replace(/\s+/g, " ");
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) {
    inter += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

/** Similarity of two course names on their subject words, 0 to 1. */
export function nameSimilarity(a: string, b: string): number {
  const A = coreTokens(a);
  const B = coreTokens(b);
  if (!A.length || !B.length) return 0;
  const ja = A.join(" ");
  const jb = B.join(" ");
  if (ja === jb) return 1;
  const setA = new Set(A);
  const setB = new Set(B);
  const shared = [...setA].filter((t) => setB.has(t)).length;
  const longer = Math.max(setA.size, setB.size);
  const contained = shared === Math.min(setA.size, setB.size) && shared > 0;
  const contain = contained ? 0.6 + 0.3 * (shared / longer) : 0;
  return Math.max(dice(ja, jb) * 0.9, (shared / longer) * 0.9, contain);
}

const QUAL_OF_COURSE = (q: string) => q.toUpperCase();
const SPECIAL = new Set(["AP", "HONORS", "HL", "SL"]);

/** Score one candidate for a line. */
export function scoreCandidate(line: { name: string; curriculum: Curriculum | null; gradeLevel: number | null }, c: CandidateCourse, offered: Set<string>): number {
  const hasArabic = /[؀-ۿ]/.test(line.name);
  let s = Math.max(nameSimilarity(line.name, c.nameEn), hasArabic ? nameSimilarity(line.name, c.nameAr) : 0);
  if (s === 0) return 0;
  const qLine = qualificationOf(line.name);
  const qCourse = QUAL_OF_COURSE(c.qualification);
  if (qLine) s += qLine === qCourse ? 0.05 : -0.2;
  else if (SPECIAL.has(qCourse)) s -= 0.12;
  if (line.gradeLevel !== null && c.gradeLevel !== null) {
    const d = Math.abs(line.gradeLevel - c.gradeLevel);
    s += d === 0 ? 0.05 : d === 1 ? -0.03 : -0.15;
  }
  if (line.curriculum && c.curriculum !== line.curriculum) s -= 0.25;
  if (offered.has(c.id)) s += 0.02;
  return Math.max(0, Math.min(1, Math.round(s * 100) / 100));
}

/**
 * Best catalog course for an imported line. Candidates should already be limited to the catalog the
 * school can see; when the line's curriculum has candidates, other curricula are only fallbacks.
 */
export function matchCourse(line: { name: string; code?: string | null; curriculum: Curriculum | null; gradeLevel: number | null }, candidates: CandidateCourse[], offered: Set<string> = new Set()): MatchResult {
  const code = line.code?.trim().toUpperCase();
  if (code) {
    const byCode = candidates.filter((c) => c.code.toUpperCase() === code && (!line.curriculum || c.curriculum === line.curriculum));
    if (byCode.length === 1) return { courseId: byCode[0].id, confidence: 1, method: "code", alternatives: [], auto: true };
  }
  const pool = line.curriculum && candidates.some((c) => c.curriculum === line.curriculum) ? candidates.filter((c) => c.curriculum === line.curriculum) : candidates;
  const target = normalizeName(line.name);
  const scored = pool
    .map((c) => {
      const sameCurriculum = !line.curriculum || c.curriculum === line.curriculum;
      const exact = sameCurriculum && (normalizeName(c.nameEn) === target || normalizeName(c.nameAr) === target);
      return { c, score: exact ? Math.min(1, scoreCandidate(line, c, offered) + 0.1) : scoreCandidate(line, c, offered), exact };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact) || a.c.code.localeCompare(b.c.code));
  const top = scored[0];
  if (!top || top.score < SUGGEST_THRESHOLD) {
    return { courseId: null, confidence: top?.score ?? 0, method: "none", alternatives: scored.slice(0, 3).map((x) => ({ courseId: x.c.id, confidence: x.score })), auto: false };
  }
  const second = scored[1];
  const clear = !second || top.score - second.score >= AUTO_MARGIN;
  return {
    courseId: top.c.id,
    confidence: top.score,
    method: top.exact ? "exact" : "fuzzy",
    alternatives: scored.slice(1, 4).map((x) => ({ courseId: x.c.id, confidence: x.score })),
    // A course from another curriculum is only ever a suggestion.
    auto: top.score >= AUTO_THRESHOLD && clear && (!line.curriculum || top.c.curriculum === line.curriculum),
  };
}
