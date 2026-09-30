"use server";

// Import center actions: read an uploaded file and preview it, then import the checked rows. The server
// validates every row again on import. Thin wrappers: permission, file reading, then the import services.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCtx, type Ctx } from "@/server/context";
import { flushEffects } from "@/server/queue";
import { schoolVerified } from "@/server/onboarding/verification";
import { STUDENT_COLUMNS } from "@/lib/people-csv";
import { CLASS_COLUMNS, ENROLLMENT_COLUMNS } from "@/lib/imports/classes";
import { STAFF_COLUMNS } from "@/lib/imports/staff";
import type { ColumnSpec } from "@/lib/imports/headers";
import { tableToRawRecords, tableToSheet, type SheetRecord } from "@/lib/imports/table";
import { isImportKind, MAX_FILE_BYTES, MAX_ROWS, type ImportKind, type ImportPreview, type ImportSummary } from "@/lib/imports/types";
import { hasStudentNoHeader } from "@/lib/registration-csv";
import { canRunKind, ImportError, type ImportActor } from "./access";
import { FileReadError, readTable } from "./files";
import { importStaff, previewStaff } from "./staff";
import { importClasses, importEnrollments, previewClasses, previewEnrollments } from "./classes";
import { fixXlsxDates, importRegistrations, importStudents, previewRegistrations, previewStudents } from "./reuse";

type Fail = { ok: false; error: string; missing?: string[] };
const fail = (error: string, missing?: string[]): Fail => ({ ok: false, error, ...(missing ? { missing } : {}) });

const COLUMNS: Record<Exclude<ImportKind, "registrations">, ColumnSpec[]> = { staff: STAFF_COLUMNS, students: STUDENT_COLUMNS, classes: CLASS_COLUMNS, enrollments: ENROLLMENT_COLUMNS };

async function actorFor(kind: ImportKind): Promise<{ ctx: Ctx; actor: ImportActor } | null> {
  const ctx = await getCtx();
  if (!canRunKind(ctx.perms, kind)) return null;
  return { ctx, actor: { orgId: ctx.orgId, membershipId: ctx.membershipId, userId: ctx.user.id, perms: ctx.perms } };
}

function errorCode(e: unknown): string | null {
  if (e instanceof ImportError || e instanceof FileReadError) return e.code;
  return null;
}

async function preview(kind: ImportKind, actor: ImportActor, records: SheetRecord[], locale: string): Promise<ImportPreview> {
  if (kind === "staff") return previewStaff(actor, records, locale);
  if (kind === "students") return previewStudents(actor, records, locale);
  if (kind === "classes") return previewClasses(actor, records, locale);
  if (kind === "enrollments") return previewEnrollments(actor, records, locale);
  return previewRegistrations(actor, records, locale);
}

export type PreviewResponse = { ok: true; fileName: string; records: SheetRecord[]; preview: ImportPreview } | Fail;

/** Reads the uploaded CSV or XLSX file and checks every row. Nothing is saved. */
export async function previewImportAction(form: FormData): Promise<PreviewResponse> {
  const kind = form.get("kind");
  if (!isImportKind(kind)) return fail("INVALID");
  const a = await actorFor(kind);
  if (!a) return fail("FORBIDDEN");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("NO_FILE");
  if (file.size > MAX_FILE_BYTES) return fail("TOO_LARGE");
  try {
    const { table, xlsx } = readTable(file.name, Buffer.from(await file.arrayBuffer()), MAX_ROWS[kind] + 200);
    let records: SheetRecord[];
    if (kind === "registrations") {
      const raw = tableToRawRecords(table);
      if (!hasStudentNoHeader(raw.headers)) return fail("MISSING_COLUMNS", ["student_no"]);
      records = raw.records;
    } else {
      const sheet = tableToSheet(table, COLUMNS[kind]);
      if (sheet.missing.length) return fail("MISSING_COLUMNS", sheet.missing);
      records = kind === "students" && xlsx ? fixXlsxDates(sheet.records) : sheet.records;
      if (records.length === 0) return fail("EMPTY");
      const result = await preview(kind, a.actor, records, a.ctx.locale);
      result.unknownHeaders = sheet.unknownHeaders;
      return { ok: true, fileName: file.name.slice(0, 200), records, preview: result };
    }
    if (records.length === 0) return fail("EMPTY");
    if (records.length > MAX_ROWS[kind]) return fail("TOO_MANY_ROWS");
    return { ok: true, fileName: file.name.slice(0, 200), records, preview: await preview(kind, a.actor, records, a.ctx.locale) };
  } catch (e) {
    const code = errorCode(e);
    if (code) return fail(code);
    throw e;
  }
}

const recordsSchema = z
  .array(z.object({ row: z.number().int().min(1).max(1_000_000), values: z.record(z.string().max(200), z.string().max(4000)) }))
  .min(1)
  .max(Math.max(...Object.values(MAX_ROWS)));

export type RunResponse = { ok: true; summary: ImportSummary } | Fail;

/** Imports the rows of a previewed file. Rows with errors are skipped and reported by row number. */
export async function runImportAction(input: { kind: string; fileName: string; records: unknown; invite?: boolean }): Promise<RunResponse> {
  const kind = input.kind;
  if (!isImportKind(kind)) return fail("INVALID");
  const a = await actorFor(kind);
  if (!a) return fail("FORBIDDEN");
  const parsed = recordsSchema.safeParse(input.records);
  if (!parsed.success) return fail("INVALID");
  if (parsed.data.length > MAX_ROWS[kind]) return fail("TOO_MANY_ROWS");
  const fileName = String(input.fileName ?? "").slice(0, 200);
  const records = parsed.data as SheetRecord[];
  try {
    let summary: ImportSummary;
    if (kind === "staff") {
      const invite = !!input.invite;
      if (invite && !a.ctx.can("people.invite")) return fail("FORBIDDEN_INVITE");
      if (invite && !(await schoolVerified(a.ctx.org, a.ctx.user))) return fail("UNVERIFIED_SCHOOL");
      const res = await importStaff(a.actor, fileName, records, { invite });
      await flushEffects(res.effects);
      const { effects: _effects, ...rest } = res;
      summary = rest;
    } else if (kind === "students") summary = await importStudents(a.actor, fileName, records);
    else if (kind === "classes") summary = await importClasses(a.actor, fileName, records);
    else if (kind === "enrollments") summary = await importEnrollments(a.actor, fileName, records);
    else summary = await importRegistrations(a.actor, fileName, records);
    revalidatePath("/[locale]/admin/import", "page");
    revalidatePath("/[locale]/admin/people", "page");
    return { ok: true, summary };
  } catch (e) {
    const code = errorCode(e);
    if (code) return fail(code);
    throw e;
  }
}
