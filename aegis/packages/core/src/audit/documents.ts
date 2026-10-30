/**
 * Document ingestion for the Audit module.
 *
 * Documents are customer policies and procedures. Their content never leaves this process:
 * parsing uses pdf-parse (PDF), mammoth (DOCX) and plain decoding (TXT, Markdown), all in
 * memory. Content is never logged and never placed in evidence payloads; the ledger only
 * records size, mime type and hash.
 */
import type { Prisma, TenantDb } from "@aegis/db";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { conflict, notFound, validation } from "../lib/errors.js";
import { sha256Hex } from "../lib/crypto.js";
import { assertPermission } from "../orgs/orgs.js";
import { deleteStoredFile, readStoredFile, storageKeyFor, writeStoredFile } from "./storage.js";

// pdf-parse is CommonJS; under NodeNext the default import may be wrapped.
const parsePdf = (pdfParse as unknown as { default?: typeof pdfParse }).default ?? pdfParse;

export const DOCUMENT_MIME_ALLOWLIST: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
};
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const PARSE_TIMEOUT_MS = 60_000;

/** Chunking targets, expressed in approximate tokens (tokens ~= words * 1.3). */
export const CHUNK_TOKENS = 800;
export const CHUNK_OVERLAP_TOKENS = 100;
const TOKENS_PER_WORD = 1.3;

export const storeDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  filename: z.string().trim().min(1).max(255),
  mime: z.string().min(1).max(120),
  retentionDays: z.number().int().min(1).max(3650).optional(),
});

export interface StoreDocumentInput extends z.infer<typeof storeDocumentSchema> {
  buffer: Buffer;
}

export interface ExtractedText {
  text: string;
  /** Page count for paginated formats; null for text formats. */
  pageCount: number | null;
}

export interface TextChunk {
  idx: number;
  text: string;
  page: number | null;
  tokens: number;
}

/** Normalises an arbitrary mime string to an allowlisted type (strips parameters such as charset). */
export function normaliseMime(mime: string, filename = ""): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  if (DOCUMENT_MIME_ALLOWLIST[base]) return base;
  // Browsers often send text/x-markdown or application/octet-stream for .md files.
  const lower = filename.toLowerCase();
  if (base === "text/x-markdown" || lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".pdf") && (base === "application/octet-stream" || base === "application/x-pdf")) return "application/pdf";
  if (lower.endsWith(".docx") && base === "application/octet-stream") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return base;
}

export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(words * TOKENS_PER_WORD);
}

/** Collapses whitespace while preserving form feeds (page separators) and paragraph breaks. */
export function normaliseWhitespace(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex -- stripping NUL bytes from extracted text is intentional
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-irregular-whitespace -- collapses non-breaking spaces from PDF extraction
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Pure text extraction per mime type. PDF pages are separated with a form feed character so
 * chunking can record the page a chunk starts on.
 */
export async function extractText(mime: string, buffer: Buffer): Promise<ExtractedText> {
  const type = normaliseMime(mime);
  switch (type) {
    case "application/pdf": {
      const pagerender = (pageData: { getTextContent: (o: unknown) => Promise<{ items: { str: string; transform: number[] }[] }> }) =>
        pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }).then((tc) => {
          let lastY: number | undefined;
          let out = "";
          for (const item of tc.items) {
            const y = item.transform[5];
            if (lastY === undefined || lastY === y) out += item.str;
            else out += "\n" + item.str;
            lastY = y;
          }
          return out + "\f";
        });
      // pdf.js (bundled in pdf-parse) reads the Buffer's whole underlying ArrayBuffer rather than the
      // Buffer's own window. Small Node Buffers share an 8 KB pool, so neighbouring bytes (often an
      // earlier copy of the same file) are parsed as part of the document and the trailer lookup
      // lands on a stale offset ("bad XRef entry"). A standalone exact-size array avoids the pool.
      const exact = new Uint8Array(buffer);
      const result = await parsePdf(exact as unknown as Buffer, { pagerender: pagerender as unknown as (pageData: unknown) => string });
      const text = normaliseWhitespace(result.text.replace(/\f\s*$/, ""));
      return { text, pageCount: result.numpages };
    }
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      const result = await mammoth.extractRawText({ buffer });
      return { text: normaliseWhitespace(result.value), pageCount: null };
    }
    case "text/plain":
    case "text/markdown":
      return { text: normaliseWhitespace(buffer.toString("utf8")), pageCount: null };
    default:
      throw validation(`Unsupported document type ${mime}`);
  }
}

/**
 * Splits text into overlapping word windows of roughly CHUNK_TOKENS tokens. Pages are taken
 * from form feed separators when present. Deterministic: the same text always yields the same chunks.
 */
