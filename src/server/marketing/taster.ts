// Free public career taster: a 12-question short form of the career assessment.
// Pure and deterministic. Uses the same statements, scoring and career weights as the full assessment
// (src/server/career, prisma/seed/data), and groups career matches into career areas (clusters).
import { APTITUDE_QUESTIONS } from "../../../prisma/seed/data/aptitude";
import { CAREERS } from "../../../prisma/seed/data/careers";
import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from "@/server/career/dimensions";
import { matchCareers, scoreAssessment, type Scores } from "@/server/career/scoring";

type I18n = { en: string; ar: string };

/** Positions in APTITUDE_QUESTIONS: one statement per dimension, plus three that separate the most common profiles. */
const PICKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 41] as const;

export type TasterQuestion = { id: string; dimension: Dimension; reverse: boolean; text: I18n };

export const TASTER_QUESTIONS: TasterQuestion[] = PICKS.map((i, n) => {
  const q = APTITUDE_QUESTIONS[i];
  return { id: `q${n + 1}`, dimension: q.dimension, reverse: Boolean(q.reverse), text: q.text };
});

export type TasterAnswers = Record<string, number>;

/** Keep only known question ids with whole answers 1 to 5. Returns null unless every question is answered. */
export function cleanAnswers(raw: unknown): TasterAnswers | null {
  if (!raw || typeof raw !== "object") return null;
  const out: TasterAnswers = {};
  for (const q of TASTER_QUESTIONS) {
    const v = (raw as Record<string, unknown>)[q.id];
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 5) return null;
    out[q.id] = n;
  }
  return out;
}

export type AreaCareer = { key: string; title: I18n; summary: I18n; matchScore: number };
export type TasterArea = { key: string; name: I18n; matchScore: number; topDims: Dimension[]; careers: AreaCareer[] };
export type TasterResult = { scores: Scores; areas: TasterArea[] };

const clusterKey = (c: I18n) => c.en.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");

/** Score the answers and rank career areas. Areas are scored by their two best-matching careers. */
export function scoreTaster(answers: TasterAnswers): TasterResult {
  const scores = scoreAssessment(
    TASTER_QUESTIONS.map((q) => ({ id: q.id, dimension: q.dimension, reverse: q.reverse })),
    answers,
  );
  const byKey = new Map(CAREERS.map((c) => [c.key, c]));
  const matches = matchCareers(
    scores,
    CAREERS.map((c) => ({ id: c.key, key: c.key, weights: c.weights, subjects: c.subjects })),
    [],
  );
  const groups = new Map<string, { name: I18n; items: typeof matches }>();
  for (const m of matches) {
    const career = byKey.get(m.key)!;
    const k = clusterKey(career.cluster);
    const g = groups.get(k) ?? { name: career.cluster, items: [] };
    g.items.push(m);
    groups.set(k, g);
  }
  const areas: TasterArea[] = [...groups.entries()].map(([key, g]) => {
    const top = g.items.slice(0, 2);
    const raw = top.reduce((s, m) => s + m.raw, 0) / top.length;
    const matchScore = Math.round(top.reduce((s, m) => s + m.matchScore, 0) / top.length);
    // Dimensions that carry the best careers in this area.
    const dimWeight = new Map<Dimension, number>();
    for (const m of top) {
      const w = byKey.get(m.key)!.weights;
      for (const d of DIMENSIONS) dimWeight.set(d, (dimWeight.get(d) ?? 0) + (w[d] ?? 0) ** 2 * (scores[d] + 1));
    }
    const topDims = [...dimWeight.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([d]) => d);
    return {
      key,
      name: g.name,
      matchScore,
      topDims,
      careers: g.items.slice(0, 3).map((m) => {
        const c = byKey.get(m.key)!;
        return { key: c.key, title: c.title, summary: c.summary, matchScore: m.matchScore };
      }),
      _raw: raw,
    };
  })
    .sort((a, b) => b._raw - a._raw || a.key.localeCompare(b.key))
    .map(({ _raw, ...a }) => {
      void _raw;
      return a;
    });
  return { scores, areas };
}

/** One or two sentences on why an area fits, in the visitor's language. */
export function areaExplanation(area: TasterArea, locale: "en" | "ar"): string {
  const [d1, d2] = area.topDims.map((d) => DIMENSION_LABELS[d]);
  const example = area.careers[0]?.title;
  if (locale === "ar") {
    return `تشير إجاباتك إلى نقاط قوة في ${d1.ar} و${d2.ar}، وهي ما تعتمد عليه مهن ${area.name.ar}${example ? ` مثل ${example.ar}` : ""}.`;
  }
  return `Your answers point to strengths in ${d1.en.toLowerCase()} and ${d2.en.toLowerCase()}, which careers in ${area.name.en.toLowerCase()}${example ? ` such as ${example.en}` : ""} rely on.`;
}

/** The teaser: top three areas with a short explanation. No careers list, no dimension profile. */
export function teaser(result: TasterResult, locale: "en" | "ar") {
  return result.areas.slice(0, 3).map((a) => ({ key: a.key, name: a.name[locale], matchScore: a.matchScore, explanation: areaExplanation(a, locale) }));
}
export type Teaser = ReturnType<typeof teaser>;

/** The name of a career area by its key (as stored on a lead), or the key itself when unknown. */
export function areaName(key: string, locale: "en" | "ar"): string {
  const c = CAREERS.find((x) => clusterKey(x.cluster) === key);
  return c ? c.cluster[locale] : key;
}

export const dimensionLabel =(d: Dimension, locale: "en" | "ar") => DIMENSION_LABELS[d][locale];
