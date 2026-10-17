/**
 * Audit reports: structured JSON or a PDF rendered with pdfkit (built-in Helvetica, no font files).
 * Every finding in every report is labelled "Automated" or "Human validated", and every page of the
 * PDF carries the engine disclaimer. Files are written to storage and recorded as AuditExport rows
 * with their sha256 so a downloaded report can be verified.
 */
import type { FindingStatus, TenantDb } from "@aegis/db";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { notFound, validation } from "../lib/errors.js";
import { sha256Hex } from "../lib/crypto.js";
import { assertPermission } from "../orgs/orgs.js";
import { ASSESSMENT_DISCLAIMER, ASSESSMENT_ENGINE, conclusionLabel } from "./assessments.js";
import { readStoredFile, storageKeyFor, writeStoredFile } from "./storage.js";

export const REPORT_KINDS = ["executive_summary", "detailed", "evidence_inventory", "gap_report", "remediation_plan"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_FORMATS = ["json", "pdf"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const REPORT_TITLES: Record<ReportKind, string> = {
  executive_summary: "Executive Summary",
  detailed: "Detailed Assessment Report",
  evidence_inventory: "Evidence Inventory",
  gap_report: "Gap Report",
  remediation_plan: "Remediation Plan",
};

export const generateReportSchema = z.object({
  assessmentId: z.string().uuid(),
  kind: z.enum(REPORT_KINDS),
  format: z.enum(REPORT_FORMATS).default("json"),
});

export interface ReportEvidence {
  kind: "automated" | "document" | "human";
  reference: string;
  score: number;
  excerpt?: string;
}

export interface ReportFinding {
  id: string;
  code: string;
  title: string;
  category: string;
  automatedStatus: FindingStatus;
  humanStatus: FindingStatus | null;
  effectiveStatus: FindingStatus;
  conclusion: "automated" | "human_validated";
  conclusionLabel: "Automated" | "Human validated";
  confidence: number;
  validatedAt: string | null;
  validationNote?: string;
  rationale?: string;
  recommendation?: string;
  evidence: ReportEvidence[];
  remediation: { id: string; title: string; status: string; owner: string | null; dueAt: string | null }[];
}

export interface ReportContent {
  kind: ReportKind;
  title: string;
  generatedAt: string;
  generatedBy: string | null;
  engine: string;
  disclaimer: string;
  organizationId: string;
  assessment: { id: string; name: string; scope: string; status: string; completedAt: string | null; createdAt: string };
  framework: { key: string; name: string; version: string; publisher: string; licenseNote: string };
  documents: { id: string; title: string; filename: string; sha256: string; pageCount: number | null; chunkCount: number }[];
  coverage: { total: number; counts: Record<FindingStatus, number>; coveragePercent: number; weightedCoveragePercent: number; humanValidated: number; automatedOnly: number };
  categories: { category: string; counts: Record<FindingStatus, number> }[];
  findings: ReportFinding[];
  remediation: { id: string; title: string; status: string; owner: string | null; dueAt: string | null; controlCode: string | null; overdue: boolean }[];
  automatedReferences: { reference: string; controls: string[] }[];
}

const emptyCounts = (): Record<FindingStatus, number> => ({ covered: 0, partial: 0, missing: 0, ambiguous: 0 });

/** Builds the full structured content for a report kind. Pure apart from reads. */
export async function buildReportContent(db: TenantDb, ctx: OrgContext, assessmentId: string, kind: ReportKind): Promise<ReportContent> {
  assertPermission(ctx, "reports:read");
  const a = await db.assessment.findUnique({ where: { id: assessmentId }, include: { framework: true } });
  if (!a) throw notFound("Assessment");
  if (a.status !== "completed") throw validation("Reports can only be generated for completed assessments");
  const findings = await db.finding.findMany({ where: { assessmentId }, include: { control: true, artifacts: { orderBy: [{ kind: "asc" }, { score: "desc" }] }, remediation: true } });
  findings.sort((x, y) => x.control.sortOrder - y.control.sortOrder || x.control.code.localeCompare(y.control.code));
  const documents = a.documentIds.length ? await db.document.findMany({ where: { orgId: ctx.orgId, id: { in: a.documentIds } }, select: { id: true, title: true, filename: true, sha256: true, pageCount: true, chunkCount: true } }) : [];
  const ownerIds = [...new Set(findings.flatMap((f) => f.remediation.map((t) => t.ownerId)).filter((x): x is string => !!x))];
  const owners = ownerIds.length ? await db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : [];
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const now = ctx.now ?? new Date();

  const includeDetail = kind === "detailed" || kind === "gap_report";
  const includeExcerpts = kind === "detailed" || kind === "evidence_inventory";
  const counts = emptyCounts();
  const catMap = new Map<string, Record<FindingStatus, number>>();
  let humanValidated = 0;
  const reportFindings: ReportFinding[] = findings.map((f) => {
    const effective = (f.humanStatus ?? f.status) as FindingStatus;
    counts[effective]++;
    const cat = f.control.category || "General";
    if (!catMap.has(cat)) catMap.set(cat, emptyCounts());
    catMap.get(cat)![effective]++;
    const conclusion = conclusionLabel(f);
    if (conclusion === "human_validated") humanValidated++;
    return {
      id: f.id,
      code: f.control.code,
      title: f.control.title,
      category: cat,
      automatedStatus: f.status,
      humanStatus: f.humanStatus,
      effectiveStatus: effective,
      conclusion,
      conclusionLabel: conclusion === "human_validated" ? "Human validated" : "Automated",
      confidence: f.confidence,
      validatedAt: f.validatedAt?.toISOString() ?? null,
      ...(includeDetail ? { validationNote: f.validationNote, rationale: f.rationale, recommendation: f.recommendation } : {}),
      evidence: f.artifacts.map((e) => ({ kind: e.kind, reference: e.reference, score: e.score, ...(includeExcerpts && e.kind !== "human" ? { excerpt: e.excerpt } : {}) })),
      remediation: f.remediation.map((t) => ({ id: t.id, title: t.title, status: t.status, owner: t.ownerId ? (ownerName.get(t.ownerId) ?? null) : null, dueAt: t.dueAt?.toISOString() ?? null })),
    };
  });
  const filtered = kind === "gap_report" ? reportFindings.filter((f) => f.effectiveStatus !== "covered") : kind === "executive_summary" ? reportFindings.filter((f) => f.effectiveStatus !== "covered").slice(0, 15) : reportFindings;
  const remediation = findings
    .flatMap((f) => f.remediation.map((t) => ({ id: t.id, title: t.title, status: t.status, owner: t.ownerId ? (ownerName.get(t.ownerId) ?? null) : null, dueAt: t.dueAt?.toISOString() ?? null, controlCode: f.control.code, overdue: !!t.dueAt && t.dueAt < now && t.status !== "resolved" })))
    .sort((x, y) => (x.dueAt ?? "9").localeCompare(y.dueAt ?? "9"));
  const autoRefs = new Map<string, string[]>();
  for (const f of reportFindings) for (const e of f.evidence) if (e.kind === "automated") autoRefs.set(e.reference, [...(autoRefs.get(e.reference) ?? []), f.code]);
  const total = findings.length || 1;
  return {
    kind,
    title: REPORT_TITLES[kind],
    generatedAt: now.toISOString(),
    generatedBy: ctx.actor.label ?? ctx.actor.id,
    engine: ASSESSMENT_ENGINE,
    disclaimer: ASSESSMENT_DISCLAIMER,
    organizationId: ctx.orgId,
    assessment: { id: a.id, name: a.name, scope: a.scope, status: a.status, completedAt: a.completedAt?.toISOString() ?? null, createdAt: a.createdAt.toISOString() },
    framework: { key: a.framework.key, name: a.framework.name, version: a.framework.version, publisher: a.framework.publisher, licenseNote: a.framework.licenseNote },
    documents,
    coverage: { total: findings.length, counts, coveragePercent: Math.round((counts.covered / total) * 100), weightedCoveragePercent: Math.round(((counts.covered + 0.5 * counts.partial) / total) * 100), humanValidated, automatedOnly: findings.length - humanValidated },
    categories: [...catMap.entries()].map(([category, c]) => ({ category, counts: c })),
    findings: filtered,
    remediation,
    automatedReferences: [...autoRefs.entries()].map(([reference, controls]) => ({ reference, controls })),
  };
}

// ---------- PDF rendering ----------

const PAGE = { size: "A4" as const, margin: 50 };
const FOOTER_HEIGHT = 36;

function statusLabel(s: FindingStatus): string {
  return { covered: "Covered", partial: "Partial", missing: "Missing", ambiguous: "Ambiguous" }[s];
}

interface Column {
  label: string;
  width: number;
  align?: "left" | "right" | "center";
}

/** Renders a report as PDF bytes. Deterministic layout; built-in Helvetica only. */
export function renderPdf(content: ReportContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: PAGE.size, margin: PAGE.margin, bufferPages: true, pdfVersion: "1.4", info: { Title: `${content.title} - ${content.assessment.name}`, Author: "AEGIS", Subject: content.framework.name, Creator: `AEGIS ${content.engine}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const contentWidth = doc.page.width - PAGE.margin * 2;
    const bottomLimit = () => doc.page.height - PAGE.margin - FOOTER_HEIGHT;

    const ensureSpace = (height: number) => {
      if (doc.y + height > bottomLimit()) doc.addPage();
    };
    const heading = (text: string, size = 14) => {
      ensureSpace(size * 2.5);
      doc.moveDown(0.6).font("Helvetica-Bold").fontSize(size).fillColor("#111827").text(text, { width: contentWidth });
      doc.moveDown(0.3).font("Helvetica").fontSize(10).fillColor("#111827");
    };
    const para = (text: string, opts: { size?: number; color?: string } = {}) => {
      doc.font("Helvetica").fontSize(opts.size ?? 10).fillColor(opts.color ?? "#111827");
      ensureSpace(doc.heightOfString(text, { width: contentWidth }) + 4);
      doc.text(text, { width: contentWidth });
    };
    const table = (columns: Column[], rows: string[][]) => {
      const scale = contentWidth / columns.reduce((s, c) => s + c.width, 0);
      const widths = columns.map((c) => c.width * scale);
      const drawRow = (cells: string[], bold: boolean) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
        const height = Math.max(...cells.map((cell, i) => doc.heightOfString(cell, { width: widths[i]! - 6 }))) + 6;
        if (doc.y + height > bottomLimit()) {
          doc.addPage();
          if (!bold) drawRow(columns.map((c) => c.label), true);
        }
        const y = doc.y;
        let x = PAGE.margin;
        if (bold) doc.rect(x, y, contentWidth, height).fill("#e5e7eb");
        doc.fillColor("#111827");
        cells.forEach((cell, i) => {
          doc.text(cell, x + 3, y + 3, { width: widths[i]! - 6, align: columns[i]!.align ?? "left" });
          x += widths[i]!;
        });
        doc.moveTo(PAGE.margin, y + height).lineTo(PAGE.margin + contentWidth, y + height).lineWidth(0.5).strokeColor("#d1d5db").stroke();
        doc.y = y + height;
        doc.x = PAGE.margin;
      };
      drawRow(columns.map((c) => c.label), true);
      for (const r of rows) drawRow(r, false);
      doc.moveDown(0.5);
    };

    // Title block
    doc.font("Helvetica-Bold").fontSize(22).fillColor("#111827").text(content.title, { width: contentWidth });
    doc.font("Helvetica").fontSize(12).fillColor("#374151").text(content.assessment.name, { width: contentWidth });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#111827");
    const meta: [string, string][] = [
      ["Framework", `${content.framework.name}${content.framework.version ? ` (${content.framework.version})` : ""}`],
      ["Assessment completed", content.assessment.completedAt ? content.assessment.completedAt.slice(0, 10) : "n/a"],
      ["Report generated", content.generatedAt.slice(0, 19).replace("T", " ") + " UTC"],
      ["Engine", content.engine],
      ["Scope", content.assessment.scope || "Not specified"],
    ];
    for (const [k, v] of meta) {
      doc.font("Helvetica-Bold").text(`${k}: `, { continued: true });
      doc.font("Helvetica").text(v);
    }
    doc.moveDown(0.5);
    doc.rect(PAGE.margin, doc.y, contentWidth, 34).fill("#fef3c7");
    doc.fillColor("#92400e").font("Helvetica").fontSize(9).text(content.disclaimer, PAGE.margin + 8, doc.y + 6, { width: contentWidth - 16 });
    doc.y += 12;
    doc.x = PAGE.margin;
    doc.fillColor("#111827");

    // Coverage
    heading("Coverage");
    const c = content.coverage;
    table(
      [{ label: "Controls", width: 2, align: "right" }, { label: "Covered", width: 2, align: "right" }, { label: "Partial", width: 2, align: "right" }, { label: "Ambiguous", width: 2, align: "right" }, { label: "Missing", width: 2, align: "right" }, { label: "Coverage", width: 2, align: "right" }, { label: "Human validated", width: 3, align: "right" }],
      [[String(c.total), String(c.counts.covered), String(c.counts.partial), String(c.counts.ambiguous), String(c.counts.missing), `${c.coveragePercent}%`, `${c.humanValidated} of ${c.total}`]],
    );
    if (content.categories.length > 1) {
      table(
        [{ label: "Category", width: 6 }, { label: "Covered", width: 2, align: "right" }, { label: "Partial", width: 2, align: "right" }, { label: "Ambiguous", width: 2, align: "right" }, { label: "Missing", width: 2, align: "right" }],
        content.categories.map((g) => [g.category, String(g.counts.covered), String(g.counts.partial), String(g.counts.ambiguous), String(g.counts.missing)]),
      );
    }

    if (content.documents.length) {
      heading("Documents assessed", 12);
      table(
        [{ label: "Title", width: 5 }, { label: "File", width: 4 }, { label: "Pages", width: 1, align: "right" }, { label: "SHA-256", width: 5 }],
        content.documents.map((d) => [d.title, d.filename, d.pageCount ? String(d.pageCount) : "-", d.sha256.slice(0, 16) + "..."]),
      );
    }

    // Findings grouped by status
    const order: FindingStatus[] = ["missing", "partial", "ambiguous", "covered"];
    const sectionTitle = content.kind === "gap_report" ? "Gaps" : content.kind === "executive_summary" ? "Key findings requiring attention" : "Findings";
    if (content.kind !== "remediation_plan" && content.kind !== "evidence_inventory") {
      heading(sectionTitle);
      if (content.findings.length === 0) para("No findings in this section.");
      for (const status of order) {
        const list = content.findings.filter((f) => f.effectiveStatus === status);
        if (!list.length) continue;
        heading(`${statusLabel(status)} (${list.length})`, 11);
        if (content.kind === "detailed" || content.kind === "gap_report") {
          for (const f of list) {
            ensureSpace(60);
            doc.font("Helvetica-Bold").fontSize(10).text(`${f.code}  ${f.title}`, { width: contentWidth });
            doc.font("Helvetica").fontSize(9).fillColor("#374151").text(`${statusLabel(f.effectiveStatus)}  |  confidence ${f.confidence.toFixed(2)}  |  ${f.conclusionLabel}${f.validatedAt ? ` on ${f.validatedAt.slice(0, 10)}` : ""}`, { width: contentWidth });
            doc.fillColor("#111827");
            if (f.rationale) para(f.rationale, { size: 9 });
            if (f.recommendation) {
              doc.font("Helvetica-Bold").fontSize(9).text("Recommendation: ", { continued: true });
              doc.font("Helvetica").text(f.recommendation, { width: contentWidth });
            }
            if (f.evidence.length) {
              doc.font("Helvetica-Bold").fontSize(9).text("Cited evidence:");
              for (const e of f.evidence.slice(0, 5)) {
                const line = `[${e.kind}] ${e.reference}${e.kind === "document" ? ` (similarity ${e.score.toFixed(2)})` : ""}`;
                para(line, { size: 8.5, color: "#374151" });
                if (e.excerpt && content.kind === "detailed") para(`"${e.excerpt}"`, { size: 8, color: "#6b7280" });
              }
            }
            if (f.remediation.length) para(`Remediation: ${f.remediation.map((t) => `${t.title} [${t.status}${t.owner ? `, ${t.owner}` : ""}${t.dueAt ? `, due ${t.dueAt.slice(0, 10)}` : ""}]`).join("; ")}`, { size: 8.5 });
            doc.moveDown(0.6);
          }
        } else {
          table(
            [{ label: "Code", width: 2 }, { label: "Control", width: 7 }, { label: "Status", width: 2 }, { label: "Confidence", width: 2, align: "right" }, { label: "Conclusion", width: 3 }, { label: "Evidence", width: 5 }],
            list.map((f) => [f.code, f.title, statusLabel(f.effectiveStatus), f.confidence.toFixed(2), f.conclusionLabel, f.evidence.slice(0, 2).map((e) => e.reference).join("; ") || "-"]),
          );
        }
      }
    }

    if (content.kind === "evidence_inventory") {
      heading("Document evidence");
      const rows = content.findings.flatMap((f) => f.evidence.filter((e) => e.kind === "document").map((e) => [f.code, e.reference, e.score.toFixed(2), f.conclusionLabel, e.excerpt ? excerptShort(e.excerpt, 160) : ""]));
      if (rows.length) table([{ label: "Control", width: 2 }, { label: "Reference", width: 5 }, { label: "Similarity", width: 2, align: "right" }, { label: "Conclusion", width: 3 }, { label: "Excerpt", width: 8 }], rows);
      else para("No document passages were cited.");
      heading("Automated evidence from AEGIS records");
      if (content.automatedReferences.length) table([{ label: "Reference", width: 6 }, { label: "Supports controls", width: 8 }], content.automatedReferences.map((r) => [r.reference, r.controls.join(", ")]));
      else para("No automated evidence was used.");
      heading("Human validations");
      const human = content.findings.filter((f) => f.conclusion === "human_validated");
      if (human.length) table([{ label: "Control", width: 2 }, { label: "Automated", width: 2 }, { label: "Human", width: 2 }, { label: "Validated", width: 3 }, { label: "Reference", width: 6 }], human.map((f) => [f.code, statusLabel(f.automatedStatus), f.humanStatus ? statusLabel(f.humanStatus) : "-", f.validatedAt?.slice(0, 10) ?? "-", f.evidence.find((e) => e.kind === "human")?.reference ?? "-"]));
      else para("No findings have been validated by a person yet.");
    }

    if (content.kind === "remediation_plan" || content.kind === "executive_summary" || content.kind === "detailed") {
      heading(content.kind === "remediation_plan" ? "Remediation tasks" : "Remediation items");
      if (content.remediation.length) {
        table(
          [{ label: "Control", width: 2 }, { label: "Task", width: 7 }, { label: "Status", width: 2 }, { label: "Owner", width: 3 }, { label: "Due", width: 2 }],
          content.remediation.map((t) => [t.controlCode ?? "-", t.title, t.status.replace("_", " ") + (t.overdue ? " (overdue)" : ""), t.owner ?? "Unassigned", t.dueAt ? t.dueAt.slice(0, 10) : "-"]),
        );
      } else para("No remediation tasks have been created for this assessment.");
    }

    heading("About this report", 11);
    para(`${content.framework.licenseNote || "Framework identifiers are referenced; control summaries are AEGIS wording."}`, { size: 8.5, color: "#374151" });
    para(`Findings labelled "Automated" were produced by ${content.engine} from lexical similarity between control wording and the assessed documents plus facts about this organization's AEGIS records. Findings labelled "Human validated" were reviewed by a named person whose decision is recorded in the evidence ledger.`, { size: 8.5, color: "#374151" });

    // Footer on every page: disclaimer and page numbers.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - PAGE.margin + 4;
      doc.moveTo(PAGE.margin, y - 6).lineTo(PAGE.margin + contentWidth, y - 6).lineWidth(0.5).strokeColor("#d1d5db").stroke();
      doc.font("Helvetica").fontSize(7.5).fillColor("#6b7280").text(content.disclaimer, PAGE.margin, y, { width: contentWidth - 80, lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, PAGE.margin + contentWidth - 80, y, { width: 80, align: "right", lineBreak: false });
      doc.page.margins.bottom = savedBottom;
    }
    doc.end();
  });
}

function excerptShort(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 3) + "...";
}