export function chunkText(text: string, opts: { chunkTokens?: number; overlapTokens?: number } = {}): TextChunk[] {
  const windowWords = Math.max(1, Math.round((opts.chunkTokens ?? CHUNK_TOKENS) / TOKENS_PER_WORD));
  const overlapWords = Math.min(windowWords - 1, Math.max(0, Math.round((opts.overlapTokens ?? CHUNK_OVERLAP_TOKENS) / TOKENS_PER_WORD)));
  const hasPages = text.includes("\f");
  const words: { w: string; page: number | null }[] = [];
  const pages = hasPages ? text.split("\f") : [text];
  pages.forEach((pageText, i) => {
    for (const w of pageText.split(/\s+/)) if (w) words.push({ w, page: hasPages ? i + 1 : null });
  });
  const chunks: TextChunk[] = [];
  if (words.length === 0) return chunks;
  const step = windowWords - overlapWords;
  for (let start = 0, idx = 0; start < words.length; start += step, idx++) {
    const slice = words.slice(start, start + windowWords);
    const body = slice.map((x) => x.w).join(" ");
    chunks.push({ idx, text: body, page: slice[0]!.page, tokens: Math.round(slice.length * TOKENS_PER_WORD) });
    if (start + windowWords >= words.length) break;
  }
  return chunks;
}

function extensionFor(mime: string): string {
  const ext = DOCUMENT_MIME_ALLOWLIST[mime];
  if (!ext) throw validation(`Unsupported document type ${mime}. Allowed: PDF, DOCX, TXT, Markdown.`);
  return ext;
}

/** Stores the file and creates the Document row (status uploaded). Parsing is a separate step. */
export async function storeDocument(db: TenantDb, ctx: OrgContext, input: StoreDocumentInput) {
  assertPermission(ctx, "audit:write");
  const meta = storeDocumentSchema.parse(input);
  const mime = normaliseMime(meta.mime, meta.filename);
  const ext = extensionFor(mime);
  if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) throw validation("The uploaded file is empty");
  if (input.buffer.length > MAX_DOCUMENT_BYTES) throw validation(`File exceeds the ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB limit`);
  if (mime === "application/pdf" && input.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw validation("The file is not a valid PDF");
  const now = ctx.now ?? new Date();
  const sha256 = sha256Hex(input.buffer);
  const doc = await db.document.create({
    data: {
      orgId: ctx.orgId,
      title: meta.title,
      filename: meta.filename,
      mime,
      size: input.buffer.length,
      sha256,
      storageKey: "pending",
      status: "uploaded",
      retentionUntil: meta.retentionDays ? new Date(now.getTime() + meta.retentionDays * 86400_000) : null,
      uploadedBy: ctx.actor.type === "user" ? ctx.actor.id : null,
      createdAt: now,
      updatedAt: now,
    },
  });
  const storageKey = storageKeyFor(ctx.orgId, "documents", doc.id, ext);
  await writeStoredFile(storageKey, input.buffer);
  const updated = await db.document.update({ where: { id: doc.id }, data: { storageKey } });
  await appendEvidence(db, ctx, { type: "document.uploaded", subjectType: "document", subjectId: doc.id, payload: { mime, size: input.buffer.length, sha256 } });
  return updated;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Reads the stored file, extracts text, chunks it and stores the chunks. Re-parsing replaces
 * previous chunks. Failures are recorded on the row (status failed, error) and in evidence.
 */
export async function parseDocument(db: TenantDb, ctx: OrgContext, documentId: string, opts: { timeoutMs?: number } = {}) {
  assertPermission(ctx, "audit:write");
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) throw notFound("Document");
  await db.document.update({ where: { id: doc.id }, data: { status: "parsing", error: null } });
  const startedAt = Date.now();
  try {
    const buffer = await readStoredFile(doc.storageKey);
    if (sha256Hex(buffer) !== doc.sha256) throw new Error("Stored file hash does not match the uploaded hash");
    const extracted = await withTimeout(extractText(doc.mime, buffer), opts.timeoutMs ?? PARSE_TIMEOUT_MS, "Document parsing");
    const chunks = chunkText(extracted.text);
    if (chunks.length === 0) throw new Error("No readable text was found in the document (scanned images are not supported yet)");
    await db.documentChunk.deleteMany({ where: { documentId: doc.id } });
    const batch = 200;
    for (let i = 0; i < chunks.length; i += batch) {
      await db.documentChunk.createMany({ data: chunks.slice(i, i + batch).map((c) => ({ orgId: ctx.orgId, documentId: doc.id, idx: c.idx, text: c.text, page: c.page, tokens: c.tokens })) });
    }
    const updated = await db.document.update({ where: { id: doc.id }, data: { status: "parsed", error: null, pageCount: extracted.pageCount, chunkCount: chunks.length, updatedAt: ctx.now ?? new Date() } });
    await appendEvidence(db, ctx, { type: "document.parsed", subjectType: "document", subjectId: doc.id, payload: { chunkCount: chunks.length, pageCount: extracted.pageCount, durationMs: Date.now() - startedAt } });
    return updated;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    const updated = await db.document.update({ where: { id: doc.id }, data: { status: "failed", error: message, updatedAt: ctx.now ?? new Date() } });
    await appendEvidence(db, ctx, { type: "document.parse_failed", subjectType: "document", subjectId: doc.id, payload: { error: message, durationMs: Date.now() - startedAt } });
    return updated;
  }
}

