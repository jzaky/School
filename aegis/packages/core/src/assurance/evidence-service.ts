import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence, exportCheckpointPublicKey, verifyChain } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { sha256Hex } from "../lib/crypto.js";
import { assertPermission } from "../orgs/orgs.js";

export const evidenceFilter = z.object({
  type: z.string().optional(),
  subjectType: z.string().optional(),
  subjectId: z.string().optional(),
  correlationId: z.string().optional(),
  actorId: z.string().optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listEvidence(db: TenantDb, ctx: OrgContext, f: z.infer<typeof evidenceFilter>) {
  assertPermission(ctx, "evidence:read");
  const where: Prisma.EvidenceEventWhereInput = {
    orgId: ctx.orgId,
    ...(f.type ? { type: f.type.endsWith("*") ? { startsWith: f.type.slice(0, -1) } : f.type } : {}),
    ...(f.subjectType ? { subjectType: f.subjectType } : {}),
    ...(f.subjectId ? { subjectId: f.subjectId } : {}),
    ...(f.correlationId ? { correlationId: f.correlationId } : {}),
    ...(f.actorId ? { actorId: f.actorId } : {}),
    ...(f.since || f.until ? { occurredAt: { ...(f.since ? { gte: f.since } : {}), ...(f.until ? { lte: f.until } : {}) } } : {}),
    ...(f.q ? { OR: [{ type: { contains: f.q } }, { subjectId: { contains: f.q } }, { correlationId: { contains: f.q } }, { hash: { startsWith: f.q } }] } : {}),
  };
  const [items, total] = await Promise.all([db.evidenceEvent.findMany({ where, orderBy: { seq: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }), db.evidenceEvent.count({ where })]);
  return { items, total, page: f.page, pageSize: f.pageSize, pageCount: Math.max(1, Math.ceil(total / f.pageSize)) };
}

export async function evidenceTypes(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "evidence:read");
  const rows = await db.evidenceEvent.groupBy({ by: ["type"], where: { orgId: ctx.orgId }, _count: { _all: true }, orderBy: { _count: { type: "desc" } } });
  return rows.map((r) => ({ type: r.type, count: r._count._all }));
}

export async function getEvidenceEvent(db: TenantDb, ctx: OrgContext, seq: bigint) {
  assertPermission(ctx, "evidence:read");
  const ev = await db.evidenceEvent.findUnique({ where: { orgId_seq: { orgId: ctx.orgId, seq } } });
  if (!ev) return null;
  const related = await db.evidenceEvent.findMany({ where: { orgId: ctx.orgId, correlationId: ev.correlationId }, orderBy: { seq: "asc" } });
  const verified = await verifyChain(db, ctx.orgId, { fromSeq: seq, limit: 1 });
  return { event: ev, related, verified: verified.valid && verified.checked === 1 };
}

/** Verification is itself evidence: who checked, when, and the outcome. */
export async function verifyAndRecord(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "evidence:read");
  const result = await verifyChain(db, ctx.orgId);
  await appendEvidence(db, ctx, { type: "evidence.verified", subjectType: "evidence_chain", subjectId: ctx.orgId, payload: { valid: result.valid, checked: result.checked, firstBadSeq: result.firstBadSeq, reason: result.reason, checkpoints: result.checkpoints.length } });
  return result;
}

export interface EvidenceExport {
  filename: string;
  contentType: string;
  body: string;
  sha256: string;
  count: number;
  verification: Awaited<ReturnType<typeof verifyChain>>;
}

/**
 * Exports evidence as JSON Lines or CSV together with the chain verification result and the
 * checkpoint public key, so a third party can re-verify offline. The export itself is recorded.
 */
export async function exportEvidence(db: TenantDb, ctx: OrgContext, f: z.infer<typeof evidenceFilter> & { format: "jsonl" | "csv" }): Promise<EvidenceExport> {
  assertPermission(ctx, "evidence:read");
  const rows = await db.evidenceEvent.findMany({
    where: { orgId: ctx.orgId, ...(f.since || f.until ? { occurredAt: { ...(f.since ? { gte: f.since } : {}), ...(f.until ? { lte: f.until } : {}) } } : {}), ...(f.type ? { type: f.type.endsWith("*") ? { startsWith: f.type.slice(0, -1) } : f.type } : {}), ...(f.subjectType ? { subjectType: f.subjectType } : {}), ...(f.correlationId ? { correlationId: f.correlationId } : {}) },
    orderBy: { seq: "asc" },
    take: 50_000,
  });
  const verification = await verifyChain(db, ctx.orgId);
  const stamp = new Date().toISOString();
  let body: string;
  if (f.format === "jsonl") {
    const header = JSON.stringify({ aegisEvidenceExport: 1, orgId: ctx.orgId, exportedAt: stamp, count: rows.length, verification: { valid: verification.valid, checked: verification.checked, firstBadSeq: verification.firstBadSeq, lastHash: verification.lastHash }, checkpointPublicKeyPem: exportCheckpointPublicKey(), hashAlgorithm: "sha256(canonical_json(event) with prevHash)", note: "Tamper-evident, not immutable. Re-verify by recomputing each hash from the fields and the previous hash." });
    body = [header, ...rows.map((r) => JSON.stringify({ ...r, seq: r.seq.toString(), occurredAt: r.occurredAt.toISOString() }))].join("\n") + "\n";
  } else {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["seq", "occurredAt", "type", "actorType", "actorId", "subjectType", "subjectId", "correlationId", "prevHash", "hash", "payload"].join(",");
    body = [head, ...rows.map((r) => [r.seq.toString(), r.occurredAt.toISOString(), r.type, r.actorType, r.actorId, r.subjectType, r.subjectId, r.correlationId, r.prevHash, r.hash, JSON.stringify(r.payload)].map(esc).join(","))].join("\n") + "\n";
  }
  const sha256 = sha256Hex(body);
  await appendEvidence(db, ctx, { type: "evidence.exported", subjectType: "evidence_chain", subjectId: ctx.orgId, payload: { format: f.format, count: rows.length, sha256, filters: { type: f.type ?? null, since: f.since ?? null, until: f.until ?? null } } });
  return { filename: `aegis-evidence-${stamp.slice(0, 10)}.${f.format}`, contentType: f.format === "jsonl" ? "application/x-ndjson" : "text/csv", body, sha256, count: rows.length, verification };
}

/**
 * Governance report: a structured snapshot combining metrics, policy activity, approvals, alerts,
 * incidents and chain status for a period. JSON always; the console renders it and offers PDF.
 */
export async function governanceReport(db: TenantDb, ctx: OrgContext, days = 30, opts: { record?: boolean } = {}) {
  assertPermission(ctx, "reports:read");
  const since = new Date(Date.now() - days * 86400_000);
  const { governanceMetrics, approvalTurnaround, topAgentsByDenials } = await import("./dashboard.js");
  const [metrics, turnaround, topDenied, policyEvents, alertsBySeverity, incidents, controlMappings] = await Promise.all([
    governanceMetrics(db, ctx, days),
    approvalTurnaround(db, ctx, days),
    topAgentsByDenials(db, ctx, days, 10),
    db.policyEvent.findMany({ where: { orgId: ctx.orgId, createdAt: { gte: since } }, include: { policy: { select: { key: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.alert.groupBy({ by: ["severity", "status"], where: { orgId: ctx.orgId, createdAt: { gte: since } }, _count: { _all: true } }),
    db.incident.findMany({ where: { orgId: ctx.orgId, createdAt: { gte: since } }, select: { number: true, title: true, severity: true, status: true, createdAt: true, resolvedAt: true } }),
    db.controlMapping.groupBy({ by: ["source"], where: { orgId: ctx.orgId }, _count: { _all: true } }),
  ]);
  const chain = await verifyChain(db, ctx.orgId);
  const report = {
    generatedAt: new Date().toISOString(),
    periodDays: days,
    organizationId: ctx.orgId,
    disclaimer: "Figures are counts over AEGIS records for this organization. Automated evidence shows that controls operated inside AEGIS; it does not by itself demonstrate organizational compliance with any standard.",
    metrics,
    approvals: turnaround,
    topDeniedAgents: topDenied,
    policyActivity: policyEvents.map((e) => ({ at: e.createdAt, policy: e.policy.key, type: e.type, note: e.note })),
    alerts: alertsBySeverity.map((a) => ({ severity: a.severity, status: a.status, count: a._count._all })),
    incidents,
    complianceEvidence: controlMappings.map((m) => ({ source: m.source, controls: m._count._all })),
    evidenceChain: { valid: chain.valid, checked: chain.checked, lastHash: chain.lastHash, checkpoints: chain.checkpoints.length },
  };
  // Viewing the report in the console is a read; only an explicit export is recorded as evidence.
  if (opts.record) await appendEvidence(db, ctx, { type: "report.generated", subjectType: "report", subjectId: "governance", payload: { periodDays: days, sha256: sha256Hex(JSON.stringify(report)) } });
  return report;
}