export function reportFilename(content: ReportContent, format: ReportFormat): string {
  const slug = content.assessment.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${content.kind}-${slug || "assessment"}-${content.generatedAt.slice(0, 10)}.${format}`;
}

/** Generates the report, writes it to storage and records an AuditExport with its sha256. */
export async function generateReport(db: TenantDb, ctx: OrgContext, input: z.input<typeof generateReportSchema>) {
  // Generating writes a stored file and an evidence event, so it needs audit:write, not only reports:read (S13).
  assertPermission(ctx, "audit:write");
  const data = generateReportSchema.parse(input);
  const content = await buildReportContent(db, ctx, data.assessmentId, data.kind);
  const bytes = data.format === "pdf" ? await renderPdf(content) : Buffer.from(JSON.stringify(content, null, 2), "utf8");
  const sha256 = sha256Hex(bytes);
  const now = ctx.now ?? new Date();
  const row = await db.auditExport.create({ data: { orgId: ctx.orgId, kind: data.kind, format: data.format, storageKey: "pending", size: bytes.length, sha256, createdBy: ctx.actor.type === "user" ? ctx.actor.id : null, createdAt: now } });
  const storageKey = storageKeyFor(ctx.orgId, "exports", row.id, data.format);
  await writeStoredFile(storageKey, bytes);
  await db.auditExport.update({ where: { id: row.id }, data: { storageKey } });
  await appendEvidence(db, ctx, { type: "report.generated", subjectType: "audit_export", subjectId: row.id, payload: { assessmentId: data.assessmentId, kind: data.kind, format: data.format, size: bytes.length, sha256 } });
  // The server's file path is never returned to callers (S13); the export id and storage key identify the file.
  return { exportId: row.id, bytes: bytes.length, sha256, storageKey, filename: reportFilename(content, data.format), assessmentId: data.assessmentId, kind: data.kind, format: data.format };
}

export async function listExports(db: TenantDb, ctx: OrgContext, limit = 50) {
  assertPermission(ctx, "reports:read");
  return db.auditExport.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: limit });
}

/** Returns the stored bytes with content type and a download filename. Verifies the hash before serving. */
export async function readExport(db: TenantDb, ctx: OrgContext, exportId: string) {
  assertPermission(ctx, "reports:read");
  const row = await db.auditExport.findUnique({ where: { id: exportId } });
  if (!row) throw notFound("Export");
  const buffer = await readStoredFile(row.storageKey);
  if (sha256Hex(buffer) !== row.sha256) throw validation("Stored export does not match its recorded hash");
  await appendEvidence(db, ctx, { type: "report.downloaded", subjectType: "audit_export", subjectId: row.id, payload: { kind: row.kind, format: row.format, sha256: row.sha256 } });
  return { export: row, buffer, contentType: row.format === "pdf" ? "application/pdf" : "application/json", filename: `${row.kind}-${row.createdAt.toISOString().slice(0, 10)}-${row.id.slice(0, 8)}.${row.format}` };
}