export const documentListFilter = z.object({
  status: z.enum(["uploaded", "parsing", "parsed", "failed", "all"]).default("all"),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listDocuments(db: TenantDb, ctx: OrgContext, f: Partial<z.infer<typeof documentListFilter>> = {}) {
  assertPermission(ctx, "audit:read");
  const filter = documentListFilter.parse(f);
  const where: Prisma.DocumentWhereInput = {
    orgId: ctx.orgId,
    ...(filter.status === "all" ? {} : { status: filter.status }),
    ...(filter.q ? { OR: [{ title: { contains: filter.q, mode: "insensitive" } }, { filename: { contains: filter.q, mode: "insensitive" } }] } : {}),
  };
  const [items, total] = await Promise.all([
    db.document.findMany({ where, orderBy: { createdAt: "desc" }, skip: (filter.page - 1) * filter.pageSize, take: filter.pageSize }),
    db.document.count({ where }),
  ]);
  return { items, total, page: filter.page, pageSize: filter.pageSize, pageCount: Math.max(1, Math.ceil(total / filter.pageSize)) };
}

export async function getDocument(db: TenantDb, ctx: OrgContext, documentId: string) {
  assertPermission(ctx, "audit:read");
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) throw notFound("Document");
  const [chunkCount, assessments, uploader] = await Promise.all([
    db.documentChunk.count({ where: { documentId } }),
    db.assessment.findMany({ where: { orgId: ctx.orgId, documentIds: { has: documentId } }, select: { id: true, name: true, status: true, completedAt: true, framework: { select: { key: true, name: true } } }, orderBy: { createdAt: "desc" } }),
    doc.uploadedBy ? db.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: doc.uploadedBy } }, select: { userId: true } }) : Promise.resolve(null),
  ]);
  return { ...doc, chunkCount, assessments, uploaderIsMember: !!uploader };
}

/** Chunk texts for a parsed document (used by the console's document preview). */
export async function getDocumentChunks(db: TenantDb, ctx: OrgContext, documentId: string, limit = 20) {
  assertPermission(ctx, "audit:read");
  const doc = await db.document.findUnique({ where: { id: documentId }, select: { id: true } });
  if (!doc) throw notFound("Document");
  return db.documentChunk.findMany({ where: { documentId }, orderBy: { idx: "asc" }, take: limit });
}

/**
 * Deletes the document, its chunks and its file. Documents cited by a completed assessment are
 * protected unless `force` is set, because deleting them removes the ability to re-verify findings.
 */
export async function deleteDocument(db: TenantDb, ctx: OrgContext, documentId: string, opts: { force?: boolean } = {}) {
  assertPermission(ctx, "audit:write");
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) throw notFound("Document");
  const referencing = await db.assessment.findMany({ where: { orgId: ctx.orgId, documentIds: { has: documentId } }, select: { id: true, status: true, name: true } });
  const completed = referencing.filter((a) => a.status === "completed");
  if (completed.length && !opts.force) throw conflict(`Document is cited by ${completed.length} completed assessment(s). Use force to delete anyway.`);
  await db.documentChunk.deleteMany({ where: { documentId } });
  await db.document.delete({ where: { id: documentId } });
  if (doc.storageKey !== "pending") await deleteStoredFile(doc.storageKey);
  await appendEvidence(db, ctx, { type: "document.deleted", subjectType: "document", subjectId: documentId, payload: { sha256: doc.sha256, forced: !!opts.force, referencedByAssessments: referencing.length } });
  return { deleted: true, referencedByAssessments: referencing.length };
}

/** Deletes documents whose retention date has passed. Idempotent; intended for the worker. Returns the count removed. */
export async function applyRetention(db: TenantDb, ctx: OrgContext): Promise<number> {
  const now = ctx.now ?? new Date();
  const expired = await db.document.findMany({ where: { orgId: ctx.orgId, retentionUntil: { lte: now } }, select: { id: true, storageKey: true, sha256: true } });
  let removed = 0;
  for (const doc of expired) {
    await db.documentChunk.deleteMany({ where: { documentId: doc.id } });
    await db.document.delete({ where: { id: doc.id } });
    if (doc.storageKey !== "pending") await deleteStoredFile(doc.storageKey);
    await appendEvidence(db, ctx, { type: "document.retention_deleted", subjectType: "document", subjectId: doc.id, payload: { sha256: doc.sha256 } });
    removed++;
  }
  return removed;
}
