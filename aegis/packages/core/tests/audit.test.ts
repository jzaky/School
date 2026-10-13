import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUserWithRole, makeTestTenant, withTenant, type TestTenant } from "./helpers.js";
import { makePdf } from "./fixtures/make-pdf.js";
import { makeDocx } from "./fixtures/make-docx.js";
import { applyRetention, deleteDocument, extractText, getDocument, listDocuments, parseDocument, storeDocument } from "../src/audit/documents.js";
import { storageRoot } from "../src/audit/storage.js";
import { addControl, createCustomFramework, getFramework, listFrameworks } from "../src/audit/frameworks.js";
import { assessmentDashboard, createAssessment, getAssessment, listControlMappings, refreshControlMappings, runAssessment, validateFinding } from "../src/audit/assessments.js";
import { createTask, listTasks, transition } from "../src/audit/remediation.js";
import { generateReport, listExports, readExport } from "../src/audit/reports.js";
import { seedDemoAudit, seedSharedFrameworks } from "../src/seed/demo-audit.js";
import { sha256Hex } from "../src/lib/crypto.js";

const FIXTURE_DIR = join(import.meta.dirname, "fixtures");

let t: TestTenant;
let viewer: Awaited<ReturnType<typeof addUserWithRole>>;
let auditor: Awaited<ReturnType<typeof addUserWithRole>>;
let mdDocId: string;
let pdfDocId: string;

beforeAll(async () => {
  t = await makeTestTenant("audit");
  viewer = await addUserWithRole(t, "viewer");
  auditor = await addUserWithRole(t, "auditor");
});
afterAll(async () => {
  await t.cleanup();
  await rm(join(storageRoot(), t.orgId), { recursive: true, force: true });
});

