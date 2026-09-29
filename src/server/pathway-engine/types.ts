// Types for the academic pathway engine. Pure: no database, no server-only imports, so client
// components can import them (and run the engine) as well as the server.
//
// Vocabulary
// - A StudentProfile is what the student has: courses (completed, in progress, planned) mapped to
//   curriculum-neutral canonical subjects, overall results and test scores.
// - A ProgramForEval is a programme with its CURRENT requirement rows: at most one general row
//   (curriculum null) and one row per curriculum.
// - evaluate() compares them line by line with three-valued logic (met, not met, unknown).

export const ENGINE_VERSION = "pe-1";

export const CURRICULA = ["BRITISH", "IB", "AMERICAN", "UAE_MOE", "JORDAN_TAWJIHI", "CBSE", "ISC", "SABIS", "OTHER"] as const;
export type Curriculum = (typeof CURRICULA)[number];

export const SUBJECT_LEVELS = ["FOUNDATION", "STANDARD", "ADVANCED", "HIGHER"] as const;
export type SubjectLevel = (typeof SUBJECT_LEVELS)[number];
export const LEVEL_RANK: Record<SubjectLevel, number> = { FOUNDATION: 0, STANDARD: 1, ADVANCED: 2, HIGHER: 3 };

export type CourseStatus = "COMPLETED" | "IN_PROGRESS" | "PLANNED";
export type MappingStatus = "AUTO" | "NEEDS_REVIEW" | "CONFIRMED";
export type Confidence = "VERIFIED" | "OFFICIAL" | "REVIEWED" | "EXTRACTED" | "EXAMPLE" | "UNKNOWN";
export type SubjectRequirementType = "REQUIRED" | "RECOMMENDED" | "PREFERRED" | "OPTIONAL" | "ONE_OF" | "TWO_OF";

