/**
 * Assessment engine "aegis-lexical-v1".
 *
 * For every control of a framework the engine retrieves the most similar chunks of the selected
 * documents with BM25, applies deterministic checks (keyword overlap, policy-style language,
 * automated evidence from this tenant's own AEGIS records) and classifies the control as
 * covered, partial, ambiguous or missing. Every finding carries a rationale listing the signals
 * and the cited excerpts, and is labelled automated until a person validates it.
 *
 * Similarity is not proof of compliance. The engine never calls an external AI provider.
 */
import type { FindingStatus, Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { conflict, notFound, validation } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { runAutomatedCheck, type AutomatedEvidence } from "./automated-checks.js";
import { Bm25Index, lexicalOverlap, policyPhrasesIn, type SearchHit } from "./retrieval.js";

export const ASSESSMENT_ENGINE = "aegis-lexical-v1";
export const ASSESSMENT_DISCLAIMER = "Automated lexical assessment. Similarity is not proof of compliance. Findings require human validation.";
export const EXCERPT_MAX_CHARS = 400;
const TOP_K = 5;

export const createAssessmentSchema = z.object({
  frameworkId: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  scope: z.string().trim().max(2000).default(""),
  documentIds: z.array(z.string().uuid()).max(100).default([]),
});

export async function createAssessment(db: TenantDb, ctx: OrgContext, input: z.infer<typeof createAssessmentSchema>) {
  assertPermission(ctx, "audit:write");
  const data = createAssessmentSchema.parse(input);
  const framework = await db.framework.findUnique({ where: { id: data.frameworkId }, select: { id: true, key: true, name: true } });
  if (!framework) throw notFound("Framework");
  const ids = [...new Set(data.documentIds)];
  if (ids.length) {
    const found = await db.document.count({ where: { orgId: ctx.orgId, id: { in: ids } } });
    if (found !== ids.length) throw validation("One or more documents do not exist in this organization");
  }
  const now = ctx.now ?? new Date();
  const a = await db.assessment.create({ data: { orgId: ctx.orgId, frameworkId: framework.id, name: data.name, scope: data.scope, documentIds: ids, status: "draft", startedBy: ctx.actor.type === "user" ? ctx.actor.id : null, createdAt: now, updatedAt: now } });
  await appendEvidence(db, ctx, { type: "assessment.created", subjectType: "assessment", subjectId: a.id, payload: { frameworkKey: framework.key, documentCount: ids.length } });
  return a;
}

export interface ControlSignals {
  best: SearchHit | null;
  hits: SearchHit[];
  overlap: number;
  policyPhrases: string[];
  automated: AutomatedEvidence | null;
}

export interface Classification {
  status: FindingStatus;
  confidence: number;
  reasons: string[];
}

/** Pure classification from signals. Exported for tests. Thresholds documented inline. */
export function classify(s: ControlSignals): Classification {
  const score = s.best?.normalisedScore ?? 0;
  const overlap = s.overlap;
  const automatedPresent = !!s.automated?.present;
  const reasons: string[] = [];
  let status: FindingStatus;
  if ((score >= 0.6 && overlap >= 0.5) || (automatedPresent && score >= 0.3)) {
    status = "covered";
    reasons.push(automatedPresent && score >= 0.3 && !(score >= 0.6 && overlap >= 0.5) ? "document evidence corroborated by AEGIS records" : "strong lexical match with high keyword overlap");
  } else if (automatedPresent && score < 0.3) {
    // Conflicting signals: the platform holds supporting records but the documents barely mention the topic.
    status = "ambiguous";
    reasons.push("AEGIS records exist but the selected documents do not describe this control");
  } else if (score >= 0.35 && overlap < 0.15 && s.policyPhrases.length === 0) {
    status = "ambiguous";
    reasons.push("lexical match without keyword overlap or normative language");
  } else if (score >= 0.35) {
    status = "partial";
    reasons.push("moderate lexical match; coverage appears incomplete");
  } else if (score >= 0.2) {
    status = "ambiguous";
    reasons.push("weak lexical match; the topic may be addressed indirectly");
  } else {
    status = "missing";
    reasons.push(s.best ? "no sufficiently similar passage found" : "no matching passage found");
  }
  const confidence = Math.min(1, 0.5 * score + 0.3 * overlap + 0.2 * (automatedPresent ? 1 : 0));
  return { status, confidence: Math.round(confidence * 1000) / 1000, reasons };
}

export function recommendationFor(status: FindingStatus, control: { title: string; summary: string }, bestDocTitle: string | null): string {
  const objective = control.summary || control.title;
  switch (status) {
    case "covered":
      return `Keep the cited evidence current${bestDocTitle ? ` and re-run the assessment after the next revision of "${bestDocTitle}"` : ""}. Confirm during human validation that the passage states who is responsible and how often it is reviewed.`;
    case "partial":
      return `Strengthen the documentation for "${control.title}" so that it clearly addresses: ${objective} Add explicit responsibilities, a review cadence and an approval record.`;
    case "ambiguous":
      return `Review the cited passages manually and decide whether they satisfy: ${objective} If they do not, add a dedicated section or procedure for "${control.title}".`;
    case "missing":
      return `Document and implement "${control.title}": ${objective} No supporting passage was found in the selected documents; attach the relevant policy or procedure and re-run the assessment.`;
  }
}

export function excerptOf(text: string, max = EXCERPT_MAX_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 3);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + "...";
}

