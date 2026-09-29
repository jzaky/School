"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/server/context";
import { EngineAccessError, actorFromCtx } from "@/server/pathway-engine/access";
import { CURRICULA, type Curriculum } from "@/server/pathway-engine/types";
import { extractPdfText } from "@/server/curriculum/pdf-text";
import { parseCsv, parseTranscriptText, rowsFromTable } from "./parse";
import { readXlsx } from "./xlsx";
import { addCourseRow, commitImport, createImport, deleteCourseRow, searchCourses, setCourseMapping, setRowDecision, updateCourseRow, applyCurrentAverage, type RowAction } from "./service";
import { addSchoolCourse, updateSchoolCourse } from "./catalog";
import { recomputeCaseload } from "./dashboard";
import { MAX_IMPORT_ROWS, type CommitSummary, type ImportKind, type ParseResult, type ParsedRow } from "./types";

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const done = () => revalidatePath("/", "layout");

async function run<T extends object>(fn: () => Promise<T>): Promise<Ok<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof EngineAccessError) return { ok: false, error: e.code };
    throw e;
  }
}

const curriculum = z.enum(CURRICULA);
const grade = z.coerce.number().int().min(6).max(13);
const MAX_BYTES = 8 * 1024 * 1024;

/** Upload a transcript (CSV, XLSX or a text-based PDF), match it and open it for review. */
export async function uploadTranscriptAction(form: FormData): Promise<Ok<{ id: string; rows: number; needsReview: number; warnings: number }>> {
  const ctx = await getCtx();
  const actor = await actorFromCtx(ctx);
  const meta = z.object({ studentId: z.string().min(1), curriculum, defaultGradeLevel: grade }).safeParse({ studentId: form.get("studentId"), curriculum: form.get("curriculum"), defaultGradeLevel: form.get("defaultGradeLevel") });
  if (!meta.success) return { ok: false, error: "invalid" };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "no_file" };
  if (file.size > MAX_BYTES) return { ok: false, error: "too_large" };
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  let kind: ImportKind;
  let parsed: ParseResult;
  try {
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      kind = "PDF";
      const text = extractPdfText(buf).replace(/\u0000/g, "").trim();
      if (text.length < 10) return { ok: false, error: "pdf_no_text" };
      parsed = parseTranscriptText(text, { gradeLevel: meta.data.defaultGradeLevel });
    } else if (name.endsWith(".xlsx")) {
      kind = "XLSX";
      parsed = rowsFromTable(readXlsx(buf));
    } else if (name.endsWith(".xls")) {
      return { ok: false, error: "xls_old" };
    } else {
      kind = "CSV";
      parsed = parseCsv(buf.toString("utf8"));
    }
  } catch {
    return { ok: false, error: "unreadable" };
  }
  if (!parsed.rows.length) return { ok: false, error: parsed.problems.some((p) => p.code === "no_header") ? "no_header" : "no_rows" };
  const res = await run(() => createImport(actor, { studentId: meta.data.studentId, fileName: file.name, kind, curriculum: meta.data.curriculum as Curriculum, defaultGradeLevel: meta.data.defaultGradeLevel, rows: parsed.rows, problems: parsed.problems }));
  done();
  return res.ok ? { ok: true, id: res.id, rows: res.rows, needsReview: res.needsReview, warnings: parsed.problems.length } : res;
}

const status = z.enum(["COMPLETED", "IN_PROGRESS", "PLANNED"]);
const gradeText = z.string().trim().max(8).nullable().optional();
const manualRow = z.object({ name: z.string().trim().min(1).max(160), code: z.string().trim().max(40).nullable().optional(), gradeLevel: grade, schoolYear: z.string().trim().max(20).nullable().optional(), status, finalGrade: gradeText, predictedGrade: gradeText });
const manualInput = z.object({ studentId: z.string().min(1), curriculum, rows: z.array(manualRow).min(1).max(MAX_IMPORT_ROWS) });

/** Manual entry goes through the same matching and review as a file. */
export async function manualTranscriptAction(raw: z.input<typeof manualInput>): Promise<Ok<{ id: string; rows: number; needsReview: number }>> {
  const parsed = manualInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const actor = await actorFromCtx(await getCtx());
  const rows: ParsedRow[] = parsed.data.rows.map((r) => ({
    name: r.name,
    code: r.code?.toUpperCase() || null,
    curriculum: null,
    gradeLevel: r.gradeLevel,
    schoolYear: r.schoolYear || null,
    status: r.status,
    finalGrade: r.finalGrade?.toUpperCase() || null,
    predictedGrade: r.predictedGrade?.toUpperCase() || null,
    gradeScale: null,
  }));
  const res = await run(() => createImport(actor, { studentId: parsed.data.studentId, fileName: "manual", kind: "MANUAL", curriculum: parsed.data.curriculum as Curriculum, defaultGradeLevel: rows[0].gradeLevel ?? 10, rows, problems: [] }));
  done();
  return res;
}

const rowAction = z.discriminatedUnion("type", [z.object({ type: z.literal("confirm") }), z.object({ type: z.literal("choose"), courseId: z.string().min(1) }), z.object({ type: z.literal("local") }), z.object({ type: z.literal("reset") })]);

export async function setRowDecisionAction(input: { importId: string; row: number; action: RowAction }): Promise<Ok> {
  const a = rowAction.safeParse(input.action);
  if (!a.success || !Number.isInteger(input.row)) return { ok: false, error: "invalid" };
  const actor = await actorFromCtx(await getCtx());
  const res = await run(async () => {
    await setRowDecision(actor, input.importId, input.row, a.data);
    return {};
  });
  done();
  return res;
}

