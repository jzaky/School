"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import {
  addControl,
  attachEvidence,
  controlInputSchema,
  createAssessment,
  createAssessmentSchema,
  createCustomFramework,
  createFrameworkSchema,
  createTask,
  createTaskSchema,
  deleteControl,
  deleteDocument,
  DOCUMENT_MIME_ALLOWLIST,
  forbidden,
  generateReport,
  generateReportSchema,
  getDocument,
  getDocumentChunks,
  importControls,
  importControlsCsv,
  MAX_DOCUMENT_BYTES,
  normaliseMime,
  parseDocument,
  runAssessment,
  storeDocument,
  transition,
  transitionSchema,
  updateControl,
  updateTask,
  updateTaskSchema,
  validateFinding,
  validateFindingSchema,
  validation,
  type ControlInput,
} from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const uuid = z.string().uuid();

// ---------- documents ----------

export interface UploadResult {
  id: string;
  title: string;
  status: string;
  chunkCount: number;
  pageCount: number | null;
  error: string | null;
}

/**
 * Stores the file, then parses it in a second tenant transaction with a long timeout. The file
 * content is read into memory once and never logged.
 */
export async function uploadDocumentAction(formData: FormData) {
  return act(async (): Promise<UploadResult> => {
    const c = await getConsoleContext();
    if (!c.can("audit:write")) throw forbidden("Requires audit:write");
    const file = formData.get("file");
    if (!(file instanceof File)) throw validation("Choose a file to upload");
    if (file.size === 0) throw validation("The selected file is empty");
    if (file.size > MAX_DOCUMENT_BYTES) throw validation(`File exceeds the ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB limit`);
    const mime = normaliseMime(file.type || "application/octet-stream", file.name);
    if (!DOCUMENT_MIME_ALLOWLIST[mime]) throw validation("Unsupported file type. Allowed: PDF, DOCX, TXT, Markdown.");
    const title = z.string().trim().min(1).max(200).parse(String(formData.get("title") ?? "").trim() || file.name.replace(/\.[^.]+$/, ""));
    const retentionRaw = String(formData.get("retentionDays") ?? "").trim();
    const retentionDays = retentionRaw ? z.coerce.number().int().min(1).max(3650).parse(retentionRaw) : undefined;
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await withTenant(c.ctx.orgId, (db) => storeDocument(db, c.ctx, { title, filename: file.name.slice(0, 255), mime, buffer, retentionDays }));
    const parsed = await withTenant(c.ctx.orgId, (db) => parseDocument(db, c.ctx, stored.id, { timeoutMs: 80_000 }), { timeout: 90_000 });
    revalidatePath("/audit/documents");
    revalidatePath("/audit/assessments");
    return { id: parsed.id, title: parsed.title, status: parsed.status, chunkCount: parsed.chunkCount, pageCount: parsed.pageCount, error: parsed.error };
  });
}

export interface DocumentPreview {
  chunks: { idx: number; page: number | null; tokens: number; text: string }[];
  chunkCount: number;
  assessments: { id: string; name: string; status: string; frameworkName: string }[];
}

export async function documentPreviewAction(documentId: string) {
  return act(async (): Promise<DocumentPreview> => {
    const c = await getConsoleContext();
    const id = uuid.parse(documentId);
    return withTenant(
      c.ctx.orgId,
      async (db) => {
        const [doc, chunks] = await Promise.all([getDocument(db, c.ctx, id), getDocumentChunks(db, c.ctx, id, 5)]);
        return { chunks: chunks.map((ch) => ({ idx: ch.idx, page: ch.page, tokens: ch.tokens, text: ch.text })), chunkCount: doc.chunkCount, assessments: doc.assessments.map((a) => ({ id: a.id, name: a.name, status: a.status, frameworkName: a.framework.name })) };
      },
      { readOnly: true },
    );
  });
}

export async function deleteDocumentAction(documentId: string, force: boolean) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(documentId);
    const r = await withTenant(c.ctx.orgId, (db) => deleteDocument(db, c.ctx, id, { force: z.boolean().parse(force) }));
    revalidatePath("/audit/documents");
    revalidatePath("/audit/assessments");
    return r;
  });
}

// ---------- frameworks and controls ----------

export async function createFrameworkAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = createFrameworkSchema.parse(input);
    const f = await withTenant(c.ctx.orgId, (db) => createCustomFramework(db, c.ctx, data));
    revalidatePath("/audit/standards");
    return { id: f.id };
  });
}

export async function addControlAction(frameworkId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(frameworkId);
    const data = controlInputSchema.parse(input);
    const ctl = await withTenant(c.ctx.orgId, (db) => addControl(db, c.ctx, id, data));
    revalidatePath(`/audit/standards/${id}`);
    revalidatePath("/audit/standards");
    return { id: ctl.id };
  });
}

export async function updateControlAction(frameworkId: string, controlId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const fid = uuid.parse(frameworkId);
    const cid = uuid.parse(controlId);
    const data = controlInputSchema.partial().parse(input);
    await withTenant(c.ctx.orgId, (db) => updateControl(db, c.ctx, cid, data));
    revalidatePath(`/audit/standards/${fid}`);
  });
}

export async function deleteControlAction(frameworkId: string, controlId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const fid = uuid.parse(frameworkId);
    const cid = uuid.parse(controlId);
    await withTenant(c.ctx.orgId, (db) => deleteControl(db, c.ctx, cid));
    revalidatePath(`/audit/standards/${fid}`);
    revalidatePath("/audit/standards");
  });
}