function rationaleFor(s: ControlSignals, c: Classification, chunkRef: (id: string) => string): string {
  const parts: string[] = [];
  if (s.best) parts.push(`Best lexical match: ${chunkRef(s.best.chunkId)} (similarity ${s.best.normalisedScore.toFixed(2)}, ${Math.round(s.best.termCoverage * 100)}% of query terms present).`);
  else parts.push("No passage in the selected documents matched the control wording.");
  parts.push(`Keyword overlap with the best passage: ${Math.round(s.overlap * 100)}%.`);
  parts.push(s.policyPhrases.length ? `Normative language found: ${s.policyPhrases.join(", ")}.` : "No normative language (shall, must, approved by) found in the best passage.");
  if (s.automated) parts.push(`Automated evidence (${s.automated.reference}): ${s.automated.detail}${s.automated.present ? "" : " No supporting records."}`);
  parts.push(`Classification: ${c.status} (${c.reasons.join("; ")}). Confidence ${c.confidence.toFixed(2)}.`);
  parts.push("Automated conclusion; requires human validation.");
  return parts.join(" ");
}

export interface RunOptions {
  /** Skip automated AEGIS record checks (tests, or documents-only mode). */
  skipAutomatedChecks?: boolean;
}

/**
 * Runs the engine over the assessment's documents. Re-running a completed or failed assessment
 * replaces its findings and artifacts. Should run in its own tenant transaction; on failure the
 * assessment is marked failed with the error message when the transaction is still usable.
 */
