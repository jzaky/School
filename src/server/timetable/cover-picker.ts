// Substitute picker for staff absence. Pure and deterministic.
// For each lesson that needs cover it picks someone FREE that period (not teaching, not absent,
// not already covering), preferring the same department, then someone qualified for the subject,
// then anyone free, and spreading cover fairly across the week.

export type CoverLesson = {
  key: string; // unique per lesson and date
  date: string; // YYYY-MM-DD
  periodNo: number;
  subjectId: string | null;
  gradeLevel: number;
  departmentId: string | null;
};

export type CoverCandidate = {
  id: string;
  departmentId: string | null;
  qualifications: Array<{ subjectId: string; gradeLevels: number[] }>;
  maxPeriodsPerWeek: number;
  teachingPeriods: number; // timetabled lessons per week
};

export type CoverTier = "DEPARTMENT" | "QUALIFIED" | "ANY";

export type CoverPick = { key: string; substituteId: string | null; tier: CoverTier | null };

/** Key for a person being busy on a date and period. */
export const busyKey = (date: string, periodNo: number, memberId: string) => `${date}|${periodNo}|${memberId}`;

export function tierOf(c: CoverCandidate, l: CoverLesson): CoverTier {
  if (l.departmentId && c.departmentId === l.departmentId) return "DEPARTMENT";
  if (l.subjectId && c.qualifications.some((q) => q.subjectId === l.subjectId && (q.gradeLevels.length === 0 || q.gradeLevels.includes(l.gradeLevel)))) return "QUALIFIED";
  return "ANY";
}

/** Cover periods in a week after which someone is only asked when nobody lighter is free. */
export const FAIR_CAP = 3;

const TIER_RANK: Record<CoverTier, number> = { DEPARTMENT: 0, QUALIFIED: 1, ANY: 2 };

/**
 * Rank the free candidates for one lesson, best first. `busy` holds date|period|member for everyone
 * who is teaching, absent or already covering. `coverCount` is each person's cover so far this week.
 */
export function rankCandidates(
  lesson: CoverLesson,
  candidates: CoverCandidate[],
  busy: Set<string>,
  coverCount: Record<string, number>,
  coverToday: Record<string, number> = {},
  exclude: string[] = [],
  fairCap = FAIR_CAP,
): Array<{ id: string; tier: CoverTier; overLimit: boolean; coverCount: number }> {
  const out: Array<{ id: string; tier: CoverTier; overLimit: boolean; coverCount: number }> = [];
  for (const c of candidates) {
    if (exclude.includes(c.id)) continue;
    if (busy.has(busyKey(lesson.date, lesson.periodNo, c.id))) continue;
    const covers = coverCount[c.id] ?? 0;
    out.push({ id: c.id, tier: tierOf(c, lesson), overLimit: c.teachingPeriods + covers >= c.maxPeriodsPerWeek, coverCount: covers });
  }
  const heavy = (x: { coverCount: number }) => x.coverCount >= fairCap;
  return out.sort((a, b) => {
    // Fairness first: someone who already covers a lot this week goes after everyone who does not.
    if (heavy(a) !== heavy(b)) return heavy(a) ? 1 : -1;
    // Respect weekly limits where we can: someone over their limit only when nobody else in the same tier is free.
    if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) return TIER_RANK[a.tier] - TIER_RANK[b.tier];
    if (a.overLimit !== b.overLimit) return a.overLimit ? 1 : -1;
    if (a.coverCount !== b.coverCount) return a.coverCount - b.coverCount;
    const ta = coverToday[a.id] ?? 0;
    const tb = coverToday[b.id] ?? 0;
    if (ta !== tb) return ta - tb;
    const ca = candidates.find((c) => c.id === a.id)!.teachingPeriods;
    const cb = candidates.find((c) => c.id === b.id)!.teachingPeriods;
    if (ca !== cb) return ca - cb;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Pick a substitute for every lesson. Lessons are handled in date and period order; each pick marks the
 * substitute busy for that period and adds to their cover count, so the load spreads across people.
 */
export function pickSubstitutes(input: {
  lessons: CoverLesson[];
  candidates: CoverCandidate[];
  busy: Set<string>;
  coverCount?: Record<string, number>; // existing cover this week, per member
  exclude?: Record<string, string[]>; // lesson key -> members who must not be picked (for example they declined)
}): CoverPick[] {
  const busy = new Set(input.busy);
  const count: Record<string, number> = { ...(input.coverCount ?? {}) };
  const today: Record<string, number> = {};
  const lessons = [...input.lessons].sort((a, b) => a.date.localeCompare(b.date) || a.periodNo - b.periodNo || a.key.localeCompare(b.key));
  const picks: CoverPick[] = [];
  for (const l of lessons) {
    const dayCount: Record<string, number> = {};
    for (const [k, v] of Object.entries(today)) if (k.startsWith(`${l.date}|`)) dayCount[k.slice(l.date.length + 1)] = v;
    const ranked = rankCandidates(l, input.candidates, busy, count, dayCount, input.exclude?.[l.key] ?? []);
    const best = ranked[0];
    if (!best) {
      picks.push({ key: l.key, substituteId: null, tier: null });
      continue;
    }
    busy.add(busyKey(l.date, l.periodNo, best.id));
    count[best.id] = (count[best.id] ?? 0) + 1;
    today[`${l.date}|${best.id}`] = (today[`${l.date}|${best.id}`] ?? 0) + 1;
    picks.push({ key: l.key, substituteId: best.id, tier: best.tier });
  }
  return picks;
}