/** Pure parse of pasted CSV, so the dialog can show what would be imported before committing. */
export async function previewControlsCsvAction(csv: string) {
  return act(async (): Promise<{ controls: ControlInput[] }> => {
    const c = await getConsoleContext();
    if (!c.can("audit:read")) throw forbidden("Requires audit:read");
    return { controls: importControlsCsv(z.string().max(500_000).parse(csv)) };
  });
}

export async function importControlsAction(frameworkId: string, csv: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const fid = uuid.parse(frameworkId);
    const r = await withTenant(c.ctx.orgId, (db) => importControls(db, c.ctx, fid, z.string().max(500_000).parse(csv)), { timeout: 60_000 });
    revalidatePath(`/audit/standards/${fid}`);
    revalidatePath("/audit/standards");
    return r;
  });
}

// ---------- assessments ----------

export async function createAssessmentAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = createAssessmentSchema.parse(input);
    const a = await withTenant(c.ctx.orgId, (db) => createAssessment(db, c.ctx, data));
    revalidatePath("/audit/assessments");
    return { id: a.id };
  });
}

/** Runs the lexical engine in its own transaction with a long timeout; the page shows a running state meanwhile. */
export async function runAssessmentAction(assessmentId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(assessmentId);
    const a = await withTenant(c.ctx.orgId, (db) => runAssessment(db, c.ctx, id), { timeout: 180_000 });
    revalidatePath("/audit/assessments");
    revalidatePath(`/audit/assessments/${id}`);
    revalidatePath("/audit/remediation");
    const summary = a.summary as { coveragePercent?: number; error?: string } | null;
    return { status: a.status, coveragePercent: summary?.coveragePercent ?? null, error: summary?.error ?? null };
  });
}

export async function validateFindingAction(assessmentId: string, findingId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const aid = uuid.parse(assessmentId);
    const fid = uuid.parse(findingId);
    const data = validateFindingSchema.parse(input);
    const f = await withTenant(c.ctx.orgId, (db) => validateFinding(db, c.ctx, fid, data));
    revalidatePath(`/audit/assessments/${aid}`);
    revalidatePath("/audit/assessments");
    return { humanStatus: f.humanStatus, validatedAt: f.validatedAt?.toISOString() ?? null };
  });
}

// ---------- remediation ----------

const taskInput = createTaskSchema.extend({ dueAt: z.string().optional() });

function revalidateTasks(assessmentId?: string | null) {
  revalidatePath("/audit/remediation");
  revalidatePath("/audit/assessments");
  if (assessmentId) revalidatePath(`/audit/assessments/${assessmentId}`);
}

export async function createTaskAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const raw = taskInput.parse(input);
    const data = { ...raw, dueAt: raw.dueAt ? new Date(raw.dueAt) : undefined, ownerId: raw.ownerId || undefined, findingId: raw.findingId || undefined };
    if (data.dueAt && Number.isNaN(data.dueAt.getTime())) throw validation("Due date is invalid");
    const { task, assessmentId } = await withTenant(c.ctx.orgId, async (db) => {
      const task = await createTask(db, c.ctx, data);
      const finding = task.findingId ? await db.finding.findUnique({ where: { id: task.findingId }, select: { assessmentId: true } }) : null;
      return { task, assessmentId: finding?.assessmentId ?? null };
    });
    revalidateTasks(assessmentId);
    return { id: task.id };
  });
}

const taskPatch = updateTaskSchema.extend({ dueAt: z.string().nullable().optional() });

export async function updateTaskAction(taskId: string, patch: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(taskId);
    const raw = taskPatch.parse(patch);
    const data = { ...raw, dueAt: raw.dueAt === undefined ? undefined : raw.dueAt === null || raw.dueAt === "" ? null : new Date(raw.dueAt) };
    if (data.dueAt && Number.isNaN(data.dueAt.getTime())) throw validation("Due date is invalid");
    await withTenant(c.ctx.orgId, (db) => updateTask(db, c.ctx, id, data));
    revalidateTasks();
  });
}

export async function transitionTaskAction(taskId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(taskId);
    const data = transitionSchema.parse(input);
    const t = await withTenant(c.ctx.orgId, (db) => transition(db, c.ctx, id, data.status, data.note));
    const assessmentId = t.findingId ? await withTenant(c.ctx.orgId, (db) => db.finding.findUnique({ where: { id: t.findingId! }, select: { assessmentId: true } }), { readOnly: true }) : null;
    revalidateTasks(assessmentId?.assessmentId);
    return { status: t.status };
  });
}

export async function attachEvidenceAction(taskId: string, documentId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(taskId);
    const doc = uuid.parse(documentId);
    await withTenant(c.ctx.orgId, (db) => attachEvidence(db, c.ctx, id, doc));
    revalidateTasks();
  });
}

// ---------- reports ----------

export async function generateReportAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("audit:write")) throw forbidden("Requires audit:write");
    const data = generateReportSchema.parse(input);
    const r = await withTenant(c.ctx.orgId, (db) => generateReport(db, c.ctx, data), { timeout: 60_000 });
    revalidatePath("/audit/reports");
    revalidatePath(`/audit/assessments/${data.assessmentId}`);
    return { exportId: r.exportId, bytes: r.bytes, sha256: r.sha256, filename: r.filename, format: r.format, kind: r.kind };
  });
}