export async function runAssessment(db: TenantDb, ctx: OrgContext, assessmentId: string, opts: RunOptions = {}) {
  assertPermission(ctx, "audit:write");
  const a = await db.assessment.findUnique({ where: { id: assessmentId }, include: { framework: { include: { controls: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }] } } } } });
  if (!a) throw notFound("Assessment");
  if (a.status === "running") throw conflict("Assessment is already running");
  if (a.framework.controls.length === 0) throw validation("The framework has no controls");
  const started = Date.now();
  const now = () => ctx.now ?? new Date();
  await db.assessment.update({ where: { id: a.id }, data: { status: "running", updatedAt: now() } });
  try {
    const documents = a.documentIds.length ? await db.document.findMany({ where: { orgId: ctx.orgId, id: { in: a.documentIds }, status: "parsed" }, select: { id: true, title: true, chunkCount: true } }) : [];
    const chunks = documents.length ? await db.documentChunk.findMany({ where: { documentId: { in: documents.map((d) => d.id) } }, select: { id: true, documentId: true, idx: true, page: true, text: true }, orderBy: [{ documentId: "asc" }, { idx: "asc" }] }) : [];
    const chunkById = new Map(chunks.map((c) => [c.id, c]));
    const docTitle = new Map(documents.map((d) => [d.id, d.title]));
    const chunkRef = (id: string) => {
      const c = chunkById.get(id)!;
      return `${docTitle.get(c.documentId) ?? "document"}${c.page ? ` p.${c.page}` : ""} chunk ${c.idx}`;
    };
    const index = new Bm25Index(chunks.map((c) => ({ id: c.id, text: c.text })));

    await db.evidenceArtifact.deleteMany({ where: { assessmentId: a.id } });
    await db.finding.deleteMany({ where: { assessmentId: a.id } });

    const automatedCache = new Map<string, AutomatedEvidence | null>();
    const counts: Record<FindingStatus, number> = { covered: 0, partial: 0, missing: 0, ambiguous: 0 };
    let automatedArtifacts = 0;
    for (const control of a.framework.controls) {
      const query = [control.title, control.summary, ...control.keywords].join(" ");
      const hits = index.search(query, TOP_K);
      const best = hits[0] ?? null;
      const bestChunk = best ? chunkById.get(best.chunkId) : undefined;
      let automated: AutomatedEvidence | null = null;
      if (!opts.skipAutomatedChecks && control.automatedEvidenceType) {
        if (!automatedCache.has(control.automatedEvidenceType)) automatedCache.set(control.automatedEvidenceType, await runAutomatedCheck(db, ctx, control.automatedEvidenceType));
        automated = automatedCache.get(control.automatedEvidenceType) ?? null;
      }
      const signals: ControlSignals = { best, hits, overlap: bestChunk ? lexicalOverlap(control.keywords, bestChunk.text) : 0, policyPhrases: bestChunk ? policyPhrasesIn(bestChunk.text) : [], automated };
      const c = classify(signals);
      counts[c.status]++;
      const finding = await db.finding.create({
        data: {
          orgId: ctx.orgId,
          assessmentId: a.id,
          controlId: control.id,
          status: c.status,
          confidence: c.confidence,
          rationale: rationaleFor(signals, c, chunkRef),
          recommendation: recommendationFor(c.status, control, bestChunk ? (docTitle.get(bestChunk.documentId) ?? null) : null),
          createdAt: now(),
          updatedAt: now(),
        },
      });
      const artifacts: Prisma.EvidenceArtifactCreateManyInput[] = hits
        .filter((h) => h.normalisedScore >= 0.1)
        .map((h) => {
          const ch = chunkById.get(h.chunkId)!;
          return { orgId: ctx.orgId, assessmentId: a.id, findingId: finding.id, kind: "document" as const, documentId: ch.documentId, chunkId: ch.id, excerpt: excerptOf(ch.text), score: h.normalisedScore, reference: chunkRef(ch.id), createdAt: now() };
        });
      if (automated?.present) {
        artifacts.push({ orgId: ctx.orgId, assessmentId: a.id, findingId: finding.id, kind: "automated", excerpt: automated.detail, score: 1, reference: automated.reference, createdAt: now() });
        automatedArtifacts++;
      }
      if (artifacts.length) await db.evidenceArtifact.createMany({ data: artifacts });
    }

    const total = a.framework.controls.length;
    const summary = {
      engine: ASSESSMENT_ENGINE,
      disclaimer: ASSESSMENT_DISCLAIMER,
      total,
      counts,
      coveragePercent: Math.round((counts.covered / total) * 100),
      weightedCoveragePercent: Math.round(((counts.covered + 0.5 * counts.partial) / total) * 100),
      documents: documents.map((d) => ({ id: d.id, title: d.title, chunkCount: d.chunkCount })),
      documentsRequested: a.documentIds.length,
      chunkCount: chunks.length,
      automatedArtifacts,
      durationMs: Date.now() - started,
      completedAt: now().toISOString(),
    };
    const completed = await db.assessment.update({ where: { id: a.id }, data: { status: "completed", summary: summary as Prisma.InputJsonValue, completedAt: now(), updatedAt: now() } });
    await appendEvidence(db, ctx, { type: "assessment.completed", subjectType: "assessment", subjectId: a.id, payload: { frameworkKey: a.framework.key, engine: ASSESSMENT_ENGINE, counts, coveragePercent: summary.coveragePercent, documentCount: documents.length, durationMs: summary.durationMs } });
    await refreshControlMappings(db, ctx, a.frameworkId);
    return completed;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    try {
      const failed = await db.assessment.update({ where: { id: a.id }, data: { status: "failed", summary: { engine: ASSESSMENT_ENGINE, error: message, failedAt: now().toISOString() } as Prisma.InputJsonValue, updatedAt: now() } });
      await appendEvidence(db, ctx, { type: "assessment.failed", subjectType: "assessment", subjectId: a.id, payload: { error: message } });
      return failed;
    } catch {
      // The transaction is no longer usable; surface the original error.
      throw err;
    }
  }
}

