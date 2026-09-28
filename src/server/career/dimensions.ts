// The 9 aptitude dimensions used by the assessment, the careers catalog and the scoring engine.
import type { I18nText } from "@/server/forms/schema";

export const DIMENSIONS = [
  "analytical",
  "verbal",
  "spatial",
  "investigative",
  "creative",
  "social",
  "enterprising",
  "technical",
  "organized",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, I18nText> = {
  analytical: { en: "Logical and mathematical", ar: "التفكير المنطقي والرياضي" },
  verbal: { en: "Language and communication", ar: "اللغة والتواصل" },
  spatial: { en: "Visual and spatial", ar: "التصور البصري والمكاني" },
  investigative: { en: "Scientific curiosity", ar: "الفضول العلمي" },
  creative: { en: "Creativity and design", ar: "الإبداع والتصميم" },
  social: { en: "Helping and teaching", ar: "مساعدة الآخرين وتعليمهم" },
  enterprising: { en: "Leadership and enterprise", ar: "القيادة وريادة الأعمال" },
  technical: { en: "Hands-on and technical", ar: "المهارات العملية والتقنية" },
  organized: { en: "Organization and detail", ar: "التنظيم والدقة" },
};

/** Career weights: each dimension 0 to 5, how much the career draws on it. */
export type CareerWeights = Record<Dimension, number>;

export type CareerSeed = {
  key: string;
  title: I18nText;
  cluster: I18nText;
  summary: I18nText;
  dayInLife: I18nText;
  weights: CareerWeights;
  subjects: string[]; // subject codes, e.g. MATH, PHYS, CS
  skills: { en: string[]; ar: string[] };
  education: I18nText;
  salaryMinAed: number; // monthly
  salaryMaxAed: number;
  outlook: "growing" | "stable" | "emerging";
  uaeDemand: 1 | 2 | 3 | 4 | 5;
};

export type AptitudeQuestionSeed = {
  dimension: Dimension;
  text: I18nText;
  reverse?: boolean;
};

export type UniversitySeed = {
  key: string;
  name: I18nText;
  countryCode: string;
  city: I18nText;
  worldRank?: number;
  acceptanceRate?: number;
  minAverage?: number;
  programs: string[];
  website: string;
  deadlineMonth: number;
};
