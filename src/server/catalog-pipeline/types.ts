// Shared shapes for the requirement data pipeline. Pure types and constants: safe in the worker,
// tests and client components.

export const SOURCE_TYPES = ["OFFICIAL_UNIVERSITY", "OFFICIAL_BODY", "MIRROR", "MANUAL"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const CURRICULA = ["BRITISH", "IB", "AMERICAN", "UAE_MOE", "JORDAN_TAWJIHI", "CBSE", "ISC", "SABIS", "OTHER"] as const;
export type Curriculum = (typeof CURRICULA)[number];

export const SUBJECT_TYPES = ["REQUIRED", "RECOMMENDED", "PREFERRED", "OPTIONAL", "ONE_OF", "TWO_OF"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export const LEVELS = ["FOUNDATION", "STANDARD", "ADVANCED", "HIGHER"] as const;
export type Level = (typeof LEVELS)[number];

export const LANGUAGE_TESTS = ["IELTS", "TOEFL", "PTE", "DUOLINGO", "CAMBRIDGE"] as const;
export type LanguageTest = (typeof LANGUAGE_TESTS)[number];
export const ADMISSION_TESTS = ["SAT", "ACT", "TMUA", "MAT", "STEP", "ESAT", "UCAT", "LNAT", "AP"] as const;
export type AdmissionTest = (typeof ADMISSION_TESTS)[number];
export const TEST_POLICIES = ["REQUIRED", "RECOMMENDED", "OPTIONAL", "NOT_CONSIDERED"] as const;
export type TestPolicy = (typeof TEST_POLICIES)[number];
export const ADDITIONAL_KINDS = ["INTERVIEW", "PERSONAL_STATEMENT", "PORTFOLIO", "REFERENCE", "ESSAY", "OTHER"] as const;
export type AdditionalKind = (typeof ADDITIONAL_KINDS)[number];

export type SubjectLine = {
  type: SubjectType;
  keys: string[];
  minimumLevel?: Level | null;
  minimumGrade?: string | null;
  evidenceQuote: string;
};
export type LanguageLine = { test: string; minOverall: number; minComponent?: number | null; evidenceQuote: string };
export type TestLine = { test: string; policy: string; minScore?: number | null; evidenceQuote: string };
export type AdditionalLine = { kind: string; required: boolean; noteEn?: string | null; evidenceQuote: string };

/** Overall thresholds for one curriculum group. Each value has its own evidence. */
export type OverallLine = {
  field: "gradeProfile" | "minimumPoints" | "minimumGPA" | "minimumPercent";
  value: string | number;
  evidenceQuote: string;
};

/** One requirement group: the general row (curriculum null) or one curriculum's row. */
export type DraftGroup = {
  curriculum: Curriculum | null;
  overall: OverallLine[];
  subjects: SubjectLine[];
  languages: LanguageLine[];
  tests: TestLine[];
  additional: AdditionalLine[];
};

export type RejectedLine = { section: string; summary: string; reason: string; evidenceQuote?: string };

export type DraftMeta = {
  contentHash: string;
  model: string;
  promptVersion: string;
  cacheKey: string;
  provider?: string;
  interactionId?: string | null;
  /** Demo data that nobody checked against the official page. */
  example?: boolean;
  demoKey?: string;
};

/** RequirementExtraction.normalizedJson */
export type DraftSet = {
  groups: DraftGroup[];
  rejected: RejectedLine[];
  meta: DraftMeta;
};

export const emptyGroup = (curriculum: Curriculum | null): DraftGroup => ({ curriculum, overall: [], subjects: [], languages: [], tests: [], additional: [] });

export const lineCount = (g: DraftGroup) => g.overall.length + g.subjects.length + g.languages.length + g.tests.length + g.additional.length;

/** Severity of a requirement change, lowest first. */
export const SEVERITIES = ["WATCH", "NOTABLE", "MAJOR"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CHANGE_TYPES = ["ADDED", "REMOVED", "THRESHOLD_RAISED", "THRESHOLD_LOWERED", "STRENGTH_CHANGED", "SOURCE_CHANGED", "SOURCE_REMOVED"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

/** What a diff entry is about, enough to render a localized label. */
export type LineRef =
  | { section: "subject"; keys: string[]; type: string }
  | { section: "language"; test: string; part?: "component" }
  | { section: "test"; test: string; part?: "minScore" }
  | { section: "additional"; kind: string }
  | { section: "overall"; field: OverallLine["field"] }
  | { section: "source" };

export type DiffEntry = {
  type: ChangeType;
  ref: LineRef;
  from: string | null;
  to: string | null;
  /** True when the line can make a student miss (REQUIRED, ONE_OF, TWO_OF, required tests, thresholds). */
  binding: boolean;
  severity: Severity;
  summaryEn: string;
  summaryAr: string;
};

export type ChangeReview = { outcome: "REVIEWED" | "DISMISSED"; note: string | null; at: string; byUserId: string | null; notified?: number };

/** RequirementChange.diff */
export type ChangeDiff = {
  severity: Severity;
  curriculum: Curriculum | null;
  entries: DiffEntry[];
  summaryAr: string;
  review?: ChangeReview;
  example?: boolean;
  demoKey?: string;
};
