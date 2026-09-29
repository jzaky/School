// Turn a Grades module average (a percentage) into a predicted grade on a course's grade scale. Pure.
// Only scales with an accepted school-level conversion get a suggestion; AP, IB and GCSE 9 to 1
// grades are exam results that a class average does not predict, so those show the average only.
import { bandFor, type Band } from "@/server/grades/calc";
import { GRADE_SCALES } from "@/server/pathway-engine/grade-scales";

const US_LETTER: Array<[number, string]> = [
  [97, "A+"],
  [93, "A"],
  [90, "A-"],
  [87, "B+"],
  [83, "B"],
  [80, "B-"],
  [77, "C+"],
  [73, "C"],
  [70, "C-"],
  [67, "D+"],
  [63, "D"],
  [60, "D-"],
  [0, "F"],
];

export function suggestFromAverage(scale: string | null | undefined, pct: number | null | undefined, bands: Band[]): string | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct) || !scale) return null;
  const p = Math.max(0, Math.min(100, pct));
  if (scale === "PERCENT") return String(Math.round(p));
  if (scale === "US_LETTER") return US_LETTER.find(([min]) => p >= min)![1];
  if (scale === "A_LEVEL" || scale === "IGCSE_LETTER") {
    const label = bandFor(p, bands);
    const labels = GRADE_SCALES[scale].labels ?? [];
    return label && labels.includes(label.toUpperCase()) ? label.toUpperCase() : null;
  }
  return null;
}
