// Transcript import types. Pure: safe to import from client components.
import type { Curriculum, MatchStatus } from "@/server/pathway-engine/types";

export type RowStatus = "COMPLETED" | "IN_PROGRESS" | "PLANNED";

/** One course line read from a file or typed in, before matching. */
export type ParsedRow = {
  name: string;
  code: string | null;
  /** The curriculum the course was taken in (a transfer student's earlier school may differ from their current track). */
  curriculum: Curriculum | null;
  gradeLevel: number | null;
  schoolYear: string | null;
  status: RowStatus | null;
  finalGrade: string | null;
  predictedGrade: string | null;
  gradeScale: string | null;
};

export type ParseProblem = { line: number; code: "no_name" | "no_grade_level" | "bad_grade_level" | "no_rows" | "no_header" | "too_many_rows" };
export type ParseResult = { rows: ParsedRow[]; problems: ParseProblem[] };

export type MatchMethod = "code" | "exact" | "fuzzy" | "none";
export type MatchCandidate = { courseId: string; confidence: number };
export type MatchResult = { courseId: string | null; confidence: number; method: MatchMethod; alternatives: MatchCandidate[]; auto: boolean };

/** How the reviewer settled a row. AUTO: the matcher was confident. LOCAL: a school-only course with no catalog equivalent. */
export type RowDecision = "AUTO" | "NEEDS_REVIEW" | "CONFIRMED" | "LOCAL";

/** A row as stored on TranscriptImport.rows. */
export type ImportRow = ParsedRow & {
  i: number;
  gradeLevel: number;
  status: RowStatus;
  curriculum: Curriculum;
  match: MatchResult;
  decision: RowDecision;
  /** The chosen CurriculumCourse (null for LOCAL rows and rows without a suggestion). */
  courseId: string | null;
  /** The StudentCourse written for this row by the last commit. */
  studentCourseId?: string | null;
  /** Set on commit when the student already had this course on record from another source. */
  duplicateOf?: string | null;
};

export type ProgramChange = { programId: string; nameEn: string; nameAr: string; uniEn: string; uniAr: string; before: MatchStatus; after: MatchStatus; missingBefore: number; missingAfter: number };

export type CommitSummary = {
  at: string;
  byId: string;
  created: number;
  updated: number;
  skipped: number;
  programs: ProgramChange[];
  /** Row index to the programmes where that row newly meets a requirement line. */
  rowEffects: Record<string, string[]>;
};

/** The JSON stored in TranscriptImport.rows. */
export type ImportPayload = {
  v: 1;
  curriculum: Curriculum;
  rows: ImportRow[];
  lastCommit?: CommitSummary | null;
};

export const IMPORT_KINDS = ["CSV", "XLSX", "PDF", "MANUAL"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** The downloadable template. Column names are also accepted in Arabic (see parse.ts). */
export const TEMPLATE_HEADERS = ["course_name", "course_code", "grade_level", "school_year", "status", "final_grade", "predicted_grade", "grade_scale"] as const;
export const TEMPLATE_CSV = [
  TEMPLATE_HEADERS.join(","),
  "IGCSE Mathematics,IGCSE_MATH,10,2024-2025,COMPLETED,A*,,IGCSE_LETTER",
  "IGCSE Physics,,10,2024-2025,COMPLETED,A,,IGCSE_LETTER",
  "A-Level Mathematics,AL_MATH,11,2025-2026,IN_PROGRESS,,A,A_LEVEL",
  "Mathematics Standard,,10,2024-2025,COMPLETED,92,,PERCENT",
].join("\n");

export const MAX_IMPORT_ROWS = 80;