describe("document ingestion", () => {
  it("stores and parses markdown, text, PDF and DOCX into chunks", async () => {
    const md = await readFile(join(FIXTURE_DIR, "sample-policy.md"));
    const mdDoc = await withTenant(t.orgId, (db) => storeDocument(db, t.ownerCtx, { title: "Sample IR procedure", filename: "sample-policy.md", mime: "text/markdown", buffer: md }));
    expect(mdDoc.status).toBe("uploaded");
    expect(mdDoc.sha256).toBe(sha256Hex(md));
    expect(mdDoc.storageKey).toBe(`${t.orgId}/documents/${mdDoc.id}.md`);
    await stat(join(storageRoot(), mdDoc.storageKey));
    const parsedMd = await withTenant(t.orgId, (db) => parseDocument(db, t.ownerCtx, mdDoc.id));
    expect(parsedMd.status, parsedMd.error ?? "").toBe("parsed");
    expect(parsedMd.chunkCount).toBeGreaterThan(0);
    mdDocId = mdDoc.id;

    const txt = Buffer.from("Backups of information and systems are taken daily. Restores are tested twice a year and approved by the CISO.\n".repeat(40));
    const txtDoc = await withTenant(t.orgId, (db) => storeDocument(db, t.ownerCtx, { title: "Backup standard", filename: "backup.txt", mime: "text/plain; charset=utf-8", buffer: txt }));
    expect(txtDoc.mime).toBe("text/plain");
    const parsedTxt = await withTenant(t.orgId, (db) => parseDocument(db, t.ownerCtx, txtDoc.id));
    expect(parsedTxt.status, parsedTxt.error ?? "").toBe("parsed");
    expect(parsedTxt.chunkCount).toBeGreaterThan(0);

    const pdf = await makePdf(["Access control policy. Access rights shall be reviewed quarterly and approved by asset owners. Multi-factor authentication is mandatory for privileged access.", "Second page. Logging of privileged actions is retained for seven years."]);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pdfDoc = await withTenant(t.orgId, (db) => storeDocument(db, t.ownerCtx, { title: "Access control policy", filename: "access.pdf", mime: "application/pdf", buffer: pdf }));
    const parsedPdf = await withTenant(t.orgId, (db) => parseDocument(db, t.ownerCtx, pdfDoc.id), { timeout: 60_000 });
    expect(parsedPdf.status, parsedPdf.error ?? "").toBe("parsed");
    expect(parsedPdf.pageCount).toBe(2);
    expect(parsedPdf.chunkCount).toBeGreaterThan(0);
    pdfDocId = pdfDoc.id;
    const detail = await withTenant(t.orgId, (db) => getDocument(db, t.ownerCtx, pdfDoc.id));
    expect(detail.chunkCount).toBe(parsedPdf.chunkCount);
    expect(detail.assessments).toEqual([]);

    const docx = makeDocx(["Supplier security. Suppliers are assessed before onboarding and reviewed annually.", "Contracts must include security requirements."]);
    const extracted = await extractText("application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx);
    expect(extracted.text).toContain("Suppliers are assessed before onboarding");
    const docxDoc = await withTenant(t.orgId, (db) => storeDocument(db, t.ownerCtx, { title: "Supplier standard", filename: "supplier.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx }));
    const parsedDocx = await withTenant(t.orgId, (db) => parseDocument(db, t.ownerCtx, docxDoc.id));
    expect(parsedDocx.status).toBe("parsed");
    expect(parsedDocx.chunkCount).toBe(1);

    const list = await withTenant(t.orgId, (db) => listDocuments(db, viewer.ctx, { status: "parsed" }));
    expect(list.total).toBe(4);
  });

  it("rejects disallowed types, oversized files and fake PDFs; viewers cannot upload", async () => {
    await expect(withTenant(t.orgId, (db) => storeDocument(db, t.ownerCtx, { title: "x", filename: "x.exe", mime: "application/octet-stream", buffer: Buffer.from("MZ") }))).rejects.toThrow(/Unsupported document type/);
    await expect(withTenant(t.orgId, (db) => storeDocument(db, t.ownerCtx, { title: "x", filename: "x.txt", mime: "text/plain", buffer: Buffer.alloc(25 * 1024 * 1024 + 1) }))).rejects.toThrow(/25 MB/);
    await expect(withTenant(t.orgId, (db) => storeDocument(db, t.ownerCtx, { title: "x", filename: "x.pdf", mime: "application/pdf", buffer: Buffer.from("not a pdf") }))).rejects.toThrow(/not a valid PDF/);
    await expect(withTenant(t.orgId, (db) => storeDocument(db, viewer.ctx, { title: "x", filename: "x.txt", mime: "text/plain", buffer: Buffer.from("hello") }))).rejects.toThrow(/Missing permission audit:write/);
  });

  it("marks unreadable files as failed with an error", async () => {
    const doc = await withTenant(t.orgId, (db) => storeDocument(db, t.ownerCtx, { title: "Broken", filename: "broken.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("definitely not a zip file") }));
    const parsed = await withTenant(t.orgId, (db) => parseDocument(db, t.ownerCtx, doc.id));
    expect(parsed.status).toBe("failed");
    expect(parsed.error).toBeTruthy();
    await withTenant(t.orgId, (db) => deleteDocument(db, t.ownerCtx, doc.id));
  });

  it("applies retention", async () => {
    const doc = await withTenant(t.orgId, (db) => storeDocument(db, t.ownerCtx, { title: "Short lived", filename: "tmp.txt", mime: "text/plain", buffer: Buffer.from("temporary"), retentionDays: 1 }));
    expect(doc.retentionUntil).not.toBeNull();
    expect(await withTenant(t.orgId, (db) => applyRetention(db, t.ownerCtx))).toBe(0);
    const later = { ...t.ownerCtx, now: new Date(Date.now() + 2 * 86400_000) };
    expect(await withTenant(t.orgId, (db) => applyRetention(db, later))).toBe(1);
    await expect(stat(join(storageRoot(), doc.storageKey))).rejects.toThrow();
  });
});

describe("frameworks", () => {
  it("seeds the shared catalog idempotently and exposes it to tenants read-only", async () => {
    const first = await seedSharedFrameworks();
    const again = await seedSharedFrameworks();
    expect(first.frameworks.slice(0, 3).map((f) => [f.key, f.controls])).toEqual([["iso-42001", 65], ["iso-27001-2022", 93], ["nist-ai-rmf-1.0", 72]]);
    expect(first.frameworks).toHaveLength(13);
    expect(first.frameworks.map((f) => f.key)).toContain("eu-ai-act");
    expect(again.frameworks.map((f) => f.id)).toEqual(first.frameworks.map((f) => f.id));
    const list = await withTenant(t.orgId, (db) => listFrameworks(db, viewer.ctx));
    const iso = list.find((f) => f.key === "iso-42001")!;
    expect(iso.shared).toBe(true);
    expect(iso.controlCount).toBe(65);
    const full = await withTenant(t.orgId, (db) => getFramework(db, viewer.ctx, iso.id));
    expect(full.controls.find((c) => c.code === "A.6.2.5")?.automatedEvidenceType).toBe("approval_workflow");
    await expect(withTenant(t.orgId, (db) => addControl(db, t.ownerCtx, iso.id, { code: "X", title: "Nope", summary: "", category: "", keywords: [] }))).rejects.toThrow(/read-only/);
  });
});

describe("assessment engine", () => {
  let frameworkId: string;
  let assessmentId: string;
  let matchedFindingId: string;
  it("classifies a matching control as covered or partial with a cited excerpt and an unmatched control as missing", async () => {
    const fw = await withTenant(t.orgId, (db) => createCustomFramework(db, t.ownerCtx, { key: "mgb-internal", name: "Internal control set", version: "1", description: "Test" }));
    frameworkId = fw.id;
    await withTenant(t.orgId, (db) => addControl(db, t.ownerCtx, fw.id, { code: "IR-1", title: "Incident response procedure", summary: "Security incidents are detected, assessed, contained and recovered under a documented procedure with an incident commander and post-incident review.", category: "Operations", keywords: ["incident", "containment", "incident commander", "post-incident review", "chain of custody"] }));
    await withTenant(t.orgId, (db) => addControl(db, t.ownerCtx, fw.id, { code: "PH-1", title: "Cabling security", summary: "Power and network cabling is protected from interception and damage.", category: "Physical", keywords: ["cabling", "cables", "interception"] }));
    const a = await withTenant(t.orgId, (db) => createAssessment(db, t.ownerCtx, { frameworkId: fw.id, name: "Smoke assessment", scope: "Test", documentIds: [mdDocId, pdfDocId] }));
    expect(a.status).toBe("draft");
    assessmentId = a.id;
    await expect(withTenant(t.orgId, (db) => runAssessment(db, viewer.ctx, a.id))).rejects.toThrow(/Missing permission audit:write/);
    const done = await withTenant(t.orgId, (db) => runAssessment(db, auditor.ctx, a.id), { timeout: 60_000 });
    expect(done.status).toBe("completed");
    const summary = done.summary as { engine: string; counts: Record<string, number>; disclaimer: string; documents: unknown[] };
    expect(summary.engine).toBe("aegis-lexical-v1");
    expect(summary.disclaimer).toMatch(/not proof of compliance/);
    expect(summary.documents).toHaveLength(2);
    const view = await withTenant(t.orgId, (db) => getAssessment(db, viewer.ctx, a.id));
    const ir = view.findings.find((f) => f.control.code === "IR-1")!;
    const ph = view.findings.find((f) => f.control.code === "PH-1")!;
    expect(["covered", "partial"]).toContain(ir.status);
    expect(ir.conclusion).toBe("automated");
    expect(ir.artifacts.length).toBeGreaterThan(0);
    expect(ir.artifacts[0]!.kind).toBe("document");
    expect(ir.artifacts[0]!.excerpt.length).toBeLessThanOrEqual(400);
    expect(ir.artifacts[0]!.reference).toMatch(/Sample IR procedure chunk \d+/);
    expect(ir.rationale).toMatch(/requires human validation/);
    expect(ph.status).toBe("missing");
    expect(ph.recommendation).toMatch(/Document and implement/);
    expect(view.categories.map((c) => c.category)).toEqual(["Operations", "Physical"]);
    matchedFindingId = ir.id;
    const evidence = await withTenant(t.orgId, (db) => db.evidenceEvent.findMany({ where: { orgId: t.orgId, type: "assessment.completed", subjectId: a.id } }));
    expect(evidence).toHaveLength(1);
  });

  it("records human validation and reflects it in control mappings", async () => {
    await expect(withTenant(t.orgId, (db) => validateFinding(db, viewer.ctx, matchedFindingId, { humanStatus: "covered", note: "x" }))).rejects.toThrow(/Missing permission/);
    const v = await withTenant(t.orgId, (db) => validateFinding(db, auditor.ctx, matchedFindingId, { humanStatus: "covered", note: "Checked against the live runbook." }));
    expect(v.humanStatus).toBe("covered");
    expect(v.validatedBy).toBe(auditor.userId);
    expect(v.conclusion).toBe("human_validated");
    const view = await withTenant(t.orgId, (db) => getAssessment(db, viewer.ctx, assessmentId));
    expect(view.review).toEqual({ validated: 1, pending: 1 });
    expect(view.findings.find((f) => f.id === matchedFindingId)!.artifacts.some((x) => x.kind === "human")).toBe(true);
    const refreshed = await withTenant(t.orgId, (db) => refreshControlMappings(db, auditor.ctx, frameworkId));
    expect(refreshed.counts).toEqual({ automated: 0, customer_document: 0, human_validated: 1, missing: 1 });
    const mappings = await withTenant(t.orgId, (db) => listControlMappings(db, viewer.ctx, frameworkId));
    expect(mappings.find((m) => m.control.code === "IR-1")?.source).toBe("human_validated");
    expect(mappings.find((m) => m.control.code === "PH-1")?.status).toBe("missing");
  });

  it("refuses to delete a cited document unless forced", async () => {
    await expect(withTenant(t.orgId, (db) => deleteDocument(db, t.ownerCtx, pdfDocId))).rejects.toThrow(/completed assessment/);
    const detail = await withTenant(t.orgId, (db) => getDocument(db, t.ownerCtx, pdfDocId));
    expect(detail.assessments.map((a) => a.id)).toContain(assessmentId);
  });

  it("enforces the remediation transition order and resolves the finding", async () => {
    const view = await withTenant(t.orgId, (db) => getAssessment(db, viewer.ctx, assessmentId));
    const ph = view.findings.find((f) => f.control.code === "PH-1")!;
    const task = await withTenant(t.orgId, (db) => createTask(db, auditor.ctx, { findingId: ph.id, title: "Protect network cabling", description: "Install conduits.", ownerId: t.ownerUserId, dueAt: new Date(Date.now() + 7 * 86400_000) }));
    expect(task.status).toBe("open");
    const notes = await withTenant(t.orgId, (db) => db.notification.findMany({ where: { orgId: t.orgId, userId: t.ownerUserId, type: "remediation.assigned" } }));
    expect(notes).toHaveLength(1);
    await expect(withTenant(t.orgId, (db) => transition(db, auditor.ctx, task.id, "review"))).rejects.toThrow(/Cannot move a task from open to review/);
    await expect(withTenant(t.orgId, (db) => transition(db, auditor.ctx, task.id, "resolved"))).rejects.toThrow(/Cannot move/);
    await withTenant(t.orgId, (db) => transition(db, auditor.ctx, task.id, "in_progress", "started"));
    await withTenant(t.orgId, (db) => transition(db, auditor.ctx, task.id, "review", "done"));
    const resolved = await withTenant(t.orgId, (db) => transition(db, t.ownerCtx, task.id, "resolved", "accepted"));
    expect(resolved.status).toBe("resolved");
    expect((resolved.history as { to: string }[]).map((h) => h.to)).toEqual(["open", "in_progress", "review", "resolved"]);
    const finding = await withTenant(t.orgId, (db) => db.finding.findUniqueOrThrow({ where: { id: ph.id } }));
    expect(finding.resolvedAt).not.toBeNull();
    await expect(withTenant(t.orgId, (db) => transition(db, t.ownerCtx, task.id, "reopened"))).rejects.toThrow(/note is required/);
    const reopened = await withTenant(t.orgId, (db) => transition(db, t.ownerCtx, task.id, "reopened", "regression found"));
    expect(reopened.status).toBe("reopened");
    expect((await withTenant(t.orgId, (db) => db.finding.findUniqueOrThrow({ where: { id: ph.id } }))).resolvedAt).toBeNull();
    const active = await withTenant(t.orgId, (db) => listTasks(db, viewer.ctx, { status: "active" }));
    expect(active.total).toBe(1);
    await expect(withTenant(t.orgId, (db) => createTask(db, viewer.ctx, { title: "Nope nope", description: "" }))).rejects.toThrow(/Missing permission/);
  });

  it("writes JSON and PDF reports with matching hashes", async () => {
    const json = await withTenant(t.orgId, (db) => generateReport(db, auditor.ctx, { assessmentId, kind: "detailed", format: "json" }));
    const jsonBytes = await readFile(json.path);
    expect(jsonBytes.length).toBe(json.bytes);
    expect(sha256Hex(jsonBytes)).toBe(json.sha256);
    const content = JSON.parse(jsonBytes.toString("utf8")) as { findings: { code: string; conclusionLabel: string; evidence: unknown[] }[]; disclaimer: string; coverage: { humanValidated: number } };
    expect(content.disclaimer).toMatch(/human validation/);
    expect(content.findings.find((f) => f.code === "IR-1")?.conclusionLabel).toBe("Human validated");
    expect(content.findings.find((f) => f.code === "PH-1")?.conclusionLabel).toBe("Automated");
    expect(content.coverage.humanValidated).toBe(1);

    for (const kind of ["executive_summary", "detailed", "evidence_inventory", "gap_report", "remediation_plan"] as const) {
      const pdf = await withTenant(t.orgId, (db) => generateReport(db, auditor.ctx, { assessmentId, kind, format: "pdf" }));
      const bytes = await readFile(pdf.path);
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(sha256Hex(bytes)).toBe(pdf.sha256);
      expect(bytes.length).toBe(pdf.bytes);
    }
    const exports = await withTenant(t.orgId, (db) => listExports(db, viewer.ctx));
    expect(exports).toHaveLength(6);
    const download = await withTenant(t.orgId, (db) => readExport(db, viewer.ctx, json.exportId));
    expect(download.contentType).toBe("application/json");
    expect(download.buffer.equals(jsonBytes)).toBe(true);
    await expect(withTenant(t.orgId, (db) => readExport(db, { ...viewer.ctx, actor: { ...viewer.ctx.actor, permissions: ["org:read"] } }, json.exportId))).rejects.toThrow(/Missing permission reports:read/);
  });

  it("summarises the dashboard", async () => {
    const d = await withTenant(t.orgId, (db) => assessmentDashboard(db, viewer.ctx));
    expect(d.frameworks).toHaveLength(1);
    expect(d.trend).toHaveLength(1);
    expect(d.remediation.open).toBe(1);
    expect(d.review).toEqual({ validated: 1, pending: 1 });
  });
});

describe("demo seed", () => {
  it("seeds documents, two completed assessments, validations, six tasks and a PDF export", async () => {
    const result = await withTenant(t.orgId, (db) => seedDemoAudit(db, t.ownerCtx, { ownerUserId: t.ownerUserId, auditorUserId: auditor.userId }), { timeout: 180_000 });
    expect(result.documents).toHaveLength(3);
    expect(result.documents.every((d) => d.chunkCount > 0)).toBe(true);
    expect(result.assessments.map((a) => a.frameworkKey)).toEqual(["iso-42001", "nist-ai-rmf-1.0"]);
    const iso = result.assessments[0]!;
    expect((iso.counts.covered ?? 0) + (iso.counts.partial ?? 0)).toBeGreaterThanOrEqual(30);
    expect(iso.coveragePercent).toBeGreaterThanOrEqual(25);
    const nist = result.assessments[1]!;
    expect((nist.counts.covered ?? 0) + (nist.counts.partial ?? 0)).toBeGreaterThanOrEqual(25);
    expect(result.validated).toBe(5);
    expect(result.tasks.map((x) => x.status).sort()).toEqual(["in_progress", "open", "open", "reopened", "resolved", "review"]);
    expect(result.export.bytes).toBeGreaterThan(1000);
    const file = await withTenant(t.orgId, (db) => readExport(db, auditor.ctx, result.export.exportId));
    expect(file.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(sha256Hex(file.buffer)).toBe(result.export.sha256);
  }, 240_000);
});