export async function commitImportAction(importId: string): Promise<Ok<{ summary: CommitSummary }>> {
  const actor = await actorFromCtx(await getCtx());
  const res = await run(async () => ({ summary: await commitImport(actor, importId) }));
  done();
  return res;
}

export type CourseOption = { id: string; code: string; nameEn: string; nameAr: string; curriculum: string; gradeLevel: number | null; isGlobal: boolean };

/** Searchable course picker. Read only. */
export async function searchCoursesAction(input: { q: string; curriculum?: string | null }): Promise<Ok<{ courses: CourseOption[] }>> {
  const ctx = await getCtx();
  if (!ctx.can("pathways.view")) return { ok: false, error: "forbidden" };
  const c = input.curriculum ? curriculum.safeParse(input.curriculum) : null;
  const rows = await searchCourses(ctx.db, ctx.orgId, String(input.q ?? ""), c?.success ? c.data : null);
  return { ok: true, courses: rows.map((r) => ({ id: r.id, code: r.code, nameEn: r.nameEn, nameAr: r.nameAr, curriculum: r.curriculum, gradeLevel: r.gradeLevel, isGlobal: r.orgId === null })) };
}

// ---------------------------------------------------------------------------------------------
// Course record

const patch = z.object({ localName: z.string().max(160).optional(), gradeLevel: grade.optional(), schoolYear: z.string().max(20).nullable().optional(), status: status.optional(), finalGrade: gradeText, predictedGrade: gradeText });

export async function updateCourseRowAction(input: { id: string; patch: z.input<typeof patch> }): Promise<Ok> {
  const p = patch.safeParse(input.patch);
  if (!p.success) return { ok: false, error: "invalid" };
  const actor = await actorFromCtx(await getCtx());
  const res = await run(async () => {
    await updateCourseRow(actor, input.id, p.data);
    return {};
  });
  done();
  return res;
}

export async function setCourseMappingAction(input: { id: string; courseId?: string | null; local?: boolean; confirm?: boolean }): Promise<Ok> {
  const actor = await actorFromCtx(await getCtx());
  const res = await run(async () => {
    await setCourseMapping(actor, input.id, { courseId: input.courseId ?? null, local: !!input.local, confirm: !!input.confirm });
    return {};
  });
  done();
  return res;
}

const addInput = z.object({ studentId: z.string().min(1), courseId: z.string().nullable(), localName: z.string().max(160), gradeLevel: grade, schoolYear: z.string().max(20).nullable().optional(), status, finalGrade: gradeText, predictedGrade: gradeText });

export async function addCourseRowAction(raw: z.input<typeof addInput>): Promise<Ok> {
  const p = addInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "invalid" };
  const actor = await actorFromCtx(await getCtx());
  const res = await run(async () => {
    await addCourseRow(actor, p.data.studentId, { ...p.data, finalGrade: p.data.finalGrade ?? null, predictedGrade: p.data.predictedGrade ?? null });
    return {};
  });
  done();
  return res;
}

export async function deleteCourseRowAction(id: string): Promise<Ok> {
  const actor = await actorFromCtx(await getCtx());
  const res = await run(async () => {
    await deleteCourseRow(actor, id);
    return {};
  });
  done();
  return res;
}

export async function applyCurrentAverageAction(id: string): Promise<Ok> {
  const actor = await actorFromCtx(await getCtx());
  const res = await run(async () => {
    await applyCurrentAverage(actor, id);
    return {};
  });
  done();
  return res;
}

// ---------------------------------------------------------------------------------------------
// School catalog

const grades = z.array(z.number().int().min(6).max(13)).min(1).max(8);
const notes = z.string().max(500).nullable().optional();

export async function addSchoolCourseAction(input: { courseId: string; gradeLevels: number[]; subjectId?: string | null; notesEn?: string | null; notesAr?: string | null }): Promise<Ok> {
  const p = z.object({ courseId: z.string().min(1), gradeLevels: grades, subjectId: z.string().nullable().optional(), notesEn: notes, notesAr: notes }).safeParse(input);
  if (!p.success) return { ok: false, error: "invalid" };
  const actor = await actorFromCtx(await getCtx());
  const res = await run(async () => {
    await addSchoolCourse(actor, p.data.courseId, p.data);
    return {};
  });
  done();
  return res;
}

export async function updateSchoolCourseAction(input: { id: string; gradeLevels?: number[]; subjectId?: string | null; notesEn?: string | null; notesAr?: string | null; active?: boolean }): Promise<Ok> {
  const p = z.object({ id: z.string().min(1), gradeLevels: grades.optional(), subjectId: z.string().nullable().optional(), notesEn: notes, notesAr: notes, active: z.boolean().optional() }).safeParse(input);
  if (!p.success) return { ok: false, error: "invalid" };
  const actor = await actorFromCtx(await getCtx());
  const { id, ...rest } = p.data;
  const res = await run(async () => {
    await updateSchoolCourse(actor, id, rest);
    return {};
  });
  done();
  return res;
}

// ---------------------------------------------------------------------------------------------
// Dashboard

export async function recomputeCaseloadAction(input: { grade?: number | null; curriculum?: string | null; counselor?: string | null }): Promise<Ok<{ evaluated: number; capped: boolean }>> {
  const c = input.curriculum ? curriculum.safeParse(input.curriculum) : null;
  const actor = await actorFromCtx(await getCtx());
  const res = await run(() => recomputeCaseload(actor, { grade: input.grade ?? null, curriculum: c?.success ? c.data : null, counselor: input.counselor ?? null }));
  done();
  return res;
}
