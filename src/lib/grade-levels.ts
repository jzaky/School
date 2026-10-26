// Grade levels are stored as integers: KG1 = -1, KG2 = 0, Grades 1 to 12 = 1 to 12.
// Labels come from the "gradeLevel" messages, for example t("gradeLevel.label", gradeLevelValues(level)).
export const KG1 = -1;
export const KG2 = 0;
export const MIN_GRADE_LEVEL = KG1;
export const MAX_GRADE_LEVEL = 12;
export const ALL_GRADE_LEVELS: readonly number[] = Array.from({ length: MAX_GRADE_LEVEL - MIN_GRADE_LEVEL + 1 }, (_, i) => MIN_GRADE_LEVEL + i);

export function gradeLevelValues(level: number): { level: "kg1" | "kg2" | "n"; grade: number } {
  return { level: level === KG1 ? "kg1" : level === KG2 ? "kg2" : "n", grade: level };
}

export function gradeRange(from: number, to: number): number[] {
  return ALL_GRADE_LEVELS.filter((g) => g >= from && g <= to);
}