export const assessmentListFilter = z.object({
  frameworkId: z.string().uuid().optional(),
  status: z.enum(["draft", "running", "completed", "failed", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export async function listAssessments(db: TenantDb, ctx: OrgContext, f: Partial<z.infer<typeof assessmentListFilter>> = {}) {
  assertPermission(ctx, "audit:read");
  const filter = assessmentListFilter.parse(f);
  const where: Prisma.AssessmentWhereInput = { orgId: ctx.orgId, ...(filter.frameworkId ? { frameworkId: filter.frameworkId } : {}), ...(filter.status === "all" ? {} : { status: filter.status }) };
  const [items, total] = await Promise.all([
    db.assessment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (filter.page - 1) * filter.pageSize, take: filter.pageSize, include: { framework: { select: { id: true, key: true, name: true, version: true } } } }),
    db.assessment.count({ where }),
  ]);
  return { items, total, page: filter.page, pageSize: filter.pageSize, pageCount: Math.max(1, Math.ceil(total / filter.pageSize)) };
}

/** Label every consumer must show next to a finding. */
export function conclusionLabel(f: { humanStatus: FindingStatus | null; validatedBy: string | null }): "human_validated" | "automated" {
  return f.humanStatus && f.validatedBy ? "human_validated" : "automated";
}

export async function getAssessment(db: TenantDb, ctx: OrgContext, assessmentId: string) {
  assertPermission(ctx, "audit:read");
  const a = await db.assessment.findUnique({ where: { id: assessmentId }, include: { framework: true } });
  if (!a) throw notFound("Assessment");
  const findings = await db.finding.findMany({
    where: { assessmentId },
    include: { control: true, artifacts: { orderBy: [{ kind: "asc" }, { score: "desc" }] }, remediation: { select: { id: true, title: true, status: true, ownerId: true, dueAt: true } } },
  });
  findings.sort((x, y) => x.control.sortOrder - y.control.sortOrder || x.control.code.localeCompare(y.control.code));
  const documents = a.documentIds.length ? await db.document.findMany({ where: { orgId: ctx.orgId, id: { in: a.documentIds } }, select: { id: true, title: true, filename: true, status: true, chunkCount: true, pageCount: true, sha256: true } }) : [];
  const decorated = findings.map((f) => ({ ...f, effectiveStatus: (f.humanStatus ?? f.status) as FindingStatus, conclusion: conclusionLabel(f) }));
  const categoryOrder: string[] = [];
  const byCategory = new Map<string, typeof decorated>();
  for (const f of decorated) {
    const cat = f.control.category || "General";
    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
      categoryOrder.push(cat);
    }
    byCategory.get(cat)!.push(f);
  }
  const categories = categoryOrder.map((category) => {
    const list = byCategory.get(category)!;
    const counts: Record<FindingStatus, number> = { covered: 0, partial: 0, missing: 0, ambiguous: 0 };
    for (const f of list) counts[f.effectiveStatus]++;
    return { category, counts, findingIds: list.map((f) => f.id) };
  });
  const review = { validated: decorated.filter((f) => f.conclusion === "human_validated").length, pending: decorated.filter((f) => f.conclusion === "automated").length };
  return { ...a, documents, findings: decorated, categories, review, disclaimer: ASSESSMENT_DISCLAIMER };
}

export const validateFindingSchema = z.object({ humanStatus: z.enum(["covered", "partial", "missing", "ambiguous"]), note: z.string().trim().max(2000).default("") });

export async function validateFinding(db: TenantDb, ctx: OrgContext, findingId: string, input: z.infer<typeof validateFindingSchema>) {
  assertPermission(ctx, "audit:write");
  if (ctx.actor.type !== "user" || !ctx.actor.id) throw validation("Only a signed-in person can validate a finding");
  const data = validateFindingSchema.parse(input);
  const f = await db.finding.findUnique({ where: { id: findingId }, include: { control: { select: { code: true } } } });
  if (!f) throw notFound("Finding");
  const now = ctx.now ?? new Date();
  const updated = await db.finding.update({ where: { id: findingId }, data: { humanStatus: data.humanStatus, validatedBy: ctx.actor.id, validatedAt: now, validationNote: data.note, updatedAt: now } });
  await db.evidenceArtifact.create({ data: { orgId: ctx.orgId, assessmentId: f.assessmentId, findingId: f.id, kind: "human", excerpt: data.note, score: 1, reference: `human:${ctx.actor.label ?? ctx.actor.id}:${data.humanStatus}`, addedBy: ctx.actor.id, createdAt: now } });
  await appendEvidence(db, ctx, { type: "finding.validated", subjectType: "finding", subjectId: f.id, payload: { assessmentId: f.assessmentId, control: f.control.code, automatedStatus: f.status, humanStatus: data.humanStatus, changed: f.status !== data.humanStatus } });
  return { ...updated, conclusion: "human_validated" as const };
}

export async function resolveFinding(db: TenantDb, ctx: OrgContext, findingId: string, note = "") {
  assertPermission(ctx, "audit:write");
  const f = await db.finding.findUnique({ where: { id: findingId } });
  if (!f) throw notFound("Finding");
  const now = ctx.now ?? new Date();
  const updated = await db.finding.update({ where: { id: findingId }, data: { resolvedAt: now, updatedAt: now } });
  await appendEvidence(db, ctx, { type: "finding.resolved", subjectType: "finding", subjectId: f.id, payload: { assessmentId: f.assessmentId, note } });
  return updated;
}

export async function reopenFinding(db: TenantDb, ctx: OrgContext, findingId: string, note = "") {
  assertPermission(ctx, "audit:write");
  const f = await db.finding.findUnique({ where: { id: findingId } });
  if (!f) throw notFound("Finding");
  const updated = await db.finding.update({ where: { id: findingId }, data: { resolvedAt: null, updatedAt: ctx.now ?? new Date() } });
  await appendEvidence(db, ctx, { type: "finding.reopened", subjectType: "finding", subjectId: f.id, payload: { assessmentId: f.assessmentId, note } });
  return updated;
}

/** Headline numbers for the Audit landing page. */
export async function assessmentDashboard(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "audit:read");
  const now = ctx.now ?? new Date();
  const completed = await db.assessment.findMany({ where: { orgId: ctx.orgId, status: "completed" }, orderBy: { completedAt: "asc" }, include: { framework: { select: { id: true, key: true, name: true, version: true } } } });
  const latestByFramework = new Map<string, (typeof completed)[number]>();
  for (const a of completed) latestByFramework.set(a.frameworkId, a);
  const coverageOf = (a: (typeof completed)[number]) => (a.summary as { coveragePercent?: number }).coveragePercent ?? 0;
  const frameworks = [...latestByFramework.values()].map((a) => ({ framework: a.framework, assessmentId: a.id, name: a.name, completedAt: a.completedAt, coveragePercent: coverageOf(a), counts: (a.summary as { counts?: Record<FindingStatus, number> }).counts ?? null }));
  const trend = completed.map((a) => ({ assessmentId: a.id, frameworkKey: a.framework.key, completedAt: a.completedAt, coveragePercent: coverageOf(a) }));
  const latestIds = [...latestByFramework.values()].map((a) => a.id);
  const [validated, pending, openRemediation, overdueRemediation, docs, drafts] = await Promise.all([
    latestIds.length ? db.finding.count({ where: { assessmentId: { in: latestIds }, validatedBy: { not: null } } }) : 0,
    latestIds.length ? db.finding.count({ where: { assessmentId: { in: latestIds }, validatedBy: null } }) : 0,
    db.remediationTask.count({ where: { orgId: ctx.orgId, status: { not: "resolved" } } }),
    db.remediationTask.count({ where: { orgId: ctx.orgId, status: { not: "resolved" }, dueAt: { lt: now } } }),
    db.document.groupBy({ by: ["status"], where: { orgId: ctx.orgId }, _count: { _all: true } }),
    db.assessment.count({ where: { orgId: ctx.orgId, status: { in: ["draft", "running"] } } }),
  ]);
  return {
    frameworks,
    trend,
    review: { validated, pending },
    remediation: { open: openRemediation, overdue: overdueRemediation },
    documents: Object.fromEntries(docs.map((d) => [d.status, d._count._all])) as Record<string, number>,
    assessmentsInProgress: drafts,
    disclaimer: ASSESSMENT_DISCLAIMER,
  };
}

