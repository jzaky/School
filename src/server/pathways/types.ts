// Shared types for university pathways. Pure: safe to import from client and server code.
// Requirements are always indicative until a person checks them against the official page.

export const CURRICULA = ["BRITISH", "IB", "AMERICAN", "UAE_MOE", "JORDAN_TAWJIHI", "OTHER"] as const;
export type Curriculum = (typeof CURRICULA)[number];
/** Curricula a programme can list requirements for. */
export const REQ_CURRICULA = ["BRITISH", "IB", "AMERICAN", "UAE_MOE", "JORDAN_TAWJIHI"] as const;
export type ReqCurriculum = (typeof REQ_CURRICULA)[number];

export const APPLY_ROUTES = ["UCAS", "COMMON_APP", "UC_APP", "MIT_APP", "OUAC", "STUDIELINK", "CAO", "UNI_ASSIST", "JORDAN_UNIFIED", "DIRECT"] as const;
export type ApplyRoute = (typeof APPLY_ROUTES)[number];

export const FIELDS = ["computer_science", "engineering", "medicine", "business", "economics", "law", "psychology", "architecture", "science"] as const;
export type Field = (typeof FIELDS)[number];

export const DEGREES = ["BSc", "BEng", "MEng", "BA", "LLB", "MBChB", "BMBCh", "MD", "BArch", "BBA"] as const;

export const UAE_STREAMS = ["ADVANCED", "ELITE", "GENERAL"] as const;
export const TAWJIHI_STREAMS = ["SCIENTIFIC", "LITERARY", "INDUSTRIAL", "HEALTH", "IT", "AGRICULTURAL"] as const;

/** Test kinds a student can record. */
export const TEST_KINDS = ["IELTS", "TOEFL", "SAT", "ACT", "EMSAT_ENGLISH", "EMSAT_MATH", "EMSAT_PHYSICS", "EMSAT_CHEMISTRY", "UCAT", "TMUA", "LNAT"] as const;
export type TestKind = (typeof TEST_KINDS)[number];
export const TEST_RANGE: Record<TestKind, { min: number; max: number; step: number }> = {
  IELTS: { min: 0, max: 9, step: 0.5 },
  TOEFL: { min: 0, max: 120, step: 1 },
  SAT: { min: 400, max: 1600, step: 10 },
  ACT: { min: 1, max: 36, step: 1 },
  EMSAT_ENGLISH: { min: 500, max: 2000, step: 25 },
  EMSAT_MATH: { min: 500, max: 2000, step: 25 },
  EMSAT_PHYSICS: { min: 500, max: 2000, step: 25 },
  EMSAT_CHEMISTRY: { min: 500, max: 2000, step: 25 },
  UCAT: { min: 900, max: 3600, step: 10 },
  TMUA: { min: 1, max: 9, step: 0.1 },
  LNAT: { min: 0, max: 42, step: 1 },
};

/** Result levels a student can record per curriculum. OVERALL rows hold a total, average or GPA. */
export const RESULT_LEVELS: Record<Curriculum, string[]> = {
  BRITISH: ["A_LEVEL", "AS_LEVEL", "GCSE"],
  IB: ["HL", "SL"],
  AMERICAN: ["AP", "HONORS"],
  UAE_MOE: [],
  JORDAN_TAWJIHI: [],
  OTHER: [],
};
export const OVERALL = "OVERALL";

export type SubjectMin = { code: string; min?: string | null };

export type Notes = { notesEn?: string; notesAr?: string };
export type BritishReq = Notes & { grades?: string; subjects?: SubjectMin[] };
export type IbReq = Notes & { points?: number; hl?: SubjectMin[]; sl?: SubjectMin[] };
export type AmericanReq = Notes & { gpa?: number; testPolicy?: "REQUIRED" | "OPTIONAL" | "BLIND"; sat?: number; act?: number; ap?: SubjectMin[] };
export type UaeMoeReq = Notes & { average?: number; streams?: string[]; emsat?: Array<{ kind: string; min?: number | null }> };
export type TawjihiReq = Notes & { average?: number; streams?: string[]; byStream?: Record<string, number> };

export type Deadline = { kind: "early" | "regular" | "equal" | "oxbridge" | "international" | "unified"; month: number; day?: number };
export type RouteInfo = { via: ApplyRoute; deadlines?: Deadline[]; url?: string };

export type ProgramRequirements = {
  route?: RouteInfo;
  /** Admissions tests the programme asks for, for example UCAT, TMUA or LNAT. */
  admissionsTests?: string[];
  BRITISH?: BritishReq;
  IB?: IbReq;
  AMERICAN?: AmericanReq;
  UAE_MOE?: UaeMoeReq;
  JORDAN_TAWJIHI?: TawjihiReq;
};

export type EnglishReq = Notes & { ielts?: number; ieltsMinBand?: number; toefl?: number; emsatEnglish?: number };

export type ProgramForCheck = {
  requiredSubjects: string[];
  recommendedSubjects: string[];
  requirements: ProgramRequirements;
  englishReq: EnglishReq | null;
};

export type ResultRow = { subjectCode: string; level: string | null; predicted: string | null; achieved: string | null; confirmed: boolean };
export type TestRow = { kind: string; score: number; confirmed: boolean };

export type StudentForCheck = {
  curriculum: Curriculum;
  /** Subject codes the student takes now or has registered for. */
  subjects: string[];
  /** Subject codes the school offers. null when unknown. */
  offered: string[] | null;
  results: ResultRow[];
  tests: TestRow[];
};

export type CheckStatus = "met" | "not_met" | "unknown";
export type CheckKind = "overall" | "stream" | "subject" | "recommended" | "test" | "admissionsTest" | "english";

export type CheckItem = {
  id: string;
  kind: CheckKind;
  status: CheckStatus;
  /** Optional items (recommended subjects, optional tests) never count as gaps. */
  optional?: boolean;
  /** Subject code or test kind. */
  code?: string;
  required?: string | number | null;
  have?: string | number | null;
  /** Subjects: the student takes it now. */
  taking?: boolean;
  /** Subjects: the school offers it (null when unknown). */
  offered?: boolean | null;
  /** The value used is a prediction, not an achieved result. */
  provisional?: boolean;
  /** The value was entered by a student or parent and a counselor has not confirmed it yet. */
  unconfirmed?: boolean;
  /** Tests: accepted alternatives, for example IELTS or TOEFL. */
  alternatives?: string[];
  policy?: "REQUIRED" | "OPTIONAL" | "BLIND";
};

export type CheckResult = {
  curriculum: Curriculum;
  /** The programme lists requirements for the student's curriculum. */
  listed: boolean;
  items: CheckItem[];
  summary: { met: number; notMet: number; unknown: number };
  classesToTake: Array<{ code: string; required: boolean; offered: boolean | null }>;
  scoreGaps: Array<{ code: string; required: number; have: number }>;
};