export const MATCH_STATUSES = ["ELIGIBLE", "ON_TRACK", "POSSIBLY_ELIGIBLE", "MISSING_REQUIREMENTS", "NEEDS_MANUAL_REVIEW", "UNKNOWN_DATA"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** How a curriculum course counts toward one canonical subject. */
export type CourseMapping = { subjectKey: string; level: SubjectLevel; rigor: number; confidence: number };

export type StudentCourseInput = {
  /** StudentCourse id, or a synthetic id for legacy results and what-if additions. */
  id: string;
  /** CurriculumCourse id when known. */
  courseId: string | null;
  code?: string | null;
  nameEn: string;
  nameAr: string;
  gradeLevel: number;
  status: CourseStatus;
  finalGrade?: string | null;
  predictedGrade?: string | null;
  /** Grade scale key, see grade-scales.ts. */
  gradeScale: string | null;
  mappingStatus: MappingStatus;
  mappings: CourseMapping[];
};

/** An overall figure (GPA, percentage or IB points). final is false for predictions. */
export type Metric = { value: number; final: boolean };

export type StudentProfile = {
  curriculum: Curriculum;
  gradeLevel: number;
  /** UAE MoE or Tawjihi stream, for example ADVANCED or SCIENTIFIC. */
  stream?: string | null;
  courses: StudentCourseInput[];
  overall: { gpa?: Metric | null; percent?: Metric | null; points?: Metric | null };
  tests: Array<{ kind: string; score: number }>;
};

export type SubjectLine = {
  id: string;
  type: SubjectRequirementType;
  keys: string[];
  minimumLevel?: SubjectLevel | null;
  minimumGrade?: string | null;
  /** Extra canonical subject keys that are also accepted (OR). */
  alternatives?: string[];
  noteEn?: string | null;
  noteAr?: string | null;
  evidenceQuote?: string | null;
};
export type LanguageLine = { id: string; test: string; minOverall: number; minComponent?: number | null; waiverNoteEn?: string | null; evidenceQuote?: string | null };
/** policy: REQUIRED, OPTIONAL, RECOMMENDED or BLIND (not considered). */
export type TestLine = { id: string; test: string; policy: string; minScore?: number | null; noteEn?: string | null; evidenceQuote?: string | null };
/** kind: PERSONAL_STATEMENT, ESSAYS, INTERVIEW, REFERENCE, PORTFOLIO are application steps; NOTE is free text that needs a person. */
export type AdditionalLine = { id: string; kind: string; required: boolean; noteEn?: string | null; noteAr?: string | null; evidenceQuote?: string | null };

export type RequirementRow = {
  id: string;
  curriculum: Curriculum | null;
  intakeYear: number;
  version: number;
  confidence: Confidence;
  minimumGPA?: number | null;
  minimumPercent?: number | null;
  minimumPoints?: number | null;
  gradeProfile?: string | null;
  /** One or more accepted streams separated by | or a comma. */
  stream?: string | null;
  notesEn?: string | null;
  notesAr?: string | null;
  evidenceLocator?: string | null;
  sourceUrl?: string | null;
  checkedAt?: string | null;
  subjects: SubjectLine[];
  languages: LanguageLine[];
  tests: TestLine[];
  additional: AdditionalLine[];
};

export type ProgramForEval = { id: string; requirements: RequirementRow[] };

// ---------------------------------------------------------------------------------------------
// Results

export type LineStatus = "met" | "not_met" | "unknown";
export type LineKind = "subject" | "gpa" | "percent" | "points" | "gradeProfile" | "stream" | "language" | "test" | "additional";
/** final: completed with a final result. predicted: in progress or a predicted grade. planned: a planned course or a test still to take. */
export type Basis = "final" | "predicted" | "planned";
export type UnknownReason =
  | "grade_pending"
  | "grade_missing"
  | "mapping_review"
  | "scale_mismatch"
  | "unverified"
  | "not_taken"
  | "no_overall"
  | "no_stream"
  | "manual";

export type SatisfiedBy = { courseId: string; nameEn: string; nameAr: string; subjectKey: string; grade: string | null; basis: Basis };

export type LineResult = {
  id: string;
  rowId: string;
  kind: LineKind;
  /** REQUIRED, ONE_OF, TWO_OF, RECOMMENDED... for subjects; REQUIRED or OPTIONAL etc. for tests. */
  type: string;
  status: LineStatus;
  /** Advisory lines (recommended subjects, optional tests, application steps) never count as gaps. */
  advisory: boolean;
  basis?: Basis;
  reason?: UnknownReason;
  /** The result before unverified-requirement downgrading, for display. */
  underlying?: LineStatus;
  keys?: string[];
  minimumLevel?: SubjectLevel | null;
  required?: string | number | null;
  have?: string | number | null;
  satisfiedBy?: SatisfiedBy[];
  /** TWO_OF: how many slots are filled. */
  filled?: number;
  needed?: number;
  alternatives?: string[];
  confidence: Confidence;
  evidenceQuote?: string | null;
  noteEn?: string | null;
  noteAr?: string | null;
};

export type ClassToTake = { lineId: string; subjectKeys: string[]; minimumLevel: SubjectLevel | null; minimumGrade: string | null; slots: number };
export type ScoreGap = { lineId: string; kind: string; required: number; have: number };

export type EvalResult = {
  programId: string;
  status: MatchStatus;
  /** The student's curriculum is covered by a curriculum row (or the programme only has a general row). */
  covered: boolean;
  rowIds: string[];
  lines: LineResult[];
  counts: { requiredSatisfied: number; requiredMissing: number; requiredUnknown: number; recommendedSatisfied: number };
  classesToTake: ClassToTake[];
  /** Recommended subjects the student does not have yet. Advice only, never a gap. */
  suggestedClasses: ClassToTake[];
  scoreGaps: ScoreGap[];
};

/** Status order from best to worst, used for "improves" comparisons. */
export const STATUS_RANK: Record<MatchStatus, number> = {
  ELIGIBLE: 5,
  ON_TRACK: 4,
  POSSIBLY_ELIGIBLE: 3,
  NEEDS_MANUAL_REVIEW: 2,
  MISSING_REQUIREMENTS: 1,
  UNKNOWN_DATA: 0,
};

// ---------------------------------------------------------------------------------------------
// School catalog (for unlock and planner)

export type CatalogCourse = {
  /** SchoolCourse id. */
  id: string;
  courseId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  gradeLevels: number[];
  gradeScale: string | null;
  mappings: CourseMapping[];
};
