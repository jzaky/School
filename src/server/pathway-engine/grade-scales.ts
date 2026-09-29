// Grade scales per curriculum, with rank comparison inside ONE scale. Pure.
// We never convert between scales (an A-level A is not "the same" as an IB 6). The only
// cross-scale comparisons are ones a requirement row states itself, which the data encodes
// as a separate line in that curriculum's row.

export type GradeScale = {
  key: string;
  /** Ordered labels from lowest to highest, for letter or band scales. */
  labels?: string[];
  /** Numeric scales: inclusive range. */
  min?: number;
  max?: number;
  step?: number;
};

export const GRADE_SCALES: Record<string, GradeScale> = {
  /** A-level and AS: A* to U. */
  A_LEVEL: { key: "A_LEVEL", labels: ["U", "E", "D", "C", "B", "A", "A*"] },
  /** IGCSE letter grades: A* to G. */
  IGCSE_LETTER: { key: "IGCSE_LETTER", labels: ["U", "G", "F", "E", "D", "C", "B", "A", "A*"] },
  /** GCSE and IGCSE numbered grades: 9 (highest) to 1. */
  GCSE_9: { key: "GCSE_9", labels: ["U", "1", "2", "3", "4", "5", "6", "7", "8", "9"] },
  /** IB subject grades: 7 (highest) to 1. */
  IB_7: { key: "IB_7", labels: ["1", "2", "3", "4", "5", "6", "7"] },
  /** AP exam scores: 5 (highest) to 1. */
  AP_5: { key: "AP_5", labels: ["1", "2", "3", "4", "5"] },
  /** US course letter grades. */
  US_LETTER: { key: "US_LETTER", labels: ["F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"] },
  /** Unweighted 4.0 GPA. */
  GPA_4: { key: "GPA_4", min: 0, max: 4, step: 0.01 },
  /** Percentage marks: CBSE, ISC, SABIS, UAE MoE, Tawjihi. */
  PERCENT: { key: "PERCENT", min: 0, max: 100, step: 0.1 },
  /** IB diploma total. */
  IB_POINTS: { key: "IB_POINTS", min: 0, max: 45, step: 1 },
};

/** The usual subject grade scale for a curriculum course, by curriculum and qualification. */
export function scaleFor(curriculum: string, qualification?: string | null): string {
  const q = (qualification ?? "").toUpperCase();
  switch (curriculum) {
    case "BRITISH":
      if (q === "GCSE") return "GCSE_9";
      if (q === "IGCSE") return "IGCSE_LETTER";
      return "A_LEVEL";
    case "IB":
      return "IB_7";
    case "AMERICAN":
      return q === "AP" ? "AP_5" : "US_LETTER";
    default:
      return "PERCENT";
  }
}

const norm = (g: string) => g.trim().toUpperCase().replace(/\s+/g, "");

/** Rank of a grade within a scale (higher is better), or null when the grade is not on that scale. */
export function gradeRank(scaleKey: string | null | undefined, grade: string | null | undefined): number | null {
  if (!scaleKey || grade === null || grade === undefined || grade === "") return null;
  const scale = GRADE_SCALES[scaleKey];
  if (!scale) return null;
  const g = norm(String(grade));
  if (scale.labels) {
    const i = scale.labels.indexOf(g);
    return i < 0 ? null : i;
  }
  const n = Number.parseFloat(g.replace(/%$/, ""));
  if (!Number.isFinite(n) || !/^-?\d+(\.\d+)?%?$/.test(g)) return null;
  if (scale.min !== undefined && n < scale.min) return null;
  if (scale.max !== undefined && n > scale.max) return null;
  return n;
}

export const isGradeOn = (scaleKey: string | null | undefined, grade: string | null | undefined) => gradeRank(scaleKey, grade) !== null;

/** Compare two grades on one scale: positive when a is better. null when either is not on the scale. */
export function compareGrades(scaleKey: string, a: string, b: string): number | null {
  const ra = gradeRank(scaleKey, a);
  const rb = gradeRank(scaleKey, b);
  if (ra === null || rb === null) return null;
  return ra - rb;
}

/** Does `have` meet `min` on this scale? null when either grade is not on the scale. */
export function meetsGrade(scaleKey: string | null | undefined, have: string | null | undefined, min: string | null | undefined): boolean | null {
  if (!scaleKey) return null;
  const h = gradeRank(scaleKey, have);
  const m = gradeRank(scaleKey, min);
  if (h === null || m === null) return null;
  return h >= m;
}

/** Grade options for a scale, best first, for pickers. Numeric scales return a short useful list. */
export function gradeOptions(scaleKey: string | null | undefined): string[] {
  const scale = scaleKey ? GRADE_SCALES[scaleKey] : null;
  if (!scale) return [];
  if (scale.labels) return [...scale.labels].reverse().filter((l) => l !== "U" && l !== "F");
  if (scale.key === "PERCENT") return ["98", "95", "90", "85", "80", "75", "70", "65", "60"];
  if (scale.key === "GPA_4") return ["4.0", "3.9", "3.8", "3.7", "3.5", "3.3", "3.0", "2.7", "2.5"];
  return [];
}

/**
 * Parse a grade profile such as "A*AA" (A-level) or "766" (IB HL) into grades, best first order kept.
 * Returns null when the profile is not on the scale.
 */
export function parseGradeProfile(scaleKey: string, profile: string | null | undefined): string[] | null {
  if (!profile) return null;
  const s = norm(profile);
  const out: string[] = [];
  if (scaleKey === "A_LEVEL" || scaleKey === "IGCSE_LETTER") {
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (s[i + 1] === "*") {
        out.push(`${c}*`);
        i++;
      } else out.push(c);
    }
  } else {
    for (const c of s) out.push(c);
  }
  return out.every((g) => gradeRank(scaleKey, g) !== null) ? out : null;
}
