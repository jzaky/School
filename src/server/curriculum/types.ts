// Shapes stored in LessonPlan JSON columns, with validators. Pure: safe to import in client code.

export type Phase = "starter" | "main" | "plenary";
export const PHASES: Phase[] = ["starter", "main", "plenary"];

export type Activity = {
  phase: Phase;
  minutes: number;
  titleEn: string;
  titleAr: string;
  detailEn: string;
  detailAr: string;
};

export type Material = { en: string; ar: string };

export type Bilingual = { en: string; ar: string };

const str = (v: unknown): v is string => typeof v === "string";

export function isActivity(v: unknown): v is Activity {
  const a = v as Activity;
  return Boolean(a) && PHASES.includes(a.phase) && typeof a.minutes === "number" && Number.isFinite(a.minutes) && str(a.titleEn) && str(a.titleAr) && str(a.detailEn) && str(a.detailAr);
}

export function isMaterial(v: unknown): v is Material {
  const m = v as Material;
  return Boolean(m) && str(m.en) && str(m.ar);
}

/** Read activities from the JSON column, dropping anything malformed. */
export function readActivities(v: unknown): Activity[] {
  return Array.isArray(v) ? v.filter(isActivity) : [];
}

export function readMaterials(v: unknown): Material[] {
  return Array.isArray(v) ? v.filter(isMaterial) : [];
}

/** Differentiation is stored as a JSON string {"en","ar"} in a text column; older rows may be plain text. */
export function readBilingualText(v: string | null | undefined): Bilingual {
  if (!v) return { en: "", ar: "" };
  try {
    const o = JSON.parse(v) as Bilingual;
    if (o && str(o.en) && str(o.ar)) return o;
  } catch {
    // plain text
  }
  return { en: v, ar: v };
}

export function writeBilingualText(b: Bilingual): string | null {
  if (!b.en.trim() && !b.ar.trim()) return null;
  return JSON.stringify({ en: b.en.trim(), ar: b.ar.trim() });
}

/** A lesson laid out minute by minute: each activity with its start and end minute. */
export function sessionTimeline(activities: Activity[]) {
  const order = (p: Phase) => PHASES.indexOf(p);
  const sorted = activities.map((a, i) => ({ a, i })).sort((x, y) => order(x.a.phase) - order(y.a.phase) || x.i - y.i);
  let t = 0;
  return sorted.map(({ a }) => {
    const start = t;
    t += Math.max(0, Math.round(a.minutes));
    return { ...a, start, end: t };
  });
}

export function totalMinutes(activities: Activity[]) {
  return activities.reduce((s, a) => s + Math.max(0, Math.round(a.minutes)), 0);
}

export const pickBi = (locale: string, en: string | null | undefined, ar: string | null | undefined) => (locale === "ar" ? ar || en || "" : en || ar || "");
