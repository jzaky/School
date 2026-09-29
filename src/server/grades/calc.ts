// Pure grade maths shared by the gradebook, the family view, report cards and tests.

export type Band = { label: string; minPercent: number };

/** Default bands when a school has not configured its own. */
export const DEFAULT_BANDS: Band[] = [
  { label: "A*", minPercent: 90 },
  { label: "A", minPercent: 80 },
  { label: "B", minPercent: 70 },
  { label: "C", minPercent: 60 },
  { label: "D", minPercent: 50 },
  { label: "E", minPercent: 40 },
  { label: "U", minPercent: 0 },
];

export type ScoredItem = {
  score: number | null | undefined;
  maxScore: number;
  weight: number;
  excused?: boolean;
};

/** Percentage for one score, or null when there is nothing to count. */
export function percent(score: number | null | undefined, maxScore: number): number | null {
  if (score === null || score === undefined || !Number.isFinite(score) || !(maxScore > 0)) return null;
  return (score / maxScore) * 100;
}

/**
 * Weighted average percentage. Each assessment counts as score / max, weighted by its weight.
 * Missing and excused scores are left out, so they neither help nor hurt. Null when nothing counts.
 */
export function weightedAverage(items: ScoredItem[]): number | null {
  let sum = 0;
  let weights = 0;
  for (const it of items) {
    if (it.excused) continue;
    const p = percent(it.score, it.maxScore);
    if (p === null || !(it.weight > 0)) continue;
    sum += p * it.weight;
    weights += it.weight;
  }
  return weights > 0 ? sum / weights : null;
}

/** Plain mean of the numbers that are present. */
export function mean(values: Array<number | null | undefined>): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Sort bands from highest threshold to lowest. */
export function sortBands(bands: Band[]): Band[] {
  return [...bands].sort((a, b) => b.minPercent - a.minPercent);
}

/** The band for a percentage: the highest band whose threshold the percentage reaches. */
export function bandFor(pct: number | null | undefined, bands: Band[] = DEFAULT_BANDS): string | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  const sorted = sortBands(bands.length ? bands : DEFAULT_BANDS);
  for (const b of sorted) if (pct >= b.minPercent - 1e-9) return b.label;
  return sorted[sorted.length - 1]?.label ?? null;
}

/** Validate a band set: unique non-empty labels, thresholds 0 to 100, unique thresholds, one band at 0. */
export function validateBands(bands: Band[]): string | null {
  if (bands.length < 2 || bands.length > 15) return "bandCount";
  const labels = new Set<string>();
  const mins = new Set<number>();
  for (const b of bands) {
    const label = b.label.trim();
    if (!label || label.length > 8) return "bandLabel";
    if (labels.has(label.toLowerCase())) return "bandDuplicate";
    labels.add(label.toLowerCase());
    if (!Number.isFinite(b.minPercent) || b.minPercent < 0 || b.minPercent > 100) return "bandRange";
    if (mins.has(b.minPercent)) return "bandDuplicate";
    mins.add(b.minPercent);
  }
  if (!mins.has(0)) return "bandZero";
  return null;
}

/** Running weighted average after each dated item, for a trend line. */
export function runningAverages<T extends ScoredItem & { at: Date | string | null }>(items: T[]): Array<{ at: Date; avg: number }> {
  const sorted = items.filter((i) => i.at).sort((a, b) => new Date(a.at!).getTime() - new Date(b.at!).getTime());
  const out: Array<{ at: Date; avg: number }> = [];
  const acc: ScoredItem[] = [];
  for (const it of sorted) {
    acc.push(it);
    const avg = weightedAverage(acc);
    if (avg !== null && !it.excused && it.score !== null && it.score !== undefined) out.push({ at: new Date(it.at!), avg });
  }
  return out;
}

/** Parse a pasted block (Excel copies rows with newlines and columns with tabs). */
export function parsePasted(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  while (rows.length && rows[rows.length - 1].trim() === "") rows.pop();
  return rows.map((r) => r.split("\t").map((c) => c.trim()));
}

/** Read a typed or pasted score. Accepts Arabic-Indic digits and a decimal comma. */
export function parseScore(raw: string): { ok: true; value: number | null } | { ok: false } {
  const s = raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".");
  if (!s) return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false };
  return { ok: true, value: Number(s) };
}

export function round1(n: number) {
  return Math.round(n * 10) / 10;
}
