// Deterministic aptitude scoring and career matching. Same answers always give the same results.
import { DIMENSIONS, DIMENSION_LABELS, type CareerWeights, type Dimension } from "./dimensions";

export type Question = { id: string; dimension: string; reverse: boolean };
export type Answers = Record<string, number>; // questionId -> 1..5 (strongly disagree .. strongly agree)
export type Scores = Record<Dimension, number>; // 0..100

export function scoreAssessment(questions: Question[], answers: Answers): Scores {
  const sums = Object.fromEntries(DIMENSIONS.map((d) => [d, { total: 0, n: 0 }])) as Record<Dimension, { total: number; n: number }>;
  for (const q of questions) {
    const raw = answers[q.id];
    if (!raw || !DIMENSIONS.includes(q.dimension as Dimension)) continue;
    const v = Math.min(5, Math.max(1, raw));
    const scored = q.reverse ? 6 - v : v;
    sums[q.dimension as Dimension].total += (scored - 1) / 4;
    sums[q.dimension as Dimension].n += 1;
  }
  return Object.fromEntries(DIMENSIONS.map((d) => [d, sums[d].n ? Math.round((sums[d].total / sums[d].n) * 100) : 0])) as Scores;
}

export type CareerLike = { id: string; key: string; weights: CareerWeights; subjects: string[] };
export type Match = { careerId: string; key: string; raw: number; matchScore: number; topDims: Dimension[]; sharedSubjects: string[]; missingSubjects: string[] };

export function matchCareers(scores: Scores, careers: CareerLike[], studentSubjects: string[]): Match[] {
  const out = careers.map((c) => {
    const w = c.weights;
    // Squared weights: the dimensions a career is defined by count most.
    const totalW = DIMENSIONS.reduce((s, d) => s + (w[d] ?? 0) ** 2, 0) || 1;
    const contrib = DIMENSIONS.map((d) => ({ d, v: ((w[d] ?? 0) ** 2 * scores[d]) / 100 }));
    // Weighted fit on the dimensions the career relies on, minus a small penalty when heavy
    // requirements meet low scores, plus a bonus for subjects already taken.
    const fit = contrib.reduce((s, x) => s + x.v, 0) / totalW;
    const gaps = DIMENSIONS.reduce((s, d) => s + ((w[d] ?? 0) >= 4 && scores[d] < 40 ? 0.04 : 0), 0);
    const shared = c.subjects.filter((x) => studentSubjects.includes(x));
    const bonus = Math.min(0.04, shared.length * 0.015);
    const raw = Math.max(0, Math.min(1, fit - gaps + bonus));
    const matchScore = Math.round(35 + 62 * Math.min(1, Math.max(0, (raw - 0.25) / 0.65)));
    const topDims = [...contrib].sort((a, b) => b.v - a.v).slice(0, 2).map((x) => x.d);
    return { careerId: c.id, key: c.key, raw, matchScore, topDims, sharedSubjects: shared, missingSubjects: c.subjects.filter((x) => !studentSubjects.includes(x)) };
  });
  return out.sort((a, b) => b.raw - a.raw || a.key.localeCompare(b.key));
}

const SUBJECT_NAMES: Record<string, { en: string; ar: string }> = {
  MATH: { en: "Mathematics", ar: "الرياضيات" },
  PHYS: { en: "Physics", ar: "الفيزياء" },
  CHEM: { en: "Chemistry", ar: "الكيمياء" },
  BIO: { en: "Biology", ar: "الأحياء" },
  CS: { en: "Computer Science", ar: "علوم الحاسوب" },
  ENG: { en: "English", ar: "اللغة الإنجليزية" },
  ARAB: { en: "Arabic", ar: "اللغة العربية" },
  ECON: { en: "Economics", ar: "الاقتصاد" },
  BUS: { en: "Business Studies", ar: "إدارة الأعمال" },
  ART: { en: "Art and Design", ar: "الفنون والتصميم" },
  DT: { en: "Design and Technology", ar: "التصميم والتكنولوجيا" },
  GEO: { en: "Geography", ar: "الجغرافيا" },
  HIST: { en: "History", ar: "التاريخ" },
  PE: { en: "Physical Education", ar: "التربية الرياضية" },
  PSY: { en: "Psychology", ar: "علم النفس" },
  MUSIC: { en: "Music", ar: "الموسيقى" },
  FR: { en: "French", ar: "الفرنسية" },
};

export function subjectName(code: string, locale: "en" | "ar") {
  return SUBJECT_NAMES[code]?.[locale] ?? code;
}

export function reasoning(m: Match, careerTitle: { en: string; ar: string }) {
  const d1 = DIMENSION_LABELS[m.topDims[0]];
  const d2 = DIMENSION_LABELS[m.topDims[1]];
  const shared = m.sharedSubjects.map((s) => SUBJECT_NAMES[s] ?? { en: s, ar: s });
  const missing = m.missingSubjects.slice(0, 1).map((s) => SUBJECT_NAMES[s] ?? { en: s, ar: s });
  const en = [
    `Your strengths in ${d1.en.toLowerCase()} and ${d2.en.toLowerCase()} are at the heart of work as a ${careerTitle.en}.`,
    shared.length ? `You already study ${shared.map((s) => s.en).join(" and ")}, which this path builds on.` : "",
    missing.length ? `Adding ${missing[0].en} would open more routes into it.` : "",
  ].filter(Boolean).join(" ");
  const ar = [
    `تتوافق نقاط قوتك في ${d1.ar} و${d2.ar} مع جوهر العمل في مهنة ${careerTitle.ar}.`,
    shared.length ? `أنت تدرس ${shared.map((s) => s.ar).join(" و")}، وهي أساس هذا المسار.` : "",
    missing.length ? `دراسة ${missing[0].ar} ستفتح لك طرقًا أكثر إلى هذا المجال.` : "",
  ].filter(Boolean).join(" ");
  return { en, ar };
}

/** Suggest reach / target / safety from how selective a university is. */
export function suggestCategory(acceptanceRate: number | null | undefined): "REACH" | "TARGET" | "SAFETY" {
  if (acceptanceRate == null) return "TARGET";
  if (acceptanceRate < 25) return "REACH";
  if (acceptanceRate < 60) return "TARGET";
  return "SAFETY";
}