/**
 * Compliance evidence mapping for the Assurance module. One row per control of the framework,
 * derived from the latest completed assessment: human_validated when a person validated the
 * finding, automated when AEGIS records support it, customer_document when document passages
 * were cited, missing otherwise. Idempotent upsert by (orgId, controlId).
 */
export async function refreshControlMappings(db: TenantDb, ctx: OrgContext, frameworkId: string) {
  assertPermission(ctx, "audit:write");
  const framework = await db.framework.findUnique({ where: { id: frameworkId }, include: { controls: { select: { id: true, automatedEvidenceType: true } } } });
  if (!framework) throw notFound("Framework");
  const latest = await db.assessment.findFirst({ where: { orgId: ctx.orgId, frameworkId, status: "completed" }, orderBy: { completedAt: "desc" }, select: { id: true } });
  const findings = latest ? await db.finding.findMany({ where: { assessmentId: latest.id }, include: { artifacts: { select: { kind: true } } } }) : [];
  const byControl = new Map(findings.map((f) => [f.controlId, f]));
  const now = ctx.now ?? new Date();
  const counts = { automated: 0, customer_document: 0, human_validated: 0, missing: 0 };
  for (const control of framework.controls) {
    const f = byControl.get(control.id);
    let source: keyof typeof counts = "missing";
    let evidenceType: string | null = null;
    let status = "not_assessed";
    let notes = latest ? "" : "No completed assessment for this framework.";
    if (f) {
      const effective = f.humanStatus ?? f.status;
      status = effective;
      const hasAutomated = f.artifacts.some((x) => x.kind === "automated");
      const hasDocument = f.artifacts.some((x) => x.kind === "document");
      if (f.validatedBy && f.humanStatus) source = "human_validated";
      else if (hasAutomated && (effective === "covered" || effective === "partial")) source = "automated";
      else if (hasDocument && (effective === "covered" || effective === "partial")) source = "customer_document";
      else source = "missing";
      evidenceType = hasAutomated ? control.automatedEvidenceType : hasDocument ? "document" : null;
      notes = f.rationale.slice(0, 300);
    }
    counts[source]++;
    await db.controlMapping.upsert({
      where: { orgId_controlId: { orgId: ctx.orgId, controlId: control.id } },
      create: { orgId: ctx.orgId, controlId: control.id, source, evidenceType, status, notes, validatedBy: f?.validatedBy ?? null, validatedAt: f?.validatedAt ?? null, createdAt: now, updatedAt: now },
      update: { source, evidenceType, status, notes, validatedBy: f?.validatedBy ?? null, validatedAt: f?.validatedAt ?? null, updatedAt: now },
    });
  }
  return { frameworkId, assessmentId: latest?.id ?? null, controls: framework.controls.length, counts };
}

/** Read side for the Assurance module. */
export async function listControlMappings(db: TenantDb, ctx: OrgContext, frameworkId?: string) {
  assertPermission(ctx, "audit:read");
  return db.controlMapping.findMany({ where: { orgId: ctx.orgId, ...(frameworkId ? { control: { frameworkId } } : {}) }, include: { control: { select: { id: true, code: true, title: true, category: true, frameworkId: true } } }, orderBy: { updatedAt: "desc" } });
}
